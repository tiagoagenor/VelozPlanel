import os from "node:os";
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
  startupScript?: string | null;
  startFile?: string | null; // arquivo que inicia o app Node (ex.: server.js)
  phpNodeVersion?: string | null; // versão Node (via nvm) para ambientes PHP
  envVars?: EnvVarPair[]; // variáveis de ambiente gerenciadas (Env real do Docker)
  phpRoot?: string | null; // docroot do php -S (Laravel = /var/www/public)
  // Rede por-dono: quando presente, o app nasce na bridge do dono (IP fixo) em vez
  // da docker0 — assim app e serviços/bancos do MESMO dono se alcançam. A porta
  // publicada (PortBindings) e o supervisor continuam iguais.
  network?: { name: string; subnet: string; gateway: string } | null;
  ip?: string | null;
  ownerId?: string | null;
}

export interface ProvisionResult {
  containerId: string;
  httpPort: number;
  versionFull: string | null; // versão real resolvida no container (ex.: 24.19.0)
  phpNodeVersionFull?: string | null; // versão Node real resolvida via nvm (envs PHP)
}

/** Lê a versão real do runtime dentro do container (node -v / PHP_VERSION). */
async function readRuntimeVersion(
  container: Docker.Container,
  kind: string,
): Promise<string | null> {
  const cmd =
    kind === "php" ? ["php", "-r", "echo PHP_VERSION;"] : ["node", "-v"];
  try {
    const ex = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: false,
      Tty: false,
    });
    const stream = await ex.start({ hijack: true, stdin: false });
    const chunks: Buffer[] = [];
    const sink = new (await import("node:stream")).Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    });
    docker.modem.demuxStream(stream, sink, sink);
    await new Promise<void>((resolve) => stream.on("end", () => resolve()));
    const out = Buffer.concat(chunks).toString("utf8").trim().replace(/^v/, "");
    return out || null;
  } catch {
    return null;
  }
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

/** Imagem BASE própria do VelozPlanel (composer, extensões, git, toolchain). */
function customImage(runtime: RuntimeSpec): string {
  return `velozplanel/${runtime.kind}:${runtime.version}`;
}

/** Imagem oficial crua — usada como fallback quando não há base própria local. */
function officialImage(runtime: RuntimeSpec): string {
  return runtime.kind === "php"
    ? `php:${runtime.version}-cli`
    : `node:${runtime.version}-alpine`;
}

/**
 * Escolhe a imagem: usa a base própria `velozplanel/<kind>:<v>` se ela existir
 * localmente no nó; senão cai na imagem oficial crua (rollout incremental — à
 * medida que as bases são carregadas nos nós, os ambientes passam a usá-las).
 */
async function resolveImage(runtime: RuntimeSpec): Promise<string> {
  const custom = customImage(runtime);
  try {
    await docker.getImage(custom).inspect();
    return custom;
  } catch {
    return officialImage(runtime);
  }
}

/**
 * Monta o Cmd que escreve o arquivo servidor e sobe o server na :80.
 * O conteúdo do arquivo vai entre aspas SIMPLES no shell; nenhum dos templates
 * (PHP_INDEX / NODE_SERVER) contém aspas simples, então o quoting é seguro.
 */
/**
 * Prefixo de inicialização: grava o script do cliente (base64, à prova de aspas)
 * e roda UMA vez (marcador /.veloz-init-done). Falha no script não impede o app.
 */
function setupPrefix(startupScript: string | null | undefined): string {
  if (!startupScript || !startupScript.trim()) return "";
  const b64 = Buffer.from(startupScript, "utf8").toString("base64");
  return (
    `if [ ! -f /.veloz-init-done ]; then ` +
    `printf '%s' '${b64}' | base64 -d > /veloz-startup.sh 2>/dev/null; ` +
    `sh /veloz-startup.sh; touch /.veloz-init-done; fi; `
  );
}

// Loader das variáveis de ambiente gerenciadas: lê /veloz/env (linhas
// KEY=base64(valor)) e exporta como env REAL. NUNCA usa `source`/`set -a` (um
// valor malicioso executaria) — o valor vem base64, sem metacaractere de shell.
const RESERVED_ENV = new Set(["PATH","LD_PRELOAD","LD_LIBRARY_PATH","NVM_DIR","HOME","PWD","SHELL","IFS","ENV","BASH_ENV","PS4"]);

const LOAD_ENV =
  `if [ -f /veloz/env ]; then while IFS='=' read -r k v; do ` +
  `[ -n "\$k" ] && export "\$k=\$(printf %s "\$v" | base64 -d)"; done < /veloz/env; fi; `;

function cmdFor(runtime: RuntimeSpec, startupScript?: string | null): string[] {
  const setup = setupPrefix(startupScript);
  if (runtime.kind === "php") {
    // Supervisor: docroot vem de /.vp-php-root (senão VP_PHP_ROOT, senão /var/www).
    // Laravel serve /var/www/public com um router (URLs limpas). Guard: se o
    // ROOT ainda não existir (antes do 1º deploy), cai para /var/www → :80 sempre sobe.
    const script =
      setup +
      `touch /.veloz-env-capable; mkdir -p /var/www; ` +
      `trap 'kill "\$VPPID" 2>/dev/null; exit 0' TERM INT; ` +
      `while :; do ` +
      LOAD_ENV +
      `ROOT="\$(cat /.vp-php-root 2>/dev/null || printf '%s' "\${VP_PHP_ROOT:-/var/www}")"; ` +
      `[ -d "\$ROOT" ] || ROOT=/var/www; ` +
      `[ -f /var/www/index.php ] || printf '%s' '${PHP_INDEX}' > /var/www/index.php; ` +
      `if [ -f /.vp-php-router.php ]; then RT=/.vp-php-router.php; else RT=""; fi; ` +
      `cd "\$ROOT"; php -S 0.0.0.0:80 -t "\$ROOT" \$RT & VPPID=\$!; echo "\$VPPID" > /.vp-app-pid; wait "\$VPPID"; ` +
      `sleep 1; ` +
      `done`;
    return ["sh", "-c", script];
  }
  // NODE: supervisor. Roda `node <arquivo>` (de /.vp-node-start, senão VP_NODE_START,
  // senão index.js), relendo /veloz/env a cada subida. Loop = auto-restart.
  const script =
    setup +
    `touch /.veloz-env-capable; mkdir -p /app; ` +
    `trap 'kill "\$VPPID" 2>/dev/null; exit 0' TERM INT; ` +
    `while :; do ` +
    LOAD_ENV +
    `START="\$(cat /.vp-node-start 2>/dev/null || printf '%s' "\${VP_NODE_START:-index.js}")"; ` +
    `[ -f "/app/\$START" ] || printf '%s' '${NODE_SERVER}' > "/app/\$START"; ` +
    `cd /app; node "\$START" & VPPID=\$!; echo "\$VPPID" > /.vp-node-pid; echo "\$VPPID" > /.vp-app-pid; wait "\$VPPID"; ` +
    `sleep 1; ` +
    `done`;
  return ["sh", "-c", script];
}

export interface EnvVarPair { key: string; value: string; buildTime?: boolean }

/** Monta o corpo do /veloz/env (KEY=base64(valor)) e o transporta base64. */
function envFileTransport(vars: EnvVarPair[]): string {
  const body =
    vars
      .map((v) => `${v.key}=${Buffer.from(v.value, "utf8").toString("base64")}`)
      .join("\n") + "\n"; // newline final: senão o `while read` descarta a última var
  return Buffer.from(body, "utf8").toString("base64");
}

/**
 * Grava as variáveis gerenciadas em /veloz/env e reinicia o PROCESSO do app
 * (não o container) para que o app as veja como env REAL. Se o container é
 * antigo (sem /.veloz-env-capable), grava mesmo assim mas devolve applied:false
 * (o painel avisa que precisa recriar). Injeção impossível: valor vai base64.
 */
export async function writeEnvFileAndRestart(
  containerId: string,
  vars: EnvVarPair[],
): Promise<{ applied: boolean; reason?: string }> {
  const b64 = envFileTransport(vars);
  const write = `mkdir -p /veloz && (printf '%s' '${b64}' | base64 -d > /veloz/env) && chmod 600 /veloz/env`;
  const capable = (await execCapture(containerId, ["sh", "-c", "[ -f /.veloz-env-capable ] && echo YES || echo NO"])).includes("YES");
  await execCapture(containerId, ["sh", "-c", write]);
  if (!capable) return { applied: false, reason: "recreate_required" };
  await execCapture(containerId, ["sh", "-c", `kill "$(cat /.vp-app-pid 2>/dev/null)" 2>/dev/null || true`]);
  return { applied: true };
}

const PHP_ROUTER = `<?php
$root = $_SERVER['DOCUMENT_ROOT'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($path !== '/' && is_file($root . $path)) return false;
require $root . '/index.php';
`;

/** Valida o docroot (borda do agente): só sob /var/www, sem metacaracteres. */
function safePhpRoot(root: string): boolean {
  return /^\/var\/www(\/[A-Za-z0-9._-]+)*$/.test(root);
}

/**
 * Aplica o docroot do PHP (Laravel → /var/www/public) ao vivo, sem recriar:
 * grava /.vp-php-root (+ router quando pedido) e reinicia o processo php.
 */
export async function applyPhpRoot(
  containerId: string,
  root: string,
  useRouter: boolean,
): Promise<void> {
  if (!safePhpRoot(root)) root = "/var/www";
  const c = docker.getContainer(containerId);
  const routerB64 = Buffer.from(PHP_ROUTER, "utf8").toString("base64");
  const script =
    `printf '%s' '${root}' > /.vp-php-root; ` +
    (useRouter
      ? `printf '%s' '${routerB64}' | base64 -d > /.vp-php-router.php; `
      : `rm -f /.vp-php-router.php; `) +
    `kill "$(cat /.vp-app-pid 2>/dev/null)" 2>/dev/null || true`;
  const ex = await c.exec({ Cmd: ["sh", "-c", script], AttachStdout: false, AttachStderr: false });
  await ex.start({});
}

/**
 * Aplica um novo arquivo de start no container Node SEM recriá-lo: grava
 * /.vp-node-start e mata o processo node atual — o supervisor relê e reinicia
 * com o novo arquivo. Mantém os arquivos e a porta/domínio.
 */
export async function applyNodeStart(
  containerId: string,
  startFile: string,
): Promise<void> {
  const c = docker.getContainer(containerId);
  // grava o arquivo-alvo (o path já vem validado na borda: só [A-Za-z0-9_./-]).
  const write = await c.exec({
    Cmd: ["sh", "-c", `printf '%s' '${startFile}' > /.vp-node-start`],
    AttachStdout: false,
    AttachStderr: false,
  });
  await write.start({});
  // mata o node atual (pelo pid registrado); o supervisor reinicia sozinho.
  const kill = await c.exec({
    Cmd: ["sh", "-c", `kill "$(cat /.vp-node-pid 2>/dev/null)" 2>/dev/null || true`],
    AttachStdout: false,
    AttachStderr: false,
  });
  await kill.start({});
}

/**
 * Bind mounts do LXCFS: apresentam um /proc "consciente do cgroup" dentro do
 * container, então `htop`/`top`/`free`/`nproc` mostram os recursos DO PLANO
 * (1 vCPU / 512 MB), não os do host. Ativado por `VP_LXCFS=1` no nó (onde o
 * lxcfs está instalado). Se o nó não tiver lxcfs, deixe a env desligada.
 */
function lxcfsBinds(): string[] {
  if (!process.env.VP_LXCFS) return [];
  const base = "/var/lib/lxcfs/proc";
  return [
    `${base}/cpuinfo:/proc/cpuinfo`,
    `${base}/meminfo:/proc/meminfo`,
    `${base}/stat:/proc/stat`,
    `${base}/uptime:/proc/uptime`,
    `${base}/loadavg:/proc/loadavg`,
    `${base}/diskstats:/proc/diskstats`,
    `${base}/swaps:/proc/swaps`,
  ];
}

/** Expande "0-2,4" -> [0,1,2,4]. */
function parseCpuset(cs: string): number[] {
  const out: number[] = [];
  for (const part of cs.split(",")) {
    const p = part.trim();
    if (!p) continue;
    if (p.includes("-")) {
      const parts = p.split("-").map((n) => Number(n));
      const a = parts[0] ?? 0;
      const b = parts[1] ?? a;
      for (let i = a; i <= b; i++) out.push(i);
    } else out.push(Number(p));
  }
  return out;
}

/**
 * Escolhe os cores (cpuset) do container: `ceil(vcpu)` cores, os MENOS usados
 * pelos containers de cliente já existentes no nó (espalha a carga, não empilha
 * no core 0). Com o cpuset definido, htop/nproc/cpuinfo mostram exatamente essa
 * quantidade — a cota (NanoCpus) continua sendo o limite real de tempo de CPU.
 * Ativado junto com a visão de recursos (VP_LXCFS).
 */
async function pickCpuset(vcpu: number): Promise<string | undefined> {
  if (!process.env.VP_LXCFS) return undefined;
  const hostCores = os.cpus().length || 1;
  const needed = Math.min(hostCores, Math.max(1, Math.ceil(vcpu)));
  const usage = new Array(hostCores).fill(0);
  try {
    const containers = await docker.listContainers({
      filters: { label: ["vp.env"] },
    });
    for (const c of containers) {
      const info = await docker.getContainer(c.Id).inspect();
      const cs = info.HostConfig?.CpusetCpus;
      if (cs) for (const core of parseCpuset(cs)) if (core < hostCores) usage[core]++;
    }
  } catch {
    /* sem dados: assume tudo livre */
  }
  const chosen = usage
    .map((u, i) => [u, i] as const)
    .sort((a, b) => a[0] - b[0])
    .slice(0, needed)
    .map(([, i]) => i)
    .sort((a, b) => a - b);
  return chosen.join(",");
}

export async function provision(args: ProvisionArgs): Promise<ProvisionResult> {
  const { envId, name, runtime, limits } = args;
  const image = await resolveImage(runtime);
  await ensureImage(image);

  await removeExistingByEnv(envId); // idempotência: retry não deixa container duplicado
  const binds = lxcfsBinds();
  const cpuset = await pickCpuset(limits.vcpu);
  const attachNet = !!(args.network && args.ip && args.ownerId);
  if (attachNet) {
    await ensureNetwork(args.network!.name, args.network!.subnet, args.network!.gateway, args.ownerId!);
  }
  const container = await docker.createContainer({
    Image: image,
    Cmd: cmdFor(runtime, args.startupScript),
    Env: [
      `VP_ENV_NAME=${name}`,
      `VP_RUNTIME_KIND=${runtime.kind}`,
      `VP_RUNTIME_VERSION=${runtime.version}`,
      // arquivo de start do Node na 1ª subida; depois /.vp-node-start manda.
      `VP_NODE_START=${(args.startFile && args.startFile.trim()) || "index.js"}`,
      // docroot do PHP na 1ª subida; depois /.vp-php-root manda.
      `VP_PHP_ROOT=${(args.phpRoot && args.phpRoot.trim()) || "/var/www"}`,
      // variáveis gerenciadas como Env REAL (Docker não faz parsing de shell).
      ...(args.envVars ?? [])
        .filter((v) => !RESERVED_ENV.has(v.key) && !v.key.startsWith("VP_"))
        .map((v) => `${v.key}=${v.value}`),
    ],
    Labels: { "vp.env": envId },
    ExposedPorts: { "80/tcp": {} },
    HostConfig: {
      Memory: Math.round(limits.memMb * 1024 * 1024),
      NanoCpus: Math.round(limits.vcpu * 1e9),
      RestartPolicy: { Name: "unless-stopped" }, // site volta após crash/OOM (D4)
      Init: true, // init do Docker (tini) como PID 1 → sinais/SIGTERM e reap limpos
      Binds: binds.length ? binds : undefined, // LXCFS (htop/free veem o plano)
      CpusetCpus: cpuset || undefined, // cores visíveis = ceil(vcpu) (htop/nproc corretos)
      // HostPort "" => Docker escolhe uma porta efêmera livre no host.
      PortBindings: { "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "" }] },
    },
    // Rede por-dono (IP fixo) quando informada; senão cai na docker0 (legado).
    ...(attachNet
      ? { NetworkingConfig: { EndpointsConfig: { [args.network!.name]: { IPAMConfig: { IPv4Address: args.ip! } } } } }
      : {}),
  });

  await container.start();

  // Materializa /veloz/env (para o re-apply "ao vivo" futuro; na 1ª subida o
  // Env do Docker já basta). Não falha o provision se der erro.
  if (args.envVars && args.envVars.length) {
    await writeEnvFileAndRestart(container.id, args.envVars).catch(() => {});
  }

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

  const versionFull = await readRuntimeVersion(container, runtime.kind);

  // Ambientes PHP: aplica a versão de Node escolhida (via nvm) se houver.
  let phpNodeVersionFull: string | null = null;
  if (runtime.kind === "php" && args.phpNodeVersion && args.phpNodeVersion.trim()) {
    phpNodeVersionFull = await applyNodeVersion(container.id, args.phpNodeVersion.trim()).catch(
      () => null,
    );
  }
  return { containerId: container.id, httpPort: Number(binding), versionFull, phpNodeVersionFull };
}

/* ─────────────── Ambientes de SERVIÇO (sem deploy, sem porta pública) ─────────────── */

/**
 * Cria (idempotente) a rede-bridge do dono. Redes definidas pelo usuário NÃO casam
 * com a regra `-i docker0 -o docker0 DROP` (interface `br-*` ≠ docker0) e o Docker
 * já isola bridges diferentes entre si — então o app e o banco do MESMO dono se falam,
 * e outros donos (em outras bridges / no docker0) ficam isolados. Zero porta no host.
 */
async function ensureNetwork(name: string, subnet: string, gateway: string, ownerId: string): Promise<void> {
  try {
    await docker.getNetwork(name).inspect();
    return; // já existe
  } catch {
    /* criar abaixo */
  }
  try {
    await docker.createNetwork({
      Name: name,
      Driver: "bridge",
      CheckDuplicate: true,
      IPAM: { Driver: "default", Config: [{ Subnet: subnet, Gateway: gateway }] },
      Options: {
        "com.docker.network.bridge.enable_icc": "true",
        "com.docker.network.bridge.enable_ip_masquerade": "true", // egress p/ internet (pull/plugins)
      },
      Labels: { "vp.owner": ownerId },
    });
  } catch {
    // corrida: outro provisionamento criou a rede ao mesmo tempo — ok.
    await docker.getNetwork(name).inspect();
  }
}

/** Volume nomeado idempotente para o datadir do serviço. */
async function ensureNamedVolume(name: string, envId: string): Promise<void> {
  try {
    await docker.getVolume(name).inspect();
  } catch {
    await docker.createVolume({ Name: name, Labels: { "vp.env": envId } });
  }
}

/** Executa um comando e devolve só o exit code (para probe de readiness). */
async function runExecCode(containerId: string, argv: string[]): Promise<number> {
  const c = docker.getContainer(containerId);
  const ex = await c.exec({ Cmd: argv, AttachStdout: true, AttachStderr: true, Tty: false });
  const stream = await ex.start({ hijack: true, stdin: false });
  await new Promise<void>((resolve) => {
    stream.on("end", resolve);
    stream.on("close", resolve);
    stream.resume();
  });
  const info = await ex.inspect();
  return info.ExitCode ?? 1;
}

/** Espera o serviço ficar pronto rodando `cmd` (sh -lc) até `tries` vezes (1s). */
async function waitReady(containerId: string, cmd: string | null | undefined, tries = 40): Promise<boolean> {
  if (!cmd) return true;
  for (let i = 0; i < tries; i++) {
    const code = await runExecCode(containerId, ["sh", "-lc", cmd]).catch(() => 1);
    if (code === 0) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export interface ServiceProvisionArgs {
  envId: string;
  name: string;
  image: string; // imagem stock (redis:7, mysql:8, mariadb:11, postgres:16, rabbitmq:3-management, …)
  limits: Limits;
  network: { name: string; subnet: string; gateway: string };
  ip: string; // IP fixo do container na bridge do dono
  ownerId: string;
  dataPath?: string | null; // datadir a montar no volume nomeado; null = sem volume (ferramentas)
  env?: EnvVarPair[]; // Env do Docker (credenciais do serviço)
  readiness?: string | null; // comando de readiness (sh -lc); null = não espera
  role?: string; // "service" | "tool:<kind>" | "app" — vai no label vp.role
  publishPort?: number | null; // porta interna a PUBLICAR no host (apps web: n8n/wordpress). Bancos = null.
}
export interface ServiceProvisionResult {
  containerId: string;
  ready: boolean;
  httpPort?: number | null; // porta publicada no host (quando publishPort setado)
}

/**
 * Provisiona um container de SERVIÇO na bridge do dono: imagem stock + entrypoint
 * nativo (sem supervisor/Cmd), volume nomeado no datadir, IP fixo, SEM PortBindings
 * (nada publicado no host), endurecido. Readiness por exec (não por porta).
 */
export async function provisionService(args: ServiceProvisionArgs): Promise<ServiceProvisionResult> {
  await removeExistingByEnv(args.envId); // idempotência em retry (mesmo vp.env)
  await ensureImage(args.image);
  await ensureNetwork(args.network.name, args.network.subnet, args.network.gateway, args.ownerId);

  const binds: string[] = [];
  if (args.dataPath) {
    const vol = `veloz-data-${args.envId}`;
    await ensureNamedVolume(vol, args.envId);
    binds.push(`${vol}:${args.dataPath}`);
  }

  const env = (args.env ?? [])
    .filter((v) => !RESERVED_ENV.has(v.key))
    .map((v) => `${v.key}=${v.value}`);

  const cpuset = await pickCpuset(args.limits.vcpu);
  const pubKey = args.publishPort ? `${args.publishPort}/tcp` : null;
  const container = await docker.createContainer({
    Image: args.image,
    Env: env.length ? env : undefined,
    Labels: { "vp.env": args.envId, "vp.role": args.role ?? "service" },
    // Bancos/ferramentas: sem publicação (só rede interna). Apps web (n8n/wordpress): publica a porta.
    ExposedPorts: pubKey ? { [pubKey]: {} } : undefined,
    HostConfig: {
      Memory: Math.round(args.limits.memMb * 1024 * 1024),
      NanoCpus: Math.round(args.limits.vcpu * 1e9),
      CpusetCpus: cpuset || undefined,
      RestartPolicy: { Name: "unless-stopped" },
      Init: true,
      PidsLimit: 512,
      CapDrop: ["NET_RAW", "NET_ADMIN"], // mata ARP-spoof L2 na bridge compartilhada do dono
      SecurityOpt: ["no-new-privileges"],
      Binds: binds.length ? binds : undefined,
      PortBindings: pubKey ? { [pubKey]: [{ HostIp: "0.0.0.0", HostPort: "" }] } : undefined,
    },
    NetworkingConfig: {
      EndpointsConfig: {
        [args.network.name]: { IPAMConfig: { IPv4Address: args.ip } },
      },
    },
  });

  await container.start();
  const ready = await waitReady(container.id, args.readiness);
  let httpPort: number | null = null;
  if (pubKey) {
    for (let i = 0; i < 20; i++) {
      const info = await container.inspect();
      const b = info.NetworkSettings?.Ports?.[pubKey]?.[0]?.HostPort;
      if (b) { httpPort = Number(b); break; }
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return { containerId: container.id, ready, httpPort };
}

/** Sobe um serviço já existente (sem esperar porta 80). */
export async function startService(containerId: string): Promise<void> {
  await docker.getContainer(containerId).start();
}

/** Extrai "X.Y.Z" da saída `vX.Y.Z` do node -v. */
function parseNodeV(out: string): string | null {
  const m = out.match(/v?(\d+\.\d+\.\d+)/);
  return m ? m[1]! : null;
}

/**
 * Executa um comando no container e devolve o stdout (texto). Usado para nvm.
 */
async function execCapture(containerId: string, cmd: string[]): Promise<string> {
  const c = docker.getContainer(containerId);
  const ex = await c.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true, Tty: false });
  const stream = await ex.start({ hijack: true, stdin: false });
  const { Writable } = await import("node:stream");
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });
  await new Promise<void>((resolve) => {
    docker.modem.demuxStream(stream, sink, sink);
    stream.on("end", resolve);
    stream.on("close", resolve);
  });
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Troca a versão de Node (via nvm) num container PHP, ao vivo (sem recriar):
 * instala a versão, aponta o default e re-aponta os symlinks em /usr/local/bin
 * (o que faz um `node` "pelado" — build/sh -c — ver a versão nova). A versão já
 * chega validada nas duas bordas (^[0-9.]+$), então as aspas simples são seguras.
 * Devolve a versão real (ex.: "22.12.0") ou null se o nvm não existir na imagem.
 */
export async function applyNodeVersion(
  containerId: string,
  version: string,
): Promise<string | null> {
  const script =
    `export NVM_DIR=/usr/local/nvm; ` +
    `. "$NVM_DIR/nvm.sh" 2>/dev/null || { echo "VP_NO_NVM"; exit 0; }; ` +
    `nvm install '${version}' >/dev/null 2>&1 && nvm alias default '${version}' >/dev/null 2>&1 && ` +
    `D="$NVM_DIR/versions/node/$(nvm version default)/bin" && ` +
    `for b in node npm npx corepack; do [ -e "$D/$b" ] && ln -sfn "$D/$b" /usr/local/bin/$b; done; ` +
    `node -v 2>/dev/null || true`;
  const out = await execCapture(containerId, ["bash", "-lc", script]);
  if (out.includes("VP_NO_NVM")) return null;
  return parseNodeV(out);
}

/** Lê a versão de Node atual (default do nvm) no container. null se sem nvm. */
export async function readNodeCurrent(containerId: string): Promise<string | null> {
  const out = await execCapture(containerId, [
    "bash",
    "-lc",
    'export NVM_DIR=/usr/local/nvm; . "$NVM_DIR/nvm.sh" 2>/dev/null || { echo VP_NO_NVM; exit 0; }; nvm version default 2>/dev/null || true',
  ]);
  if (out.includes("VP_NO_NVM")) return null;
  return parseNodeV(out);
}

/**
 * A porta efêmera pode levar alguns ms para aparecer no inspect após o start;
 * fazemos poll (até ~4s). Retorna a HostPort ou undefined se o container saiu.
 */
async function waitForPort(
  container: Docker.Container,
  portKey = "80/tcp",
): Promise<string | undefined> {
  for (let i = 0; i < 20; i++) {
    const info = await container.inspect();
    const binding = info.NetworkSettings?.Ports?.[portKey]?.[0]?.HostPort ?? undefined;
    if (binding) return binding;
    if (info.State?.Status === "exited") return undefined; // saiu -> não adianta esperar
    await new Promise((r) => setTimeout(r, 200));
  }
  return undefined;
}

/**
 * Liga (idempotente) um container já rodando à bridge do dono, com IP fixo.
 * Dual-home: mantém o endpoint atual (docker0 + porta publicada) e ADICIONA a
 * bridge do dono. Usado na migração de apps legados sem recriar.
 */
export async function attachNetwork(
  containerId: string,
  net: { name: string; subnet: string; gateway: string; ip: string },
  ownerId: string,
): Promise<{ attached: boolean; alreadyAttached: boolean }> {
  await ensureNetwork(net.name, net.subnet, net.gateway, ownerId);
  const info = await docker.getContainer(containerId).inspect();
  const nets = info.NetworkSettings?.Networks ?? {};
  if (nets[net.name]) return { attached: true, alreadyAttached: true };
  await docker.getNetwork(net.name).connect({
    Container: containerId,
    EndpointConfig: { IPAMConfig: { IPv4Address: net.ip } },
  });
  return { attached: true, alreadyAttached: false };
}

/** Remove qualquer container existente deste ambiente (idempotência do provision em retry). */
async function removeExistingByEnv(envId: string): Promise<void> {
  try {
    const list = await docker.listContainers({ all: true, filters: { label: [`vp.env=${envId}`] } });
    for (const c of list) await docker.getContainer(c.Id).remove({ force: true }).catch(() => {});
  } catch {
    /* ignora */
  }
}

/** Remove um volume nomeado (best-effort). Usado na limpeza ao deletar ambiente. */
export async function removeVolume(name: string): Promise<void> {
  await docker.getVolume(name).remove({ force: true }).catch(() => {});
}

/** IP interno do container no nó (rede por-dono veloz-*, senão a rede padrão docker0). */
export async function containerIp(containerId: string): Promise<string | null> {
  try {
    const info = await docker.getContainer(containerId).inspect();
    const nets = (info.NetworkSettings?.Networks ?? {}) as Record<string, { IPAddress?: string }>;
    for (const [name, n] of Object.entries(nets)) {
      if (name.startsWith("veloz-") && n.IPAddress) return n.IPAddress;
    }
    for (const n of Object.values(nets)) {
      if (n.IPAddress) return n.IPAddress;
    }
    return info.NetworkSettings?.IPAddress || null;
  } catch {
    return null;
  }
}

/** Altera RAM/vCPU de um container a quente (docker update). */
export async function updateResources(
  containerId: string,
  memMb: number,
  vcpu: number,
): Promise<void> {
  const container = docker.getContainer(containerId);
  await container.update({
    Memory: Math.round(memMb * 1024 * 1024),
    NanoCpus: Math.round(vcpu * 1e9),
  } as unknown as Parameters<typeof container.update>[0]);
}

/** Inicia um container parado e devolve a NOVA porta efêmera publicada. */
export async function start(containerId: string): Promise<number | null> {
  const container = docker.getContainer(containerId);
  await container.start();
  // Qual porta esse container publica no host? Código = "80/tcp"; apps web
  // (n8n/wordpress) = a porta própria; serviços puros (mariadb/redis) = NENHUMA.
  const info = await container.inspect();
  const requested = Object.keys(info.HostConfig?.PortBindings ?? {});
  if (requested.length === 0) return null; // serviço sem porta pública → só subir
  const portKey = requested[0]!;
  const binding = await waitForPort(container, portKey);
  if (!binding) throw new Error(`Docker não publicou a porta ${portKey} após start`);
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

/** Uso de disco do container = tamanho da camada de escrita (SizeRw). */
export async function diskUsage(containerId: string): Promise<{ diskBytes: number }> {
  // `size: true` faz o Docker calcular SizeRw (camada de escrita). Não está na
  // tipagem do dockerode, por isso o cast.
  const inspectWithSize = docker.getContainer(containerId).inspect as unknown as (
    opts: { size: boolean },
  ) => Promise<{ SizeRw?: number }>;
  const info = await inspectWithSize.call(docker.getContainer(containerId), { size: true });
  return { diskBytes: Math.max(0, Math.round(info.SizeRw ?? 0)) };
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

/** Limpa a saída de `docker logs`: remove os cabeçalhos binários de multiplexação
 *  (8 bytes por frame quando não há TTY) e outros não-imprimíveis, preservando
 *  quebras de linha e tab. Suficiente para um visualizador humano de logs. */
export function cleanLog(s: string): string {
  return s.replace(/[^\t\n\r\x20-\x7e]/g, "");
}

/** Reinicia SÓ o processo do app (mata o pid registrado em /.vp-app-pid). O
 *  supervisor relê o arquivo de start e sobe de novo em ~1s — mesmo container,
 *  mesma porta publicada, /app preservado (aplica edições feitas via Arquivos). */
export async function restartApp(containerId: string): Promise<void> {
  await execCapture(containerId, ["sh", "-c", `kill "$(cat /.vp-app-pid 2>/dev/null)" 2>/dev/null || true`]);
}

/** Snapshot das últimas `tail` linhas de log do container (stdout+stderr). */
export async function logSnapshot(containerId: string, tail: number): Promise<string> {
  const buf = (await docker.getContainer(containerId).logs({
    follow: false,
    stdout: true,
    stderr: true,
    tail,
  })) as unknown as Buffer;
  return cleanLog(buf.toString("utf8"));
}

/** Stream ao vivo (follow) dos logs do container — começa com as últimas `tail`
 *  linhas e segue emitindo as novas. Quem chama deve destruir o stream ao sair. */
export async function logStream(containerId: string, tail: number): Promise<NodeJS.ReadableStream> {
  return (await docker.getContainer(containerId).logs({
    follow: true,
    stdout: true,
    stderr: true,
    tail,
  })) as unknown as NodeJS.ReadableStream;
}
