import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import {
  dbRunSqlInput,
  dbRunMongoInput,
  dbRunRedisInput,
  dbStudioConfig as dbStudioConfigSchema,
  dbSchema as dbSchemaSchema,
  dbTableMeta as dbTableMetaSchema,
  setStudioPasswordInput,
  unlockStudioInput,
  apiError,
  isSqlEngine,
} from "@velozplanel/contracts";
import type { DbStudioConfig, StudioEngine, DbResult, DbSchema, DbTableMeta, SessionUser } from "@velozplanel/contracts";
import { db } from "../db/client";
import { envTools } from "../db/schema";
import {
  ApiHttpError,
  requireUser,
  hashPassword,
  verifyPassword,
  signStudioUnlock,
  verifyStudioUnlock,
} from "../auth";
import { loadEnvironmentForUser } from "./environments";
import { agentUrlForEnv } from "../nodes";
import * as agent from "../agent";
import { introspectSchema, introspectTable, isSafeIdent } from "../studio-introspect";
import type { SqlEngine } from "../studio-introspect";

const idParams = z.object({ id: z.string().uuid() });
const STUDIO_KIND = "jstudio";
const STUDIO_ENGINES = new Set(["mysql", "mariadb", "postgres", "mongodb", "redis"]);
const DEFAULT_DB = "app";

type EnvRow = Awaited<ReturnType<typeof loadEnvironmentForUser>>;

/** Engine do Studio a partir do tipo do ambiente (null = não é banco suportado). */
function engineForEnv(env: EnvRow): StudioEngine | null {
  return env.typeId && STUDIO_ENGINES.has(env.typeId) ? (env.typeId as StudioEngine) : null;
}

function studioCookie(id: string): string {
  return `vp_studio_${id}`;
}

async function loadStudioRow(envId: string) {
  const rows = await db
    .select()
    .from(envTools)
    .where(and(eq(envTools.envId, envId), eq(envTools.kind, STUDIO_KIND)))
    .limit(1);
  return rows[0] ?? null;
}

/** Sobe a linha env_tools do Studio (idempotente por unique(env_id,kind)). */
async function upsertStudioRow(envId: string, patch: { enabled?: boolean; passwordHash?: string | null }) {
  const existing = await loadStudioRow(envId);
  if (existing) {
    await db.update(envTools).set(patch).where(eq(envTools.id, existing.id));
  } else {
    await db.insert(envTools).values({ envId, kind: STUDIO_KIND, enabled: patch.enabled ?? false, passwordHash: patch.passwordHash ?? null });
  }
}

async function buildConfig(req: FastifyRequest, env: EnvRow, user: SessionUser): Promise<DbStudioConfig> {
  const engine = engineForEnv(env);
  const row = await loadStudioRow(env.id);
  const hasPassword = !!row?.passwordHash;
  const unlocked =
    !hasPassword || user.role === "admin" || verifyStudioUnlock(req.cookies[studioCookie(env.id)], env.id);
  return {
    enabled: !!row?.enabled,
    hasPassword,
    engine,
    database: DEFAULT_DB,
    unlocked,
  };
}

/** Gate comum das rotas SQL do Studio (introspecção). Retorna env + engine SQL. */
async function gateSqlStudio(req: FastifyRequest): Promise<{ env: EnvRow; engine: SqlEngine }> {
  const user = await requireUser(req);
  const id = (req.params as { id: string }).id;
  const env = await loadEnvironmentForUser(id, user);
  const engine = engineForEnv(env);
  if (!engine) throw new ApiHttpError(400, "nao_e_banco", "este ambiente não é um banco de dados");
  if (!isSqlEngine(engine)) throw new ApiHttpError(400, "engine_incompativel", "introspecção só para bancos SQL");
  const row = await loadStudioRow(env.id);
  if (!row?.enabled) throw new ApiHttpError(403, "studio_desligado", "ative o Data Studio para usá-lo");
  if (row.passwordHash && user.role !== "admin" && !verifyStudioUnlock(req.cookies[studioCookie(env.id)], env.id)) {
    throw new ApiHttpError(401, "studio_bloqueado", "desbloqueie o Data Studio com a senha");
  }
  if (env.state !== "running" || !env.containerId) {
    throw new ApiHttpError(409, "ambiente_parado", "inicie o ambiente para usar o Data Studio");
  }
  return { env, engine };
}

/** Executa um SELECT read-only no banco do ambiente (para introspecção). */
async function runReadSql(env: EnvRow, engine: SqlEngine, sql: string): Promise<DbResult> {
  const agentUrl = await agentUrlForEnv(env);
  return agent.dbExec(agentUrl, {
    containerId: env.containerId!,
    envId: env.id,
    engine,
    sql: { sql, write: false },
  });
}

export async function dbConsoleRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // GET — estado do Studio para este ambiente.
  app.get(
    "/environments/:id/studio",
    { schema: { params: idParams, response: { 200: dbStudioConfigSchema, 401: apiError, 403: apiError, 404: apiError } } },
    async (req): Promise<DbStudioConfig> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      return buildConfig(req, env, user);
    },
  );

  // POST enable — liga/desliga o Studio (flag; sem infra).
  app.post(
    "/environments/:id/studio/enable",
    { schema: { params: idParams, body: z.object({ enabled: z.boolean() }), response: { 200: dbStudioConfigSchema } } },
    async (req): Promise<DbStudioConfig> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      if (!engineForEnv(env)) throw new ApiHttpError(400, "nao_e_banco", "este ambiente não é um banco de dados");
      await upsertStudioRow(env.id, { enabled: req.body.enabled });
      return buildConfig(req, env, user);
    },
  );

  // POST password — define (hash) ou remove (null) a senha opcional.
  app.post(
    "/environments/:id/studio/password",
    { schema: { params: idParams, body: setStudioPasswordInput, response: { 200: dbStudioConfigSchema } } },
    async (req, reply): Promise<DbStudioConfig> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const hash = req.body.password ? await hashPassword(req.body.password) : null;
      await upsertStudioRow(env.id, { passwordHash: hash });
      // ao remover/definir senha, invalida qualquer desbloqueio anterior.
      reply.clearCookie(studioCookie(env.id), { path: "/" });
      return buildConfig(req, env, user);
    },
  );

  // POST unlock — verifica a senha e emite o cookie de desbloqueio (30min).
  app.post(
    "/environments/:id/studio/unlock",
    { schema: { params: idParams, body: unlockStudioInput, response: { 200: z.object({ ok: z.boolean() }), 401: apiError } } },
    async (req, reply): Promise<{ ok: boolean }> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const row = await loadStudioRow(env.id);
      if (!row?.passwordHash) return { ok: true }; // sem senha, nada a desbloquear
      const ok = await verifyPassword(req.body.password, row.passwordHash);
      if (!ok) throw new ApiHttpError(401, "senha_incorreta", "senha do Data Studio incorreta");
      setStudioCookie(reply, env.id);
      return { ok: true };
    },
  );

  // POST exec — roda a consulta/comando (gate: posse + running + senha; auditoria de metadados).
  const execBody = z.union([
    z.object({ sql: dbRunSqlInput }),
    z.object({ mongo: dbRunMongoInput }),
    z.object({ redis: dbRunRedisInput }),
  ]);
  app.post("/environments/:id/studio/exec", { schema: { params: idParams } }, async (req, reply) => {
    const user = await requireUser(req);
    const env = await loadEnvironmentForUser(req.params.id, user);
    const engine = engineForEnv(env);
    if (!engine) throw new ApiHttpError(400, "nao_e_banco", "este ambiente não é um banco de dados");

    const row = await loadStudioRow(env.id);
    if (!row?.enabled) throw new ApiHttpError(403, "studio_desligado", "ative o Data Studio para usá-lo");

    // gate de senha (admin faz bypass, com auditoria)
    if (row.passwordHash && user.role !== "admin") {
      if (!verifyStudioUnlock(req.cookies[studioCookie(env.id)], env.id)) {
        throw new ApiHttpError(401, "studio_bloqueado", "desbloqueie o Data Studio com a senha");
      }
    }

    if (env.state !== "running" || !env.containerId) {
      throw new ApiHttpError(409, "ambiente_parado", "inicie o ambiente para usar o Data Studio");
    }

    const parsed = execBody.safeParse(req.body);
    if (!parsed.success) throw new ApiHttpError(400, "bad_request", parsed.error.message);
    const expected = engine === "redis" ? "redis" : engine === "mongodb" ? "mongo" : "sql";
    const got = "sql" in parsed.data ? "sql" : "mongo" in parsed.data ? "mongo" : "redis";
    if (got !== expected) {
      throw new ApiHttpError(400, "engine_incompativel", "tipo de comando não corresponde ao engine");
    }

    const agentUrl = await agentUrlForEnv(env);
    let result: DbResult;
    const started = Date.now();
    try {
      result = await agent.dbExec(agentUrl, {
        containerId: env.containerId,
        envId: env.id,
        engine,
        sql: "sql" in parsed.data ? parsed.data.sql : undefined,
        mongo: "mongo" in parsed.data ? parsed.data.mongo : undefined,
        redis: "redis" in parsed.data ? parsed.data.redis : undefined,
      });
    } catch (err) {
      // erros de validação/engine do agente voltam como 502 agent_error; repassa 422 amigável.
      const msg = err instanceof ApiHttpError ? err.message : "erro ao executar";
      req.log.info(
        { studio: true, userId: user.id, envId: env.id, engine, admin: user.role === "admin", ok: false, ms: Date.now() - started },
        "studio exec",
      );
      throw new ApiHttpError(422, "engine_error", msg);
    }
    // AUDITORIA: só metadados, NUNCA o corpo/resultado (PII).
    req.log.info(
      {
        studio: true,
        userId: user.id,
        envId: env.id,
        engine,
        admin: user.role === "admin",
        write:
          "sql" in parsed.data
            ? parsed.data.sql.write === true
            : "mongo" in parsed.data
              ? parsed.data.mongo.write === true
              : parsed.data.redis.write === true,
        kind: result.kind,
        ms: Date.now() - started,
      },
      "studio exec",
    );
    return reply.code(200).send(result);
  });

  // GET schema — lista tabelas/views + versão (introspecção read-only; só bancos SQL).
  app.get(
    "/environments/:id/studio/schema",
    { schema: { params: idParams, response: { 200: dbSchemaSchema, 400: apiError, 401: apiError, 403: apiError, 404: apiError, 409: apiError } } },
    async (req): Promise<DbSchema> => {
      const { env, engine } = await gateSqlStudio(req);
      return introspectSchema(engine, DEFAULT_DB, (sql) => runReadSql(env, engine, sql));
    },
  );

  // GET table/:name — metadados de uma tabela (colunas, PK, índices, FKs, triggers, DDL).
  const tableParams = z.object({ id: z.string().uuid(), name: z.string().min(1).max(128) });
  app.get(
    "/environments/:id/studio/table/:name",
    { schema: { params: tableParams, response: { 200: dbTableMetaSchema, 400: apiError, 401: apiError, 403: apiError, 404: apiError, 409: apiError } } },
    async (req): Promise<DbTableMeta> => {
      const { env, engine } = await gateSqlStudio(req);
      const name = req.params.name;
      if (!isSafeIdent(name)) throw new ApiHttpError(400, "nome_invalido", "nome de tabela inválido");
      return introspectTable(engine, name, (sql) => runReadSql(env, engine, sql));
    },
  );

  // GET redis/subscribe — proxy do stream SSE de pub/sub (gate posse/running/senha/engine=redis).
  const subQuery = z.object({
    mode: z.enum(["channel", "pattern"]).optional().default("channel"),
    target: z.string().min(1).max(512),
    db: z.coerce.number().int().min(0).max(15).optional().default(0),
  });
  app.get(
    "/environments/:id/studio/redis/subscribe",
    { schema: { params: idParams, querystring: subQuery } },
    async (req, reply) => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      if (engineForEnv(env) !== "redis") throw new ApiHttpError(400, "nao_e_redis", "pub/sub só está disponível para Redis");
      const row = await loadStudioRow(env.id);
      if (!row?.enabled) throw new ApiHttpError(403, "studio_desligado", "ative o Data Studio para usá-lo");
      if (row.passwordHash && user.role !== "admin" && !verifyStudioUnlock(req.cookies[studioCookie(env.id)], env.id)) {
        throw new ApiHttpError(401, "studio_bloqueado", "desbloqueie o Data Studio com a senha");
      }
      if (env.state !== "running" || !env.containerId) throw new ApiHttpError(409, "ambiente_parado", "inicie o ambiente");
      const { url, headers } = agent.redisSubscribeStream(await agentUrlForEnv(env), env.containerId, req.query);
      let upstream: Response;
      try {
        upstream = await fetch(url, { headers });
      } catch {
        return reply.code(502).send({ error: "agent_unreachable", message: "não foi possível falar com o Agente" });
      }
      if (!upstream.ok || !upstream.body) return reply.code(502).send({ error: "agent_error", message: `Agente respondeu ${upstream.status}` });
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const reader = upstream.body.getReader();
      const pump = async (): Promise<void> => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) raw.write(Buffer.from(value));
          }
        } catch {
          /* encerrado */
        } finally {
          raw.end();
        }
      };
      void pump();
      req.raw.on("close", () => void reader.cancel().catch(() => {}));
    },
  );
}

/** Cookie de desbloqueio do Studio (httpOnly, curto). */
function setStudioCookie(reply: FastifyReply, envId: string): void {
  reply.setCookie(studioCookie(envId), signStudioUnlock(envId), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.VP_COOKIE_SECURE === "1",
    maxAge: 30 * 60,
  });
}
