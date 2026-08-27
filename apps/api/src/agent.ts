import type { RuntimeSpec, StudioEngine, DbRunSqlInput, DbRunMongoInput, DbRunRedisInput, DbResult } from "@velozplanel/contracts";
import { ApiHttpError } from "./auth";

/**
 * Cliente HTTP do Agente (dockerode). Multi-nó: cada função recebe o
 * `agentUrl` do nó onde o ambiente vive (ex.: http://10.77.0.2:4100 via
 * WireGuard). Em dev/single-node usa-se `DEFAULT_AGENT_URL`.
 * Todas as chamadas usam o `fetch` global (Node >= 22).
 */
export const DEFAULT_AGENT_URL = process.env.AGENT_URL ?? "http://localhost:4100";

export interface ProvisionInput {
  envId: string;
  name: string;
  runtime: RuntimeSpec;
  limits: { vcpu: number; memMb: number };
  startupScript?: string | null;
  startFile?: string | null;
  pythonCmd?: string | null;
  dotnetCmd?: string | null;
  phpNodeVersion?: string | null;
  phpRoot?: string | null;
  envVars?: { key: string; value: string; buildTime?: boolean }[];
  network?: { name: string; subnet: string; gateway: string } | null;
  ip?: string | null;
  ownerId?: string | null;
}

export interface ProvisionResult {
  containerId: string;
  httpPort: number;
  versionFull: string | null;
  phpNodeVersionFull?: string | null;
}

export interface AgentStats {
  cpuPct: number;
  memBytes: number;
  memLimitBytes: number;
}

async function call<T>(
  agentUrl: string,
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 30_000,
): Promise<T> {
  let res: Response;
  const headers: Record<string, string> = {};
  if (process.env.VP_INTERNAL_TOKEN) headers["x-agent-token"] = process.env.VP_INTERNAL_TOKEN;
  if (body !== undefined) headers["content-type"] = "application/json";
  try {
    res = await fetch(`${agentUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw new ApiHttpError(
      502,
      "agent_unreachable",
      `não foi possível falar com o Agente em ${agentUrl}`,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiHttpError(
      502,
      "agent_error",
      `Agente respondeu ${res.status} em ${method} ${path}: ${text}`,
    );
  }
  // 204 / corpo vazio
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function provision(agentUrl: string, input: ProvisionInput): Promise<ProvisionResult> {
  return call<ProvisionResult>(agentUrl, "POST", "/provision", input, 600_000);
}

export interface ProvisionServiceInput {
  envId: string;
  name: string;
  image: string;
  limits: { vcpu: number; memMb: number };
  network: { name: string; subnet: string; gateway: string };
  ip: string;
  ownerId: string;
  dataPath?: string | null;
  env?: { key: string; value: string }[];
  readiness?: string | null;
  role?: string;
  publishPort?: number | null;
}

export function provisionService(
  agentUrl: string,
  input: ProvisionServiceInput,
): Promise<{ containerId: string; ready: boolean; httpPort?: number | null }> {
  return call<{ containerId: string; ready: boolean; httpPort?: number | null }>(agentUrl, "POST", "/provision-service", input, 600_000);
}

export function start(agentUrl: string, containerId: string): Promise<{ httpPort: number | null }> {
  // httpPort é null para serviços puros (mariadb/redis) — não publicam porta.
  return call<{ httpPort: number | null }>(agentUrl, "POST", "/start", { containerId });
}

export function containerIp(agentUrl: string, containerId: string): Promise<{ ip: string | null }> {
  return call<{ ip: string | null }>(agentUrl, "GET", `/container/${encodeURIComponent(containerId)}/ip`);
}

export function removeVolume(agentUrl: string, name: string): Promise<void> {
  return call<void>(agentUrl, "POST", "/volume/remove", { name });
}

/* ── Ingress por domínio (Caddy do nó) ── */
export function ingressAvailable(agentUrl: string): Promise<{ available: boolean }> {
  return call<{ available: boolean }>(agentUrl, "GET", "/ingress/available", undefined, 8_000);
}
export function publishSite(agentUrl: string, domain: string, upstream: string): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(agentUrl, "PUT", "/ingress/site", { domain, upstream }, 15_000);
}
export function unpublishSite(agentUrl: string, domain: string): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(agentUrl, "DELETE", "/ingress/site", { domain }, 15_000);
}

export function attachNetwork(
  agentUrl: string,
  containerId: string,
  network: { name: string; subnet: string; gateway: string },
  ip: string,
  ownerId: string,
): Promise<{ attached: boolean; alreadyAttached: boolean }> {
  return call<{ attached: boolean; alreadyAttached: boolean }>(agentUrl, "POST", "/network/attach", { containerId, network, ip, ownerId });
}

/** Reinicia o processo do app (sem recriar o container). */
export function restartApp(agentUrl: string, containerId: string): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(agentUrl, "POST", `/container/${containerId}/restart-app`, undefined, 15_000);
}

/* ── Logs do container ── */
export function containerLogs(agentUrl: string, containerId: string, tail: number): Promise<{ log: string }> {
  return call<{ log: string }>(agentUrl, "GET", `/container/${containerId}/logs?tail=${tail}`, undefined, 15_000);
}
/** URL + headers para o STREAM de logs (SSE) — a rota da API repassa o corpo. */
export function containerLogsStream(agentUrl: string, containerId: string, tail: number): { url: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  if (process.env.VP_INTERNAL_TOKEN) headers["x-agent-token"] = process.env.VP_INTERNAL_TOKEN;
  return { url: `${agentUrl}/container/${containerId}/logs/stream?tail=${tail}`, headers };
}

/** Troca o arquivo de start do Node e reinicia o app (sem recriar o container). */
export function applyNodeStart(
  agentUrl: string,
  containerId: string,
  startFile: string,
): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(agentUrl, "POST", "/node-start", { containerId, startFile });
}

/** Troca o arquivo de start do Python e reinicia o app (sem recriar o container). */
export function applyPythonStart(agentUrl: string, containerId: string, startFile: string): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(agentUrl, "POST", "/python-start", { containerId, startFile });
}

/** Define/limpa o comando avançado do Python (Django) e reinicia o app. */
export function applyPythonCmd(agentUrl: string, containerId: string, cmd: string | null): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(agentUrl, "POST", "/python-cmd", { containerId, cmd });
}

/** Define/limpa o comando avançado do .NET (dotnet App.dll) e reinicia o app. */
export function applyDotnetCmd(agentUrl: string, containerId: string, cmd: string | null): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(agentUrl, "POST", "/dotnet-cmd", { containerId, cmd });
}

/** Comando .NET que o supervisor está efetivamente rodando agora (inspeciona o container). */
export function dotnetEffectiveCmd(agentUrl: string, containerId: string): Promise<{ cmd: string }> {
  return call<{ cmd: string }>(agentUrl, "POST", "/dotnet-effective-cmd", { containerId });
}

/** Troca a versão de Node (via nvm) de um container PHP; devolve a versão real. */
export function applyNodeVersion(
  agentUrl: string,
  containerId: string,
  version: string,
): Promise<{ versionFull: string | null }> {
  return call<{ versionFull: string | null }>(agentUrl, "POST", "/node-version", { containerId, version });
}

/** Aplica o docroot do PHP (público = /app/www) ao vivo. */
export function applyPhpRoot(
  agentUrl: string,
  containerId: string,
  root: string,
  useRouter: boolean,
): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(agentUrl, "POST", "/php-root", { containerId, root, useRouter });
}

/** Lê a versão de Node atual (default do nvm) no container. */
export function readNodeCurrent(
  agentUrl: string,
  containerId: string,
): Promise<{ current: string | null }> {
  return call<{ current: string | null }>(agentUrl, "POST", "/node-current", { containerId });
}

/* ─── Deploy + env vars ─── */
export function applyEnvVars(
  agentUrl: string,
  containerId: string,
  vars: { key: string; value: string }[],
): Promise<{ applied: boolean; reason?: string }> {
  return call(agentUrl, "POST", "/env-vars", { containerId, vars });
}
export interface HttpCreds { username: string; password: string }
export function deployKey(agentUrl: string, envId: string, image: string): Promise<{ publicKey: string; fingerprint: string }> {
  return call(agentUrl, "POST", "/deploy/key", { envId, image });
}
export function deployImportKey(agentUrl: string, envId: string, image: string, privateKey: string): Promise<{ publicKey: string; fingerprint: string }> {
  return call(agentUrl, "POST", "/deploy/key/import", { envId, image, privateKey });
}
export function deployReset(agentUrl: string, envId: string, image: string): Promise<{ ok: boolean }> {
  return call(agentUrl, "POST", "/deploy/reset", { envId, image });
}
export function deployProbe(agentUrl: string, envId: string, image: string, repoUrl: string, http?: HttpCreds): Promise<{ reachable: boolean; isPrivate: boolean | null; message: string; defaultBranch: string | null }> {
  return call(agentUrl, "POST", "/deploy/probe", { envId, image, repoUrl, http });
}
export function deployBranches(agentUrl: string, envId: string, image: string, repoUrl: string, http?: HttpCreds): Promise<{ ok: boolean; branches: string[]; message: string }> {
  return call(agentUrl, "POST", "/deploy/branches", { envId, image, repoUrl, http });
}
export function deployTest(agentUrl: string, envId: string, image: string, repoUrl: string, http?: HttpCreds): Promise<{ ok: boolean; message: string; defaultBranch: string | null }> {
  return call(agentUrl, "POST", "/deploy/test", { envId, image, repoUrl, http });
}
export interface DeployDetectResult {
  framework: string; runModel: string; serverEntry: string; hasComposer: boolean; hasPackageJson: boolean;
  hasRequirements?: boolean; suggestedStartFile?: string | null; suggestedPythonCmd?: string | null;
}
export function deployDetect(agentUrl: string, envId: string, image: string, repoUrl: string, branch: string, kind: string, http?: HttpCreds): Promise<DeployDetectResult> {
  return call(agentUrl, "POST", "/deploy/detect", { envId, image, repoUrl, branch, kind, http });
}
export interface DeployRunInput {
  envId: string; image: string; appContainerId: string; workdir: string;
  repoUrl: string; branch: string;
  steps: { kind: string; command?: string | null; cwd?: string | null; enabled: boolean }[];
  buildEnv: { key: string; value: string }[]; framework: string; runModel: string; http?: HttpCreds; subdir?: string | null;
  runId: string; nodeStartFile?: string | null; historyLimit?: number;
  runtimeKind?: string; pythonCmd?: string | null; dotnetCmd?: string | null;
}
export function startDeploy(agentUrl: string, input: DeployRunInput): Promise<{ started: boolean }> {
  return call(agentUrl, "POST", "/deploy/run", input);
}
export function deployLog(agentUrl: string, runId: string): Promise<{ log: string; status: string; done: boolean; commitSha: string | null; exitCode: number | null }> {
  return call(agentUrl, "GET", `/deploy/log/${encodeURIComponent(runId)}`);
}

export function stop(agentUrl: string, containerId: string): Promise<void> {
  return call<void>(agentUrl, "POST", "/stop", { containerId });
}

export function remove(agentUrl: string, containerId: string): Promise<void> {
  return call<void>(agentUrl, "DELETE", `/container/${encodeURIComponent(containerId)}`);
}

export function diskUsage(agentUrl: string, containerId: string): Promise<{ diskBytes: number }> {
  return call<{ diskBytes: number }>(agentUrl, "GET", `/disk/${encodeURIComponent(containerId)}`);
}

export function stats(agentUrl: string, containerId: string): Promise<AgentStats> {
  return call<AgentStats>(agentUrl, "GET", `/stats/${encodeURIComponent(containerId)}`);
}

export function updateResources(
  agentUrl: string,
  containerId: string,
  memMb: number,
  vcpu: number,
): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(agentUrl, "POST", `/resources/${encodeURIComponent(containerId)}`, {
    memMb,
    vcpu,
  });
}

/* ─────────────── Arquivos ─────────────── */

export interface AgentFileEntry {
  name: string;
  type: "file" | "dir";
  size: number;
  mtime: number;
  mode: string;
}

export interface AgentDownloadResult {
  base64: string;
  name: string;
  size: number;
}

export function listFiles(
  agentUrl: string,
  containerId: string,
  path: string,
): Promise<{ entries: AgentFileEntry[] }> {
  return call<{ entries: AgentFileEntry[] }>(
    agentUrl,
    "GET",
    `/files/${encodeURIComponent(containerId)}?path=${encodeURIComponent(path)}`,
  );
}

export function readFile(
  agentUrl: string,
  containerId: string,
  path: string,
): Promise<{ content: string; truncated: boolean }> {
  return call<{ content: string; truncated: boolean }>(
    agentUrl,
    "GET",
    `/files/${encodeURIComponent(containerId)}/read?path=${encodeURIComponent(path)}`,
  );
}

export function writeFile(
  agentUrl: string,
  containerId: string,
  path: string,
  content: string,
): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(
    agentUrl,
    "POST",
    `/files/${encodeURIComponent(containerId)}/write`,
    { path, content },
  );
}

export function uploadFile(
  agentUrl: string,
  containerId: string,
  path: string,
  contentBase64: string,
): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(
    agentUrl,
    "POST",
    `/files/${encodeURIComponent(containerId)}/upload`,
    { path, contentBase64 },
  );
}

export function mkdir(
  agentUrl: string,
  containerId: string,
  path: string,
): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(
    agentUrl,
    "POST",
    `/files/${encodeURIComponent(containerId)}/mkdir`,
    { path },
  );
}

export function removeFile(agentUrl: string, containerId: string, path: string): Promise<void> {
  return call<void>(
    agentUrl,
    "DELETE",
    `/files/${encodeURIComponent(containerId)}?path=${encodeURIComponent(path)}`,
  );
}

export function renameFile(
  agentUrl: string,
  containerId: string,
  path: string,
  newName: string,
): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(
    agentUrl,
    "POST",
    `/files/${encodeURIComponent(containerId)}/rename`,
    { path, newName },
  );
}

export function chmodFile(
  agentUrl: string,
  containerId: string,
  path: string,
  mode: string,
): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(
    agentUrl,
    "POST",
    `/files/${encodeURIComponent(containerId)}/chmod`,
    { path, mode },
  );
}

export function downloadFile(
  agentUrl: string,
  containerId: string,
  path: string,
): Promise<AgentDownloadResult> {
  return call<AgentDownloadResult>(
    agentUrl,
    "GET",
    `/files/${encodeURIComponent(containerId)}/download?path=${encodeURIComponent(path)}`,
  );
}

/** Jamees Studio: executa uma consulta/comando de banco no container (timeout 40s > 25s do engine). */
export function dbExec(
  agentUrl: string,
  body: { containerId: string; envId: string; engine: StudioEngine; sql?: DbRunSqlInput; mongo?: DbRunMongoInput ; redis?: DbRunRedisInput },
): Promise<DbResult> {
  return call<DbResult>(agentUrl, "POST", "/db/exec", body, 40_000);
}

/** Jamees Studio: URL+headers do stream SSE de pub/sub do Redis (a API proxia). */
export function redisSubscribeStream(
  agentUrl: string,
  containerId: string,
  params: { mode: "channel" | "pattern"; target: string; db: number },
): { url: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  if (process.env.VP_INTERNAL_TOKEN) headers["x-agent-token"] = process.env.VP_INTERNAL_TOKEN;
  const qs = new URLSearchParams({ mode: params.mode, target: params.target, db: String(params.db) });
  return { url: `${agentUrl}/db/redis/subscribe/${containerId}?${qs.toString()}`, headers };
}
