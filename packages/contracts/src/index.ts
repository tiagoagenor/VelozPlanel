import { z } from "zod";

/**
 * Contratos compartilhados do VelozPlanel (fonte única de verdade).
 * API valida entrada/saída com estes schemas; painel e agente reusam os tipos.
 * Dinheiro sempre em centavos (bigint-safe: usamos number inteiro de centavos no núcleo).
 */

/* ─────────────── Runtimes (linguagem + versão) ─────────────── */

export const runtimeKind = z.enum(["php", "node"]);
export type RuntimeKind = z.infer<typeof runtimeKind>;

/** Versões oferecidas no núcleo (ordem crescente, como na faixa do Hostoo). */
export const RUNTIME_VERSIONS: Record<RuntimeKind, string[]> = {
  php: ["5.6", "7.0", "7.2", "7.3", "7.4", "8.0", "8.1", "8.2", "8.3", "8.4"],
  node: ["18", "20", "22", "24"],
};

/** Versão recomendada por linguagem (destaque/def. na criação). */
export const RECOMMENDED_VERSION: Record<RuntimeKind, string> = {
  php: "8.3",
  node: "22",
};

export const runtimeSpec = z.object({
  kind: runtimeKind,
  version: z.string().min(1),
});
export type RuntimeSpec = z.infer<typeof runtimeSpec>;

/* ─────────────── Planos ─────────────── */

// Plano agora é dinâmico (dados no banco) — o id é uma chave livre (slug).
export const planId = z.string().min(1);
export type PlanId = string;

export interface PlanSpec {
  id: PlanId;
  label: string;
  vcpu: number; // cota de CPU (1.0 = 1 vCPU)
  memMb: number; // teto de memória
  diskGb: number;
  priceMonthCents: number; // preço mensal ativo, em centavos
}

/** Plano como vem/vai para a API (mesmos campos do PlanSpec + ativo). */
export const plan = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  vcpu: z.number().min(0.25).max(16),
  memMb: z.number().int().min(128).max(32768),
  diskGb: z.number().int().min(1).max(2000),
  priceMonthCents: z.number().int().min(0),
  active: z.boolean(),
});
export type Plan = z.infer<typeof plan>;

export const createPlanInput = z.object({
  id: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-z][a-z0-9-]*$/, "use um slug: minúsculas, números e hífen, começando com letra"),
  label: z.string().min(2).max(40),
  vcpu: z.number().min(0.25).max(16),
  memMb: z.number().int().min(128).max(32768),
  diskGb: z.number().int().min(1).max(2000),
  priceMonthCents: z.number().int().min(0),
  active: z.boolean().default(true),
});
export type CreatePlanInput = z.infer<typeof createPlanInput>;

export const updatePlanInput = z.object({
  label: z.string().min(2).max(40).optional(),
  vcpu: z.number().min(0.25).max(16).optional(),
  memMb: z.number().int().min(128).max(32768).optional(),
  diskGb: z.number().int().min(1).max(2000).optional(),
  priceMonthCents: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});
export type UpdatePlanInput = z.infer<typeof updatePlanInput>;

export const PLANS: Record<PlanId, PlanSpec> = {
  start: { id: "start", label: "Start", vcpu: 1, memMb: 512, diskGb: 10, priceMonthCents: 3050 },
  light: { id: "light", label: "Light", vcpu: 1.5, memMb: 1024, diskGb: 20, priceMonthCents: 4900 },
  plus: { id: "plus", label: "Plus", vcpu: 2, memMb: 2048, diskGb: 40, priceMonthCents: 9800 },
  pro: { id: "pro", label: "Pro", vcpu: 3, memMb: 4096, diskGb: 80, priceMonthCents: 17200 },
};

/** Tarifa horária ativa derivada do preço mensal (mês contábil = 720 h). */
export function hourlyActiveCents(plan: PlanSpec): number {
  return plan.priceMonthCents / 720;
}
/** Pausado cobra só disco: R$ 0,25/GB/mês. */
export function hourlyPausedCents(plan: PlanSpec): number {
  return (plan.diskGb * 25) / 720;
}

/* ─────────────── Estados do ambiente ─────────────── */

export const envState = z.enum([
  "provisioning",
  "running",
  "paused",
  "error",
  "deleting",
]);
export type EnvState = z.infer<typeof envState>;

/* ─────────────── Ambiente ─────────────── */

export const environment = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  ownerId: z.string().uuid(),
  nodeId: z.string().uuid().nullable(),
  plan: planId,
  runtime: runtimeSpec,
  state: envState,
  containerId: z.string().nullable(),
  httpPort: z.number().int().nullable(), // porta publicada no host de dev
  domain: z.string().nullable(), // domínio próprio configurado pelo cliente
  createdAt: z.string().datetime(),
});
export type Environment = z.infer<typeof environment>;

/** Definir/limpar o domínio do ambiente. `null` remove. */
export const setDomainInput = z.object({
  domain: z
    .string()
    .min(3)
    .max(253)
    .regex(/^([a-z0-9-]+\.)+[a-z]{2,}$/i, "informe um domínio válido, ex.: meusite.com.br")
    .nullable(),
});
export type SetDomainInput = z.infer<typeof setDomainInput>;

/** Trocar a versão/linguagem do runtime (recria o container). */
export const changeRuntimeInput = runtimeSpec;
export type ChangeRuntimeInput = RuntimeSpec;

export const createEnvironmentInput = z.object({
  name: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "use apenas letras minúsculas, números e hífen"),
  plan: planId,
  runtime: runtimeSpec,
});
export type CreateEnvironmentInput = z.infer<typeof createEnvironmentInput>;

/* ─────────────── Nó ─────────────── */

export const nodeStatus = z.enum(["online", "degraded", "offline"]);
export type NodeStatus = z.infer<typeof nodeStatus>;

export const node = z.object({
  id: z.string().uuid(),
  name: z.string(),
  region: z.string(),
  status: nodeStatus,
  vcpuTotal: z.number(),
  memMbTotal: z.number(),
  envCount: z.number().int(),
  publicHost: z.string().nullable(), // IP/host público do nó (SSH, DNS). Configurado pelo super admin.
  lastSeenAt: z.string().datetime().nullable(),
});
export type Node = z.infer<typeof node>;

/** Super admin edita o host público do nó (usado em SSH e registro A do DNS). */
export const updateNodeInput = z.object({
  publicHost: z
    .string()
    .max(253)
    .regex(
      /^([a-z0-9-]+\.)*[a-z0-9-]+$|^(\d{1,3}\.){3}\d{1,3}$/i,
      "informe um IP ou hostname válido, ex.: 200.9.22.2 ou node1.velozplanel.com",
    )
    .nullable(),
});
export type UpdateNodeInput = z.infer<typeof updateNodeInput>;

/* ─────────────── Métricas ─────────────── */

export const metricSample = z.object({
  ts: z.number(), // epoch ms
  cpuPct: z.number(), // 0..100 (relativo à cota do ambiente)
  memBytes: z.number(),
  memLimitBytes: z.number(),
});
export type MetricSample = z.infer<typeof metricSample>;

export const metricSeries = z.object({
  envId: z.string().uuid(),
  samples: z.array(metricSample),
});
export type MetricSeries = z.infer<typeof metricSeries>;

/* ─────────────── Auth ─────────────── */

export const userRole = z.enum(["admin", "client"]);
export type UserRole = z.infer<typeof userRole>;

export const loginInput = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginInput>;

export const sessionUser = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: userRole,
});
export type SessionUser = z.infer<typeof sessionUser>;

/* ─────────────── Arquivos (gerenciador de arquivos do ambiente) ─────────────── */

export const fileEntry = z.object({
  name: z.string(),
  type: z.enum(["file", "dir"]),
  size: z.number(), // bytes (0 para dir)
  mtime: z.number(), // epoch ms
  mode: z.string(), // permissões octais, ex.: "644"
});
export type FileEntry = z.infer<typeof fileEntry>;

export const fileList = z.object({
  path: z.string(), // caminho absoluto dentro do ambiente (ex.: /var/www)
  root: z.string(), // raiz servida (var/www ou /app)
  entries: z.array(fileEntry),
});
export type FileList = z.infer<typeof fileList>;

export const fileContent = z.object({
  path: z.string(),
  content: z.string(),
  truncated: z.boolean(), // true se o arquivo foi cortado por tamanho
});
export type FileContent = z.infer<typeof fileContent>;

export const writeFileInput = z.object({
  path: z.string().min(1),
  content: z.string(),
});
export type WriteFileInput = z.infer<typeof writeFileInput>;

export const mkPathInput = z.object({
  path: z.string().min(1),
});
export type MkPathInput = z.infer<typeof mkPathInput>;

/** Upload de arquivo (binário) para uma pasta: conteúdo em base64. */
export const uploadFileInput = z.object({
  dir: z.string().min(1), // pasta de destino (absoluta, confinada à raiz)
  filename: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[^/\\]+$/, "nome de arquivo inválido (sem barras)"),
  contentBase64: z.string(), // conteúdo do arquivo em base64
});
export type UploadFileInput = z.infer<typeof uploadFileInput>;

/** Renomear/mover dentro do mesmo diretório (só o nome final). */
export const renameFileInput = z.object({
  path: z.string().min(1), // caminho atual (absoluto)
  newName: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[^/\\]+$/, "nome inválido (sem barras)"),
});
export type RenameFileInput = z.infer<typeof renameFileInput>;

/** Alterar permissões (chmod), modo octal de 3 ou 4 dígitos. */
export const chmodInput = z.object({
  path: z.string().min(1),
  mode: z.string().regex(/^[0-7]{3,4}$/, "modo octal inválido, ex.: 644 ou 755"),
});
export type ChmodInput = z.infer<typeof chmodInput>;

/* ─────────────── Bancos de dados do cliente ─────────────── */

export const dbEngine = z.enum(["mysql"]); // núcleo: MariaDB (MySQL-compatível). PG depois.
export type DbEngine = z.infer<typeof dbEngine>;

export const database = z.object({
  id: z.string().uuid(),
  envId: z.string().uuid(),
  engine: dbEngine,
  name: z.string(), // nome do database
  dbUser: z.string(),
  host: z.string(),
  port: z.number().int(),
  createdAt: z.string().datetime(),
});
export type Database = z.infer<typeof database>;

/** Criação retorna a senha UMA vez (não é armazenada em claro). */
export const databaseWithSecret = database.extend({
  password: z.string(),
});
export type DatabaseWithSecret = z.infer<typeof databaseWithSecret>;

export const createDatabaseInput = z.object({
  name: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-z][a-z0-9_]*$/, "comece com letra; use letras minúsculas, números e _"),
});
export type CreateDatabaseInput = z.infer<typeof createDatabaseInput>;

/* ─────────────── SSL / HTTPS ─────────────── */

export const sslCertStatus = z.enum([
  "none", // sem domínio ou sem certificado
  "pending", // emissão solicitada (fase futura, precisa de domínio público + borda)
  "active", // certificado ativo (self-signed no núcleo)
  "error",
]);
export type SslCertStatus = z.infer<typeof sslCertStatus>;

export const sslStatus = z.object({
  envId: z.string().uuid(),
  domain: z.string().nullable(),
  forceHttps: z.boolean(),
  certStatus: sslCertStatus,
  issuer: z.string().nullable(), // ex.: "self-signed (dev)" | "Let's Encrypt"
  notAfter: z.string().datetime().nullable(),
  message: z.string().nullable(), // nota honesta sobre limitação/estado
});
export type SslStatus = z.infer<typeof sslStatus>;

export const forceHttpsInput = z.object({ forceHttps: z.boolean() });
export type ForceHttpsInput = z.infer<typeof forceHttpsInput>;

/* ─────────────── SSH / SFTP (acesso ao ambiente) ─────────────── */

export const sshKey = z.object({
  id: z.string().uuid(),
  label: z.string(),
  fingerprint: z.string(), // SHA256:...
  publicKey: z.string(),
  createdAt: z.string().datetime(),
});
export type SshKey = z.infer<typeof sshKey>;

export const addSshKeyInput = z.object({
  label: z.string().min(1).max(60),
  publicKey: z.string().min(1), // linha completa: "ssh-ed25519 AAAA... comentário"
});
export type AddSshKeyInput = z.infer<typeof addSshKeyInput>;

export const sshAuthMode = z.enum(["key", "password", "both"]);
export type SshAuthMode = z.infer<typeof sshAuthMode>;

/** Acesso: de qualquer IP ou só de uma lista (echo da decisão do cliente). */
export const sshAccessScope = z.enum(["any", "allowlist"]);
export type SshAccessScope = z.infer<typeof sshAccessScope>;

export const sshConfig = z.object({
  envId: z.string().uuid(),
  enabled: z.boolean(),
  username: z.string(),
  host: z.string(),
  port: z.number().int(),
  authMode: sshAuthMode,
  accessScope: sshAccessScope,
  allowlist: z.array(z.string()), // IPs/CIDRs quando accessScope = allowlist
  keys: z.array(sshKey),
  gatewayActive: z.boolean(), // false no núcleo (gateway SSH ativa na fase de infra)
  message: z.string().nullable(),
});
export type SshConfig = z.infer<typeof sshConfig>;

export const updateSshConfigInput = z.object({
  enabled: z.boolean(),
  authMode: sshAuthMode,
  accessScope: sshAccessScope,
  allowlist: z
    .array(
      z
        .string()
        .regex(
          /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/,
          "informe um IP ou CIDR válido, ex.: 189.40.1.2 ou 189.40.0.0/16",
        ),
    )
    .max(50),
});
export type UpdateSshConfigInput = z.infer<typeof updateSshConfigInput>;

/* ═══════════════ SUPER ADMIN ═══════════════ */

/* ── Usuários / clientes ── */
export const accountStatus = z.enum(["active", "suspended"]);
export type AccountStatus = z.infer<typeof accountStatus>;

export const adminUser = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: userRole,
  status: accountStatus,
  envCount: z.number().int(),
  balanceCents: z.number().int(), // saldo em centavos (soma do razão de créditos)
  createdAt: z.string().datetime(),
});
export type AdminUser = z.infer<typeof adminUser>;

/* ── Créditos / saldo ── */
export const creditTransaction = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  amountCents: z.number().int(), // positivo = crédito, negativo = débito/estorno
  kind: z.string(), // "admin_credit" | "admin_debit" | ...
  reason: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type CreditTransaction = z.infer<typeof creditTransaction>;

/** Admin adiciona (ou remove, se negativo) saldo de um cliente. */
export const addCreditInput = z.object({
  amountCents: z.number().int().refine((v) => v !== 0, "informe um valor diferente de zero"),
  reason: z.string().max(200).nullable().optional(),
});
export type AddCreditInput = z.infer<typeof addCreditInput>;

/** Saldo do próprio usuário (painel do cliente). */
export const balance = z.object({
  balanceCents: z.number().int(),
  transactions: z.array(creditTransaction),
});
export type Balance = z.infer<typeof balance>;

export const createUserInput = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(6).max(100),
  role: userRole,
});
export type CreateUserInput = z.infer<typeof createUserInput>;

export const updateUserInput = z.object({
  name: z.string().min(2).max(80).optional(),
  role: userRole.optional(),
  status: accountStatus.optional(),
  password: z.string().min(6).max(100).optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserInput>;

/* ── Ambientes da frota (visão admin) ── */
export const adminEnvironment = z.object({
  id: z.string().uuid(),
  name: z.string(),
  ownerId: z.string().uuid(),
  ownerEmail: z.string(),
  nodeId: z.string().uuid().nullable(),
  nodeName: z.string().nullable(),
  plan: planId,
  runtime: runtimeSpec,
  state: envState,
  createdAt: z.string().datetime(),
});
export type AdminEnvironment = z.infer<typeof adminEnvironment>;

/** Alterar vCPU/RAM a quente (requisito nº 9) — motivo obrigatório, vai para auditoria. */
export const resourceChangeInput = z.object({
  vcpu: z.number().min(0.25).max(8),
  memMb: z.number().int().min(256).max(16384),
  reason: z.string().min(3).max(200),
});
export type ResourceChangeInput = z.infer<typeof resourceChangeInput>;

/* ── Auditoria ── */
export const auditEntry = z.object({
  id: z.string().uuid(),
  ts: z.string().datetime(),
  actorEmail: z.string(),
  actorRole: z.string(),
  action: z.string(),
  target: z.string().nullable(),
  detail: z.string().nullable(),
  ip: z.string().nullable(),
});
export type AuditEntry = z.infer<typeof auditEntry>;

/* ── Rede / WireGuard (config honesta; mesh real é infra-fase) ── */
export const wgPeerStatus = z.enum(["configured", "handshake_ok", "offline"]);
export type WgPeerStatus = z.infer<typeof wgPeerStatus>;

export const wgPeer = z.object({
  id: z.string().uuid(),
  nodeId: z.string().uuid().nullable(),
  name: z.string(),
  privateIp: z.string(), // 10.77.x.x
  endpoint: z.string().nullable(),
  publicKey: z.string().nullable(),
  status: wgPeerStatus,
  createdAt: z.string().datetime(),
});
export type WgPeer = z.infer<typeof wgPeer>;

export const addWgPeerInput = z.object({
  name: z.string().min(2).max(60),
  nodeId: z.string().uuid().nullable().optional(),
  privateIp: z
    .string()
    .regex(/^(\d{1,3}\.){3}\d{1,3}$/, "informe um IP privado, ex.: 10.77.0.2"),
  endpoint: z.string().max(120).nullable().optional(),
  publicKey: z.string().max(120).nullable().optional(),
});
export type AddWgPeerInput = z.infer<typeof addWgPeerInput>;

/* ── Planos (admin) ── */
export const planAdmin = z.object({
  id: planId,
  label: z.string(),
  vcpu: z.number(),
  memMb: z.number(),
  diskGb: z.number(),
  priceMonthCents: z.number().int(),
  hourlyActiveCents: z.number(),
  hourlyPausedCents: z.number(),
});
export type PlanAdmin = z.infer<typeof planAdmin>;

/* ── Dashboard da operação ── */
export const adminOverview = z.object({
  nodes: z.object({ total: z.number().int(), online: z.number().int() }),
  environments: z.object({
    total: z.number().int(),
    running: z.number().int(),
    paused: z.number().int(),
    error: z.number().int(),
  }),
  users: z.object({ total: z.number().int(), clients: z.number().int() }),
  databases: z.number().int(),
  monthlyRevenueCents: z.number().int(), // estimado a partir dos ambientes ativos
});
export type AdminOverview = z.infer<typeof adminOverview>;

/* ── Catálogo de módulos ── */
export const moduleInfo = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  scope: z.enum(["environment", "node", "platform"]),
  status: z.enum(["builtin", "active", "planned"]),
});
export type ModuleInfo = z.infer<typeof moduleInfo>;

/* ─────────────── Erro padronizado da API ─────────────── */

export const apiError = z.object({
  error: z.string(),
  message: z.string(),
});
export type ApiError = z.infer<typeof apiError>;
