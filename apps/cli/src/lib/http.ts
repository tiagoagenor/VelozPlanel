/** Chamadas HTTP à API interna (WireGuard) e aos agentes dos nós. */

export interface HttpResult {
  ok: boolean;
  status: number;
  json: unknown;
  text: string;
}

export async function httpJson(
  url: string,
  opts: { method?: string; token?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<HttpResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (opts.token) {
      // Mesmo segredo serve x-internal-token (API) e x-agent-token (agente).
      headers["x-internal-token"] = opts.token;
      headers["x-agent-token"] = opts.token;
    }
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text };
  } catch (e) {
    return { ok: false, status: 0, json: null, text: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(t);
  }
}
