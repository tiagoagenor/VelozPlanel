import type {
  ChangeRuntimeInput,
  CreateDatabaseInput,
  CreateEnvironmentInput,
  Database,
  DatabaseWithSecret,
  DbStudioConfig,
  DbResult,
  DbSchema,
  DbTableMeta,
  DbRunSqlInput,
  DbRunMongoInput,
  DbRunRedisInput,
  Environment,
  FileContent,
  FileList,
  LoginInput,
  MetricSeries,
  DiskUsage,
  Node,
  SessionUser,
  SslStatus,
  AdminPanelStatus,
  SshConfig,
  SshKey,
  AddSshKeyInput,
  GenerateSshKeyInput,
  GeneratedSshKey,
  UpdateSshConfigInput,
  SftpConfig,
  SetSftpEnabledInput,
  GeneratedSftpPassword,
  DeployConfig,
  SetDeployConnectionInput,
  DeployProbeInput,
  DeployProbeResult,
  GeneratedDeployKey,
  ImportDeployKeyInput,
  SetDeployHttpCredentialsInput,
  SetDeployStepsInput,
  SetDeployAutoInput,
  DeployRun,
  DeployBranchesResult,
  SetDeployBranchInput,
  SetDeployHistoryInput,
  EnvVarsConfig,
  SetEnvVarsInput,
  AdminOverview,
  AdminUser,
  CreateUserInput,
  UpdateUserInput,
  AdminEnvironment,
  ResourceChangeInput,
  AuditEntry,
  WgPeer,
  AddWgPeerInput,
  Plan,
  CreatePlanInput,
  UpdatePlanInput,
  EnvType,
  CreateEnvTypeInput,
  UpdateEnvTypeInput,
  RegionOption,
  ReservedSubdomain,
  CreateReservedSubdomainInput,
  CreditTransaction,
  AddCreditInput,
  Balance,
  ModuleInfo,
  BillingSettings,
  BillingRunHour,
  ContainerLogs,
  UpdateBillingSettingsInput,
  DnsZone,
  DnsRRset,
  DnsServerInfo,
  CreateZoneInput,
  CreateZoneResult,
  UpsertRRsetInput,
  DeleteRRsetInput,
  VerifyResult,
  DiscoverResult,
  DnsZoneEffective,
  DnsPoint,
  PointInput,
  PointResult,
} from "@velozplanel/contracts";

/**
 * Base da API do núcleo (ver NUCLEO-SPEC.md).
 *
 * Prioridade:
 *  1) `NEXT_PUBLIC_API_URL` explícito (produção atrás de proxy, domínio próprio).
 *  2) Mesma origem do navegador na porta 4000 — funciona igual acessando por
 *     `localhost:3000` OU por `192.168.2.105:3000` na LAN, sem quebrar o cookie
 *     de sessão (que é preso ao host). É o que resolve o laço de "volta pro login".
 *  3) Fallback de SSR (sem `window`): localhost.
 */
function resolveApiBase(): string {
  const explicit = process.env.NEXT_PUBLIC_API_URL;
  if (explicit) return explicit;
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:4000/api/v1`;
  }
  return "http://localhost:4000/api/v1";
}

export const API_BASE = resolveApiBase();

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

/**
 * Define (ou remove, com null) o host público do nó — IP/hostname que os
 * clientes usam para SSH/SFTP e no registro A do DNS. Ação de super admin.
 */
export function updateNode(
  id: string,
  patch: { publicHost?: string | null; httpHost?: string | null; alertMessage?: string | null; region?: string },
): Promise<Node> {
  return request<Node>(`/nodes/${id}`, {
    method: "PATCH",
    body: patch,
  });
}

/* ─────────────── Ambientes ─────────────── */

export function listEnvironments(): Promise<Environment[]> {
  return request<Environment[]>("/environments");
}

/** Tipos de ambiente ativos (para o wizard de criação), com preço por tipo. */
export function listServiceTypes(): Promise<EnvType[]> {
  return request<EnvType[]>("/env-types");
}

/** Regiões disponíveis para criar ambiente (com aviso opcional da máquina). */
export function listRegions(): Promise<RegionOption[]> {
  return request<RegionOption[]>("/regions");
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

/* ── Jamees Studio (console de banco) ── */
export function getStudioConfig(id: string): Promise<DbStudioConfig> {
  return request<DbStudioConfig>(`/environments/${id}/studio`);
}
export function setStudioEnabled(id: string, enabled: boolean): Promise<DbStudioConfig> {
  return request<DbStudioConfig>(`/environments/${id}/studio/enable`, { method: "POST", body: { enabled } });
}
export function setStudioPassword(id: string, password: string | null): Promise<DbStudioConfig> {
  return request<DbStudioConfig>(`/environments/${id}/studio/password`, { method: "POST", body: { password } });
}
export function unlockStudio(id: string, password: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/environments/${id}/studio/unlock`, { method: "POST", body: { password } });
}
/**
 * O agente executa 1 consulta por ambiente de cada vez (lock; paralelo → 429 db_busy).
 * Serializa TODAS as chamadas do Studio de um mesmo ambiente numa fila FIFO por id,
 * para o react-query poder disparar schema/dados/contagem/metadados sem colidir.
 */
const studioChains = new Map<string, Promise<unknown>>();
function studioSerialize<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = studioChains.get(id) ?? Promise.resolve();
  const run = prev.then(fn, fn); // roda fn independente do resultado anterior
  studioChains.set(id, run.catch(() => {}));
  return run;
}

export function studioExec(id: string, body: DbStudioExecBody): Promise<DbResult> {
  return studioSerialize(id, () => request<DbResult>(`/environments/${id}/studio/exec`, { method: "POST", body }));
}
export type DbStudioExecBody = { sql: DbRunSqlInput } | { mongo: DbRunMongoInput } | { redis: DbRunRedisInput };

/** Introspecção de schema (IDE): lista tabelas/views + versão. */
export function getStudioSchema(id: string): Promise<DbSchema> {
  return studioSerialize(id, () => request<DbSchema>(`/environments/${id}/studio/schema`));
}
/** Metadados de uma tabela (colunas, PK, índices, FKs, triggers, DDL). */
export function getStudioTable(id: string, name: string): Promise<DbTableMeta> {
  return studioSerialize(id, () => request<DbTableMeta>(`/environments/${id}/studio/table/${encodeURIComponent(name)}`));
}

export function startEnvironment(id: string): Promise<Environment> {
  return request<Environment>(`/environments/${id}/start`, { method: "POST" });
}

/** Reinicia o processo do app (aplica edições de arquivo sem recriar o container). */
export function restartEnvironment(id: string): Promise<Environment> {
  return request<Environment>(`/environments/${id}/restart`, { method: "POST" });
}

/** Enfileira a remoção; o ambiente entra em "deleting" e some quando o worker termina. */
export function deleteEnvironment(id: string): Promise<Environment> {
  return request<Environment>(`/environments/${id}`, { method: "DELETE" });
}

/** Re-enfileira a última operação (provisionar/remover) de um ambiente com falha. */
export function retryEnvironment(id: string): Promise<Environment> {
  return request<Environment>(`/environments/${id}/retry`, { method: "POST" });
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

/** Personaliza o subdomínio temporário jamees.top do ambiente. */
export function updateSubdomain(id: string, subdomain: string): Promise<Environment> {
  return request<Environment>(`/environments/${id}/subdomain`, {
    method: "PATCH",
    body: { subdomain },
  });
}

/* ── Subdomínios reservados (super admin) ── */
export function listReservedSubdomains(): Promise<ReservedSubdomain[]> {
  return request<ReservedSubdomain[]>("/admin/reserved-subdomains");
}
export function createReservedSubdomain(input: CreateReservedSubdomainInput): Promise<ReservedSubdomain> {
  return request<ReservedSubdomain>("/admin/reserved-subdomains", { method: "POST", body: input });
}
export function deleteReservedSubdomain(name: string): Promise<void> {
  return request<void>(`/admin/reserved-subdomains/${encodeURIComponent(name)}`, { method: "DELETE" });
}

/** Define/limpa os comandos de inicialização (rodam 1x na criação do container). */
export function setStartupScript(
  id: string,
  startupScript: string | null,
): Promise<Environment> {
  return request<Environment>(`/environments/${id}/startup`, {
    method: "POST",
    body: { startupScript },
  });
}

/** Define o arquivo que inicia o app Node (ex.: server.js) e reinicia o app. */
export function setNodeStartFile(
  id: string,
  nodeStartFile: string | null,
): Promise<Environment> {
  return request<Environment>(`/environments/${id}/node-start`, {
    method: "POST",
    body: { nodeStartFile },
  });
}

/** Define/limpa o comando de start avançado do Python (Django); aplica ao vivo. */
export function setPythonCmd(id: string, cmd: string | null, apply = true): Promise<Environment> {
  return request<Environment>(`/environments/${id}/python-cmd`, {
    method: "POST",
    body: { cmd, apply },
  });
}

/** Define/limpa o comando avançado de start do .NET (dotnet App.dll). Aplica ao vivo. */
export function setDotnetCmd(id: string, cmd: string | null, apply = true): Promise<Environment> {
  return request<Environment>(`/environments/${id}/dotnet-cmd`, {
    method: "POST",
    body: { cmd, apply },
  });
}

/** Comando .NET que o container está rodando agora (para exibir no campo avançado). */
export function getDotnetEffectiveCmd(id: string): Promise<{ cmd: string }> {
  return request<{ cmd: string }>(`/environments/${id}/dotnet-effective-cmd`);
}

/** Troca a versão de Node (via nvm) de um ambiente PHP; aplica ao vivo. */
export function setPhpNodeVersion(
  id: string,
  phpNodeVersion: string,
): Promise<Environment> {
  return request<Environment>(`/environments/${id}/node-version`, {
    method: "POST",
    body: { phpNodeVersion },
  });
}

/** Lê a versão de Node atual no container (reflete troca feita no terminal). */
export function getPhpNodeCurrent(id: string): Promise<{ current: string | null }> {
  return request<{ current: string | null }>(`/environments/${id}/node-version`);
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

/* ─────────────── Painel admin de serviço (RabbitMQ) ─────────────── */

/** Estado do painel admin embutido (exposto ou não, URL, credenciais). */
export function getAdminPanel(id: string): Promise<AdminPanelStatus> {
  return request<AdminPanelStatus>(`/environments/${id}/admin-panel`);
}

/** Liga/desliga a exposição do painel admin num subdomínio aleatório. */
export function setAdminPanel(id: string, enabled: boolean): Promise<AdminPanelStatus> {
  return request<AdminPanelStatus>(`/environments/${id}/admin-panel`, {
    method: "POST",
    body: { enabled },
  });
}

/* ─────────────── SSH / SFTP ─────────────── */

/** Lê a configuração honesta de acesso SSH/SFTP do ambiente. */
export function getSsh(id: string): Promise<SshConfig> {
  return request<SshConfig>(`/environments/${id}/ssh`);
}

/** Grava a configuração (ligar/desligar, modo de auth, escopo de acesso, allowlist). */
export function updateSsh(
  id: string,
  input: UpdateSshConfigInput,
): Promise<SshConfig> {
  return request<SshConfig>(`/environments/${id}/ssh`, {
    method: "PUT",
    body: input,
  });
}

/** Adiciona uma chave pública autorizada (valida formato + fingerprint na API). */
export function addSshKey(id: string, input: AddSshKeyInput): Promise<SshKey> {
  return request<SshKey>(`/environments/${id}/ssh/keys`, {
    method: "POST",
    body: input,
  });
}

/** Gera um par ed25519 no servidor; devolve a chave PRIVADA UMA vez (baixe já). */
export function generateSshKey(
  id: string,
  input: GenerateSshKeyInput,
): Promise<GeneratedSshKey> {
  return request<GeneratedSshKey>(`/environments/${id}/ssh/keys/generate`, {
    method: "POST",
    body: input,
  });
}

/** Remove uma chave pública autorizada do ambiente. */
export function deleteSshKey(id: string, keyId: string): Promise<void> {
  return request<void>(`/environments/${id}/ssh/keys/${keyId}`, {
    method: "DELETE",
  });
}

/* ─────────────── SFTP (arquivos, só senha) ─────────────── */

/** Lê a configuração de acesso SFTP do ambiente. */
export function getSftp(id: string): Promise<SftpConfig> {
  return request<SftpConfig>(`/environments/${id}/sftp`);
}

/** Liga/desliga o SFTP do ambiente. */
export function setSftpEnabled(
  id: string,
  input: SetSftpEnabledInput,
): Promise<SftpConfig> {
  return request<SftpConfig>(`/environments/${id}/sftp`, {
    method: "PUT",
    body: input,
  });
}

/** Gera/reseta a senha do SFTP (sempre aleatória); volta em texto UMA vez. */
export function resetSftpPassword(id: string): Promise<GeneratedSftpPassword> {
  return request<GeneratedSftpPassword>(`/environments/${id}/sftp/password`, {
    method: "POST",
  });
}

/* ─────────────── Deploy (Git) ─────────────── */
export function getDeploy(id: string): Promise<DeployConfig> {
  return request<DeployConfig>(`/environments/${id}/deploy`);
}
export function setDeployConnection(id: string, input: SetDeployConnectionInput): Promise<DeployConfig> {
  return request<DeployConfig>(`/environments/${id}/deploy/connection`, { method: "PUT", body: input });
}
export function deployProbe(id: string, input: DeployProbeInput): Promise<DeployProbeResult> {
  return request<DeployProbeResult>(`/environments/${id}/deploy/probe`, { method: "POST", body: input });
}
export function generateDeployKey(id: string): Promise<GeneratedDeployKey> {
  return request<GeneratedDeployKey>(`/environments/${id}/deploy/key/generate`, { method: "POST" });
}
export function testDeployKey(id: string): Promise<{ ok: boolean; message: string }> {
  return request<{ ok: boolean; message: string }>(`/environments/${id}/deploy/key/test`, { method: "POST" });
}
export function importDeployKey(id: string, input: ImportDeployKeyInput): Promise<GeneratedDeployKey> {
  return request<GeneratedDeployKey>(`/environments/${id}/deploy/key/import`, { method: "POST", body: input });
}
export function setDeployHttpCredentials(id: string, input: SetDeployHttpCredentialsInput): Promise<{ ok: boolean; message: string }> {
  return request<{ ok: boolean; message: string }>(`/environments/${id}/deploy/http-credentials`, { method: "PUT", body: input });
}
export function detectDeploySteps(id: string): Promise<DeployConfig> {
  return request<DeployConfig>(`/environments/${id}/deploy/steps/detect`, { method: "POST" });
}
export function setDeploySteps(id: string, input: SetDeployStepsInput): Promise<DeployConfig> {
  return request<DeployConfig>(`/environments/${id}/deploy/steps`, { method: "PUT", body: input });
}
export function setDeployAuto(id: string, input: SetDeployAutoInput): Promise<DeployConfig> {
  return request<DeployConfig>(`/environments/${id}/deploy/auto`, { method: "PUT", body: input });
}
export function runDeploy(id: string): Promise<DeployRun> {
  return request<DeployRun>(`/environments/${id}/deploy/run`, { method: "POST" });
}
export function getDeployRuns(id: string): Promise<DeployRun[]> {
  return request<DeployRun[]>(`/environments/${id}/deploy/runs`);
}
export function deleteDeploy(id: string): Promise<void> {
  return request<void>(`/environments/${id}/deploy`, { method: "DELETE" });
}
export function getDeployBranches(id: string): Promise<DeployBranchesResult> {
  return request<DeployBranchesResult>(`/environments/${id}/deploy/branches`);
}
export function setDeployBranch(id: string, input: SetDeployBranchInput): Promise<DeployConfig> {
  return request<DeployConfig>(`/environments/${id}/deploy/branch`, { method: "PUT", body: input });
}
export function setDeployHistory(id: string, input: SetDeployHistoryInput): Promise<DeployConfig> {
  return request<DeployConfig>(`/environments/${id}/deploy/history`, { method: "PUT", body: input });
}
export function getDeployRunLog(id: string, runId: string): Promise<{ log: string | null; status: string }> {
  return request<{ log: string | null; status: string }>(`/environments/${id}/deploy/runs/${runId}/log`);
}

/* ─────────────── Variáveis de ambiente ─────────────── */
export function getEnvVars(id: string): Promise<EnvVarsConfig> {
  return request<EnvVarsConfig>(`/environments/${id}/env-vars`);
}
export function setEnvVars(id: string, input: SetEnvVarsInput): Promise<EnvVarsConfig> {
  return request<EnvVarsConfig>(`/environments/${id}/env-vars`, { method: "PUT", body: input });
}
export function revealEnvVars(id: string): Promise<{ vars: { key: string; value: string; buildTime: boolean; hidden: boolean }[] }> {
  return request<{ vars: { key: string; value: string; buildTime: boolean; hidden: boolean }[] }>(`/environments/${id}/env-vars/reveal`, { method: "POST" });
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

export function getDisk(id: string): Promise<DiskUsage> {
  return request<DiskUsage>(`/environments/${id}/disk`);
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

/**
 * Envia (cria/sobrescreve) um arquivo numa pasta de destino. O conteúdo vai
 * em base64 (suporta binário: imagens, zip etc.). `dir` é a pasta de destino
 * (confinada à raiz na API) e `filename` o nome final (sem barras).
 */
export function uploadFile(
  id: string,
  dir: string,
  filename: string,
  contentBase64: string,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/environments/${id}/files/upload`, {
    method: "POST",
    body: { dir, filename, contentBase64 },
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

/** Snapshot das últimas `tail` linhas de log do ambiente. */
export function getEnvLogs(id: string, tail = 200): Promise<ContainerLogs> {
  return request<ContainerLogs>(`/environments/${id}/logs?tail=${tail}`);
}

/** URL do stream ao vivo (SSE) — usada com EventSource (envia o cookie de sessão). */
export function envLogsStreamUrl(id: string, tail = 200): string {
  return `${API_BASE}/environments/${id}/logs/stream?tail=${tail}`;
}

/* ═══════════════ SUPER ADMIN ═══════════════ */

/* ── Dashboard da operação ── */

/** Panorama da operação: nós, ambientes, usuários, bancos e receita estimada. */
export function adminOverview(): Promise<AdminOverview> {
  return request<AdminOverview>("/admin/overview");
}

/* ── Usuários / clientes ── */

export function listUsers(): Promise<AdminUser[]> {
  return request<AdminUser[]>("/admin/users");
}

export function createUser(input: CreateUserInput): Promise<AdminUser> {
  return request<AdminUser>("/admin/users", { method: "POST", body: input });
}

export function updateUser(
  id: string,
  input: UpdateUserInput,
): Promise<AdminUser> {
  return request<AdminUser>(`/admin/users/${id}`, {
    method: "PATCH",
    body: input,
  });
}

export function deleteUser(id: string): Promise<void> {
  return request<void>(`/admin/users/${id}`, { method: "DELETE" });
}

/** Ambientes pertencentes a um usuário (visão de detalhe). */
export function userEnvironments(id: string): Promise<AdminEnvironment[]> {
  return request<AdminEnvironment[]>(`/admin/users/${id}/environments`);
}

/* ── Ambientes da frota ── */

export function listAllEnvironments(): Promise<AdminEnvironment[]> {
  return request<AdminEnvironment[]>("/admin/environments");
}

/** Altera vCPU/RAM de um ambiente (a quente se estiver rodando). Motivo obrigatório. */
export function changeResources(
  id: string,
  input: ResourceChangeInput,
): Promise<AdminEnvironment> {
  return request<AdminEnvironment>(`/admin/environments/${id}/resources`, {
    method: "POST",
    body: input,
  });
}

export function grantSubdomainChanges(id: string, count: number): Promise<AdminEnvironment> {
  return request<AdminEnvironment>(`/admin/environments/${id}/subdomain-grant`, {
    method: "POST",
    body: { count },
  });
}

export function setDefaultRegion(region: string): Promise<{ region: string }> {
  return request<{ region: string }>("/admin/default-region", { method: "PUT", body: { region } });
}

/* ── Auditoria ── */

export function listAudit(limit = 200): Promise<AuditEntry[]> {
  return request<AuditEntry[]>("/admin/audit", {
    query: { limit: String(limit) },
  });
}

/* ── Rede / WireGuard ── */

export function listWgPeers(): Promise<WgPeer[]> {
  return request<WgPeer[]>("/admin/wg/peers");
}

export function addWgPeer(input: AddWgPeerInput): Promise<WgPeer> {
  return request<WgPeer>("/admin/wg/peers", { method: "POST", body: input });
}

export function deleteWgPeer(id: string): Promise<void> {
  return request<void>(`/admin/wg/peers/${id}`, { method: "DELETE" });
}

/* ── Créditos / saldo ── */

/** Adiciona (ou remove, com valor negativo) saldo de um cliente. */
export function addCredit(
  userId: string,
  input: AddCreditInput,
): Promise<CreditTransaction> {
  return request<CreditTransaction>(`/admin/users/${userId}/credit`, {
    method: "POST",
    body: input,
  });
}

/** Extrato de créditos/débitos de um cliente (visão admin). */
export function listUserCredits(userId: string): Promise<CreditTransaction[]> {
  return request<CreditTransaction[]>(`/admin/users/${userId}/credits`);
}

/* ── Planos (admin) ── */

/** Todos os planos, ativos e inativos (visão admin). */
export function listAdminPlans(): Promise<Plan[]> {
  return request<Plan[]>("/admin/plans");
}

export function createPlan(input: CreatePlanInput): Promise<Plan> {
  return request<Plan>("/admin/plans", { method: "POST", body: input });
}

export function updatePlan(id: string, input: UpdatePlanInput): Promise<Plan> {
  return request<Plan>(`/admin/plans/${id}`, { method: "PATCH", body: input });
}

export function deletePlan(id: string): Promise<void> {
  return request<void>(`/admin/plans/${id}`, { method: "DELETE" });
}

/* ── Tipos de ambiente / preço por tipo (admin) ── */

export function listEnvTypes(): Promise<EnvType[]> {
  return request<EnvType[]>("/admin/env-types");
}

export function createEnvType(input: CreateEnvTypeInput): Promise<EnvType> {
  return request<EnvType>("/admin/env-types", { method: "POST", body: input });
}

export function updateEnvType(id: string, input: UpdateEnvTypeInput): Promise<EnvType> {
  return request<EnvType>(`/admin/env-types/${id}`, { method: "PATCH", body: input });
}

export function deleteEnvType(id: string): Promise<void> {
  return request<void>(`/admin/env-types/${id}`, { method: "DELETE" });
}

/* ── Módulos ── */

export function listModules(): Promise<ModuleInfo[]> {
  return request<ModuleInfo[]>("/admin/modules");
}

/* ── DNS / Domínios (admin global) ── */

export function dnsServerInfo(): Promise<DnsServerInfo> {
  return request<DnsServerInfo>("/admin/dns/server-info");
}

export function listDnsZones(): Promise<DnsZone[]> {
  return request<DnsZone[]>("/admin/dns/zones");
}

export function createDnsZone(input: CreateZoneInput): Promise<CreateZoneResult> {
  return request<CreateZoneResult>("/admin/dns/zones", { method: "POST", body: input });
}

export function deleteDnsZone(zone: string): Promise<void> {
  return request<void>(`/admin/dns/zones/${encodeURIComponent(zone)}`, { method: "DELETE" });
}

export function getDnsRRsets(zone: string): Promise<DnsRRset[]> {
  return request<DnsRRset[]>(`/admin/dns/zones/${encodeURIComponent(zone)}/rrsets`);
}

export function putDnsRRset(zone: string, input: UpsertRRsetInput): Promise<DnsRRset[]> {
  return request<DnsRRset[]>(`/admin/dns/zones/${encodeURIComponent(zone)}/rrset`, { method: "PUT", body: input });
}

export function deleteDnsRRset(zone: string, input: DeleteRRsetInput): Promise<DnsRRset[]> {
  return request<DnsRRset[]>(`/admin/dns/zones/${encodeURIComponent(zone)}/rrset`, { method: "DELETE", body: input });
}

export function verifyDnsZone(zone: string): Promise<VerifyResult> {
  return request<VerifyResult>(`/admin/dns/zones/${encodeURIComponent(zone)}/verify`, { method: "POST" });
}

export function discoverDnsZone(zone: string): Promise<DiscoverResult> {
  return request<DiscoverResult>(`/admin/dns/zones/${encodeURIComponent(zone)}/discover`);
}

/* ── Faturamento / cobrança por hora (cron configurável) ── */

/** Configuração e estado atual do cron de cobrança (visão admin). */
export function getBilling(): Promise<BillingSettings> {
  return request<BillingSettings>("/admin/billing");
}

/** Atualiza a configuração do cron de cobrança. */
export function updateBilling(
  input: UpdateBillingSettingsInput,
): Promise<BillingSettings> {
  return request<BillingSettings>("/admin/billing", {
    method: "PATCH",
    body: input,
  });
}

/** Dispara a cobrança agora, fora do agendamento. */
export function runBillingNow(): Promise<BillingSettings> {
  return request<BillingSettings>("/admin/billing/run", { method: "POST" });
}

/** Histórico das execuções do cron, agrupado por hora (últimas ~72h). */
export function listBillingRuns(): Promise<BillingRunHour[]> {
  return request<BillingRunHour[]>("/admin/billing-runs");
}

/* ── Domínios (cliente) — cada usuário gerencia os próprios ── */

export function domainServerInfo(): Promise<DnsServerInfo> {
  return request<DnsServerInfo>("/domains/server-info");
}
export function listDomains(): Promise<DnsZone[]> {
  return request<DnsZone[]>("/domains");
}
export function createDomain(input: CreateZoneInput): Promise<CreateZoneResult> {
  return request<CreateZoneResult>("/domains", { method: "POST", body: input });
}
export function deleteDomain(zone: string): Promise<void> {
  return request<void>(`/domains/${encodeURIComponent(zone)}`, { method: "DELETE" });
}
export function getDomainRRsets(zone: string): Promise<DnsRRset[]> {
  return request<DnsRRset[]>(`/domains/${encodeURIComponent(zone)}/rrsets`);
}
export function putDomainRRset(zone: string, input: UpsertRRsetInput): Promise<DnsRRset[]> {
  return request<DnsRRset[]>(`/domains/${encodeURIComponent(zone)}/rrset`, { method: "PUT", body: input });
}
export function deleteDomainRRset(zone: string, input: DeleteRRsetInput): Promise<DnsRRset[]> {
  return request<DnsRRset[]>(`/domains/${encodeURIComponent(zone)}/rrset`, { method: "DELETE", body: input });
}
export function verifyDomain(zone: string): Promise<VerifyResult> {
  return request<VerifyResult>(`/domains/${encodeURIComponent(zone)}/verify`, { method: "POST" });
}
export function discoverDomain(zone: string): Promise<DiscoverResult> {
  return request<DiscoverResult>(`/domains/${encodeURIComponent(zone)}/discover`);
}
export function getDomainEffective(zone: string): Promise<DnsZoneEffective> {
  return request<DnsZoneEffective>(`/domains/${encodeURIComponent(zone)}/effective`);
}
export function domainsForEnvironment(envId: string): Promise<DnsPoint[]> {
  return request<DnsPoint[]>(`/domains/by-env/${encodeURIComponent(envId)}`);
}
export function pointDomain(zone: string, input: PointInput): Promise<PointResult> {
  return request<PointResult>(`/domains/${encodeURIComponent(zone)}/point`, { method: "POST", body: input });
}
export function unpointDomain(zone: string, label: string): Promise<PointResult> {
  return request<PointResult>(`/domains/${encodeURIComponent(zone)}/point`, { method: "DELETE", body: { label } });
}
export function exportDomain(zone: string): Promise<{ content: string }> {
  return request<{ content: string }>(`/domains/${encodeURIComponent(zone)}/export`);
}

/* ═══════════════ CLIENTE ═══════════════ */

/** Planos ativos oferecidos ao cliente (para criação de ambiente). */
export function listPlans(): Promise<Plan[]> {
  return request<Plan[]>("/plans");
}

/** Saldo do próprio usuário + extrato (painel do cliente). */
export function getBalance(): Promise<Balance> {
  return request<Balance>("/balance");
}

/** Jamees Studio: URL do stream SSE de pub/sub do Redis (mesma origem, cookie via fetch). */
export function redisSubscribeUrl(id: string, mode: "channel" | "pattern", target: string, db: number): string {
  const qs = new URLSearchParams({ mode, target, db: String(db) });
  return `${API_BASE}/environments/${id}/studio/redis/subscribe?${qs.toString()}`;
}
