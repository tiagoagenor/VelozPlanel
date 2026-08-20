import type {
  ChangeRuntimeInput,
  CreateDatabaseInput,
  CreateEnvironmentInput,
  Database,
  DatabaseWithSecret,
  Environment,
  FileContent,
  FileList,
  LoginInput,
  MetricSeries,
  Node,
  SessionUser,
  SslStatus,
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

/** Define (ou remove, com null) o domínio próprio do ambiente. */
export function setDomain(
  id: string,
  domain: string | null,
): Promise<Environment> {
  return request<Environment>(`/environments/${id}/domain`, {
    method: "POST",
    body: { domain },
  });
}

/** Troca a versão/linguagem do runtime — recria o container. */
export function changeRuntime(
  id: string,
  input: ChangeRuntimeInput,
): Promise<Environment> {
  return request<Environment>(`/environments/${id}/runtime`, {
    method: "POST",
    body: input,
  });
}

/* ─────────────── SSL / HTTPS ─────────────── */

/** Lê o status honesto de SSL/HTTPS do ambiente. */
export function getSsl(id: string): Promise<SslStatus> {
  return request<SslStatus>(`/environments/${id}/ssl`);
}

/** Liga/desliga o redirecionamento para HTTPS. */
export function setForceHttps(
  id: string,
  forceHttps: boolean,
): Promise<SslStatus> {
  return request<SslStatus>(`/environments/${id}/ssl/force-https`, {
    method: "POST",
    body: { forceHttps },
  });
}

/** Emite um certificado (de desenvolvimento no núcleo). Exige domínio. */
export function issueSsl(id: string): Promise<SslStatus> {
  return request<SslStatus>(`/environments/${id}/ssl/issue`, {
    method: "POST",
  });
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

/* ─────────────── Bancos de dados ─────────────── */

export function listDatabases(id: string): Promise<Database[]> {
  return request<Database[]>(`/environments/${id}/databases`);
}

/** Cria um banco. A senha vem UMA vez na resposta (não é armazenada em claro). */
export function createDatabase(
  id: string,
  input: CreateDatabaseInput,
): Promise<DatabaseWithSecret> {
  return request<DatabaseWithSecret>(`/environments/${id}/databases`, {
    method: "POST",
    body: input,
  });
}

export function deleteDatabase(id: string, dbId: string): Promise<void> {
  return request<void>(`/environments/${id}/databases/${dbId}`, {
    method: "DELETE",
  });
}

/* ─────────────── Arquivos ─────────────── */

/** Lista o conteúdo de um diretório dentro da raiz do ambiente. */
export function listFiles(id: string, path?: string): Promise<FileList> {
  return request<FileList>(`/environments/${id}/files`, { query: { path } });
}

/** Lê o conteúdo (texto) de um arquivo. `truncated` indica corte por tamanho. */
export function readFile(id: string, path: string): Promise<FileContent> {
  return request<FileContent>(`/environments/${id}/files/read`, {
    query: { path },
  });
}

/** Grava (cria/sobrescreve) um arquivo. */
export function writeFile(
  id: string,
  path: string,
  content: string,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/environments/${id}/files/write`, {
    method: "POST",
    body: { path, content },
  });
}

/** Cria uma pasta (recursivo). */
export function mkdirFile(id: string, path: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/environments/${id}/files/mkdir`, {
    method: "POST",
    body: { path },
  });
}

/** Exclui um arquivo ou pasta (recursivo). */
export function deleteFile(id: string, path: string): Promise<void> {
  return request<void>(`/environments/${id}/files`, {
    method: "DELETE",
    query: { path },
  });
}

/** Renomeia (dentro do mesmo diretório) um arquivo ou pasta. */
export function renameFile(
  id: string,
  path: string,
  newName: string,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/environments/${id}/files/rename`, {
    method: "POST",
    body: { path, newName },
  });
}

/** Altera as permissões (chmod) de um arquivo ou pasta. Modo octal, ex.: "644". */
export function chmodFile(
  id: string,
  path: string,
  mode: string,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/environments/${id}/files/chmod`, {
    method: "POST",
    body: { path, mode },
  });
}

/**
 * Baixa um arquivo como Blob (bytes crus). Faz `fetch` direto com o cookie de
 * sessão para funcionar cross-origin; não usa `request` porque a resposta é
 * binária, não JSON.
 */
export async function downloadFile(id: string, path: string): Promise<Blob> {
  const url = `${API_BASE}/environments/${id}/files/download?path=${encodeURIComponent(
    path,
  )}`;
  let res: Response;
  try {
    res = await fetch(url, { credentials: "include", cache: "no-store" });
  } catch {
    throw new ApiError(0, "Não foi possível falar com a API.", "network_error");
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let d: { error?: string; message?: string } = {};
    try {
      d = raw ? (JSON.parse(raw) as typeof d) : {};
    } catch {
      /* corpo não-JSON */
    }
    throw new ApiError(res.status, d.message ?? res.statusText, d.error);
  }
  return res.blob();
}
