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
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
});

export const environments = pgTable("environments", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  nodeId: uuid("node_id").references(() => nodes.id, { onDelete: "set null" }),
  plan: text("plan").notNull(), // PlanId
  runtimeKind: text("runtime_kind").notNull(), // RuntimeKind
  runtimeVersion: text("runtime_version").notNull(),
  state: text("state").notNull(), // EnvState
  containerId: text("container_id"),
  httpPort: integer("http_port"),
  domain: text("domain"),
  vcpuOverride: doublePrecision("vcpu_override"), // admin alterou vCPU (senão usa o do plano)
  memMbOverride: integer("mem_mb_override"), // admin alterou RAM
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
export type MetricSampleRow = typeof metricSamples.$inferSelect;
export type NewMetricSampleRow = typeof metricSamples.$inferInsert;
