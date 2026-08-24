import os from "node:os";
import Docker from "dockerode";
import type { RuntimeSpec, StudioEngine, DbRunSqlInput, DbRunMongoInput, DbRunRedisInput, DbResult } from "@velozplanel/contracts";
import { isSqlEngine } from "@velozplanel/contracts";
import { buildSqlExec, buildMongoExec, buildRedisExec, parseExec, type ExecPlan, type ExecOutput } from "@velozplanel/db-console";

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
  startFile?: string | null; // arquivo que inicia o app Node/Python (ex.: server.js, app.py)
  pythonCmd?: string | null; // comando de start avançado (Python/Django)
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
  if (kind === "static") return null; // sem versão real
  const cmd =
    kind === "php"
      ? ["php", "-r", "echo PHP_VERSION;"]
      : kind === "python"
        ? ["python3", "-c", "import platform;print(platform.python_version())"]
        : ["node", "-v"];
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

// Página "site em construção" (base64; o nome do ambiente é injetado no runtime).
const CONSTRUCTION_B64 = "PCFET0NUWVBFIGh0bWw+CjxodG1sIGxhbmc9InB0LUJSIj4KPGhlYWQ+CiAgPG1ldGEgY2hhcnNldD0idXRmLTgiPgogIDxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsIGluaXRpYWwtc2NhbGU9MSI+CiAgPG1ldGEgbmFtZT0icm9ib3RzIiBjb250ZW50PSJub2luZGV4Ij4KICA8bWV0YSBuYW1lPSJjb2xvci1zY2hlbWUiIGNvbnRlbnQ9ImxpZ2h0IGRhcmsiPgogIDx0aXRsZT5TaXRlIGVtIGNvbnN0cnXDp8OjbyAmbWlkZG90OyBqYW1lZXMuY29tPC90aXRsZT4KICA8c3R5bGU+CiAgICA6cm9vdHsKICAgICAgLS1wdXJwbGU6ICM2MzRjYTg7CiAgICAgIC0tcHVycGxlLXN0cm9uZzogIzRhMzg4MDsKICAgICAgLS1wdXJwbGUtc29mdDogI2VmZWNmODsKICAgICAgLS1pbms6ICMyMzIxMmI7CiAgICAgIC0taW5rLXNvZnQ6ICM1YzVhNjg7CiAgICAgIC0tYmc6ICNmNmY1ZmI7CiAgICAgIC0tY2FyZDogI2ZmZmZmZjsKICAgICAgLS1saW5lOiAjZWFlN2YzOwogICAgICAtLXNoYWRvdzogMCAyMHB4IDYwcHggLTI0cHggcmdiYSg3NCw1NiwxMjgsLjM1KTsKICAgIH0KICAgIEBtZWRpYSAocHJlZmVycy1jb2xvci1zY2hlbWU6IGRhcmspewogICAgICA6cm9vdHsKICAgICAgICAtLXB1cnBsZTogI2E5OTZlODsKICAgICAgICAtLXB1cnBsZS1zdHJvbmc6ICNjM2I2ZjI7CiAgICAgICAgLS1wdXJwbGUtc29mdDogIzI0MWYzODsKICAgICAgICAtLWluazogI2YyZjFmNzsKICAgICAgICAtLWluay1zb2Z0OiAjYjBhY2MyOwogICAgICAgIC0tYmc6ICMxMzExMjA7CiAgICAgICAgLS1jYXJkOiAjMWIxODMwOwogICAgICAgIC0tbGluZTogIzJiMjc0NTsKICAgICAgICAtLXNoYWRvdzogMCAyNHB4IDcwcHggLTI4cHggcmdiYSgwLDAsMCwuNyk7CiAgICAgIH0KICAgIH0KCiAgICAqeyBib3gtc2l6aW5nOiBib3JkZXItYm94OyB9CiAgICBodG1sLCBib2R5eyBoZWlnaHQ6IDEwMCU7IH0KICAgIGJvZHl7CiAgICAgIG1hcmdpbjogMDsKICAgICAgZm9udC1mYW1pbHk6IHN5c3RlbS11aSwgLWFwcGxlLXN5c3RlbSwgIlNlZ29lIFVJIiwgUm9ib3RvLCAiSGVsdmV0aWNhIE5ldWUiLCBBcmlhbCwgc2Fucy1zZXJpZjsKICAgICAgY29sb3I6IHZhcigtLWluayk7CiAgICAgIGJhY2tncm91bmQ6IHZhcigtLWJnKTsKICAgICAgYmFja2dyb3VuZC1pbWFnZToKICAgICAgICByYWRpYWwtZ3JhZGllbnQoNjAlIDU1JSBhdCA1MCUgLTEwJSwgcmdiYSg5OSw3NiwxNjgsLjE2KSwgdHJhbnNwYXJlbnQgNjAlKSwKICAgICAgICByYWRpYWwtZ3JhZGllbnQoNDUlIDQwJSBhdCAxMDAlIDEwMCUsIHJnYmEoOTksNzYsMTY4LC4xMCksIHRyYW5zcGFyZW50IDU1JSk7CiAgICAgIC13ZWJraXQtZm9udC1zbW9vdGhpbmc6IGFudGlhbGlhc2VkOwogICAgICB0ZXh0LXJlbmRlcmluZzogb3B0aW1pemVMZWdpYmlsaXR5OwogICAgICBkaXNwbGF5OiBmbGV4OwogICAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uOwogICAgICBtaW4taGVpZ2h0OiAxMDAlOwogICAgfQoKICAgIC53cmFwewogICAgICBmbGV4OiAxOwogICAgICBkaXNwbGF5OiBmbGV4OwogICAgICBhbGlnbi1pdGVtczogY2VudGVyOwogICAgICBqdXN0aWZ5LWNvbnRlbnQ6IGNlbnRlcjsKICAgICAgcGFkZGluZzogMzJweCAyMHB4OwogICAgfQoKICAgIC5jYXJkewogICAgICB3aWR0aDogMTAwJTsKICAgICAgbWF4LXdpZHRoOiA1NjBweDsKICAgICAgYmFja2dyb3VuZDogdmFyKC0tY2FyZCk7CiAgICAgIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWxpbmUpOwogICAgICBib3JkZXItcmFkaXVzOiAyNHB4OwogICAgICBib3gtc2hhZG93OiB2YXIoLS1zaGFkb3cpOwogICAgICBwYWRkaW5nOiA0NHB4IDQwcHggNDBweDsKICAgICAgdGV4dC1hbGlnbjogY2VudGVyOwogICAgfQoKICAgIC8qIFdvcmRtYXJrICovCiAgICAuYnJhbmR7CiAgICAgIGRpc3BsYXk6IGlubGluZS1mbGV4OwogICAgICBhbGlnbi1pdGVtczogYmFzZWxpbmU7CiAgICAgIGZvbnQtd2VpZ2h0OiA4MDA7CiAgICAgIGZvbnQtc2l6ZTogMjJweDsKICAgICAgbGV0dGVyLXNwYWNpbmc6IC0uMDJlbTsKICAgICAgY29sb3I6IHZhcigtLWluayk7CiAgICAgIHVzZXItc2VsZWN0OiBub25lOwogICAgfQogICAgLmJyYW5kIC5kb3R7IGNvbG9yOiB2YXIoLS1wdXJwbGUpOyBmb250LXdlaWdodDogODAwOyBtYXJnaW46IDAgMXB4OyB9CiAgICAuYnJhbmQgLnRsZHsKICAgICAgZm9udC1zaXplOiAuNjJlbTsKICAgICAgZm9udC13ZWlnaHQ6IDYwMDsKICAgICAgY29sb3I6IHZhcigtLWluay1zb2Z0KTsKICAgICAgb3BhY2l0eTogLjc7CiAgICAgIGxldHRlci1zcGFjaW5nOiAwOwogICAgfQoKICAgIC8qIEVtYmxlbSAqLwogICAgLmVtYmxlbXsKICAgICAgd2lkdGg6IDg0cHg7CiAgICAgIGhlaWdodDogODRweDsKICAgICAgbWFyZ2luOiAyOHB4IGF1dG8gMjJweDsKICAgICAgYm9yZGVyLXJhZGl1czogMjJweDsKICAgICAgZGlzcGxheTogZ3JpZDsKICAgICAgcGxhY2UtaXRlbXM6IGNlbnRlcjsKICAgICAgYmFja2dyb3VuZDogbGluZWFyLWdyYWRpZW50KDE2MGRlZywgdmFyKC0tcHVycGxlKSwgdmFyKC0tcHVycGxlLXN0cm9uZykpOwogICAgICBib3gtc2hhZG93OiAwIDE0cHggMzJweCAtMTJweCByZ2JhKDk5LDc2LDE2OCwuNjUpOwogICAgICBwb3NpdGlvbjogcmVsYXRpdmU7CiAgICB9CiAgICAuZW1ibGVtIHN2Z3sgd2lkdGg6IDQ0cHg7IGhlaWdodDogNDRweDsgZGlzcGxheTogYmxvY2s7IH0KICAgIC5nZWFyewogICAgICB0cmFuc2Zvcm0tb3JpZ2luOiA1MCUgNTAlOwogICAgICB0cmFuc2Zvcm0tYm94OiBmaWxsLWJveDsKICAgICAgYW5pbWF0aW9uOiBzcGluIDlzIGxpbmVhciBpbmZpbml0ZTsKICAgIH0KICAgIEBrZXlmcmFtZXMgc3BpbnsgdG97IHRyYW5zZm9ybTogcm90YXRlKDM2MGRlZyk7IH0gfQoKICAgIGgxewogICAgICBtYXJnaW46IDAgMCAxMHB4OwogICAgICBmb250LXNpemU6IDI3cHg7CiAgICAgIGxpbmUtaGVpZ2h0OiAxLjI7CiAgICAgIGxldHRlci1zcGFjaW5nOiAtLjAyZW07CiAgICAgIGNvbG9yOiB2YXIoLS1pbmspOwogICAgfQogICAgLmxlYWR7CiAgICAgIG1hcmdpbjogMCBhdXRvOwogICAgICBtYXgtd2lkdGg6IDQwY2g7CiAgICAgIGZvbnQtc2l6ZTogMTUuNXB4OwogICAgICBsaW5lLWhlaWdodDogMS42OwogICAgICBjb2xvcjogdmFyKC0taW5rLXNvZnQpOwogICAgfQoKICAgIC5zaXRlewogICAgICBkaXNwbGF5OiBpbmxpbmUtYmxvY2s7CiAgICAgIG1heC13aWR0aDogMTAwJTsKICAgICAgbWFyZ2luOiAxOHB4IDAgNHB4OwogICAgICBwYWRkaW5nOiA3cHggMTRweDsKICAgICAgYm9yZGVyLXJhZGl1czogOTk5cHg7CiAgICAgIGJhY2tncm91bmQ6IHZhcigtLXB1cnBsZS1zb2Z0KTsKICAgICAgY29sb3I6IHZhcigtLXB1cnBsZS1zdHJvbmcpOwogICAgICBmb250LXdlaWdodDogNjAwOwogICAgICBmb250LXNpemU6IDE0cHg7CiAgICAgIGxldHRlci1zcGFjaW5nOiAtLjAxZW07CiAgICAgIG92ZXJmbG93LXdyYXA6IGFueXdoZXJlOwogICAgICBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS1saW5lKTsKICAgIH0KCiAgICAvKiBQcm9ncmVzcyBiYXIgKHRvdWNoIG9mIGxpZmUpICovCiAgICAucHJvZ3Jlc3N7CiAgICAgIHBvc2l0aW9uOiByZWxhdGl2ZTsKICAgICAgaGVpZ2h0OiA2cHg7CiAgICAgIG1hcmdpbjogMzBweCBhdXRvIDZweDsKICAgICAgbWF4LXdpZHRoOiAzMjBweDsKICAgICAgYm9yZGVyLXJhZGl1czogOTk5cHg7CiAgICAgIGJhY2tncm91bmQ6IHZhcigtLXB1cnBsZS1zb2Z0KTsKICAgICAgb3ZlcmZsb3c6IGhpZGRlbjsKICAgIH0KICAgIC5wcm9ncmVzczo6YmVmb3JlewogICAgICBjb250ZW50OiAiIjsKICAgICAgcG9zaXRpb246IGFic29sdXRlOwogICAgICB0b3A6IDA7IGxlZnQ6IDA7IGJvdHRvbTogMDsKICAgICAgd2lkdGg6IDQwJTsKICAgICAgYm9yZGVyLXJhZGl1czogOTk5cHg7CiAgICAgIGJhY2tncm91bmQ6IGxpbmVhci1ncmFkaWVudCg5MGRlZywgdHJhbnNwYXJlbnQsIHZhcigtLXB1cnBsZSksIHRyYW5zcGFyZW50KTsKICAgICAgYW5pbWF0aW9uOiBzbGlkZSAxLjlzIGVhc2UtaW4tb3V0IGluZmluaXRlOwogICAgfQogICAgQGtleWZyYW1lcyBzbGlkZXsKICAgICAgMCV7IHRyYW5zZm9ybTogdHJhbnNsYXRlWCgtMTIwJSk7IH0KICAgICAgMTAwJXsgdHJhbnNmb3JtOiB0cmFuc2xhdGVYKDMyMCUpOyB9CiAgICB9CgogICAgLnN0YXR1c3sKICAgICAgbWFyZ2luOiA0cHggMCAwOwogICAgICBmb250LXNpemU6IDEyLjVweDsKICAgICAgY29sb3I6IHZhcigtLWluay1zb2Z0KTsKICAgICAgbGV0dGVyLXNwYWNpbmc6IC4wMWVtOwogICAgfQoKICAgIGZvb3RlcnsKICAgICAgdGV4dC1hbGlnbjogY2VudGVyOwogICAgICBwYWRkaW5nOiAyMnB4IDE2cHggMzBweDsKICAgICAgZm9udC1zaXplOiAxMi41cHg7CiAgICAgIGNvbG9yOiB2YXIoLS1pbmstc29mdCk7CiAgICB9CiAgICBmb290ZXIgLmJyYW5keyBmb250LXNpemU6IDEzcHg7IH0KCiAgICBAbWVkaWEgKG1heC13aWR0aDogNDgwcHgpewogICAgICAuY2FyZHsgcGFkZGluZzogMzRweCAyMnB4IDMwcHg7IGJvcmRlci1yYWRpdXM6IDIwcHg7IH0KICAgICAgaDF7IGZvbnQtc2l6ZTogMjNweDsgfQogICAgICAuZW1ibGVteyB3aWR0aDogNzZweDsgaGVpZ2h0OiA3NnB4OyB9CiAgICB9CgogICAgQG1lZGlhIChwcmVmZXJzLXJlZHVjZWQtbW90aW9uOiByZWR1Y2UpewogICAgICAuZ2VhcnsgYW5pbWF0aW9uOiBub25lOyB9CiAgICAgIC5wcm9ncmVzczo6YmVmb3JleyBhbmltYXRpb246IG5vbmU7IHdpZHRoOiA1NSU7IHRyYW5zZm9ybTogbm9uZTsgbGVmdDogMDsgfQogICAgfQogIDwvc3R5bGU+CjwvaGVhZD4KPGJvZHk+CiAgPG1haW4gY2xhc3M9IndyYXAiPgogICAgPGRpdiBjbGFzcz0iY2FyZCIgcm9sZT0ic3RhdHVzIiBhcmlhLWxpdmU9InBvbGl0ZSI+CgogICAgICA8c3BhbiBjbGFzcz0iYnJhbmQiIGFyaWEtbGFiZWw9ImphbWVlcy5jb20iPmphbWVlczxzcGFuIGNsYXNzPSJkb3QiPi48L3NwYW4+PHNwYW4gY2xhc3M9InRsZCI+Y29tPC9zcGFuPjwvc3Bhbj4KCiAgICAgIDxkaXYgY2xhc3M9ImVtYmxlbSIgYXJpYS1oaWRkZW49InRydWUiPgogICAgICAgIDxzdmcgdmlld0JveD0iMCAwIDI0IDI0IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgogICAgICAgICAgPHBhdGggY2xhc3M9ImdlYXIiIGZpbGw9IiNmZmZmZmYiIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBkPSJNMTEuMDc4IDIuMjVjLS45MTcgMC0xLjY5OS42NjMtMS44NSAxLjU2N0w5LjA1IDQuODg5Yy0uMDIuMTItLjExNS4yNi0uMjk3LjM0OGE3LjQ5MyA3LjQ5MyAwIDAgMC0uOTg2LjU3Yy0uMTY2LjExNS0uMzM0LjEyNi0uNDUuMDgzTDYuMyA2LjA0NWExLjg3NSAxLjg3NSAwIDAgMC0yLjI4Mi44MTlsLS45MjIgMS41OTdhMS44NzUgMS44NzUgMCAwIDAgLjQzMiAyLjM4NWwuODQuNjkyYy4wOTUuMDc4LjE3LjIyOS4xNTQuNDNhNy41OTggNy41OTggMCAwIDAgMCAxLjEzOWMuMDE1LjItLjA1OS4zNTItLjE1My40M2wtLjg0MS42OTJhMS44NzUgMS44NzUgMCAwIDAtLjQzMiAyLjM4NWwuOTIyIDEuNTk3YTEuODc1IDEuODc1IDAgMCAwIDIuMjgyLjgxOGwxLjAxOS0uMzgyYy4xMTUtLjA0My4yODMtLjAzMS40NS4wODIuMzEyLjIxNC42NDEuNDA1Ljk4NS41Ny4xODIuMDg4LjI3Ny4yMjguMjk3LjM1bC4xNzggMS4wNzFjLjE1MS45MDQuOTMzIDEuNTY3IDEuODUgMS41NjdoMS44NDRjLjkxNiAwIDEuNjk5LS42NjMgMS44NS0xLjU2N2wuMTc4LTEuMDcyYy4wMi0uMTIuMTE0LS4yNi4yOTctLjM0OS4zNDQtLjE2NS42NzMtLjM1Ni45ODUtLjU3LjE2Ny0uMTE0LjMzNS0uMTI1LjQ1LS4wODJsMS4wMi4zODJhMS44NzUgMS44NzUgMCAwIDAgMi4yOC0uODE5bC45MjMtMS41OTdhMS44NzUgMS44NzUgMCAwIDAtLjQzMi0yLjM4NWwtLjg0LS42OTJjLS4wOTUtLjA3OC0uMTctLjIyOS0uMTU0LS40M2E3LjYxNCA3LjYxNCAwIDAgMCAwLTEuMTM5Yy0uMDE2LS4yLjA1OS0uMzUyLjE1My0uNDNsLjg0LS42OTJjLjcwOC0uNTgyLjg5MS0xLjU5LjQzMy0yLjM4NWwtLjkyMi0xLjU5N2ExLjg3NSAxLjg3NSAwIDAgMC0yLjI4Mi0uODE4bC0xLjAyLjM4MmMtLjExNC4wNDMtLjI4Mi4wMzEtLjQ0OS0uMDgzYTcuNDkgNy40OSAwIDAgMC0uOTg1LS41N2MtLjE4My0uMDg3LS4yNzctLjIyNy0uMjk3LS4zNDhsLS4xNzktMS4wNzJhMS44NzUgMS44NzUgMCAwIDAtMS44NS0xLjU2N2gtMS44NDNaTTEyIDE1Ljc1YTMuNzUgMy43NSAwIDEgMCAwLTcuNSAzLjc1IDMuNzUgMCAwIDAgMCA3LjVaIj48L3BhdGg+CiAgICAgICAgPC9zdmc+CiAgICAgIDwvZGl2PgoKICAgICAgPGgxPlNpdGUgZW0gY29uc3RydcOnw6NvPC9oMT4KICAgICAgPHAgY2xhc3M9ImxlYWQiPkVzdGFtb3MgcHJlcGFyYW5kbyB0dWRvIHBhcmEgbyBsYW7Dp2FtZW50by4gTyBjb250ZcO6ZG8gYXBhcmVjZSBhcXVpIGFzc2ltIHF1ZSBhIHB1YmxpY2HDp8OjbyBmb3IgY29uY2x1w61kYS48L3A+CgogICAgICA8c3BhbiBjbGFzcz0ic2l0ZSI+X19TSVRFX05BTUVfXzwvc3Bhbj4KCiAgICAgIDxkaXYgY2xhc3M9InByb2dyZXNzIiByb2xlPSJwcmVzZW50YXRpb24iPjwvZGl2PgogICAgICA8cCBjbGFzcz0ic3RhdHVzIj5BbWJpZW50ZSBhdGl2byAmbWlkZG90OyBhZ3VhcmRhbmRvIHB1YmxpY2HDp8OjbzwvcD4KCiAgICA8L2Rpdj4KICA8L21haW4+CgogIDxmb290ZXI+CiAgICBIb3NwZWRhZG8gcG9yIDxzcGFuIGNsYXNzPSJicmFuZCI+amFtZWVzPHNwYW4gY2xhc3M9ImRvdCI+Ljwvc3Bhbj48c3BhbiBjbGFzcz0idGxkIj5jb208L3NwYW4+PC9zcGFuPgogIDwvZm9vdGVyPgo8L2JvZHk+CjwvaHRtbD4K";

/** PHP: serve a página "site em construção" (nome do ambiente injetado). */
const PHP_INDEX = `<?php
$name = getenv("VP_ENV_NAME") ?: "seu site";
$page = str_replace("__SITE_NAME__", htmlspecialchars($name), base64_decode("${CONSTRUCTION_B64}"));
header("Content-Type: text/html; charset=utf-8");
echo $page;
`;

/** Node: serve a página "site em construção" (nome do ambiente injetado). */
const NODE_SERVER = `const http = require("http");
const name = process.env.VP_ENV_NAME || "seu site";
const page = Buffer.from("${CONSTRUCTION_B64}", "base64").toString("utf8").split("__SITE_NAME__").join(name);
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(page);
}).listen(80, "0.0.0.0");
console.log("VelozPlanel node server on :80");
`;

/** Python: HTTP server da stdlib (sem framework) que serve a página de exemplo
 *  na :80 — garante que o env "nasce vivo" mesmo sem código do usuário.
 *  NUNCA usar aspas simples (o conteúdo vai entre aspas simples no shell). */
const PYTHON_SERVER = `import os, base64
from http.server import BaseHTTPRequestHandler, HTTPServer
name = os.environ.get("VP_ENV_NAME", "seu site")
page = base64.b64decode("${CONSTRUCTION_B64}").decode("utf-8").replace("__SITE_NAME__", name)
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(page.encode("utf-8"))
    def log_message(self, *a):
        pass
print("VelozPlanel python server on :80")
HTTPServer(("0.0.0.0", 80), H).serve_forever()
`;

/** Estático: Caddyfile com fallback SPA (try_files → index.html) e arquivos
 *  ocultos escondidos. Sem aspas simples. */
const CADDYFILE = `:80 {
	root * /site
	encode gzip
	try_files {path} {path}/ /index.html
	file_server {
		hide .*
	}
}
`;

/** Estático: index.html de exemplo (site vazio). Sem aspas simples. */
const STATIC_INDEX = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <meta name="color-scheme" content="light dark">
  <title>Site em construção &middot; jamees.com</title>
  <style>
    :root{
      --purple: #634ca8;
      --purple-strong: #4a3880;
      --purple-soft: #efecf8;
      --ink: #23212b;
      --ink-soft: #5c5a68;
      --bg: #f6f5fb;
      --card: #ffffff;
      --line: #eae7f3;
      --shadow: 0 20px 60px -24px rgba(74,56,128,.35);
    }
    @media (prefers-color-scheme: dark){
      :root{
        --purple: #a996e8;
        --purple-strong: #c3b6f2;
        --purple-soft: #241f38;
        --ink: #f2f1f7;
        --ink-soft: #b0acc2;
        --bg: #131120;
        --card: #1b1830;
        --line: #2b2745;
        --shadow: 0 24px 70px -28px rgba(0,0,0,.7);
      }
    }

    *{ box-sizing: border-box; }
    html, body{ height: 100%; }
    body{
      margin: 0;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: var(--ink);
      background: var(--bg);
      background-image:
        radial-gradient(60% 55% at 50% -10%, rgba(99,76,168,.16), transparent 60%),
        radial-gradient(45% 40% at 100% 100%, rgba(99,76,168,.10), transparent 55%);
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
      display: flex;
      flex-direction: column;
      min-height: 100%;
    }

    .wrap{
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px 20px;
    }

    .card{
      width: 100%;
      max-width: 560px;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: var(--shadow);
      padding: 44px 40px 40px;
      text-align: center;
    }

    /* Wordmark */
    .brand{
      display: inline-flex;
      align-items: baseline;
      font-weight: 800;
      font-size: 22px;
      letter-spacing: -.02em;
      color: var(--ink);
      user-select: none;
    }
    .brand .dot{ color: var(--purple); font-weight: 800; margin: 0 1px; }
    .brand .tld{
      font-size: .62em;
      font-weight: 600;
      color: var(--ink-soft);
      opacity: .7;
      letter-spacing: 0;
    }

    /* Emblem */
    .emblem{
      width: 84px;
      height: 84px;
      margin: 28px auto 22px;
      border-radius: 22px;
      display: grid;
      place-items: center;
      background: linear-gradient(160deg, var(--purple), var(--purple-strong));
      box-shadow: 0 14px 32px -12px rgba(99,76,168,.65);
      position: relative;
    }
    .emblem svg{ width: 44px; height: 44px; display: block; }
    .gear{
      transform-origin: 50% 50%;
      transform-box: fill-box;
      animation: spin 9s linear infinite;
    }
    @keyframes spin{ to{ transform: rotate(360deg); } }

    h1{
      margin: 0 0 10px;
      font-size: 27px;
      line-height: 1.2;
      letter-spacing: -.02em;
      color: var(--ink);
    }
    .lead{
      margin: 0 auto;
      max-width: 40ch;
      font-size: 15.5px;
      line-height: 1.6;
      color: var(--ink-soft);
    }

    .site{
      display: inline-block;
      max-width: 100%;
      margin: 18px 0 4px;
      padding: 7px 14px;
      border-radius: 999px;
      background: var(--purple-soft);
      color: var(--purple-strong);
      font-weight: 600;
      font-size: 14px;
      letter-spacing: -.01em;
      overflow-wrap: anywhere;
      border: 1px solid var(--line);
    }

    /* Progress bar (touch of life) */
    .progress{
      position: relative;
      height: 6px;
      margin: 30px auto 6px;
      max-width: 320px;
      border-radius: 999px;
      background: var(--purple-soft);
      overflow: hidden;
    }
    .progress::before{
      content: "";
      position: absolute;
      top: 0; left: 0; bottom: 0;
      width: 40%;
      border-radius: 999px;
      background: linear-gradient(90deg, transparent, var(--purple), transparent);
      animation: slide 1.9s ease-in-out infinite;
    }
    @keyframes slide{
      0%{ transform: translateX(-120%); }
      100%{ transform: translateX(320%); }
    }

    .status{
      margin: 4px 0 0;
      font-size: 12.5px;
      color: var(--ink-soft);
      letter-spacing: .01em;
    }

    footer{
      text-align: center;
      padding: 22px 16px 30px;
      font-size: 12.5px;
      color: var(--ink-soft);
    }
    footer .brand{ font-size: 13px; }

    @media (max-width: 480px){
      .card{ padding: 34px 22px 30px; border-radius: 20px; }
      h1{ font-size: 23px; }
      .emblem{ width: 76px; height: 76px; }
    }

    @media (prefers-reduced-motion: reduce){
      .gear{ animation: none; }
      .progress::before{ animation: none; width: 55%; transform: none; left: 0; }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <div class="card" role="status" aria-live="polite">

      <span class="brand" aria-label="jamees.com">jamees<span class="dot">.</span><span class="tld">com</span></span>

      <div class="emblem" aria-hidden="true">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path class="gear" fill="#ffffff" fill-rule="evenodd" clip-rule="evenodd" d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567L9.05 4.889c-.02.12-.115.26-.297.348a7.493 7.493 0 0 0-.986.57c-.166.115-.334.126-.45.083L6.3 6.045a1.875 1.875 0 0 0-2.282.819l-.922 1.597a1.875 1.875 0 0 0 .432 2.385l.84.692c.095.078.17.229.154.43a7.598 7.598 0 0 0 0 1.139c.015.2-.059.352-.153.43l-.841.692a1.875 1.875 0 0 0-.432 2.385l.922 1.597a1.875 1.875 0 0 0 2.282.818l1.019-.382c.115-.043.283-.031.45.082.312.214.641.405.985.57.182.088.277.228.297.35l.178 1.071c.151.904.933 1.567 1.85 1.567h1.844c.916 0 1.699-.663 1.85-1.567l.178-1.072c.02-.12.114-.26.297-.349.344-.165.673-.356.985-.57.167-.114.335-.125.45-.082l1.02.382a1.875 1.875 0 0 0 2.28-.819l.923-1.597a1.875 1.875 0 0 0-.432-2.385l-.84-.692c-.095-.078-.17-.229-.154-.43a7.614 7.614 0 0 0 0-1.139c-.016-.2.059-.352.153-.43l.84-.692c.708-.582.891-1.59.433-2.385l-.922-1.597a1.875 1.875 0 0 0-2.282-.818l-1.02.382c-.114.043-.282.031-.449-.083a7.49 7.49 0 0 0-.985-.57c-.183-.087-.277-.227-.297-.348l-.179-1.072a1.875 1.875 0 0 0-1.85-1.567h-1.843ZM12 15.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z"></path>
        </svg>
      </div>

      <h1>Site em construção</h1>
      <p class="lead">Estamos preparando tudo para o lançamento. O conteúdo aparece aqui assim que a publicação for concluída.</p>

      <span class="site">seu site</span>

      <div class="progress" role="presentation"></div>
      <p class="status">Ambiente ativo &middot; aguardando publicação</p>

    </div>
  </main>

  <footer>
    Hospedado por <span class="brand">jamees<span class="dot">.</span><span class="tld">com</span></span>
  </footer>
</body>
</html>
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
  switch (runtime.kind) {
    case "php":
      return `php:${runtime.version}-cli`;
    case "python":
      return `python:${runtime.version}-slim`;
    case "static":
      return `caddy:2-alpine`;
    default:
      return `node:${runtime.version}-alpine`;
  }
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

// Corta a linha SÓ no primeiro '=' (k=${line%%=*}, v=${line#*=}). NÃO usar
// IFS='=' read k v: o base64 costuma terminar em '=' (padding) e o read trata
// esse '=' do fim como delimitador e o descarta → base64 -d recebe entrada
// truncada e perde os últimos bytes do valor.
const LOAD_ENV =
  `if [ -f /veloz/env ]; then while IFS= read -r line; do ` +
  `k=\${line%%=*}; v=\${line#*=}; ` +
  `[ -n "\$k" ] && export "\$k=\$(printf %s "\$v" | base64 -d 2>/dev/null)"; done < /veloz/env; fi; `;

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
  if (runtime.kind === "python") {
    // PYTHON: supervisor. Se houver comando avançado (/.vp-python-cmd, restaurado
    // de VP_PY_CMD base64 — Django/gunicorn), roda ele; senão roda `python3 <START>`
    // (de /.vp-python-start, senão VP_PY_START, senão app.py), gravando o servidor
    // de exemplo se o arquivo ainda não existir → :80 sempre sobe no caminho comum.
    const script =
      setup +
      `touch /.veloz-env-capable; mkdir -p /app; ` +
      `trap 'kill "\$VPPID" 2>/dev/null; exit 0' TERM INT; ` +
      `[ -f /.vp-python-cmd ] || { [ -n "\$VP_PY_CMD" ] && printf '%s' "\$VP_PY_CMD" | base64 -d > /.vp-python-cmd; }; ` +
      `while :; do ` +
      LOAD_ENV +
      `CMD="\$(cat /.vp-python-cmd 2>/dev/null)"; ` +
      `START="\$(cat /.vp-python-start 2>/dev/null || printf '%s' "\${VP_PY_START:-app.py}")"; ` +
      `if [ -z "\$CMD" ] && [ ! -f "/app/\$START" ]; then printf '%s' '${PYTHON_SERVER}' > "/app/\$START"; fi; ` +
      // deps vendorizadas pelo deploy (pip --target=.vp-vendor) sempre no path.
      `export PYTHONPATH="/app/.vp-vendor\${PYTHONPATH:+:\$PYTHONPATH}"; ` +
      `cd /app; if [ -n "\$CMD" ]; then sh -c "\$CMD" & else python3 "\$START" & fi; ` +
      `VPPID=\$!; echo "\$VPPID" > /.vp-python-pid; echo "\$VPPID" > /.vp-app-pid; wait "\$VPPID"; ` +
      `sleep 1; ` +
      `done`;
    return ["sh", "-c", script];
  }
  if (runtime.kind === "static") {
    // ESTÁTICO: Caddy file-server na :80 com fallback SPA. docroot /site.
    // O container usa Entrypoint=/bin/sh (ver createContainer) → Cmd = ["-c", …].
    const script =
      setup +
      `mkdir -p /site; ` +
      `trap 'kill "\$VPPID" 2>/dev/null; exit 0' TERM INT; ` +
      `[ -f /.vp-caddyfile ] || printf '%s' '${CADDYFILE}' > /.vp-caddyfile; ` +
      `[ -f /site/index.html ] || printf '%s' '${STATIC_INDEX}' > /site/index.html; ` +
      `while :; do ` +
      `caddy run --config /.vp-caddyfile --adapter caddyfile & VPPID=\$!; echo "\$VPPID" > /.vp-app-pid; wait "\$VPPID"; ` +
      `sleep 1; ` +
      `done`;
    return ["-c", script];
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
      // Defesa em profundidade: nunca deixa o loader sobrescrever PATH/LD_PRELOAD/
      // IFS etc. nem o namespace interno VP_ (mesmo filtro do Env nativo do Docker,
      // ver createContainer). A API já valida as chaves, isto é a 2ª barreira.
      .filter((v) => !RESERVED_ENV.has(v.key) && !v.key.startsWith("VP_"))
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

/** Igual ao applyNodeStart, mas para Python: grava /.vp-python-start e mata o pid. */
export async function applyPythonStart(containerId: string, startFile: string): Promise<void> {
  const c = docker.getContainer(containerId);
  const write = await c.exec({
    Cmd: ["sh", "-c", `printf '%s' '${startFile}' > /.vp-python-start`],
    AttachStdout: false,
    AttachStderr: false,
  });
  await write.start({});
  const kill = await c.exec({
    Cmd: ["sh", "-c", `kill "$(cat /.vp-python-pid 2>/dev/null)" 2>/dev/null || true`],
    AttachStdout: false,
    AttachStderr: false,
  });
  await kill.start({});
}

/** Define/limpa o comando avançado do Python (Django/gunicorn) SEM recriar o
 *  container: grava /.vp-python-cmd (base64→decode) ou o remove, e mata o pid. */
export async function applyPythonCmd(containerId: string, cmd: string | null): Promise<void> {
  const c = docker.getContainer(containerId);
  const trimmed = (cmd ?? "").trim();
  const write = trimmed
    ? `printf '%s' '${Buffer.from(trimmed, "utf8").toString("base64")}' | base64 -d > /.vp-python-cmd`
    : `rm -f /.vp-python-cmd`;
  const w = await c.exec({ Cmd: ["sh", "-c", write], AttachStdout: false, AttachStderr: false });
  await w.start({});
  const kill = await c.exec({
    Cmd: ["sh", "-c", `kill "$(cat /.vp-python-pid 2>/dev/null)" 2>/dev/null || true`],
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
  // Python/Estático guardam o CÓDIGO num volume nomeado → sobrevive à troca de
  // versão (recreate). Node/PHP seguem sem volume (deploy por git). O delete
  // job remove veloz-code-* junto.
  const codeDir = runtime.kind === "python" ? "/app" : runtime.kind === "static" ? "/site" : null;
  if (codeDir) {
    await ensureNamedVolume(`veloz-code-${envId}`, envId);
    binds.push(`veloz-code-${envId}:${codeDir}`);
  }
  const cpuset = await pickCpuset(limits.vcpu);
  const attachNet = !!(args.network && args.ip && args.ownerId);
  if (attachNet) {
    await ensureNetwork(args.network!.name, args.network!.subnet, args.network!.gateway, args.ownerId!);
  }
  const container = await docker.createContainer({
    Image: image,
    // Estático usa caddy:2-alpine (ENTRYPOINT=caddy) → força /bin/sh p/ rodar o script.
    ...(runtime.kind === "static" ? { Entrypoint: ["/bin/sh"] } : {}),
    Cmd: cmdFor(runtime, args.startupScript),
    Env: [
      `VP_ENV_NAME=${name}`,
      `VP_RUNTIME_KIND=${runtime.kind}`,
      `VP_RUNTIME_VERSION=${runtime.version}`,
      // arquivo de start do Node na 1ª subida; depois /.vp-node-start manda.
      `VP_NODE_START=${(args.startFile && args.startFile.trim()) || "index.js"}`,
      // arquivo de start do Python na 1ª subida; depois /.vp-python-start manda.
      `VP_PY_START=${(args.startFile && args.startFile.trim()) || "app.py"}`,
      // comando avançado do Python (Django/gunicorn) transportado em base64 e
      // restaurado no boot em /.vp-python-cmd (durável a recreate).
      `VP_PY_CMD=${args.pythonCmd && args.pythonCmd.trim() ? Buffer.from(args.pythonCmd, "utf8").toString("base64") : ""}`,
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
    throw new Error(`Docker não publicou a porta 80 (seu app precisa escutar em 0.0.0.0:80). log: ${logTail}`);
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

/* ─────────────── Jamees Studio (console de banco via docker exec) ─────────────── */

// Lock em memória: 1 exec de console por ambiente (o agente é 1 processo por nó).
const dbConsoleLocks = new Set<string>();

/** Executa um plano do db-console no container, com 2 sinks, cap de bytes e timeout. */
async function execDb(containerId: string, plan: ExecPlan): Promise<ExecOutput> {
  const c = docker.getContainer(containerId);
  const ex = await c.exec({ Cmd: plan.cmd, Env: plan.env, AttachStdout: true, AttachStderr: true, Tty: false });
  const stream = await ex.start({ hijack: true, stdin: false });
  const { Writable } = await import("node:stream");
  const MAX_BYTES = 12 * 1024 * 1024;
  const outChunks: Buffer[] = [];
  const errChunks: Buffer[] = [];
  let outLen = 0;
  let truncated = false;
  const outSink = new Writable({
    write(chunk, _enc, cb) {
      const b = Buffer.from(chunk);
      if (outLen < MAX_BYTES) {
        outChunks.push(b);
        outLen += b.length;
      } else truncated = true;
      cb();
    },
  });
  const errSink = new Writable({
    write(chunk, _enc, cb) {
      errChunks.push(Buffer.from(chunk));
      cb();
    },
  });
  let timedOut = false;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        (stream as unknown as { destroy(): void }).destroy();
      } catch {
        /* ignore */
      }
      resolve();
    }, plan.timeoutMs);
    docker.modem.demuxStream(stream, outSink, errSink);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    stream.on("end", done);
    stream.on("close", done);
  });
  const info = await ex.inspect().catch(() => ({ ExitCode: 1 }) as Docker.ExecInspectInfo);
  const stderr = Buffer.concat(errChunks).toString("utf8");
  return {
    stdout: Buffer.concat(outChunks),
    stderr: timedOut ? stderr || "tempo limite excedido (25s)" : stderr,
    exitCode: timedOut ? 124 : (info.ExitCode ?? 1),
    truncated,
  };
}

class DbBusyError extends Error {
  code = "db_busy";
  constructor() {
    super("já existe uma consulta em andamento neste ambiente");
  }
}

export interface RunDbConsoleArgs {
  containerId: string;
  envId: string;
  engine: StudioEngine;
  sql?: DbRunSqlInput;
  mongo?: DbRunMongoInput;
  redis?: DbRunRedisInput;
}

/** Ponto de entrada do agente: classifica+monta (via db-console), executa e parseia. */
export async function runDbConsole(args: RunDbConsoleArgs): Promise<DbResult> {
  if (dbConsoleLocks.has(args.envId)) throw new DbBusyError();
  dbConsoleLocks.add(args.envId);
  try {
    let plan: ExecPlan;
    if (isSqlEngine(args.engine) && args.sql) {
      plan = buildSqlExec(args.engine, args.sql);
    } else if (args.engine === "mongodb" && args.mongo) {
      plan = buildMongoExec(args.mongo);

    } else if (args.engine === "redis" && args.redis) {
      plan = buildRedisExec(args.redis);
    } else {
      const e = new Error("requisição inválida para o engine") as Error & { code: string };
      e.code = "bad_request";
      throw e;
    }
    const started = Date.now();
    const out = await execDb(args.containerId, plan);
    const result = parseExec(plan, out);
    return { ...result, tookMs: Date.now() - started };
  } finally {
    dbConsoleLocks.delete(args.envId);
  }
}

/* ─────────────── Redis Pub/Sub (stream SSE — molde dos logs) ─────────────── */

export interface RedisSubStream {
  stream: NodeJS.ReadableStream;
  kill: () => void;
}

/** Abre um SUBSCRIBE/PSUBSCRIBE via redis-cli --csv e devolve o stdout (linhas CSV). */
export async function redisSubscribeStream(
  containerId: string,
  mode: "channel" | "pattern",
  target: string,
  db: number,
): Promise<RedisSubStream> {
  const { PassThrough } = await import("node:stream");
  const verb = mode === "pattern" ? "psubscribe" : "subscribe";
  const dbn = Number.isInteger(db) ? Math.max(0, Math.min(15, db)) : 0;
  // `timeout 3600` reap um assinante abandonado (docker exec não expõe kill do processo).
  const cmd = ["timeout", "3600", "redis-cli", "-n", String(dbn), "--csv", verb, target];
  const ex = await docker.getContainer(containerId).exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true, Tty: false });
  const raw = await ex.start({ hijack: true, stdin: false });
  const out = new PassThrough();
  docker.modem.demuxStream(raw, out, out);
  const kill = (): void => {
    try {
      (raw as unknown as { destroy?: () => void }).destroy?.();
    } catch {
      /* noop */
    }
    out.end();
  };
  raw.on("end", () => out.end());
  raw.on("close", () => out.end());
  return { stream: out, kill };
}

/** Split de uma linha CSV do redis-cli (`"a","b",c`) respeitando aspas. */
export function splitRedisCsv(line: string): string[] {
  const fields: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { f += '"'; i++; } else q = false;
      } else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { fields.push(f); f = ""; }
    else f += ch;
  }
  fields.push(f);
  return fields;
}

/** Normaliza uma linha do subscribe/psubscribe num objeto de mensagem. */
export function redisPubSubMessage(line: string): { type: string; channel?: string; pattern?: string; payload?: string } | null {
  if (!line.trim()) return null;
  const f = splitRedisCsv(line);
  const type = f[0] ?? "";
  if (type === "message") return { type, channel: f[1], payload: f[2] };
  if (type === "pmessage") return { type, pattern: f[1], channel: f[2], payload: f[3] };
  if (type === "subscribe" || type === "psubscribe" || type === "unsubscribe" || type === "punsubscribe")
    return { type, channel: f[1] };
  return { type: type || "raw", payload: line };
}
