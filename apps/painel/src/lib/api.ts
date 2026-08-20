import type {
  CreateEnvironmentInput,
  Environment,
  LoginInput,
  MetricSeries,
  Node,
  SessionUser,
} from "@velozplanel/contracts";

/**
 * Base da API do núcleo (ver NUCLEO-SPEC.md).
 * Configurável por env para acesso pela rede — ex.:
 *   NEXT_PUBLIC_API_URL=http://192.168.2.105:4000/api/v1
 * Default de dev: http://localhost:4000/api/v1
 */
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

/** Erro de API tipado, carrega o status HTTP para tratamento (ex.: 401). */
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | undefined>;
};

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query } = opts;

  let url = `${API_BASE}${path}`;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v != null) qs.set(k, v);
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      // envia/recebe o cookie de sessão httpOnly `vp_session`
      credentials: "include",
      headers:
        body != null ? { "Content-Type": "application/json" } : undefined,
      body: body != null ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    // Falha de rede / CORS / API fora do ar: `fetch` lança TypeError.
    // Normaliza para ApiError(status 0) para o tratamento global tratar como
    // sessão não confirmável e mandar ao login (ver providers/AuthGuard).
    throw new ApiError(0, "Não foi possível falar com a API.", "network_error");
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const raw = await res.text();
  let data: unknown = undefined;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
  }

  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; message?: string };
    throw new ApiError(res.status, d.message ?? res.statusText, d.error);
  }

  return data as T;
}

/* ─────────────── Auth ─────────────── */

export function login(input: LoginInput): Promise<SessionUser> {
  return request<SessionUser>("/auth/login", { method: "POST", body: input });
}

export function logout(): Promise<void> {
  return request<void>("/auth/logout", { method: "POST" });
}

export function me(): Promise<SessionUser> {
  return request<SessionUser>("/auth/me");
}

/* ─────────────── Nós (admin) ─────────────── */

export function listNodes(): Promise<Node[]> {
  return request<Node[]>("/nodes");
}

/* ─────────────── Ambientes ─────────────── */

export function listEnvironments(): Promise<Environment[]> {
  return request<Environment[]>("/environments");
}

export function getEnvironment(id: string): Promise<Environment> {
  return request<Environment>(`/environments/${id}`);
}

export function createEnvironment(
  input: CreateEnvironmentInput,
): Promise<Environment> {
  return request<Environment>("/environments", { method: "POST", body: input });
}

export function pauseEnvironment(id: string): Promise<Environment> {
  return request<Environment>(`/environments/${id}/pause`, { method: "POST" });
}

export function startEnvironment(id: string): Promise<Environment> {
  return request<Environment>(`/environments/${id}/start`, { method: "POST" });
}

export function deleteEnvironment(id: string): Promise<void> {
  return request<void>(`/environments/${id}`, { method: "DELETE" });
}

/* ─────────────── Métricas ─────────────── */

export function getMetrics(
  id: string,
  window = "15m",
): Promise<MetricSeries> {
  return request<MetricSeries>(`/environments/${id}/metrics`, {
    query: { window },
  });
}
