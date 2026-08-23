import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

/**
 * Cifra de segredos em repouso (variáveis de ambiente). AES-256-GCM autenticado.
 * A chave vem de VP_ENV_SECRET (env da API, FORA do host do banco). Em produção
 * é obrigatória — fail-closed; em dev cai para um valor fixo (como VP_JWT_SECRET).
 * Formato: "v1:" + base64(iv[12] | tag[16] | ciphertext). O prefixo permite rotação.
 */
function loadKey(): Buffer {
  const secret = process.env.VP_ENV_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("VP_ENV_SECRET ausente em produção — recusando cifrar/decifrar segredos");
    }
    return createHash("sha256").update("dev-env-secret").digest();
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const key = loadKey();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return "v1:" + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function decryptSecret(stored: string): string {
  const key = loadKey();
  const b = Buffer.from(stored.replace(/^v1:/, ""), "base64");
  const d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}
