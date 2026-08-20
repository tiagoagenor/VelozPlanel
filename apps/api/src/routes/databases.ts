import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import mysql from "mysql2/promise";
import {
  database as databaseSchema,
  databaseWithSecret as databaseWithSecretSchema,
  createDatabaseInput,
  apiError,
} from "@velozplanel/contracts";
import type { Database, DatabaseWithSecret, DbEngine } from "@velozplanel/contracts";
import { db } from "../db/client";
import { databases } from "../db/schema";
import type { DatabaseRow } from "../db/schema";
import { ApiHttpError, requireUser } from "../auth";
import { loadEnvironmentForUser } from "./environments";

/**
 * Rotas de databases — o cliente cria/lista/apaga bancos MariaDB (MySQL-compatível)
 * do ambiente dele, com credenciais próprias e isoladas.
 *
 * INFRA: um MariaDB 11 "admin" roda em 127.0.0.1:3308 (root/veloz_root_dev por
 * padrão). Cada banco do cliente vira um DATABASE + USER dedicados, com GRANT
 * apenas naquele database — isolamento por usuário. A senha é gerada com CSPRNG
 * e devolvida UMA vez (nunca guardada em claro).
 */

const idParams = z.object({ id: z.string().uuid() });
const dbParams = z.object({
  id: z.string().uuid(),
  dbId: z.string().uuid(),
});

const ENGINE: DbEngine = "mysql";

/* ─────────────── Config do MariaDB admin (por env, com defaults de dev) ─────────────── */

const MARIADB_HOST = process.env.VP_MARIADB_HOST ?? "127.0.0.1";
const MARIADB_PORT = Number(process.env.VP_MARIADB_PORT ?? 3308);
const MARIADB_USER = process.env.VP_MARIADB_USER ?? "root";
const MARIADB_PASSWORD = process.env.VP_MARIADB_PASSWORD ?? "veloz_root_dev";
// Host anunciado ao cliente nas credenciais (o admin pode ficar num IP interno).
const DB_PUBLIC_HOST = process.env.VP_DB_PUBLIC_HOST ?? "localhost";

/** Pool único de administração (lazy) para executar o DDL dos clientes. */
let adminPool: mysql.Pool | null = null;
function admin(): mysql.Pool {
  if (!adminPool) {
    adminPool = mysql.createPool({
      host: MARIADB_HOST,
      port: MARIADB_PORT,
      user: MARIADB_USER,
      password: MARIADB_PASSWORD,
      waitForConnections: true,
      connectionLimit: 4,
      multipleStatements: false,
    });
  }
  return adminPool;
}

/* ─────────────── Derivação de nomes e senha ─────────────── */

/** Primeiros 8 hex do UUID do ambiente (sem hífens). */
function envSlug(envId: string): string {
  return envId.replace(/-/g, "").slice(0, 8);
}

/**
 * Nome namespaced do database: `db_<8hex>_<name>`, no máx. 64 chars.
 * `name` já vem validado pelo contrato (`^[a-z][a-z0-9_]*$`), então o resultado
 * contém apenas [a-z0-9_] — ainda assim escapamos o identificador no DDL.
 */
function dbNameFor(envId: string, name: string): string {
  return `db_${envSlug(envId)}_${name}`.slice(0, 64);
}

/** Usuário dedicado: `u_<8hex>_<name>`, no máx. 32 chars (MariaDB permite mais). */
function dbUserFor(envId: string, name: string): string {
  return `u_${envSlug(envId)}_${name}`.slice(0, 32);
}

/** Senha forte via CSPRNG (base64url, ~20 chars, sem caracteres ambíguos p/ shell). */
function generatePassword(): string {
  return randomBytes(15).toString("base64url").slice(0, 20);
}

/** Converte a linha do DB para o contrato (sem senha). */
function toDatabase(r: DatabaseRow): Database {
  return {
    id: r.id,
    envId: r.envId,
    engine: r.engine as DbEngine,
    name: r.name,
    dbUser: r.dbUser,
    host: r.host,
    port: r.port,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Erros de "já existe" do MariaDB (database ou user duplicado). */
function isDuplicateError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === "ER_DB_CREATE_EXISTS" || code === "ER_CANNOT_USER";
}

export async function databasesRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // GET /environments/:id/databases — lista os bancos do ambiente (sem senha).
  app.get(
    "/environments/:id/databases",
    {
      schema: {
        params: idParams,
        response: {
          200: z.array(databaseSchema),
          401: apiError,
          403: apiError,
          404: apiError,
        },
      },
    },
    async (req): Promise<Database[]> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const rows = await db
        .select()
        .from(databases)
        .where(eq(databases.envId, env.id));
      return rows.map(toDatabase);
    },
  );

  // POST /environments/:id/databases — cria DATABASE + USER isolados; senha 1x.
  app.post(
    "/environments/:id/databases",
    {
      schema: {
        params: idParams,
        body: createDatabaseInput,
        response: {
          200: databaseWithSecretSchema,
          401: apiError,
          403: apiError,
          404: apiError,
          409: apiError,
          502: apiError,
        },
      },
    },
    async (req): Promise<DatabaseWithSecret> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);

      const name = req.body.name;
      const dbName = dbNameFor(env.id, name);
      const dbUser = dbUserFor(env.id, name);
      const password = generatePassword();

      // Identificador (database) escapado com backticks; literais (user/host/senha)
      // escapados como string — nunca interpolamos entrada crua.
      const dbIdent = mysql.escapeId(dbName);
      const userLit = mysql.escape(dbUser);
      const hostLit = mysql.escape("%");
      const pwLit = mysql.escape(password);

      const pool = admin();
      const conn = await pool.getConnection().catch((err) => {
        req.log.error({ err }, "falha ao conectar no MariaDB admin");
        throw new ApiHttpError(502, "db_unavailable", "servidor de banco indisponível");
      });

      try {
        try {
          await conn.query(
            `CREATE DATABASE ${dbIdent} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
          );
        } catch (err) {
          if (isDuplicateError(err)) {
            throw new ApiHttpError(
              409,
              "database_exists",
              `já existe um banco chamado "${name}" neste ambiente`,
            );
          }
          throw err;
        }

        try {
          await conn.query(`CREATE USER ${userLit}@${hostLit} IDENTIFIED BY ${pwLit}`);
        } catch (err) {
          // rollback do database recém-criado se o usuário falhar
          await conn.query(`DROP DATABASE IF EXISTS ${dbIdent}`).catch(() => {});
          if (isDuplicateError(err)) {
            throw new ApiHttpError(
              409,
              "database_exists",
              `já existe um banco chamado "${name}" neste ambiente`,
            );
          }
          throw err;
        }

        await conn.query(
          `GRANT ALL PRIVILEGES ON ${dbIdent}.* TO ${userLit}@${hostLit}`,
        );
        await conn.query("FLUSH PRIVILEGES");
      } catch (err) {
        if (err instanceof ApiHttpError) throw err;
        req.log.error({ err, envId: env.id }, "falha ao provisionar banco no MariaDB");
        throw new ApiHttpError(502, "db_provision_failed", "não foi possível criar o banco");
      } finally {
        conn.release();
      }

      // Persiste os metadados (a senha NÃO é guardada em claro).
      const inserted = await db
        .insert(databases)
        .values({
          envId: env.id,
          engine: ENGINE,
          name: dbName,
          dbUser,
          host: DB_PUBLIC_HOST,
          port: MARIADB_PORT,
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new ApiHttpError(500, "internal_error", "falha ao registrar o banco");

      return { ...toDatabase(row), password };
    },
  );

  // DELETE /environments/:id/databases/:dbId — DROP DATABASE + USER; remove a linha.
  app.delete(
    "/environments/:id/databases/:dbId",
    {
      schema: {
        params: dbParams,
        response: {
          204: z.null(),
          401: apiError,
          403: apiError,
          404: apiError,
          502: apiError,
        },
      },
    },
    async (req, reply) => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);

      // Garante que o banco pertence a ESTE ambiente do usuário.
      const rows = await db
        .select()
        .from(databases)
        .where(and(eq(databases.id, req.params.dbId), eq(databases.envId, env.id)))
        .limit(1);
      const row = rows[0];
      if (!row) throw new ApiHttpError(404, "not_found", "banco não encontrado");

      const dbIdent = mysql.escapeId(row.name);
      const userLit = mysql.escape(row.dbUser);
      const hostLit = mysql.escape("%");

      const pool = admin();
      const conn = await pool.getConnection().catch((err) => {
        req.log.error({ err }, "falha ao conectar no MariaDB admin");
        throw new ApiHttpError(502, "db_unavailable", "servidor de banco indisponível");
      });
      try {
        await conn.query(`DROP DATABASE IF EXISTS ${dbIdent}`);
        await conn.query(`DROP USER IF EXISTS ${userLit}@${hostLit}`);
        await conn.query("FLUSH PRIVILEGES");
      } catch (err) {
        req.log.error({ err, envId: env.id, dbId: row.id }, "falha ao remover banco no MariaDB");
        throw new ApiHttpError(502, "db_drop_failed", "não foi possível remover o banco");
      } finally {
        conn.release();
      }

      await db.delete(databases).where(eq(databases.id, row.id));
      return reply.status(204).send(null);
    },
  );
}
