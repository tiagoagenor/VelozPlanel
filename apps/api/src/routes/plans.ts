import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { plan as planSchema, balance as balanceSchema, apiError } from "@velozplanel/contracts";
import type { Plan, Balance } from "@velozplanel/contracts";
import { requireUser } from "../auth";
import { db } from "../db/client";
import { creditTransactions } from "../db/schema";
import { listPlans, rowToPlan } from "../plans";

/** Planos ativos (para criar ambiente) + saldo do próprio cliente. */
export async function plansRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/plans",
    { schema: { response: { 200: z.array(planSchema), 401: apiError } } },
    async (req): Promise<Plan[]> => {
      await requireUser(req);
      const rows = await listPlans(true);
      return rows.map(rowToPlan);
    },
  );

  // Saldo do próprio usuário (painel do cliente).
  app.get(
    "/balance",
    { schema: { response: { 200: balanceSchema, 401: apiError } } },
    async (req): Promise<Balance> => {
      const user = await requireUser(req);
      const rows = await db
        .select()
        .from(creditTransactions)
        .where(eq(creditTransactions.userId, user.id))
        .orderBy(desc(creditTransactions.createdAt));
      const balanceCents = rows.reduce((s, r) => s + r.amountCents, 0);
      return {
        balanceCents,
        transactions: rows.map((r) => ({
          id: r.id,
          userId: r.userId,
          amountCents: r.amountCents,
          kind: r.kind,
          reason: r.reason,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  );
}
