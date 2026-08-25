import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { sshConfigs, sshKeys, sftpConfigs, environments, envTypes, envAddresses } from "../db/schema";
import { hashPassword, verifyPassword } from "../auth";
import { allocateAddress, releaseAddresses } from "../ipam";
import { agentUrlForEnv } from "../nodes";
import * as agent from "../agent";

/**
 * Rotas internas máquina-a-máquina (NÃO usam cookie de sessão). Usadas pelo
 * gateway SSH que roda nos nós de hospedagem, que consulta o controle POR
 * WireGuard (10.100.0.1:4000). Protegidas por token compartilhado
 * `VP_INTERNAL_TOKEN`. O Caddy público BLOQUEIA `/api/v1/internal/*` (403), então
 * na prática só é alcançável pela rede WireGuard.
 */
const INTERNAL_TOKEN = process.env.VP_INTERNAL_TOKEN ?? "";

/** Compara o token em tempo constante (evita oráculo de timing). */
function tokenOk(provided: unknown): boolean {
  if (!INTERNAL_TOKEN || typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(INTERNAL_TOKEN);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/* ── Proteção do verify de senha SFTP (porta pública, senha → brute-force) ── */

// Hash "isca": comparado quando o usuário/hn não existe, para IGUALAR o tempo
// (bcrypt sempre roda) e não vazar existência por timing. Calculado 1x.
const DUMMY_HASH = hashPassword("x".repeat(24));

// Throttle por username: após N falhas em janela, bloqueia por um tempo.
const FAIL_MAX = 5;
const FAIL_WINDOW_MS = 60_000;
const LOCK_MS = 60_000;
const attempts = new Map<string, { fails: number; first: number; until: number }>();
function throttleState(username: string): { locked: boolean } {
  const now = Date.now();
  const a = attempts.get(username);
  if (a && a.until > now) return { locked: true };
  if (a && now - a.first > FAIL_WINDOW_MS) attempts.delete(username);
  return { locked: false };
}
function noteFail(username: string): void {
  const now = Date.now();
  const a = attempts.get(username) ?? { fails: 0, first: now, until: 0 };
  a.fails += 1;
  if (a.fails >= FAIL_MAX) {
    a.until = now + LOCK_MS;
    a.fails = 0;
    a.first = now;
  }
  attempts.set(username, a);
}
function noteSuccess(username: string): void {
  attempts.delete(username);
}

// Limita bcrypt concorrente para o guessing nunca esfomear o event loop.
let bcryptInFlight = 0;
const BCRYPT_MAX = 4;
const bcryptQueue: Array<() => void> = [];
async function withBcryptSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (bcryptInFlight >= BCRYPT_MAX) {
    await new Promise<void>((resolve) => bcryptQueue.push(resolve));
  }
  bcryptInFlight += 1;
  try {
    return await fn();
  } finally {
    bcryptInFlight -= 1;
    const next = bcryptQueue.shift();
    if (next) next();
  }
}

export async function internalRoutes(fastify: FastifyInstance): Promise<void> {
  // Resolve, para um username `env_<hex>`, se o SSH está ligado, o container do
  // ambiente e as chaves públicas autorizadas — para o gateway autenticar/rotear.
  // Backfill: migra apps de código legados (na docker0) para a rede por-dono,
  // anexando o container ao vivo (dual-home). Idempotente. Protegido por token.
  fastify.post("/internal/backfill/app-networks", async (req, reply) => {
    if (!tokenOk(req.headers["x-internal-token"])) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const candidates = await db
      .select()
      .from(environments)
      .where(and(isNull(environments.parentEnvId), isNull(environments.typeId)));
    const results: Array<{ env: string; status: string; ip?: string }> = [];
    for (const env of candidates) {
      if (!env.containerId || !env.nodeId) { results.push({ env: env.name, status: "sem container/nó" }); continue; }
      if (env.state !== "running" && env.state !== "paused") { results.push({ env: env.name, status: `estado ${env.state}` }); continue; }
      const existing = await db.select().from(envAddresses).where(and(eq(envAddresses.envId, env.id), eq(envAddresses.role, "app")));
      if (existing.length) { results.push({ env: env.name, status: "já migrado", ip: existing[0]!.ip }); continue; }
      try {
        const agentUrl = await agentUrlForEnv(env);
        const alloc = await allocateAddress(env.nodeId, env.ownerId, env.id, "app");
        const r = await agent.attachNetwork(agentUrl, env.containerId, { name: alloc.bridgeName, subnet: alloc.subnet, gateway: alloc.gateway }, alloc.ip, env.ownerId);
        await db.update(envAddresses).set({ containerId: env.containerId }).where(and(eq(envAddresses.envId, env.id), eq(envAddresses.role, "app")));
        results.push({ env: env.name, status: r.alreadyAttached ? "já estava anexado" : "anexado", ip: alloc.ip });
      } catch (err) {
        await releaseAddresses(env.id).catch(() => {});
        results.push({ env: env.name, status: "falha: " + (err instanceof Error ? err.message : String(err)) });
      }
    }
    return { migrated: results };
  });

  fastify.get("/internal/ssh/resolve/:username", async (req, reply) => {
    if (!tokenOk(req.headers["x-internal-token"])) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const { username } = req.params as { username: string };

    const cfgRows = await db
      .select()
      .from(sshConfigs)
      .where(eq(sshConfigs.username, username))
      .limit(1);
    const cfg = cfgRows[0];
    if (!cfg) return reply.code(404).send({ error: "not_found" });

    const envRows = await db
      .select()
      .from(environments)
      .where(eq(environments.id, cfg.envId))
      .limit(1);
    const env = envRows[0];
    const keys = await db.select().from(sshKeys).where(eq(sshKeys.envId, cfg.envId));

    // Pasta onde o SSH abre. App PHP → /var; App Node → /app; SERVIÇO/STACK
    // (redis/mysql/n8n/…) → "/" (não têm /app nem /var), senão o docker exec falha.
    let workdir =
      env?.runtimeKind === "node" || env?.runtimeKind === "python" || env?.runtimeKind === "dotnet" ? "/app" : env?.runtimeKind === "static" ? "/site" : "/var";
    if (env?.typeId) {
      const et = await db.select().from(envTypes).where(eq(envTypes.id, env.typeId)).limit(1);
      if (et[0] && et[0].category !== "app") workdir = "/";
    }
    return {
      enabled: cfg.enabled,
      username: cfg.username,
      containerId: env?.containerId ?? null,
      workdir,
      state: env?.state ?? null,
      accessScope: cfg.accessScope,
      allowlist: Array.isArray(cfg.allowlist) ? (cfg.allowlist as string[]) : [],
      keys: keys.map((k) => k.publicKey),
    };
  });

  // POST /internal/sftp/verify — verifica a SENHA do SFTP para um username e,
  // se ok, devolve o container/pasta para o gateway abrir o sftp-server.
  // Endurecido contra brute-force/enumeração (porta pública, auth por senha):
  //  - resposta UNIFORME {ok:false} para usuário inexistente OU senha errada;
  //  - SEMPRE roda um bcrypt (hash isca quando não há usuário) → tempo igual;
  //  - throttle por username; bcrypt concorrente limitado (não trava o loop);
  //  - só devolve containerId/workdir em caso de sucesso.
  fastify.post("/internal/sftp/verify", async (req, reply) => {
    if (!tokenOk(req.headers["x-internal-token"])) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const body = (req.body ?? {}) as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";
    const dummy = await DUMMY_HASH;

    // Entrada malformada ou username bloqueado: gasta um bcrypt (timing) e nega.
    if (!username || !password || throttleState(username).locked) {
      await withBcryptSlot(() => verifyPassword(password || "x", dummy));
      return reply.send({ ok: false });
    }

    const cfgRows = await db
      .select()
      .from(sftpConfigs)
      .where(eq(sftpConfigs.username, username))
      .limit(1);
    const cfg = cfgRows[0];
    const hash = cfg?.passwordHash ?? dummy; // sem usuário/senha → compara com a isca

    const match = await withBcryptSlot(() => verifyPassword(password, hash));
    if (!cfg || !cfg.enabled || !cfg.passwordHash || !match) {
      noteFail(username);
      return reply.send({ ok: false });
    }

    const envRows = await db
      .select()
      .from(environments)
      .where(eq(environments.id, cfg.envId))
      .limit(1);
    const env = envRows[0];
    if (!env || !env.containerId || env.state !== "running") {
      // Senha certa, mas ambiente indisponível — não conta como falha de senha.
      return reply.send({ ok: false });
    }

    noteSuccess(username);
    const workdir =
      env.runtimeKind === "node" || env.runtimeKind === "python" || env.runtimeKind === "dotnet" ? "/app" : env.runtimeKind === "static" ? "/site" : "/var";
    return reply.send({ ok: true, containerId: env.containerId, workdir });
  });
}
