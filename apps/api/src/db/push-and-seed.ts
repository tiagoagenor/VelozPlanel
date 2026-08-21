import { eq } from "drizzle-orm";
import { PLANS } from "@velozplanel/contracts";
import { sql, db } from "./client";
import { users, nodes } from "./schema";
import { hashPassword } from "../auth";

/**
 * Cria o schema (CREATE TABLE IF NOT EXISTS — sem migrations no núcleo) e faz o seed.
 * Totalmente idempotente: pode rodar quantas vezes quiser.
 *
 *   pnpm db:push   (ou: pnpm --filter @velozplanel/api db:push)
 */

async function createSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email         text NOT NULL UNIQUE,
      name          text NOT NULL,
      role          text NOT NULL,
      password_hash text NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS nodes (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name         text NOT NULL,
      region       text NOT NULL,
      status       text NOT NULL,
      vcpu_total   double precision NOT NULL,
      mem_mb_total integer NOT NULL,
      public_host  text,
      last_seen_at timestamptz
    )
  `;
  await sql`ALTER TABLE nodes ADD COLUMN IF NOT EXISTS public_host text`;

  await sql`
    CREATE TABLE IF NOT EXISTS environments (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name            text NOT NULL,
      owner_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      node_id         uuid REFERENCES nodes(id) ON DELETE SET NULL,
      plan            text NOT NULL,
      runtime_kind    text NOT NULL,
      runtime_version text NOT NULL,
      state           text NOT NULL,
      container_id    text,
      http_port       integer,
      domain          text,
      created_at      timestamptz NOT NULL DEFAULT now()
    )
  `;
  // Colunas adicionadas depois do núcleo — garante em bancos já existentes.
  await sql`ALTER TABLE environments ADD COLUMN IF NOT EXISTS domain text`;
  await sql`ALTER TABLE environments ADD COLUMN IF NOT EXISTS vcpu_override double precision`;
  await sql`ALTER TABLE environments ADD COLUMN IF NOT EXISTS mem_mb_override integer`;

  await sql`
    CREATE TABLE IF NOT EXISTS metric_samples (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      env_id          uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
      ts              timestamptz NOT NULL DEFAULT now(),
      cpu_pct         double precision NOT NULL,
      mem_bytes       bigint NOT NULL,
      mem_limit_bytes bigint NOT NULL
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS metric_samples_env_ts_idx
      ON metric_samples (env_id, ts)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS databases (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      env_id     uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
      engine     text NOT NULL,
      name       text NOT NULL,
      db_user    text NOT NULL,
      host       text NOT NULL,
      port       integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS ssl_configs (
      env_id      uuid PRIMARY KEY REFERENCES environments(id) ON DELETE CASCADE,
      force_https boolean NOT NULL DEFAULT false,
      cert_status text NOT NULL DEFAULT 'none',
      issuer      text,
      not_after   timestamptz
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS ssh_configs (
      env_id       uuid PRIMARY KEY REFERENCES environments(id) ON DELETE CASCADE,
      enabled      boolean NOT NULL DEFAULT false,
      username     text NOT NULL,
      port         integer NOT NULL DEFAULT 2222,
      auth_mode    text NOT NULL DEFAULT 'key',
      access_scope text NOT NULL DEFAULT 'any',
      allowlist    jsonb NOT NULL DEFAULT '[]'::jsonb
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS ssh_keys (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      env_id      uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
      label       text NOT NULL,
      public_key  text NOT NULL,
      fingerprint text NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'`;

  await sql`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      ts          timestamptz NOT NULL DEFAULT now(),
      actor_email text NOT NULL,
      actor_role  text NOT NULL,
      action      text NOT NULL,
      target      text,
      detail      text,
      ip          text
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS audit_logs_ts_idx ON audit_logs (ts DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS wg_peers (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      node_id     uuid REFERENCES nodes(id) ON DELETE SET NULL,
      name        text NOT NULL,
      private_ip  text NOT NULL,
      endpoint    text,
      public_key  text,
      status      text NOT NULL DEFAULT 'configured',
      created_at  timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS plans (
      id                text PRIMARY KEY,
      label             text NOT NULL,
      vcpu              double precision NOT NULL,
      mem_mb            integer NOT NULL,
      disk_gb           integer NOT NULL,
      price_month_cents integer NOT NULL,
      active            boolean NOT NULL DEFAULT true,
      sort_order        integer NOT NULL DEFAULT 0
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount_cents integer NOT NULL,
      kind        text NOT NULL,
      reason      text,
      created_at  timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS credit_tx_user_idx ON credit_transactions (user_id)`;
}

async function seed(): Promise<void> {
  // Semeia os planos padrão (idempotente — não sobrescreve edições do admin).
  const defaults = Object.values(PLANS);
  for (let i = 0; i < defaults.length; i++) {
    const p = defaults[i]!;
    await sql`
      INSERT INTO plans (id, label, vcpu, mem_mb, disk_gb, price_month_cents, active, sort_order)
      VALUES (${p.id}, ${p.label}, ${p.vcpu}, ${p.memMb}, ${p.diskGb}, ${p.priceMonthCents}, true, ${i})
      ON CONFLICT (id) DO NOTHING
    `;
  }

  const passwordHash = await hashPassword("veloz123");

  await db
    .insert(users)
    .values([
      { email: "admin@veloz.dev", name: "Admin", role: "admin", passwordHash },
      { email: "client@veloz.dev", name: "Cliente", role: "client", passwordHash },
    ])
    .onConflictDoNothing({ target: users.email });

  const existingNode = await db
    .select()
    .from(nodes)
    .where(eq(nodes.name, "node-local"))
    .limit(1);

  if (existingNode.length === 0) {
    await db.insert(nodes).values({
      name: "node-local",
      region: "local",
      status: "online",
      vcpuTotal: 8,
      memMbTotal: 16384,
      lastSeenAt: new Date(),
    });
  }
}

async function main(): Promise<void> {
  console.log("[db:push] criando schema…");
  await createSchema();
  console.log("[db:push] seed…");
  await seed();
  console.log("[db:push] pronto.");
}

main()
  .then(async () => {
    await sql.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[db:push] falhou:", err);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
