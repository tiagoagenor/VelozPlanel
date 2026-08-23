import type { FastifyReply, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import type { SessionUser, UserRole } from "@velozplanel/contracts";
import { db } from "./db/client";
import { users } from "./db/schema";

const JWT_SECRET = process.env.VP_JWT_SECRET ?? "dev-secret";
export const SESSION_COOKIE = "vp_session";
const SESSION_MAX_AGE_S = 60 * 60 * 24 * 7; // 7 dias
// Em produção (HTTPS) o cookie deve ir com Secure. Ligado por VP_COOKIE_SECURE=1.
const COOKIE_SECURE =
  process.env.VP_COOKIE_SECURE === "1" || process.env.VP_COOKIE_SECURE === "true";

/** Erro HTTP padronizado (formato `apiError` do contracts). */
export class ApiHttpError extends Error {
  constructor(
    public statusCode: number,
    public errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiHttpError";
  }
}

/* ─────────────── Senhas ─────────────── */

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

/* ─────────────── JWT ─────────────── */

interface TokenPayload {
  sub: string;
  role: UserRole;
}

export function signSession(user: { id: string; role: UserRole }): string {
  return jwt.sign({ role: user.role }, JWT_SECRET, {
    subject: user.id,
    expiresIn: SESSION_MAX_AGE_S,
  });
}

export function verifySessionToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, JWT_SECRET);
  if (typeof decoded === "string" || !decoded.sub) {
    throw new ApiHttpError(401, "unauthorized", "sessão inválida");
  }
  return { sub: String(decoded.sub), role: decoded.role as UserRole };
}

/* ─────────────── Cookie de sessão ─────────────── */

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: COOKIE_SECURE, // true em produção (HTTPS) via VP_COOKIE_SECURE=1
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/", secure: COOKIE_SECURE });
}

/* ─────────────── Guards ─────────────── */

/** Lê o cookie, valida o JWT e carrega o usuário. Lança 401 se algo falhar. */
export async function requireUser(req: FastifyRequest): Promise<SessionUser> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) throw new ApiHttpError(401, "unauthorized", "sessão ausente");

  let payload: TokenPayload;
  try {
    payload = verifySessionToken(token);
  } catch {
    throw new ApiHttpError(401, "unauthorized", "sessão inválida");
  }

  const rows = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
  const u = rows[0];
  if (!u) throw new ApiHttpError(401, "unauthorized", "usuário não encontrado");

  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role as UserRole,
  };
}

/** Igual a `requireUser`, mas exige role admin (403 caso contrário). */
export async function requireAdmin(req: FastifyRequest): Promise<SessionUser> {
  const user = await requireUser(req);
  if (user.role !== "admin") {
    throw new ApiHttpError(403, "forbidden", "acesso restrito a administradores");
  }
  return user;
}
