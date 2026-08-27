import { eq } from "drizzle-orm";
import postgres from "postgres";
import { PLANS } from "@velozplanel/contracts";
import { sql, db, DATABASE_URL } from "./client";
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
  await sql`ALTER TABLE nodes ADD COLUMN IF NOT EXISTS agent_url text`;

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
  await sql`ALTER TABLE environments ADD COLUMN IF NOT EXISTS auto_subdomain text`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS environments_auto_subdomain_uq ON environments(lower(auto_subdomain))`;
  await sql`ALTER TABLE environments ADD COLUMN IF NOT EXISTS subdomain_changes_left integer NOT NULL DEFAULT 1`;
  // Uso de disco persistido: último valor medido (com a máquina ligada) + quando.
  await sql`ALTER TABLE environments ADD COLUMN IF NOT EXISTS disk_bytes bigint`;
  await sql`ALTER TABLE environments ADD COLUMN IF NOT EXISTS disk_measured_at timestamptz`;
  // Subdomínios reservados (jamees.top) — ninguém seleciona.
  await sql`
    CREATE TABLE IF NOT EXISTS reserved_subdomains (
      name        text PRIMARY KEY,
      reason      text,
      locked      boolean NOT NULL DEFAULT false,
      created_at  timestamptz NOT NULL DEFAULT now()
    )
  `;
  {
    const locked = ["ns1", "ns2", "ns3", "ns4", "painel", "panel"];
    const soft = ["www", "admin", "api", "app", "root", "status", "mail", "smtp", "imap", "webmail", "dns", "cdn", "static", "assets", "blog", "dashboard", "login", "auth", "billing", "docs", "help", "support", "dev", "staging", "test"];
    for (const n of locked) await sql`INSERT INTO reserved_subdomains (name, reason, locked) VALUES (${n}, 'infra/marca', true) ON CONFLICT (name) DO NOTHING`;
    for (const n of soft) await sql`INSERT INTO reserved_subdomains (name, reason, locked) VALUES (${n}, 'reservado', false) ON CONFLICT (name) DO NOTHING`;
  }

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

  await sql`
    CREATE TABLE IF NOT EXISTS sftp_configs (
      env_id          uuid PRIMARY KEY REFERENCES environments(id) ON DELETE CASCADE,
      username        text NOT NULL UNIQUE,
      enabled         boolean NOT NULL DEFAULT false,
      port            integer NOT NULL DEFAULT 2223,
      password_hash   text,
      password_set_at timestamptz
    )
  `;

  // Unifica o username do SSH para o hex COMPLETO do env (evita colisão de
  // prefixo entre ambientes) e o torna único.
  await sql`UPDATE ssh_configs SET username = 'env_' || replace(env_id::text, '-', '') WHERE username <> 'env_' || replace(env_id::text, '-', '')`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS ssh_configs_username_key ON ssh_configs(username)`;

  await sql`
    CREATE TABLE IF NOT EXISTS deploy_configs (
      env_id                uuid PRIMARY KEY REFERENCES environments(id) ON DELETE CASCADE,
      connection_mode       text NOT NULL DEFAULT 'none',
      provider              text NOT NULL DEFAULT 'github',
      repo_url              text,
      branch                text NOT NULL DEFAULT 'main',
      is_private            boolean,
      mode                  text NOT NULL DEFAULT 'simple',
      public_key            text,
      fingerprint           text,
      http_username         text,
      http_password_enc     text,
      connection_verified_at timestamptz,
      needs_reconnect       boolean NOT NULL DEFAULT false,
      host_key_state        text NOT NULL DEFAULT 'ok',
      auto_enabled          boolean NOT NULL DEFAULT false,
      interval_minutes      integer NOT NULL DEFAULT 5,
      auto_engine           text NOT NULL DEFAULT 'agent',
      deploy_strategy       text NOT NULL DEFAULT 'place',
      framework             text NOT NULL DEFAULT 'none',
      run_model             text NOT NULL DEFAULT 'standalone',
      next_check_at         timestamptz,
      last_remote_sha       text,
      last_check_at         timestamptz,
      last_good_sha         text,
      last_run_id           uuid,
      last_run_status       text,
      last_run_at           timestamptz
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS deploy_steps (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      env_id       uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
      ord          integer NOT NULL,
      enabled      boolean NOT NULL DEFAULT true,
      kind         text NOT NULL,
      command      text,
      label        text NOT NULL,
      cwd          text,
      mutates_data boolean NOT NULL DEFAULT false
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS deploy_steps_env_ord_idx ON deploy_steps(env_id, ord)`;
  await sql`
    CREATE TABLE IF NOT EXISTS deploy_runs (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      env_id           uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
      trigger          text NOT NULL,
      status           text NOT NULL,
      exit_code        integer,
      failed_step_kind text,
      commit_sha       text,
      commit_message   text,
      commit_author    text,
      steps_snapshot   jsonb,
      log              text,
      heartbeat_at     timestamptz,
      started_at       timestamptz NOT NULL DEFAULT now(),
      finished_at      timestamptz
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS deploy_runs_env_started_idx ON deploy_runs(env_id, started_at DESC)`;
  await sql`ALTER TABLE deploy_configs ADD COLUMN IF NOT EXISTS http_username text`;
  await sql`ALTER TABLE deploy_configs ADD COLUMN IF NOT EXISTS http_password_enc text`;
  await sql`ALTER TABLE deploy_configs ADD COLUMN IF NOT EXISTS subdir text`;
  await sql`ALTER TABLE deploy_configs ADD COLUMN IF NOT EXISTS history_limit integer NOT NULL DEFAULT 10`;
  await sql`
    CREATE TABLE IF NOT EXISTS env_vars (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      env_id          uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
      key             text NOT NULL,
      value_encrypted text NOT NULL,
      build_time      boolean NOT NULL DEFAULT false,
      created_at      timestamptz NOT NULL DEFAULT now(),
      updated_at      timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS env_vars_env_key_idx ON env_vars(env_id, key)`;
  await sql`ALTER TABLE env_vars ALTER COLUMN build_time SET DEFAULT true`; // toda var = build por padrão
  await sql`ALTER TABLE env_vars ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false`;

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
      max_environments  integer NOT NULL DEFAULT 5,
      active            boolean NOT NULL DEFAULT true,
      sort_order        integer NOT NULL DEFAULT 0
    )
  `;
  await sql`ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_environments integer NOT NULL DEFAULT 5`;

  // Catálogo de tipos de ambiente (dono do preço de compute).
  await sql`
    CREATE TABLE IF NOT EXISTS env_types (
      id                  text PRIMARY KEY,
      label               text NOT NULL,
      category            text NOT NULL,
      image               text,
      internal_port       integer,
      data_path           text,
      needs_db            boolean NOT NULL DEFAULT false,
      child_type          text,
      default_tool        text,
      allows_public_domain boolean NOT NULL DEFAULT false,
      price_month_cents   integer NOT NULL DEFAULT 0,
      active              boolean NOT NULL DEFAULT true,
      sort_order          integer NOT NULL DEFAULT 0
    )
  `;
  // Modelo B: price_month_cents vira ADICIONAL; min_vcpu/min_mem_mb = requisito.
  await sql`ALTER TABLE env_types ADD COLUMN IF NOT EXISTS min_vcpu double precision NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE env_types ADD COLUMN IF NOT EXISTS min_mem_mb integer NOT NULL DEFAULT 0`;

  // Sub-rede /24 por (dono, nó).
  await sql`
    CREATE TABLE IF NOT EXISTS owner_networks (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      node_id     uuid NOT NULL,
      owner_id    uuid NOT NULL,
      slot        integer NOT NULL,
      subnet      text NOT NULL,
      gateway     text NOT NULL,
      bridge_name text NOT NULL
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS owner_networks_node_owner_uq ON owner_networks (node_id, owner_id)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS owner_networks_node_slot_uq ON owner_networks (node_id, slot)`;

  // Livro-razão de IPAM: um IP fixo por container na bridge do dono.
  await sql`
    CREATE TABLE IF NOT EXISTS env_addresses (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      node_id      uuid NOT NULL,
      env_id       uuid NOT NULL,
      role         text NOT NULL,
      ip           text NOT NULL,
      container_id text
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS env_addresses_node_ip_uq ON env_addresses (node_id, ip)`;
  // Dedupe defensivo antes do índice único (caso haja duplicata de antes).
  await sql`DELETE FROM env_addresses a USING env_addresses b WHERE a.env_id = b.env_id AND a.role = b.role AND a.ctid < b.ctid`;
  // Um IP por (env, papel) — fecha o vazamento de IP em retry idempotente.
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS env_addresses_env_role_uq ON env_addresses (env_id, role)`;

  // Fila de jobs (provisionar/remover ambiente).
  await sql`
    CREATE TABLE IF NOT EXISTS jobs (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind         text NOT NULL,
      env_id       uuid NOT NULL,
      payload      jsonb NOT NULL DEFAULT '{}',
      status       text NOT NULL DEFAULT 'queued',
      attempts     integer NOT NULL DEFAULT 0,
      max_attempts integer NOT NULL DEFAULT 8,
      run_after    timestamptz NOT NULL DEFAULT now(),
      locked_by    text,
      locked_at    timestamptz,
      heartbeat_at timestamptz,
      last_error   text,
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now(),
      finished_at  timestamptz
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs (run_after) WHERE status = 'queued'`;
  await sql`CREATE INDEX IF NOT EXISTS jobs_env_idx ON jobs (env_id, created_at DESC)`;
  await sql`ALTER TABLE environments ADD COLUMN IF NOT EXISTS error_message text`;

  // Metadados de zona DNS (o storage do DNS vive no database `pdns` via gpgsql).
  // Aqui guardamos só o que o pdns não sabe: status de delegação + vínculo com env.
  await sql`
    CREATE TABLE IF NOT EXISTS dns_zones_meta (
      zone           text PRIMARY KEY,
      environment_id uuid REFERENCES environments(id) ON DELETE SET NULL,
      status         text NOT NULL DEFAULT 'pending',
      serial         bigint,
      checked_at     timestamptz,
      check_msg      text,
      created_by     uuid,
      created_at     timestamptz NOT NULL DEFAULT now()
    )
  `;
  // Dono (cliente) da zona — DNS por usuário. null = domínio do SISTEMA (super admin).
  // O tipo (sistema vs cliente) é definido por ONDE a zona é criada: pela área
  // admin (/admin/dns/zones) nasce como sistema (owner null); pela área do cliente
  // (/domains) nasce com o dono = quem criou (mesmo que seja um admin usando o
  // painel como usuário). NÃO reclassificamos por papel.
  await sql`ALTER TABLE dns_zones_meta ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id) ON DELETE SET NULL`;

  // Vínculo domínio(label)→ambiente (roteamento por nome).
  await sql`
    CREATE TABLE IF NOT EXISTS env_domains (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      zone           text NOT NULL,
      label          text NOT NULL,
      environment_id uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
      owner_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      is_primary     boolean NOT NULL DEFAULT false,
      created_at     timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS env_domains_zone_label_idx ON env_domains (zone, label)`;
  await sql`CREATE INDEX IF NOT EXISTS env_domains_env_idx ON env_domains (environment_id)`;
  await sql`ALTER TABLE env_domains ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT false`;
  // Cobrança de gerência por domínio (relógio + preço configurável).
  await sql`ALTER TABLE dns_zones_meta ADD COLUMN IF NOT EXISTS last_charged_at timestamptz`;

  // Ferramentas de UI por ambiente-serviço (liga/desliga, default desligado).
  await sql`
    CREATE TABLE IF NOT EXISTS env_tools (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      env_id       uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
      kind         text NOT NULL,
      enabled      boolean NOT NULL DEFAULT false,
      container_id text,
      ip           text,
      target_ip    text,
      target_port  integer
    )
  `;
  // Jamees Studio: senha opcional do painel (hash bcrypt; null = sem senha).
  await sql`ALTER TABLE env_tools ADD COLUMN IF NOT EXISTS password_hash text`;
  // Painel de serviço (rabbitmq): subdomínio aleatório fixo sob jamees.com.
  await sql`ALTER TABLE env_tools ADD COLUMN IF NOT EXISTS subdomain text`;
  // 1 linha por (env, ferramenta) — idempotência do flag liga/desliga.
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS env_tools_env_kind_uq ON env_tools(env_id, kind)`;

  // Credenciais de serviço cifradas (persistem — necessárias p/ injetar e autenticar a UI).
  await sql`
    CREATE TABLE IF NOT EXISTS service_credentials (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      env_id          uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
      key             text NOT NULL,
      value_encrypted text NOT NULL
    )
  `;

  await sql`ALTER TABLE environments ADD COLUMN IF NOT EXISTS type_id text`;
  await sql`ALTER TABLE environments ADD COLUMN IF NOT EXISTS parent_env_id uuid`;
  await sql`ALTER TABLE environments ADD COLUMN IF NOT EXISTS public_domain text`;
  await sql`ALTER TABLE nodes ADD COLUMN IF NOT EXISTS alert_message text`;
  // Alerta inicial do servidor local (instável) — só se ainda não houver um.
  await sql`UPDATE nodes SET alert_message = 'Servidor local (em casa): máquina instável — pode cair, reiniciar ou perder conexão. Use apenas para testes; não coloque nada de produção aqui.' WHERE name = 'sp-local' AND (alert_message IS NULL OR alert_message = '')`;

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

  await sql`ALTER TABLE environments ADD COLUMN IF NOT EXISTS last_charged_at timestamptz`;
  await sql`ALTER TABLE environments ADD COLUMN IF NOT EXISTS runtime_version_full text`;
  await sql`ALTER TABLE environments ADD COLUMN IF NOT EXISTS startup_script text`;
  await sql`ALTER TABLE environments ADD COLUMN IF NOT EXISTS node_start_file text`;
  await sql`ALTER TABLE environments ADD COLUMN IF NOT EXISTS python_cmd text`;
  await sql`ALTER TABLE environments ADD COLUMN IF NOT EXISTS dotnet_cmd text`;
  await sql`ALTER TABLE environments ADD COLUMN IF NOT EXISTS php_node_version text`;
  await sql`ALTER TABLE environments ADD COLUMN IF NOT EXISTS php_node_version_full text`;
  await sql`ALTER TABLE environments ADD COLUMN IF NOT EXISTS php_web_root text`;

  await sql`
    CREATE TABLE IF NOT EXISTS platform_settings (
      id                       integer PRIMARY KEY DEFAULT 1,
      billing_enabled          boolean NOT NULL DEFAULT false,
      billing_interval_minutes integer NOT NULL DEFAULT 60,
      suspend_on_zero          boolean NOT NULL DEFAULT true,
      billing_last_run_at      timestamptz
    )
  `;
  await sql`INSERT INTO platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;
  await sql`ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS billing_free_minutes integer NOT NULL DEFAULT 1`;
  await sql`ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS domain_price_month_cents integer NOT NULL DEFAULT 100`;
  await sql`ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS default_region text`;
  await sql`UPDATE platform_settings SET default_region='local' WHERE default_region IS NULL`;
  await sql`ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS rate_vcpu_month_cents integer NOT NULL DEFAULT 2000`;
  await sql`ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS rate_ram_gb_month_cents integer NOT NULL DEFAULT 2000`;
  await sql`ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS rate_disk_gb_month_cents integer NOT NULL DEFAULT 25`;
  // Resumo da última execução do cron (sobrevive a restart).
  await sql`ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS billing_last_run_finished_at timestamptz`;
  await sql`ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS billing_last_instances integer`;
  await sql`ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS billing_last_suspended integer`;
  await sql`ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS billing_last_charged_cents integer`;
  await sql`ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS billing_last_ok boolean`;

  // Rollup HORÁRIO das execuções de cobrança (histórico compacto).
  await sql`
    CREATE TABLE IF NOT EXISTS billing_run_hours (
      hour           timestamptz PRIMARY KEY,
      runs           integer NOT NULL DEFAULT 0,
      charged_cents  integer NOT NULL DEFAULT 0,
      charge_events  integer NOT NULL DEFAULT 0,
      suspended      integer NOT NULL DEFAULT 0,
      instances      integer NOT NULL DEFAULT 0,
      errors         integer NOT NULL DEFAULT 0,
      first_run_at   timestamptz NOT NULL,
      last_run_at    timestamptz NOT NULL
    )`;
}

async function seed(): Promise<void> {
  // Semeia os planos padrão (idempotente — não sobrescreve edições do admin).
  const defaults = Object.values(PLANS);
  for (let i = 0; i < defaults.length; i++) {
    const p = defaults[i]!;
    await sql`
      INSERT INTO plans (id, label, vcpu, mem_mb, disk_gb, price_month_cents, max_environments, active, sort_order)
      VALUES (${p.id}, ${p.label}, ${p.vcpu}, ${p.memMb}, ${p.diskGb}, ${p.priceMonthCents}, ${p.maxEnvironments}, true, ${i})
      ON CONFLICT (id) DO NOTHING
    `;
  }

  // Semeia o catálogo de tipos (idempotente — não sobrescreve preços editados pelo admin).
  // Modelo B: price = ADICIONAL (0 por padrão); minVcpu/minMemMb = requisito.
  const envTypeSeed: Array<{
    id: string; label: string; category: string; image: string | null; port: number | null;
    dataPath: string | null; needsDb: boolean; childType: string | null; tool: string | null;
    publicDomain: boolean; price: number; minVcpu: number; minMemMb: number;
  }> = [
    { id: "php", label: "PHP", category: "app", image: null, port: 80, dataPath: null, needsDb: false, childType: null, tool: null, publicDomain: false, price: 0, minVcpu: 0, minMemMb: 0 },
    { id: "node", label: "Node.js", category: "app", image: null, port: 80, dataPath: null, needsDb: false, childType: null, tool: null, publicDomain: false, price: 0, minVcpu: 0, minMemMb: 0 },
    { id: "python", label: "Python", category: "app", image: null, port: 80, dataPath: null, needsDb: false, childType: null, tool: null, publicDomain: false, price: 0, minVcpu: 0, minMemMb: 0 },
    { id: "static", label: "Site estático (HTML/SPA)", category: "app", image: null, port: 80, dataPath: null, needsDb: false, childType: null, tool: null, publicDomain: false, price: 0, minVcpu: 0, minMemMb: 0 },
    { id: "dotnet", label: ".NET", category: "app", image: null, port: 80, dataPath: null, needsDb: false, childType: null, tool: null, publicDomain: false, price: 0, minVcpu: 0, minMemMb: 0 },
    { id: "redis", label: "Redis", category: "service", image: "redis:7", port: 6379, dataPath: "/data", needsDb: false, childType: null, tool: "redisinsight", publicDomain: false, price: 0, minVcpu: 0, minMemMb: 0 },
    { id: "mysql", label: "MySQL", category: "service", image: "mysql:8", port: 3306, dataPath: "/var/lib/mysql", needsDb: false, childType: null, tool: "phpmyadmin", publicDomain: false, price: 0, minVcpu: 1, minMemMb: 1024 },
    { id: "mariadb", label: "MariaDB", category: "service", image: "mariadb:11", port: 3306, dataPath: "/var/lib/mysql", needsDb: false, childType: null, tool: "phpmyadmin", publicDomain: false, price: 0, minVcpu: 1, minMemMb: 1024 },
    { id: "postgres", label: "PostgreSQL", category: "service", image: "postgres:16", port: 5432, dataPath: "/var/lib/postgresql/data", needsDb: false, childType: null, tool: "adminer", publicDomain: false, price: 0, minVcpu: 0, minMemMb: 0 },
    { id: "rabbitmq", label: "RabbitMQ", category: "service", image: "rabbitmq:3-management", port: 5672, dataPath: "/var/lib/rabbitmq", needsDb: false, childType: null, tool: "rabbitmq_mgmt", publicDomain: false, price: 0, minVcpu: 0, minMemMb: 0 },
    { id: "n8n", label: "n8n", category: "stack", image: "n8nio/n8n", port: 5678, dataPath: "/home/node/.n8n", needsDb: true, childType: "postgres", tool: null, publicDomain: false, price: 0, minVcpu: 1, minMemMb: 1024 },
    { id: "wordpress", label: "WordPress", category: "stack", image: "wordpress:php8.3-apache", port: 80, dataPath: "/var/www/html", needsDb: true, childType: "mariadb", tool: null, publicDomain: true, price: 0, minVcpu: 1, minMemMb: 1024 },
    // MongoDB: mesmo preço do MySQL (0) e piso 0.5 vCPU / 512 MB. Sem ferramenta de UI própria.
    { id: "mongodb", label: "MongoDB", category: "service", image: "mongo:7", port: 27017, dataPath: "/data/db", needsDb: false, childType: null, tool: null, publicDomain: false, price: 0, minVcpu: 0.5, minMemMb: 512 },
  ];
  for (let i = 0; i < envTypeSeed.length; i++) {
    const t = envTypeSeed[i]!;
    await sql`
      INSERT INTO env_types (id, label, category, image, internal_port, data_path, needs_db, child_type, default_tool, allows_public_domain, price_month_cents, min_vcpu, min_mem_mb, active, sort_order)
      VALUES (${t.id}, ${t.label}, ${t.category}, ${t.image}, ${t.port}, ${t.dataPath}, ${t.needsDb}, ${t.childType}, ${t.tool}, ${t.publicDomain}, ${t.price}, ${t.minVcpu}, ${t.minMemMb}, true, ${i})
      ON CONFLICT (id) DO NOTHING
    `;
  }

  // Migração ÚNICA do Modelo B para bancos já existentes (ON CONFLICT não atualiza):
  // zera os adicionais herdados do modelo antigo e semeia os mínimos. Roda 1× só
  // (marcador), pra não sobrescrever ajustes futuros do admin.
  await sql`ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS pricing_v2_applied boolean NOT NULL DEFAULT false`;
  const pv2 = await sql`SELECT pricing_v2_applied FROM platform_settings WHERE id = 1`;
  if (pv2[0] && !pv2[0].pricing_v2_applied) {
    await sql`UPDATE env_types SET price_month_cents = 0`;
    await sql`UPDATE env_types SET min_vcpu = 1, min_mem_mb = 1024 WHERE id IN ('mysql','mariadb','n8n','wordpress')`;
    await sql`UPDATE platform_settings SET pricing_v2_applied = true WHERE id = 1`;
    console.log("[db:push] pricing v2 (Modelo B) aplicado: adicionais zerados + mínimos semeados.");
  }

  // Admin inicial: credenciais vêm de env em produção (nunca hardcode fraco).
  const adminEmail = process.env.VP_SEED_ADMIN_EMAIL ?? "admin@veloz.dev";
  const adminPassword = process.env.VP_SEED_ADMIN_PASSWORD ?? "veloz123";
  const adminHash = await hashPassword(adminPassword);

  await db
    .insert(users)
    .values({ email: adminEmail, name: "Admin", role: "admin", passwordHash: adminHash })
    .onConflictDoNothing({ target: users.email });

  // Cliente de demonstração: só em dev (VP_SEED_DEMO=1). Nunca em produção.
  if (process.env.VP_SEED_DEMO === "1") {
    const demoHash = await hashPassword("veloz123");
    await db
      .insert(users)
      .values({ email: "client@veloz.dev", name: "Cliente", role: "client", passwordHash: demoHash })
      .onConflictDoNothing({ target: users.email });
  }

  // Nó local de demonstração: só em dev (VP_SEED_DEMO=1). Em produção os nós
  // reais são cadastrados pelo super admin — nunca recriar o node-local aqui.
  if (process.env.VP_SEED_DEMO === "1") {
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
        agentUrl: process.env.AGENT_URL ?? "http://localhost:4100",
        lastSeenAt: new Date(),
      });
    }
  }
}

/**
 * Bootstrap do backend do PowerDNS: database dedicado `pdns` (movível com um
 * `pg_dump -Fc pdns`), role `pdns` e o schema gpgsql OFICIAL do PowerDNS
 * (tabelas domains/records/…). Idempotente. Pulado quando não há
 * `PDNS_DB_PASSWORD` (ambiente de dev, sem servidor DNS).
 */
async function bootstrapPdns(): Promise<void> {
  const pdnsPassword = process.env.PDNS_DB_PASSWORD;
  if (!pdnsPassword) {
    console.log("[db:push] pdns: PDNS_DB_PASSWORD ausente — pulando bootstrap do DNS.");
    return;
  }
  const pdnsDbName = process.env.PDNS_DB_NAME ?? "pdns";
  const pdnsUser = process.env.PDNS_DB_USER ?? "pdns";

  // 1) Role + database (fora de transação — CREATE DATABASE não pode transacionar).
  const roleExists = await sql`SELECT 1 FROM pg_roles WHERE rolname = ${pdnsUser}`;
  if (roleExists.length === 0) {
    await sql.unsafe(`CREATE ROLE ${pdnsUser} LOGIN PASSWORD '${pdnsPassword.replace(/'/g, "''")}'`);
    console.log(`[db:push] pdns: role ${pdnsUser} criada.`);
  } else {
    await sql.unsafe(`ALTER ROLE ${pdnsUser} LOGIN PASSWORD '${pdnsPassword.replace(/'/g, "''")}'`);
  }
  const dbExists = await sql`SELECT 1 FROM pg_database WHERE datname = ${pdnsDbName}`;
  if (dbExists.length === 0) {
    await sql.unsafe(`CREATE DATABASE ${pdnsDbName} OWNER ${pdnsUser}`);
    console.log(`[db:push] pdns: database ${pdnsDbName} criado.`);
  }

  // 2) Schema gpgsql oficial do PowerDNS, aplicado no database `pdns`.
  const pdnsUrl = new URL(DATABASE_URL);
  pdnsUrl.pathname = `/${pdnsDbName}`;
  const psql = postgres(pdnsUrl.toString(), { max: 2 });
  try {
    await psql`
      CREATE TABLE IF NOT EXISTS domains (
        id              SERIAL PRIMARY KEY,
        name            VARCHAR(255) NOT NULL,
        master          VARCHAR(128) DEFAULT NULL,
        last_check      INT DEFAULT NULL,
        type            VARCHAR(8) NOT NULL,
        notified_serial BIGINT DEFAULT NULL,
        account         VARCHAR(40) DEFAULT NULL,
        options         TEXT DEFAULT NULL,
        catalog         TEXT DEFAULT NULL
      )
    `;
    await psql`CREATE UNIQUE INDEX IF NOT EXISTS name_index ON domains(name)`;
    await psql`CREATE INDEX IF NOT EXISTS catalog_idx ON domains(catalog)`;

    await psql`
      CREATE TABLE IF NOT EXISTS records (
        id        BIGSERIAL PRIMARY KEY,
        domain_id INT DEFAULT NULL REFERENCES domains(id) ON DELETE CASCADE,
        name      VARCHAR(255) DEFAULT NULL,
        type      VARCHAR(10) DEFAULT NULL,
        content   VARCHAR(65535) DEFAULT NULL,
        ttl       INT DEFAULT NULL,
        prio      INT DEFAULT NULL,
        disabled  BOOL DEFAULT 'f',
        ordername VARCHAR(255),
        auth      BOOL DEFAULT 't'
      )
    `;
    await psql`CREATE INDEX IF NOT EXISTS rec_name_index ON records(name)`;
    await psql`CREATE INDEX IF NOT EXISTS nametype_index ON records(name,type)`;
    await psql`CREATE INDEX IF NOT EXISTS domain_id ON records(domain_id)`;
    await psql`CREATE INDEX IF NOT EXISTS recordorder ON records (domain_id, ordername text_pattern_ops)`;

    await psql`
      CREATE TABLE IF NOT EXISTS supermasters (
        ip         INET NOT NULL,
        nameserver VARCHAR(255) NOT NULL,
        account    VARCHAR(40) NOT NULL,
        PRIMARY KEY(ip, nameserver)
      )
    `;
    await psql`
      CREATE TABLE IF NOT EXISTS comments (
        id          SERIAL PRIMARY KEY,
        domain_id   INT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        name        VARCHAR(255) NOT NULL,
        type        VARCHAR(10) NOT NULL,
        modified_at INT NOT NULL,
        account     VARCHAR(40) DEFAULT NULL,
        comment     VARCHAR(65535) NOT NULL
      )
    `;
    await psql`CREATE INDEX IF NOT EXISTS comments_domain_id_idx ON comments (domain_id)`;
    await psql`CREATE INDEX IF NOT EXISTS comments_name_type_idx ON comments (name, type)`;
    await psql`CREATE INDEX IF NOT EXISTS comments_order_idx ON comments (domain_id, modified_at)`;

    await psql`
      CREATE TABLE IF NOT EXISTS domainmetadata (
        id        SERIAL PRIMARY KEY,
        domain_id INT REFERENCES domains(id) ON DELETE CASCADE,
        kind      VARCHAR(32),
        content   TEXT
      )
    `;
    await psql`CREATE INDEX IF NOT EXISTS domainidmetaindex ON domainmetadata(domain_id)`;

    await psql`
      CREATE TABLE IF NOT EXISTS cryptokeys (
        id        SERIAL PRIMARY KEY,
        domain_id INT REFERENCES domains(id) ON DELETE CASCADE,
        flags     INT NOT NULL,
        active    BOOL,
        published BOOL DEFAULT 't',
        content   TEXT
      )
    `;
    await psql`CREATE INDEX IF NOT EXISTS domainidindex ON cryptokeys(domain_id)`;

    await psql`
      CREATE TABLE IF NOT EXISTS tsigkeys (
        id        SERIAL PRIMARY KEY,
        name      VARCHAR(255),
        algorithm VARCHAR(50),
        secret    VARCHAR(255)
      )
    `;
    await psql`CREATE UNIQUE INDEX IF NOT EXISTS namealgoindex ON tsigkeys(name, algorithm)`;

    // A role do pdns precisa manipular tudo (o daemon fala gpgsql direto).
    await psql.unsafe(`GRANT ALL ON SCHEMA public TO ${pdnsUser}`);
    await psql.unsafe(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${pdnsUser}`);
    await psql.unsafe(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${pdnsUser}`);
    console.log("[db:push] pdns: schema gpgsql aplicado + grants.");
  } finally {
    await psql.end({ timeout: 5 }).catch(() => {});
  }
}

async function main(): Promise<void> {
  console.log("[db:push] criando schema…");
  await createSchema();
  console.log("[db:push] seed…");
  await seed();
  console.log("[db:push] bootstrap pdns…");
  await bootstrapPdns();
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
