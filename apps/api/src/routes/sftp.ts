import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  sftpConfig as sftpConfigSchema,
  setSftpEnabledInput,
  generatedSftpPassword as generatedSftpPasswordSchema,
  apiError,
} from "@velozplanel/contracts";
import type { SftpConfig, GeneratedSftpPassword } from "@velozplanel/contracts";
import { db } from "../db/client";
import { sftpConfigs, nodes } from "../db/schema";
import type { SftpConfigRow, EnvironmentRow } from "../db/schema";
import { ApiHttpError, requireUser, hashPassword } from "../auth";
import { loadEnvironmentForUser } from "./environments";

/**
 * SFTP — transferência de arquivos SÓ por senha, na porta 2223. Módulo SEPARADO
 * do SSH (que é shell só por chave, porta 2222). A senha é SEMPRE aleatória,
 * gerada pelo painel; o servidor guarda apenas o hash bcrypt. Quem gera/reseta:
 * dono do ambiente (ou admin) — via loadEnvironmentForUser.
 */

const idParams = z.object({ id: z.string().uuid() });
const SFTP_HOST = process.env.VP_SSH_HOST ?? "localhost";
const SFTP_PORT = 2223;

/**
 * username estável e ÚNICO do ambiente: env_<32 hex do id> (o UUID inteiro).
 * Usar o hex completo evita colisão de prefixo entre ambientes (que rotearia a
 * senha de um tenant para o container de outro). Mesmo padrão no SSH.
 */
function usernameFor(env: EnvironmentRow): string {
  return `env_${env.id.replace(/-/g, "")}`;
}

/** Cria (ou carrega) a linha sftp_configs 1:1 com o ambiente. */
async function loadOrCreateSftpConfig(env: EnvironmentRow): Promise<SftpConfigRow> {
  const rows = await db.select().from(sftpConfigs).where(eq(sftpConfigs.envId, env.id)).limit(1);
  const existing = rows[0];
  if (existing) return existing;

  const inserted = await db
    .insert(sftpConfigs)
    .values({ envId: env.id, username: usernameFor(env), port: SFTP_PORT })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];

  const again = await db.select().from(sftpConfigs).where(eq(sftpConfigs.envId, env.id)).limit(1);
  if (again[0]) return again[0];
  throw new ApiHttpError(500, "internal_error", "falha ao carregar configuração de SFTP");
}

/** Host público do nó do ambiente (mesmo do SSH); cai para VP_SSH_HOST/localhost. */
async function resolveSftpHost(env: EnvironmentRow): Promise<string> {
  if (env.nodeId) {
    const rows = await db.select().from(nodes).where(eq(nodes.id, env.nodeId)).limit(1);
    const ph = rows[0]?.publicHost;
    if (ph && ph.trim()) return ph.trim();
  }
  return SFTP_HOST;
}

function toSftpConfig(cfg: SftpConfigRow, host: string): SftpConfig {
  const hasPassword = !!cfg.passwordHash;
  const notes: string[] = [];
  if (!cfg.enabled) {
    notes.push("Ligue o SFTP e gere uma senha para transferir arquivos.");
  } else if (!hasPassword) {
    notes.push("O SFTP está ligado, mas nenhuma senha foi gerada ainda — gere uma senha para conectar.");
  } else {
    notes.push(`Conecte com: sftp -P ${cfg.port} ${cfg.username}@${host}`);
  }
  return {
    envId: cfg.envId,
    enabled: cfg.enabled,
    username: cfg.username,
    host,
    port: cfg.port,
    hasPassword,
    passwordSetAt: cfg.passwordSetAt ? cfg.passwordSetAt.toISOString() : null,
    gatewayActive: true,
    message: notes.join(" "),
  };
}

/** Senha aleatória forte (>= 24 chars, base64url sem viés). */
function generatePassword(): string {
  return randomBytes(18).toString("base64url"); // 18 bytes -> 24 chars
}

export async function sftpRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // GET /environments/:id/sftp — configuração de acesso SFTP do ambiente.
  app.get(
    "/environments/:id/sftp",
    {
      schema: {
        params: idParams,
        response: { 200: sftpConfigSchema, 401: apiError, 403: apiError, 404: apiError },
      },
    },
    async (req): Promise<SftpConfig> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const cfg = await loadOrCreateSftpConfig(env);
      const host = await resolveSftpHost(env);
      return toSftpConfig(cfg, host);
    },
  );

  // PUT /environments/:id/sftp — liga/desliga o SFTP.
  app.put(
    "/environments/:id/sftp",
    {
      schema: {
        params: idParams,
        body: setSftpEnabledInput,
        response: { 200: sftpConfigSchema, 401: apiError, 403: apiError, 404: apiError },
      },
    },
    async (req): Promise<SftpConfig> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      await loadOrCreateSftpConfig(env);
      const updated = await db
        .update(sftpConfigs)
        .set({ enabled: req.body.enabled })
        .where(eq(sftpConfigs.envId, env.id))
        .returning();
      const cfg = updated[0];
      if (!cfg) throw new ApiHttpError(500, "internal_error", "falha ao salvar configuração de SFTP");
      const host = await resolveSftpHost(env);
      return toSftpConfig(cfg, host);
    },
  );

  // POST /environments/:id/sftp/password — gera (ou reseta) a senha do SFTP.
  // A senha é SEMPRE aleatória e volta em texto UMA única vez (guardamos só o
  // hash). no-store para não cachear a resposta com a senha.
  app.post(
    "/environments/:id/sftp/password",
    {
      schema: {
        params: idParams,
        response: {
          200: generatedSftpPasswordSchema,
          401: apiError,
          403: apiError,
          404: apiError,
        },
      },
    },
    async (req, reply): Promise<GeneratedSftpPassword> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      await loadOrCreateSftpConfig(env);

      reply.header("cache-control", "no-store");
      reply.header("pragma", "no-cache");

      const password = generatePassword();
      const passwordHash = await hashPassword(password);
      const now = new Date();
      // Gerar senha liga o SFTP automaticamente (senão o cliente gera e não usa).
      const updated = await db
        .update(sftpConfigs)
        .set({ passwordHash, passwordSetAt: now, enabled: true })
        .where(eq(sftpConfigs.envId, env.id))
        .returning();
      if (!updated[0]) throw new ApiHttpError(500, "internal_error", "falha ao salvar a senha");

      // A senha em texto sai só aqui, uma vez. Nunca é persistida nem logada.
      return { password, passwordSetAt: now.toISOString() };
    },
  );
}
