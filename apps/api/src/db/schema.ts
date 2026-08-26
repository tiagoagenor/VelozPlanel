import {
  pgTable,
  uuid,
  text,
  timestamp,
  doublePrecision,
  integer,
  bigint,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Esquema Drizzle (postgres-js) — fonte da estrutura do DB do núcleo.
 * Colunas de enum são armazenadas como text (validadas na borda pelos schemas do contracts).
 */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").notNull(), // "admin" | "client"
  status: text("status").notNull().default("active"), // "active" | "suspended"
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const nodes = pgTable("nodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  region: text("region").notNull(),
  status: text("status").notNull(), // "online" | "degraded" | "offline"
  vcpuTotal: doublePrecision("vcpu_total").notNull(),
  memMbTotal: integer("mem_mb_total").notNull(),
  publicHost: text("public_host"), // IP/host público (SSH, DNS) — configurado pelo super admin
  httpHost: text("http_host"), // host onde as portas HTTP publicadas são alcançáveis (Abrir site). Fallback: publicHost. Ex.: nó local NAT = IP da LAN
  alertMessage: text("alert_message"), // aviso do super admin sobre a máquina (ex.: "instável") — mostrado na criação de ambiente
  agentUrl: text("agent_url"), // endpoint do Agente deste nó (ex.: http://10.77.0.2:4100 via WireGuard)
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
});

export const environments = pgTable("environments", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  nodeId: uuid("node_id").references(() => nodes.id, { onDelete: "set null" }),
  plan: text("plan").notNull(), // PlanId (tier de recurso/limite)
  typeId: text("type_id"), // slug em env_types (dono do preço). null = legado (usa runtimeKind/plano)
  parentEnvId: uuid("parent_env_id"), // banco-filho de uma stack (n8n/wordpress). null = raiz
  publicDomain: text("public_domain"), // domínio público OPCIONAL (só wordpress/n8n) — opt-in
  runtimeKind: text("runtime_kind").notNull(), // RuntimeKind
  runtimeVersion: text("runtime_version").notNull(),
  runtimeVersionFull: text("runtime_version_full"), // versão real resolvida no container
  startupScript: text("startup_script"), // comandos de inicialização (rodam 1x na criação)
  nodeStartFile: text("node_start_file"), // arquivo que inicia o app Node (e Python: app.py)
  pythonCmd: text("python_cmd"), // comando de start avançado (Python/Django, ex.: gunicorn/runserver)
  dotnetCmd: text("dotnet_cmd"), // comando de start avançado (.NET, ex.: dotnet App.dll)
  phpNodeVersion: text("php_node_version"), // versão Node escolhida (envs PHP via nvm)
  phpNodeVersionFull: text("php_node_version_full"), // versão Node real resolvida (nvm)
  phpWebRoot: text("php_web_root"), // document root do php -S (Laravel = /var/www/public)
  state: text("state").notNull(), // EnvState
  containerId: text("container_id"),
  httpPort: integer("http_port"),
  domain: text("domain"),
  autoSubdomain: text("auto_subdomain"), // endereço temporário <sub>.jamees.top (único)
  vcpuOverride: doublePrecision("vcpu_override"), // admin alterou vCPU (senão usa o do plano)
  memMbOverride: integer("mem_mb_override"), // admin alterou RAM
  lastChargedAt: timestamp("last_charged_at", { withTimezone: true }), // último débito de cobrança
  errorMessage: text("error_message"), // mensagem de falha do job (provision/delete) — mostrada no painel
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const metricSamples = pgTable(
  "metric_samples",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    envId: uuid("env_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    cpuPct: doublePrecision("cpu_pct").notNull(),
    memBytes: bigint("mem_bytes", { mode: "number" }).notNull(),
    memLimitBytes: bigint("mem_limit_bytes", { mode: "number" }).notNull(),
  },
  (t) => [index("metric_samples_env_ts_idx").on(t.envId, t.ts)],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type NodeRow = typeof nodes.$inferSelect;
export type NewNodeRow = typeof nodes.$inferInsert;
export type EnvironmentRow = typeof environments.$inferSelect;
export type NewEnvironmentRow = typeof environments.$inferInsert;

// Bancos de dados dos clientes (metadados; a senha NÃO é guardada em claro).
export const databases = pgTable("databases", {
  id: uuid("id").primaryKey().defaultRandom(),
  envId: uuid("env_id")
    .notNull()
    .references(() => environments.id, { onDelete: "cascade" }),
  engine: text("engine").notNull(), // "mysql"
  name: text("name").notNull(),
  dbUser: text("db_user").notNull(),
  host: text("host").notNull(),
  port: integer("port").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type DatabaseRow = typeof databases.$inferSelect;

// Configuração de SSL/HTTPS por ambiente.
export const sslConfigs = pgTable("ssl_configs", {
  envId: uuid("env_id")
    .primaryKey()
    .references(() => environments.id, { onDelete: "cascade" }),
  forceHttps: boolean("force_https").notNull().default(false),
  certStatus: text("cert_status").notNull().default("none"),
  issuer: text("issuer"),
  notAfter: timestamp("not_after", { withTimezone: true }),
});
export type SslConfigRow = typeof sslConfigs.$inferSelect;

// Configuração de acesso SSH/SFTP por ambiente.
export const sshConfigs = pgTable("ssh_configs", {
  envId: uuid("env_id")
    .primaryKey()
    .references(() => environments.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  username: text("username").notNull(),
  port: integer("port").notNull().default(2222),
  authMode: text("auth_mode").notNull().default("key"),
  accessScope: text("access_scope").notNull().default("any"),
  allowlist: jsonb("allowlist").notNull().default([]),
});
export type SshConfigRow = typeof sshConfigs.$inferSelect;

// Chaves públicas SSH autorizadas por ambiente.
export const sshKeys = pgTable("ssh_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  envId: uuid("env_id")
    .notNull()
    .references(() => environments.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  publicKey: text("public_key").notNull(),
  fingerprint: text("fingerprint").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type SshKeyRow = typeof sshKeys.$inferSelect;

// SFTP — módulo SEPARADO do SSH: transferência de arquivos SÓ por senha
// (porta 2223). A senha é gerada pelo painel (sempre aleatória); guardamos só
// o hash bcrypt. 1:1 com o ambiente (env_id = PK).
export const sftpConfigs = pgTable("sftp_configs", {
  envId: uuid("env_id")
    .primaryKey()
    .references(() => environments.id, { onDelete: "cascade" }),
  username: text("username").notNull().unique(), // env_<hex>, usado pelo gateway
  enabled: boolean("enabled").notNull().default(false),
  port: integer("port").notNull().default(2223),
  passwordHash: text("password_hash"), // null = nenhuma senha definida ainda
  passwordSetAt: timestamp("password_set_at", { withTimezone: true }),
});
export type SftpConfigRow = typeof sftpConfigs.$inferSelect;

// Deploy por Git — 1:1 com o ambiente (config), N passos ordenados, N execuções.
export const deployConfigs = pgTable("deploy_configs", {
  envId: uuid("env_id")
    .primaryKey()
    .references(() => environments.id, { onDelete: "cascade" }),
  connectionMode: text("connection_mode").notNull().default("none"), // none|public|ssh|local
  provider: text("provider").notNull().default("github"),
  repoUrl: text("repo_url"),
  branch: text("branch").notNull().default("main"),
  isPrivate: boolean("is_private"),
  mode: text("mode").notNull().default("simple"), // simple|advanced
  publicKey: text("public_key"), // só a PÚBLICA (privada mora no volume de build do nó)
  fingerprint: text("fingerprint"),
  httpUsername: text("http_username"), // usuário do HTTPS
  httpPasswordEnc: text("http_password_enc"), // senha/token cifrada
  connectionVerifiedAt: timestamp("connection_verified_at", { withTimezone: true }),
  needsReconnect: boolean("needs_reconnect").notNull().default(false),
  hostKeyState: text("host_key_state").notNull().default("ok"),
  autoEnabled: boolean("auto_enabled").notNull().default(false),
  intervalMinutes: integer("interval_minutes").notNull().default(5),
  autoEngine: text("auto_engine").notNull().default("agent"), // reservado
  deployStrategy: text("deploy_strategy").notNull().default("place"), // place|recreate
  framework: text("framework").notNull().default("none"), // none|nextjs
  runModel: text("run_model").notNull().default("standalone"), // standalone|next_start
  subdir: text("subdir"), // pasta do projeto dentro do repo (monorepo); null = raiz
  historyLimit: integer("history_limit").notNull().default(10), // 0 = nunca apagar
  nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
  lastRemoteSha: text("last_remote_sha"),
  lastCheckAt: timestamp("last_check_at", { withTimezone: true }),
  lastGoodSha: text("last_good_sha"),
  lastRunId: uuid("last_run_id"),
  lastRunStatus: text("last_run_status"),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
});
export type DeployConfigRow = typeof deployConfigs.$inferSelect;

export const deploySteps = pgTable("deploy_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  envId: uuid("env_id")
    .notNull()
    .references(() => environments.id, { onDelete: "cascade" }),
  ord: integer("ord").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  kind: text("kind").notNull(), // DeployStepKind
  command: text("command"), // livre só em kind="shell"
  label: text("label").notNull(),
  cwd: text("cwd"),
  mutatesData: boolean("mutates_data").notNull().default(false),
});
export type DeployStepRow = typeof deploySteps.$inferSelect;

export const deployRuns = pgTable(
  "deploy_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    envId: uuid("env_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    trigger: text("trigger").notNull(), // manual|auto
    status: text("status").notNull(), // running|success|failed|interrupted
    exitCode: integer("exit_code"),
    failedStepKind: text("failed_step_kind"),
    commitSha: text("commit_sha"),
    commitMessage: text("commit_message"),
    commitAuthor: text("commit_author"),
    stepsSnapshot: jsonb("steps_snapshot"),
    log: text("log"), // redigido, ~64KB
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("deploy_runs_env_started_idx").on(t.envId, t.startedAt)],
);
export type DeployRunRow = typeof deployRuns.$inferSelect;

// Variáveis de ambiente gerenciadas (reais). Valor CIFRADO em repouso.
export const envVars = pgTable(
  "env_vars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    envId: uuid("env_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    valueEncrypted: text("value_encrypted").notNull(), // "v1:" + base64(iv|tag|ciphertext)
    buildTime: boolean("build_time").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("env_vars_env_key_idx").on(t.envId, t.key)],
);
export type EnvVarRow = typeof envVars.$inferSelect;

// Auditoria — registro imutável de ações (admin/cliente/sistema).
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  actorEmail: text("actor_email").notNull(),
  actorRole: text("actor_role").notNull(),
  action: text("action").notNull(),
  target: text("target"),
  detail: text("detail"),
  ip: text("ip"),
});
export type AuditLogRow = typeof auditLogs.$inferSelect;

// Peers da rede WireGuard (config; mesh real é infra-fase).
export const wgPeers = pgTable("wg_peers", {
  id: uuid("id").primaryKey().defaultRandom(),
  nodeId: uuid("node_id").references(() => nodes.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  privateIp: text("private_ip").notNull(),
  endpoint: text("endpoint"),
  publicKey: text("public_key"),
  status: text("status").notNull().default("configured"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type WgPeerRow = typeof wgPeers.$inferSelect;

// Planos (dinâmicos, editáveis pelo super admin). id = slug.
export const plans = pgTable("plans", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  vcpu: doublePrecision("vcpu").notNull(),
  memMb: integer("mem_mb").notNull(),
  diskGb: integer("disk_gb").notNull(),
  priceMonthCents: integer("price_month_cents").notNull(),
  maxEnvironments: integer("max_environments").notNull().default(5),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});
export type PlanRow = typeof plans.$inferSelect;

// Catálogo de TIPOS de ambiente (dinâmico, editável pelo super admin). id = slug.
// O TIPO é dono do preço de COMPUTE (o plano segue como tier de recurso/limite).
// category: "app" (php/node, tem deploy) | "service" (redis/mysql/… sem deploy) | "stack" (n8n/wordpress = app + banco-filho).
export const envTypes = pgTable("env_types", {
  id: text("id").primaryKey(), // slug: php, node, redis, mysql, mariadb, postgres, rabbitmq, n8n, wordpress
  label: text("label").notNull(),
  category: text("category").notNull(),
  image: text("image"), // imagem stock (services/stacks); null para app (usa base do runtime)
  internalPort: integer("internal_port"), // porta interna do serviço (nunca publicada no host)
  dataPath: text("data_path"), // datadir a montar no volume nomeado (veloz-data-<envId>)
  needsDb: boolean("needs_db").notNull().default(false), // stack precisa de banco-filho
  childType: text("child_type"), // slug do tipo do banco-filho (ex.: wordpress -> mariadb)
  defaultTool: text("default_tool"), // ferramenta de UI padrão: phpmyadmin|adminer|redisinsight|rabbitmq_mgmt|null
  allowsPublicDomain: boolean("allows_public_domain").notNull().default(false),
  priceMonthCents: integer("price_month_cents").notNull().default(0), // ADICIONAL do tipo (Modelo B), default 0
  minVcpu: doublePrecision("min_vcpu").notNull().default(0), // vCPU mínimo p/ rodar este tipo
  minMemMb: integer("min_mem_mb").notNull().default(0), // RAM mínima (MB) p/ rodar este tipo
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});
export type EnvTypeRow = typeof envTypes.$inferSelect;

// Sub-rede /24 por (dono, nó): a bridge onde os ambientes do dono naquele nó vivem.
export const ownerNetworks = pgTable(
  "owner_networks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nodeId: uuid("node_id").notNull(),
    ownerId: uuid("owner_id").notNull(),
    slot: integer("slot").notNull(), // 3º octeto (0-255) — bridge veloz-u<slot>
    subnet: text("subnet").notNull(), // ex.: 10.201.<slot>.0/24
    gateway: text("gateway").notNull(), // ex.: 10.201.<slot>.1
    bridgeName: text("bridge_name").notNull(), // veloz-u<slot>
  },
  (t) => ({
    uniqOwner: uniqueIndex("owner_networks_node_owner_uq").on(t.nodeId, t.ownerId),
    uniqSlot: uniqueIndex("owner_networks_node_slot_uq").on(t.nodeId, t.slot),
  }),
);
export type OwnerNetworkRow = typeof ownerNetworks.$inferSelect;

// Livro-razão de IPAM: um IP fixo por CONTAINER (app, banco, ferramenta) na bridge do dono.
export const envAddresses = pgTable(
  "env_addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nodeId: uuid("node_id").notNull(),
    envId: uuid("env_id").notNull(),
    role: text("role").notNull(), // "app" | "db" | "tool:<kind>"
    ip: text("ip").notNull(),
    containerId: text("container_id"),
  },
  (t) => ({ uniqNodeIp: uniqueIndex("env_addresses_node_ip_uq").on(t.nodeId, t.ip) }),
);
export type EnvAddressRow = typeof envAddresses.$inferSelect;

// Ferramentas de UI por ambiente-serviço, com liga/desliga (default desligado).
export const envTools = pgTable("env_tools", {
  id: uuid("id").primaryKey().defaultRandom(),
  envId: uuid("env_id")
    .notNull()
    .references(() => environments.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // phpmyadmin | adminer | redisinsight | rabbitmq_mgmt
  enabled: boolean("enabled").notNull().default(false),
  containerId: text("container_id"), // sidecar da ferramenta (null p/ UI embutida)
  ip: text("ip"), // IP do sidecar na bridge do dono
  targetIp: text("target_ip"), // IP interno que o proxy alcança (a própria ferramenta)
  targetPort: integer("target_port"),
  passwordHash: text("password_hash"), // Jamees Studio: senha opcional (bcrypt); null = sem senha
  subdomain: text("subdomain"), // painel de serviço: subdomínio aleatório fixo sob jamees.com
});
export type EnvToolRow = typeof envTools.$inferSelect;

// Credenciais de serviço (cifradas). Diferente de databases.ts, aqui a senha PERSISTE
// (necessária para injetar no app linkado e autenticar a ferramenta de UI).
export const serviceCredentials = pgTable("service_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  envId: uuid("env_id")
    .notNull()
    .references(() => environments.id, { onDelete: "cascade" }),
  key: text("key").notNull(), // ex.: root_password, app_user, app_password, db_name
  valueEncrypted: text("value_encrypted").notNull(),
});
export type ServiceCredentialRow = typeof serviceCredentials.$inferSelect;

// Fila persistente de jobs (provisionar/remover ambiente) — assíncrono e escalável.
// Claim com FOR UPDATE SKIP LOCKED; serialização por env via advisory lock no worker.
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(), // "provision_env" | "delete_env"
    envId: uuid("env_id").notNull(), // SEM FK: o delete apaga a linha do env
    payload: jsonb("payload").notNull().default({}),
    status: text("status").notNull().default("queued"), // queued|running|done|failed|canceled
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(8),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    claimIdx: index("jobs_claim_idx").on(t.runAfter),
    envIdx: index("jobs_env_idx").on(t.envId),
  }),
);
export type JobRow = typeof jobs.$inferSelect;

// Metadados de zona DNS (o pdns guarda o resto no database `pdns` via gpgsql).
// A única tabela nossa: status de delegação + vínculo opcional com ambiente.
export const dnsZonesMeta = pgTable("dns_zones_meta", {
  zone: text("zone").primaryKey(), // nome da zona sem ponto final (ex.: geestao.top)
  environmentId: uuid("environment_id").references(() => environments.id, {
    onDelete: "set null",
  }),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }), // dono cliente; null = zona do painel/admin
  status: text("status").notNull().default("pending"),
  serial: bigint("serial", { mode: "number" }),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  checkMsg: text("check_msg"),
  createdBy: uuid("created_by"),
  lastChargedAt: timestamp("last_charged_at", { withTimezone: true }), // relógio da cobrança de gerência
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type DnsZoneMetaRow = typeof dnsZonesMeta.$inferSelect;

// Vínculo domínio→ambiente por REGISTRO (label), fonte da verdade do roteamento
// por nome. Um domínio pode ter www→X e loja→Y; o primário vai p/ environments.domain.
export const envDomains = pgTable(
  "env_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    zone: text("zone").notNull(), // ex.: meusite.com.br (sem ponto final)
    label: text("label").notNull(), // "@" | "www" | "loja" ...
    environmentId: uuid("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    isPrimary: boolean("is_primary").notNull().default(false),
    published: boolean("published").notNull().default(false), // vhost/HTTPS ativo no nó
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    zoneLabelUq: uniqueIndex("env_domains_zone_label_idx").on(t.zone, t.label),
    envIdx: index("env_domains_env_idx").on(t.environmentId),
  }),
);
export type EnvDomainRow = typeof envDomains.$inferSelect;

// Razão de créditos por usuário (saldo = soma de amount_cents).
export const creditTransactions = pgTable("credit_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  kind: text("kind").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type CreditTransactionRow = typeof creditTransactions.$inferSelect;

// Configurações da plataforma (linha única) — inclui o cron de cobrança.
export const platformSettings = pgTable("platform_settings", {
  id: integer("id").primaryKey().default(1),
  billingEnabled: boolean("billing_enabled").notNull().default(false),
  billingIntervalMinutes: integer("billing_interval_minutes").notNull().default(60),
  // Cortesia: ambientes com MENOS de X minutos de vida não são cobrados no acerto
  // ao deletar (protege delete acidental/instantâneo). 0 = sem cortesia.
  billingFreeMinutes: integer("billing_free_minutes").notNull().default(1),
  suspendOnZero: boolean("suspend_on_zero").notNull().default(true),
  domainPriceMonthCents: integer("domain_price_month_cents").notNull().default(100), // R$1,00/domínio/mês
  // Taxas por recurso — alimentam a calculadora "Calcular pela taxa" dos planos.
  // NÃO entram na cobrança (a cobrança usa o preço gravado do plano). Exceção:
  // rateDiskGbMonthCents é a taxa de disco cobrada no estado PAUSADO.
  rateVcpuMonthCents: integer("rate_vcpu_month_cents").notNull().default(2000), // R$20/vCPU/mês
  rateRamGbMonthCents: integer("rate_ram_gb_month_cents").notNull().default(2000), // R$20/GB RAM/mês
  rateDiskGbMonthCents: integer("rate_disk_gb_month_cents").notNull().default(25), // R$0,25/GB disco/mês
  billingLastRunAt: timestamp("billing_last_run_at", { withTimezone: true }), // CURSOR do agendador (marcado ANTES de rodar)
  // Resumo da ÚLTIMA execução concluída (sobrevive a restart; alimenta a tela).
  billingLastRunFinishedAt: timestamp("billing_last_run_finished_at", { withTimezone: true }),
  billingLastInstances: integer("billing_last_instances"),
  billingLastSuspended: integer("billing_last_suspended"),
  billingLastChargedCents: integer("billing_last_charged_cents"),
  billingLastOk: boolean("billing_last_ok"),
});
export type PlatformSettingsRow = typeof platformSettings.$inferSelect;

/** Rollup HORÁRIO das execuções de cobrança (1 linha por hora, em UTC). Mantém
 *  o histórico compacto mesmo com o cron rodando a cada poucos minutos. */
export const billingRunHours = pgTable("billing_run_hours", {
  hour: timestamp("hour", { withTimezone: true }).primaryKey(), // início da hora (UTC)
  runs: integer("runs").notNull().default(0), // execuções nesta hora
  chargedCents: integer("charged_cents").notNull().default(0), // soma cobrada na hora
  chargeEvents: integer("charge_events").notNull().default(0), // soma de débitos de ambiente
  suspended: integer("suspended").notNull().default(0), // soma de ambientes suspensos
  instances: integer("instances").notNull().default(0), // SNAPSHOT: cobráveis na última rodada da hora
  errors: integer("errors").notNull().default(0), // rodadas que falharam
  firstRunAt: timestamp("first_run_at", { withTimezone: true }).notNull(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }).notNull(),
});
export type BillingRunHourRow = typeof billingRunHours.$inferSelect;

/** Subdomínios (de jamees.top) que nenhum cliente pode selecionar. */
export const reservedSubdomains = pgTable("reserved_subdomains", {
  name: text("name").primaryKey(), // sempre minúsculo
  reason: text("reason"),
  locked: boolean("locked").notNull().default(false), // travado (não removível pelo admin)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ReservedSubdomainRow = typeof reservedSubdomains.$inferSelect;

export type MetricSampleRow = typeof metricSamples.$inferSelect;
export type NewMetricSampleRow = typeof metricSamples.$inferInsert;
