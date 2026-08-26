/**
 * Subdomínio temporário <sub>.jamees.top de cada ambiente.
 * Gera um aleatório curto (base32 sem ambíguos) único e não-reservado.
 */
import { sql } from "drizzle-orm";
import { slugify } from "@velozplanel/contracts";
import { db } from "./db/client";
import { environments, reservedSubdomains, envTools } from "./db/schema";

const CHARS = "abcdefghjkmnpqrstuvwxyz23456789"; // sem i/l/o/0/1

function randStr(len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)]!;
  return s;
}

export async function isSubReserved(sub: string): Promise<boolean> {
  const rows = await db.select({ name: reservedSubdomains.name }).from(reservedSubdomains).where(sql`lower(name) = ${sub.toLowerCase()}`);
  return rows.length > 0;
}

export async function isSubTaken(sub: string, exceptEnvId?: string): Promise<boolean> {
  const rows = await db.select({ id: environments.id }).from(environments).where(sql`lower(auto_subdomain) = ${sub.toLowerCase()}`);
  if (rows.some((r) => r.id !== exceptEnvId)) return true;
  // Painéis de serviço (env_tools.subdomain) vivem na MESMA zona jamees.top — evita colisão.
  const tools = await db.select({ id: envTools.id }).from(envTools).where(sql`lower(subdomain) = ${sub.toLowerCase()}`);
  return tools.length > 0;
}

/** Gera um subdomínio novo (7 chars; 8 após várias colisões), livre e não-reservado. */
export async function generateSubdomain(len = 7): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const sub = randStr(attempt >= 5 ? len + 1 : len);
    if (await isSubReserved(sub)) continue;
    if (await isSubTaken(sub)) continue;
    return sub;
  }
  return randStr(10); // fallback praticamente impossível de alcançar
}

/**
 * Subdomínio a partir do NOME do ambiente (ex.: "Meu Site" → meu-site). Se o slug
 * for curto/vazio, reservado ou já em uso, adiciona um sufixo aleatório; se ainda
 * assim não der, cai no aleatório puro. Garante 3–30 chars válidos.
 */
export async function subdomainFromName(name: string): Promise<string> {
  const base = slugify(name).slice(0, 24).replace(/-+$/g, "");
  if (base.length < 3) return generateSubdomain();
  if (!(await isSubReserved(base)) && !(await isSubTaken(base))) return base;
  for (let attempt = 0; attempt < 6; attempt++) {
    const cand = `${base}-${randStr(4)}`;
    if (await isSubReserved(cand)) continue;
    if (await isSubTaken(cand)) continue;
    return cand;
  }
  return generateSubdomain();
}
