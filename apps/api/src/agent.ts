import type { RuntimeSpec } from "@velozplanel/contracts";
import { ApiHttpError } from "./auth";

/**
 * Cliente HTTP do Agente (dockerode) em http://localhost:4100.
 * Todas as chamadas usam o `fetch` global (Node >= 22).
 */
const AGENT_URL = process.env.AGENT_URL ?? "http://localhost:4100";

export interface ProvisionInput {
  envId: string;
  name: string;
  runtime: RuntimeSpec;
  limits: { vcpu: number; memMb: number };
}

export interface ProvisionResult {
  containerId: string;
  httpPort: number;
}

export interface AgentStats {
  cpuPct: number;
  memBytes: number;
  memLimitBytes: number;
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${AGENT_URL}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    throw new ApiHttpError(
      502,
      "agent_unreachable",
      `não foi possível falar com o Agente em ${AGENT_URL}`,
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

export function provision(input: ProvisionInput): Promise<ProvisionResult> {
  return call<ProvisionResult>("POST", "/provision", input);
}

export function start(containerId: string): Promise<{ httpPort: number }> {
  return call<{ httpPort: number }>("POST", "/start", { containerId });
}

export function stop(containerId: string): Promise<void> {
  return call<void>("POST", "/stop", { containerId });
}

export function remove(containerId: string): Promise<void> {
  return call<void>("DELETE", `/container/${encodeURIComponent(containerId)}`);
}

export function stats(containerId: string): Promise<AgentStats> {
  return call<AgentStats>("GET", `/stats/${encodeURIComponent(containerId)}`);
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
  containerId: string,
  path: string,
): Promise<{ entries: AgentFileEntry[] }> {
  return call<{ entries: AgentFileEntry[] }>(
    "GET",
    `/files/${encodeURIComponent(containerId)}?path=${encodeURIComponent(path)}`,
  );
}

export function readFile(
  containerId: string,
  path: string,
): Promise<{ content: string; truncated: boolean }> {
  return call<{ content: string; truncated: boolean }>(
    "GET",
    `/files/${encodeURIComponent(containerId)}/read?path=${encodeURIComponent(path)}`,
  );
}

export function writeFile(
  containerId: string,
  path: string,
  content: string,
): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(
    "POST",
    `/files/${encodeURIComponent(containerId)}/write`,
    { path, content },
  );
}

export function mkdir(
  containerId: string,
  path: string,
): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(
    "POST",
    `/files/${encodeURIComponent(containerId)}/mkdir`,
    { path },
  );
}

export function removeFile(containerId: string, path: string): Promise<void> {
  return call<void>(
    "DELETE",
    `/files/${encodeURIComponent(containerId)}?path=${encodeURIComponent(path)}`,
  );
}

export function renameFile(
  containerId: string,
  path: string,
  newName: string,
): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(
    "POST",
    `/files/${encodeURIComponent(containerId)}/rename`,
    { path, newName },
  );
}

export function chmodFile(
  containerId: string,
  path: string,
  mode: string,
): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(
    "POST",
    `/files/${encodeURIComponent(containerId)}/chmod`,
    { path, mode },
  );
}

export function downloadFile(
  containerId: string,
  path: string,
): Promise<AgentDownloadResult> {
  return call<AgentDownloadResult>(
    "GET",
    `/files/${encodeURIComponent(containerId)}/download?path=${encodeURIComponent(path)}`,
  );
}
