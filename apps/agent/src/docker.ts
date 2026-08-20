import Docker from "dockerode";
import type { RuntimeSpec } from "@velozplanel/contracts";

/**
 * Wrapper dockerode do Agente VelozPlanel.
 *
 * Estratégia de página (sem bind mount — funciona no Docker Desktop):
 *   O container recebe o conteúdo do ambiente via variáveis de ambiente
 *   (VP_ENV_NAME / VP_RUNTIME_KIND / VP_RUNTIME_VERSION). O Cmd é um pequeno
 *   script `sh -c` que ESCREVE o arquivo servidor DENTRO do container e sobe o
 *   HTTP server na porta 80 em 0.0.0.0. O arquivo é estático (lê as env vars em
 *   runtime), então não injetamos valores dinâmicos na string do shell — evita
 *   qualquer problema de quoting/escape.
 *
 * Estratégia de porta:
 *   Publicamos a porta 80 do container com HostPort "" (efêmera). O Docker
 *   escolhe uma porta livre do host; lemos ela em `inspect`
 *   (NetworkSettings.Ports["80/tcp"][0].HostPort). Mais robusto que tentar
 *   adivinhar uma porta livre no host.
 */

const docker = new Docker(); // usa /var/run/docker.sock (Docker Desktop no Mac)

export interface Limits {
  vcpu: number; // 1.0 = 1 vCPU
  memMb: number;
}

export interface ProvisionArgs {
  envId: string;
  name: string;
  runtime: RuntimeSpec;
  limits: Limits;
}

export interface ProvisionResult {
  containerId: string;
  httpPort: number;
}

export interface StatsResult {
  cpuPct: number;
  memBytes: number;
  memLimitBytes: number;
}

/** PHP: um index.php estático que lê as env vars e imprime a página. */
const PHP_INDEX = `<?php
$name = htmlspecialchars(getenv("VP_ENV_NAME") ?: "unknown");
$kind = htmlspecialchars(getenv("VP_RUNTIME_KIND") ?: "php");
$ver  = htmlspecialchars(getenv("VP_RUNTIME_VERSION") ?: "");
header("Content-Type: text/html; charset=utf-8");
echo "<!doctype html><meta charset=utf-8><title>$name</title>";
echo "<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:3rem auto;padding:0 1rem}</style>";
echo "<h1>$name</h1><p><strong>Runtime:</strong> $kind $ver</p>";
echo "<p>Container VelozPlanel ativo.</p>";
`;

/** Node: um server http inline estático que lê as env vars. */
const NODE_SERVER = `const http = require("http");
const name = process.env.VP_ENV_NAME || "unknown";
const kind = process.env.VP_RUNTIME_KIND || "node";
const ver = process.env.VP_RUNTIME_VERSION || "";
const style = "body{font-family:system-ui,sans-serif;max-width:640px;margin:3rem auto;padding:0 1rem}";
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(\`<!doctype html><meta charset=utf-8><title>\${name}</title><style>\${style}</style><h1>\${name}</h1><p><strong>Runtime:</strong> \${kind} \${ver}</p><p>Container VelozPlanel ativo.</p>\`);
}).listen(80, "0.0.0.0");
console.log("VelozPlanel node server on :80");
`;

/** Puxa a imagem se ela não existir localmente. */
async function ensureImage(image: string): Promise<void> {
  try {
    await docker.getImage(image).inspect();
    return; // já existe
  } catch {
    // não existe local -> pull
  }
  await new Promise<void>((resolve, reject) => {
    docker.pull(image, (err: unknown, stream: NodeJS.ReadableStream | undefined) => {
      if (err || !stream) return reject(err ?? new Error(`pull falhou: ${image}`));
      docker.modem.followProgress(stream, (doneErr: Error | null) =>
        doneErr ? reject(doneErr) : resolve(),
      );
    });
  });
}

function imageFor(runtime: RuntimeSpec): string {
  return runtime.kind === "php"
    ? `php:${runtime.version}-cli`
    : `node:${runtime.version}-alpine`;
}

/**
 * Monta o Cmd que escreve o arquivo servidor e sobe o server na :80.
 * O conteúdo do arquivo vai entre aspas SIMPLES no shell; nenhum dos templates
 * (PHP_INDEX / NODE_SERVER) contém aspas simples, então o quoting é seguro.
 */
function cmdFor(runtime: RuntimeSpec): string[] {
  if (runtime.kind === "php") {
    const script =
      `mkdir -p /var/www && printf '%s' '${PHP_INDEX}' > /var/www/index.php && ` +
      `exec php -S 0.0.0.0:80 -t /var/www`;
    return ["sh", "-c", script];
  }
  const script =
    `mkdir -p /app && printf '%s' '${NODE_SERVER}' > /app/server.js && ` +
    `exec node /app/server.js`;
  return ["sh", "-c", script];
}

export async function provision(args: ProvisionArgs): Promise<ProvisionResult> {
  const { envId, name, runtime, limits } = args;
  const image = imageFor(runtime);
  await ensureImage(image);

  const container = await docker.createContainer({
    Image: image,
    Cmd: cmdFor(runtime),
    Env: [
      `VP_ENV_NAME=${name}`,
      `VP_RUNTIME_KIND=${runtime.kind}`,
      `VP_RUNTIME_VERSION=${runtime.version}`,
    ],
    Labels: { "vp.env": envId },
    ExposedPorts: { "80/tcp": {} },
    HostConfig: {
      Memory: Math.round(limits.memMb * 1024 * 1024),
      NanoCpus: Math.round(limits.vcpu * 1e9),
      RestartPolicy: { Name: "no" },
      // HostPort "" => Docker escolhe uma porta efêmera livre no host.
      PortBindings: { "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "" }] },
    },
  });

  await container.start();

  const binding = await waitForPort(container);
  if (!binding) {
    let logTail = "";
    try {
      const buf = await container.logs({ stdout: true, stderr: true, tail: 15 });
      logTail = buf.toString("utf8").replace(/[^\x20-\x7e\n]/g, "").trim().slice(-500);
    } catch {
      /* ignore */
    }
    await container.remove({ force: true }).catch(() => {});
    throw new Error(`Docker não publicou a porta 80 do container. log: ${logTail}`);
  }

  return { containerId: container.id, httpPort: Number(binding) };
}

/**
 * A porta efêmera pode levar alguns ms para aparecer no inspect após o start;
 * fazemos poll (até ~4s). Retorna a HostPort ou undefined se o container saiu.
 */
async function waitForPort(container: Docker.Container): Promise<string | undefined> {
  for (let i = 0; i < 20; i++) {
    const info = await container.inspect();
    const binding = info.NetworkSettings?.Ports?.["80/tcp"]?.[0]?.HostPort ?? undefined;
    if (binding) return binding;
    if (info.State?.Status === "exited") return undefined; // saiu -> não adianta esperar
    await new Promise((r) => setTimeout(r, 200));
  }
  return undefined;
}

/** Inicia um container parado e devolve a NOVA porta efêmera publicada. */
export async function start(containerId: string): Promise<number> {
  const container = docker.getContainer(containerId);
  await container.start();
  const binding = await waitForPort(container);
  if (!binding) throw new Error("Docker não publicou a porta 80 após start");
  return Number(binding);
}

export async function stop(containerId: string): Promise<void> {
  await docker.getContainer(containerId).stop();
}

export async function remove(containerId: string): Promise<void> {
  const container = docker.getContainer(containerId);
  await container.stop().catch(() => {}); // pode já estar parado
  await container.remove({ force: true });
}

export async function stats(containerId: string): Promise<StatsResult> {
  const container = docker.getContainer(containerId);
  // stream:false => uma amostra única (com precpu_stats preenchido).
  const s = (await container.stats({ stream: false })) as unknown as DockerStats;

  const cpuDelta =
    s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
  const systemDelta =
    (s.cpu_stats.system_cpu_usage ?? 0) - (s.precpu_stats.system_cpu_usage ?? 0);
  const onlineCpus =
    s.cpu_stats.online_cpus ?? s.cpu_stats.cpu_usage.percpu_usage?.length ?? 1;

  // Uso bruto em % de UM core * nº de cores usados.
  let cpuPct = 0;
  if (systemDelta > 0 && cpuDelta > 0) {
    cpuPct = (cpuDelta / systemDelta) * onlineCpus * 100;
  }

  // Relativo à cota (NanoCpus): 100% = cota total do ambiente.
  const quotaCores = await quotaForContainer(container);
  if (quotaCores > 0) {
    cpuPct = cpuPct / quotaCores;
  }
  cpuPct = Math.max(0, Math.round(cpuPct * 100) / 100);

  const memBytes = s.memory_stats.usage ?? 0;
  const memLimitBytes = s.memory_stats.limit ?? 0;

  return { cpuPct, memBytes, memLimitBytes };
}

/** Lê a cota de CPU (em cores) do HostConfig via inspect; 0 se ilimitado. */
async function quotaForContainer(container: Docker.Container): Promise<number> {
  try {
    const info = await container.inspect();
    const nano = info.HostConfig?.NanoCpus ?? 0;
    return nano > 0 ? nano / 1e9 : 0;
  } catch {
    return 0;
  }
}

/* Tipos mínimos do payload de docker stats (dockerode tipa como any). */
interface CpuUsage {
  total_usage: number;
  percpu_usage?: number[];
}
interface CpuStats {
  cpu_usage: CpuUsage;
  system_cpu_usage?: number;
  online_cpus?: number;
}
interface DockerStats {
  cpu_stats: CpuStats;
  precpu_stats: CpuStats;
  memory_stats: { usage?: number; limit?: number };
}
