import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  sshConfig as sshConfigSchema,
  sshKey as sshKeySchema,
  addSshKeyInput,
  updateSshConfigInput,
  apiError,
} from "@velozplanel/contracts";
import type { SshConfig, SshKey, SshAuthMode, SshAccessScope } from "@velozplanel/contracts";
import { db } from "../db/client";
import { sshConfigs, sshKeys } from "../db/schema";
import type { SshConfigRow, SshKeyRow, EnvironmentRow } from "../db/schema";
import { ApiHttpError, requireUser } from "../auth";
import { loadEnvironmentForUser } from "./environments";

const idParams = z.object({ id: z.string().uuid() });
const keyParams = z.object({ id: z.string().uuid(), keyId: z.string().uuid() });

/**
 * Host público do gateway SSH/SFTP. No núcleo local não há gateway aceitando
 * conexão — este valor é só o dado de conexão que o cliente verá quando o
 * gateway for provisionado (fase de infra/borda, como o SSL).
 */
const SSH_HOST = process.env.VP_SSH_HOST ?? "localhost";
const SSH_PORT = 2222;

/** Tipos de chave pública SSH aceitos (algoritmo no 1º campo da linha). */
const ALLOWED_KEY_TYPES = [
  "ssh-ed25519",
  "ssh-rsa",
  "ssh-dss",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "sk-ssh-ed25519@openssh.com",
  "sk-ecdsa-sha2-nistp256@openssh.com",
];

function isAllowedKeyType(type: string): boolean {
  if (ALLOWED_KEY_TYPES.includes(type)) return true;
  // cobre ecdsa-sha2-* e sk-* futuros/variantes
  return type.startsWith("ecdsa-sha2-") || type.startsWith("sk-");
}

/**
 * Valida uma linha de chave pública SSH e calcula o fingerprint no formato
 * OpenSSH `SHA256:<base64 sem padding do sha256 do blob binário da chave>`.
 *
 * O 2º campo é o blob base64; ele codifica, em ordem, a string do algoritmo
 * (length-prefixed, uint32 big-endian). Conferimos que essa string bate com o
 * 1º campo — isso rejeita blob corrompido/aleatório de forma robusta.
 *
 * Segurança: aceitamos SOMENTE chave PÚBLICA. Se a linha contiver marcadores
 * de chave privada, rejeitamos explicitamente.
 */
function parseAndFingerprint(
  publicKey: string,
): { ok: true; fingerprint: string; normalized: string } | { ok: false; reason: string } {
  const line = publicKey.trim();
  if (/-----BEGIN[\s\S]*PRIVATE KEY-----/i.test(line) || /PRIVATE KEY/i.test(line)) {
    return { ok: false, reason: "isso parece uma chave PRIVADA; cole apenas a chave PÚBLICA" };
  }

  const parts = line.split(/\s+/);
  const type = parts[0] ?? "";
  const blob = parts[1] ?? "";
  if (!type || !blob) {
    return {
      ok: false,
      reason: "formato inválido; use a linha completa, ex.: \"ssh-ed25519 AAAA... comentário\"",
    };
  }
  if (!isAllowedKeyType(type)) {
    return { ok: false, reason: `tipo de chave não suportado: ${type}` };
  }
  // base64 estrito (sem espaços internos; o split já separou).
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(blob)) {
    return { ok: false, reason: "o blob da chave não é base64 válido" };
  }

  let raw: Buffer;
  try {
    raw = Buffer.from(blob, "base64");
  } catch {
    return { ok: false, reason: "o blob da chave não é base64 válido" };
  }
  if (raw.length < 4) {
    return { ok: false, reason: "o blob da chave é muito curto" };
  }

  // Lê a 1ª string length-prefixed (uint32 BE + bytes) = nome do algoritmo.
  const algoLen = raw.readUInt32BE(0);
  if (algoLen <= 0 || algoLen + 4 > raw.length) {
    return { ok: false, reason: "o blob da chave está malformado" };
  }
  const algoInBlob = raw.subarray(4, 4 + algoLen).toString("ascii");
  if (algoInBlob !== type) {
    return {
      ok: false,
      reason: `o tipo (${type}) não corresponde ao conteúdo da chave (${algoInBlob})`,
    };
  }

  const digest = createHash("sha256").update(raw).digest("base64").replace(/=+$/, "");
  const normalized = parts.length > 2 ? `${type} ${blob} ${parts.slice(2).join(" ")}` : `${type} ${blob}`;
  return { ok: true, fingerprint: `SHA256:${digest}`, normalized };
}

function toSshKey(r: SshKeyRow): SshKey {
  return {
    id: r.id,
    label: r.label,
    fingerprint: r.fingerprint,
    publicKey: r.publicKey,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Carrega a linha `ssh_configs` do ambiente; se não existir, cria com o
 * username derivado do id do ambiente. PK = env_id (1:1 com o ambiente).
 * Usa onConflictDoNothing + reload para tolerar corrida entre requisições.
 */
async function loadOrCreateSshConfig(env: EnvironmentRow): Promise<SshConfigRow> {
  const rows = await db.select().from(sshConfigs).where(eq(sshConfigs.envId, env.id)).limit(1);
  const existing = rows[0];
  if (existing) return existing;

  // username honesto e estável: env_<8 primeiros hex do id do ambiente>.
  const username = `env_${env.id.replace(/-/g, "").slice(0, 8)}`;
  const inserted = await db
    .insert(sshConfigs)
    .values({ envId: env.id, username, port: SSH_PORT })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];

  const again = await db.select().from(sshConfigs).where(eq(sshConfigs.envId, env.id)).limit(1);
  if (again[0]) return again[0];
  throw new ApiHttpError(500, "internal_error", "falha ao carregar configuração de SSH");
}

/**
 * Monta o `sshConfig` do contrato a partir da linha de config + das chaves,
 * escolhendo uma `message` HONESTA. `gatewayActive` é sempre false no núcleo:
 * o gateway SSH/SFTP que TERMINA a conexão ainda não roda; ele ativa na fase
 * de infra/borda (como o SSL). Nunca afirmamos que já há SSH aceitando conexão.
 */
function toSshConfig(cfg: SshConfigRow, keys: SshKeyRow[]): SshConfig {
  const authMode = cfg.authMode as SshAuthMode;
  const accessScope = cfg.accessScope as SshAccessScope;
  const keyRequired = authMode === "key" || authMode === "both";

  const notes: string[] = [];
  if (cfg.enabled && keyRequired && keys.length === 0) {
    notes.push(
      "O modo de autenticação exige chave, mas nenhuma chave pública foi adicionada ainda — adicione uma chave para poder conectar.",
    );
  }
  notes.push(
    "A configuração fica salva. O acesso SSH/SFTP passa a valer quando o gateway SSH for provisionado (fase de infra) — no núcleo local ainda não há gateway aceitando conexão.",
  );

  return {
    envId: cfg.envId,
    enabled: cfg.enabled,
    username: cfg.username,
    host: SSH_HOST,
    port: cfg.port,
    authMode,
    accessScope,
    allowlist: Array.isArray(cfg.allowlist) ? (cfg.allowlist as string[]) : [],
    keys: keys.map(toSshKey),
    gatewayActive: false,
    message: notes.join(" "),
  };
}

async function loadKeys(envId: string): Promise<SshKeyRow[]> {
  return db.select().from(sshKeys).where(eq(sshKeys.envId, envId));
}

export async function sshRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // GET /environments/:id/ssh — configuração honesta de acesso SSH do ambiente.
  app.get(
    "/environments/:id/ssh",
    {
      schema: {
        params: idParams,
        response: { 200: sshConfigSchema, 401: apiError, 403: apiError, 404: apiError },
      },
    },
    async (req): Promise<SshConfig> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const cfg = await loadOrCreateSshConfig(env);
      const keys = await loadKeys(env.id);
      return toSshConfig(cfg, keys);
    },
  );

  // PUT /environments/:id/ssh — grava enabled/authMode/accessScope/allowlist.
  app.put(
    "/environments/:id/ssh",
    {
      schema: {
        params: idParams,
        body: updateSshConfigInput,
        response: { 200: sshConfigSchema, 401: apiError, 403: apiError, 404: apiError },
      },
    },
    async (req): Promise<SshConfig> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      await loadOrCreateSshConfig(env); // garante a linha antes do update
      const updated = await db
        .update(sshConfigs)
        .set({
          enabled: req.body.enabled,
          authMode: req.body.authMode,
          accessScope: req.body.accessScope,
          allowlist: req.body.allowlist,
        })
        .where(eq(sshConfigs.envId, env.id))
        .returning();
      const cfg = updated[0];
      if (!cfg) throw new ApiHttpError(500, "internal_error", "falha ao salvar configuração de SSH");
      const keys = await loadKeys(env.id);
      return toSshConfig(cfg, keys);
    },
  );

  // POST /environments/:id/ssh/keys — adiciona uma chave pública autorizada.
  // Valida o formato, calcula o fingerprint SHA256 e rejeita chave duplicada.
  app.post(
    "/environments/:id/ssh/keys",
    {
      schema: {
        params: idParams,
        body: addSshKeyInput,
        response: {
          200: sshKeySchema,
          400: apiError,
          401: apiError,
          403: apiError,
          404: apiError,
          409: apiError,
        },
      },
    },
    async (req): Promise<SshKey> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      await loadOrCreateSshConfig(env);

      const parsed = parseAndFingerprint(req.body.publicKey);
      if (!parsed.ok) {
        throw new ApiHttpError(400, "invalid_key", `chave pública inválida: ${parsed.reason}`);
      }

      // Duplicidade: mesma fingerprint já cadastrada neste ambiente.
      const dup = await db
        .select()
        .from(sshKeys)
        .where(and(eq(sshKeys.envId, env.id), eq(sshKeys.fingerprint, parsed.fingerprint)))
        .limit(1);
      if (dup[0]) {
        throw new ApiHttpError(409, "duplicate_key", "esta chave já está cadastrada neste ambiente");
      }

      const inserted = await db
        .insert(sshKeys)
        .values({
          envId: env.id,
          label: req.body.label,
          publicKey: parsed.normalized,
          fingerprint: parsed.fingerprint,
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new ApiHttpError(500, "internal_error", "falha ao salvar a chave");
      return toSshKey(row);
    },
  );

  // DELETE /environments/:id/ssh/keys/:keyId — remove uma chave do ambiente.
  app.delete(
    "/environments/:id/ssh/keys/:keyId",
    {
      schema: {
        params: keyParams,
        response: { 204: z.null(), 401: apiError, 403: apiError, 404: apiError },
      },
    },
    async (req, reply) => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const deleted = await db
        .delete(sshKeys)
        .where(and(eq(sshKeys.id, req.params.keyId), eq(sshKeys.envId, env.id)))
        .returning();
      if (!deleted[0]) throw new ApiHttpError(404, "not_found", "chave não encontrada neste ambiente");
      return reply.status(204).send(null);
    },
  );
}
