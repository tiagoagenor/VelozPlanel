/**
 * Subdomínio temporário <sub>.jamees.top de cada ambiente.
 * Gera um aleatório curto (base32 sem ambíguos) único e não-reservado.
 */
import { sql } from "drizzle-orm";
import { db } from "./db/client";
import { environments, reservedSubdomains } from "./db/schema";

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
  return rows.some((r) => r.id !== exceptEnvId);
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
