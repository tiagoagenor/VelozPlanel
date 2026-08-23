import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { plan as planSchema, balance as balanceSchema, envType as envTypeSchema, regionOption as regionOptionSchema, apiError } from "@velozplanel/contracts";
import type { Plan, Balance, EnvType, RegionOption } from "@velozplanel/contracts";
import { requireUser } from "../auth";
import { db } from "../db/client";
import { creditTransactions, environments, envTypes, nodes, dnsZonesMeta } from "../db/schema";
import { listPlans, rowToPlan, getPlan } from "../plans";
import { breakdownCredits } from "../credits";
import { getSettings } from "../billing";

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

  // Regiões disponíveis para criar ambiente (com aviso opcional da máquina).
  app.get(
    "/regions",
    { schema: { response: { 200: z.array(regionOptionSchema), 401: apiError } } },
    async (req): Promise<RegionOption[]> => {
      await requireUser(req);
      const rows = await db.select().from(nodes);
      const byRegion = new Map<string, RegionOption>();
      for (const n of rows) {
        const cur = byRegion.get(n.region) ?? { region: n.region, alert: null, online: false };
        if (!cur.alert && n.alertMessage) cur.alert = n.alertMessage;
        if (n.status === "online" && n.agentUrl && n.agentUrl.trim()) cur.online = true;
        byRegion.set(n.region, cur);
      }
      return [...byRegion.values()].sort((a, b) => a.region.localeCompare(b.region));
    },
  );

  // Tipos de ambiente ATIVOS (para o wizard de criação) — com preço por tipo.
  app.get(
    "/env-types",
    { schema: { response: { 200: z.array(envTypeSchema), 401: apiError } } },
    async (req): Promise<EnvType[]> => {
      await requireUser(req);
      const rows = await db.select().from(envTypes).where(eq(envTypes.active, true)).orderBy(envTypes.sortOrder);
      return rows.map((r) => ({
        id: r.id,
        label: r.label,
        category: r.category as EnvType["category"],
        image: r.image,
        internalPort: r.internalPort,
        dataPath: r.dataPath,
        needsDb: r.needsDb,
        childType: r.childType,
        defaultTool: r.defaultTool as EnvType["defaultTool"],
        allowsPublicDomain: r.allowsPublicDomain,
        priceMonthCents: r.priceMonthCents,
        minVcpu: r.minVcpu,
        minMemMb: r.minMemMb,
        active: r.active,
        sortOrder: r.sortOrder,
      }));
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
      const bal = breakdownCredits(rows);
      const balanceCents = bal.totalCents;

      // Gasto mensal estimado: soma o preço do plano de cada ambiente ATIVO (running).
      // O banco-filho de uma stack (parentEnvId != null) NÃO conta — vai junto do
      // container principal, não dobra. Sem máquina ativa → gasto 0 → estimativa nula.
      const envs = await db
        .select()
        .from(environments)
        .where(eq(environments.ownerId, user.id));
      let monthlyBurnCents = 0;
      for (const env of envs) {
        if (env.state !== "running" || env.parentEnvId) continue;
        const plan = await getPlan(env.plan);
        if (plan) monthlyBurnCents += plan.priceMonthCents;
      }
      // Taxa de gerência dos domínios do cliente.
      const myDomains = await db.select().from(dnsZonesMeta).where(eq(dnsZonesMeta.ownerId, user.id));
      if (myDomains.length) {
        const settings = await getSettings();
        monthlyBurnCents += myDomains.length * (settings.domainPriceMonthCents ?? 100);
      }
      const estimateMonths =
        monthlyBurnCents > 0 && balanceCents > 0 ? balanceCents / monthlyBurnCents : null;

      return {
        balanceCents,
        moneyCents: bal.moneyCents,
        bonusCents: bal.bonusCents,
        monthlyBurnCents,
        estimateMonths,
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
