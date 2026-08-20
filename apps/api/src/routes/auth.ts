import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { eq } from "drizzle-orm";
import { loginInput, sessionUser, apiError } from "@velozplanel/contracts";
import type { UserRole } from "@velozplanel/contracts";
import { db } from "../db/client";
import { users } from "../db/schema";
import {
  ApiHttpError,
  verifyPassword,
  signSession,
  setSessionCookie,
  clearSessionCookie,
  requireUser,
} from "../auth";

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/auth/login",
    {
      schema: {
        body: loginInput,
        response: { 200: sessionUser, 401: apiError },
      },
    },
    async (req, reply) => {
      const { email, password } = req.body;
      const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
      const u = rows[0];
      if (!u || !(await verifyPassword(password, u.passwordHash))) {
        throw new ApiHttpError(401, "invalid_credentials", "email ou senha inválidos");
      }
      const role = u.role as UserRole;
      const token = signSession({ id: u.id, role });
      setSessionCookie(reply, token);
      return { id: u.id, email: u.email, name: u.name, role };
    },
  );

  app.post("/auth/logout", async (_req, reply) => {
    clearSessionCookie(reply);
    return reply.status(204).send();
  });

  app.get(
    "/auth/me",
    { schema: { response: { 200: sessionUser, 401: apiError } } },
    async (req) => {
      return requireUser(req);
    },
  );
}
