import { eq, inArray, gte, and, lt, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { db } from "./db/client";
import {
  environments,
  creditTransactions,
  platformSettings,
  auditLogs,
  envTypes,
  dnsZonesMeta,
  billingRunHours,
} from "./db/schema";
import type { PlatformSettingsRow } from "./db/schema";
import { getPlan } from "./plans";
import * as agent from "./agent";
import { agentUrlForEnv } from "./nodes";

/** Estado do job em memória (para status na UI). */
let running = false;
let lastResult: { at: string; chargedCents: number; envsCharged: number; suspended: number } | null =
  null;

export function billingStatus(): { running: boolean; last: typeof lastResult } {
  return { running, last: lastResult };
}

/** Carrega (ou cria) a linha única de configurações. */
export async function getSettings(): Promise<PlatformSettingsRow> {
  const rows = await db.select().from(platformSettings).where(eq(platformSettings.id, 1)).limit(1);
  if (rows[0]) return rows[0];
  await db.insert(platformSettings).values({ id: 1 }).onConflictDoNothing();
  const again = await db.select().from(platformSettings).where(eq(platformSettings.id, 1)).limit(1);
  return again[0]!;
}

/** Saldo total (soma do razão) de um usuário — agregado no banco (usa o índice). */
async function balanceOf(userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${creditTransactions.amountCents}), 0)::int` })
    .from(creditTransactions)
    .where(eq(creditTransactions.userId, userId));
  return row?.total ?? 0;
}

/**
 * Executa uma rodada de cobrança: debita cada ambiente ativo/pausado pela
 * tarifa do plano × tempo decorrido desde o último débito. Idempotente por
 * "relógio": só avança `last_charged_at` quando cobra ao menos 1 centavo, então
 * rodar cedo demais não cobra em dobro — acumula.
 */
export async function runBilling(log?: FastifyBaseLogger): Promise<{
  chargedCents: number;
  envsCharged: number;
  suspended: number;
}> {
  if (running) return { chargedCents: 0, envsCharged: 0, suspended: 0 };
  running = true;
  const now = new Date();
  let chargedCents = 0;
  let envsCharged = 0;
  let suspended = 0;
  let instances = 0; // total de ambientes cobráveis (roots em running/paused) — gauge
  let ok = true;
  const touchedOwners = new Set<string>();
  const settings = await getSettings();

  try {
    const envs = await db
      .select()
      .from(environments)
      .where(inArray(environments.state, ["running", "paused"]));

    // Modelo B: o PLANO é o preço de compute; o tipo carrega só um ADICIONAL
    // (priceMonthCents, default 0). Este mapa é o adicional por tipo.
    const typeRows = await db.select().from(envTypes);
    const typeAdder = new Map(typeRows.map((t) => [t.id, t.priceMonthCents]));
    const diskRateCents = settings.rateDiskGbMonthCents ?? 25;

    for (const env of envs) {
      // O banco-filho de uma stack (parentEnvId != null) NÃO é cobrado à parte:
      // vai junto do container principal (ex.: WordPress cobra 1×, o MySQL vai junto).
      if (env.parentEnvId) continue;
      instances++; // conta antes de qualquer continue por relógio/custo
      const since = env.lastChargedAt ?? env.createdAt;
      // Primeira vez: só inicia o relógio, sem cobrar retroativo.
      if (!env.lastChargedAt) {
        await db.update(environments).set({ lastChargedAt: now }).where(eq(environments.id, env.id));
        continue;
      }
      const elapsedMs = now.getTime() - since.getTime();
      if (elapsedMs <= 0) continue;

      const plan = await getPlan(env.plan);
      if (!plan) continue;
      const hours = elapsedMs / 3_600_000;
      // Ativo = (preço do plano + adicional do tipo) / 720. Pausado = só disco.
      const adder = (env.typeId ? typeAdder.get(env.typeId) : 0) ?? 0;
      const activeMonthCents = plan.priceMonthCents + adder;
      const ratePerHour =
        env.state === "running"
          ? activeMonthCents / 720
          : (plan.diskGb * diskRateCents) / 720;
      const cost = Math.round(hours * ratePerHour);
      if (cost < 1) continue; // acumula (não avança o relógio) até dar >= 1 centavo

      await db.insert(creditTransactions).values({
        userId: env.ownerId,
        amountCents: -cost,
        kind: "usage",
        reason: `${env.name} · ${env.state === "running" ? "ativo" : "pausado"} · ${hours.toFixed(2)}h`,
      });
      await db.update(environments).set({ lastChargedAt: now }).where(eq(environments.id, env.id));
      chargedCents += cost;
      envsCharged++;
      touchedOwners.add(env.ownerId);
    }

    // Taxa de gerência por DOMÍNIO do cliente (owner_id não nulo). Mesmo relógio.
    // Domínios do SISTEMA (owner nulo) não são cobrados.
    const domainMonthCents = settings.domainPriceMonthCents ?? 100;
    if (domainMonthCents > 0) {
      const zones = await db.select().from(dnsZonesMeta);
      for (const z of zones) {
        if (!z.ownerId) continue;
        const since = z.lastChargedAt ?? z.createdAt;
        if (!z.lastChargedAt) {
          await db.update(dnsZonesMeta).set({ lastChargedAt: now }).where(eq(dnsZonesMeta.zone, z.zone));
          continue;
        }
        const elapsedMs = now.getTime() - since.getTime();
        if (elapsedMs <= 0) continue;
        const hours = elapsedMs / 3_600_000;
        const cost = Math.round(hours * (domainMonthCents / 720));
        if (cost < 1) continue; // acumula até dar >= 1 centavo
        await db.insert(creditTransactions).values({
          userId: z.ownerId,
          amountCents: -cost,
          kind: "usage",
          reason: `Domínio ${z.zone} · gerência · ${hours.toFixed(2)}h`,
        });
        await db.update(dnsZonesMeta).set({ lastChargedAt: now }).where(eq(dnsZonesMeta.zone, z.zone));
        chargedCents += cost;
        touchedOwners.add(z.ownerId);
      }
    }

    // Inadimplência: se o saldo do dono zerou, pausa os ambientes rodando dele.
    if (settings.suspendOnZero) {
      for (const ownerId of touchedOwners) {
        const bal = await balanceOf(ownerId);
        if (bal > 0) continue;
        const toStop = await db
          .select()
          .from(environments)
          .where(eq(environments.ownerId, ownerId));
        for (const e of toStop) {
          if (e.state !== "running") continue;
          try {
            if (e.containerId) await agent.stop(await agentUrlForEnv(e), e.containerId);
          } catch {
            /* segue mesmo se o agente falhar */
          }
          await db.update(environments).set({ state: "paused" }).where(eq(environments.id, e.id));
          await db.insert(auditLogs).values({
            actorEmail: "system",
            actorRole: "system",
            action: "env.suspend_no_balance",
            target: e.name,
            detail: "saldo esgotado",
            ip: null,
          });
          suspended++;
        }
      }
    }
  } catch (err) {
    ok = false;
    log?.error({ err }, "billing run failed");
  } finally {
    running = false;
    lastResult = { at: now.toISOString(), chargedCents, envsCharged, suspended };
    // Persiste o resumo da última execução (sobrevive a restart) + rollup horário.
    try {
      await db
        .update(platformSettings)
        .set({
          billingLastRunFinishedAt: now,
          billingLastInstances: instances,
          billingLastSuspended: suspended,
          billingLastChargedCents: chargedCents,
          billingLastOk: ok,
        })
        .where(eq(platformSettings.id, 1));

      // Balde da hora (UTC, truncado por epoch — determinístico, imune ao TZ).
      const hour = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
      await db
        .insert(billingRunHours)
        .values({
          hour,
          runs: 1,
          chargedCents,
          chargeEvents: envsCharged,
          suspended,
          instances,
          errors: ok ? 0 : 1,
          firstRunAt: now,
          lastRunAt: now,
        })
        .onConflictDoUpdate({
          target: billingRunHours.hour,
          set: {
            runs: sql`${billingRunHours.runs} + 1`,
            chargedCents: sql`${billingRunHours.chargedCents} + ${chargedCents}`,
            chargeEvents: sql`${billingRunHours.chargeEvents} + ${envsCharged}`,
            suspended: sql`${billingRunHours.suspended} + ${suspended}`,
            instances, // snapshot da rodada mais recente (não soma)
            errors: sql`${billingRunHours.errors} + ${ok ? 0 : 1}`,
            lastRunAt: now, // first_run_at preservado de propósito
          },
        });

      // Retenção: mantém ~30 dias de histórico. Barato (PK btree); roda sempre.
      await db.delete(billingRunHours).where(lt(billingRunHours.hour, new Date(now.getTime() - 30 * 86_400_000)));
    } catch (err) {
      log?.error({ err }, "billing rollup persist failed");
    }
  }
  return { chargedCents, envsCharged, suspended };
}

/**
 * Acerto de cobrança ao DELETAR um ambiente: debita o tempo proporcional ainda
 * não faturado (desde `last_charged_at ?? created_at` até agora), com a mesma
 * taxa do cron (ativo = plano+adicional do tipo; pausado = disco). Fecha o buraco
 * do "criou e deletou antes do cron = grátis".
 *
 * CORTESIA (`billing_free_minutes`, default 1): se a VIDA TOTAL do ambiente
 * (`now - created_at`) for menor que X minutos, NÃO cobra (delete acidental).
 *
 * Deve ser chamado ANTES de mudar o estado para "deleting" (a taxa depende do
 * estado running/paused). Idempotente na prática: avança `last_charged_at`.
 * Devolve os centavos cobrados (0 se cortesia/sem custo). Nunca lança — o delete
 * não pode falhar por causa da cobrança.
 */
export async function settleEnvironment(envId: string, log?: FastifyBaseLogger): Promise<number> {
  try {
    const rows = await db.select().from(environments).where(eq(environments.id, envId)).limit(1);
    const env = rows[0];
    if (!env) return 0;
    // Filho de stack não é cobrado à parte (vai junto do principal).
    if (env.parentEnvId) return 0;
    // Só faz sentido acertar o que estava rodando/pausado (provisioning/erro nunca cobrou).
    if (env.state !== "running" && env.state !== "paused") return 0;

    const settings = await getSettings();
    if (!settings.billingEnabled) return 0; // cobrança automática desligada → não cobra no delete
    const now = new Date();
    const freeMinutes = settings.billingFreeMinutes ?? 1;
    const lifetimeMs = now.getTime() - env.createdAt.getTime();
    if (lifetimeMs < freeMinutes * 60_000) return 0; // cortesia

    const since = env.lastChargedAt ?? env.createdAt;
    const elapsedMs = now.getTime() - since.getTime();
    if (elapsedMs <= 0) return 0;

    const plan = await getPlan(env.plan);
    if (!plan) return 0;
    const diskRateCents = settings.rateDiskGbMonthCents ?? 25;
    let adder = 0;
    if (env.typeId) {
      const t = await db.select().from(envTypes).where(eq(envTypes.id, env.typeId)).limit(1);
      adder = t[0]?.priceMonthCents ?? 0;
    }
    const hours = elapsedMs / 3_600_000;
    const ratePerHour =
      env.state === "running" ? (plan.priceMonthCents + adder) / 720 : (plan.diskGb * diskRateCents) / 720;
    const cost = Math.round(hours * ratePerHour);
    if (cost < 1) return 0;

    await db.insert(creditTransactions).values({
      userId: env.ownerId,
      amountCents: -cost,
      kind: "usage",
      reason: `${env.name} · acerto ao deletar · ${hours.toFixed(2)}h`,
    });
    await db.update(environments).set({ lastChargedAt: now }).where(eq(environments.id, env.id));
    return cost;
  } catch (err) {
    log?.error({ err, envId }, "settleEnvironment falhou (delete segue mesmo assim)");
    return 0;
  }
}

/** Total debitado (usage) desde o início do dia (para o painel) — agregado no banco. */
export async function chargedTodayCents(): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(abs(${creditTransactions.amountCents})), 0)::int` })
    .from(creditTransactions)
    .where(and(gte(creditTransactions.createdAt, start), eq(creditTransactions.kind, "usage")));
  return row?.total ?? 0;
}

/** Últimas N horas do rollup de execuções (mais recente primeiro). */
export async function recentRunHours(limit = 72): Promise<import("./db/schema").BillingRunHourRow[]> {
  return db.select().from(billingRunHours).orderBy(sql`${billingRunHours.hour} DESC`).limit(limit);
}

/**
 * Agendador do cron de cobrança. Verifica a cada 30s se já passou o intervalo
 * configurado desde a última execução; se sim (e o billing estiver ligado),
 * roda. Ler o intervalo do banco a cada tick faz a mudança de config valer na hora.
 */
export function startBillingScheduler(log: FastifyBaseLogger): () => void {
  const tick = async (): Promise<void> => {
    try {
      const s = await getSettings();
      if (!s.billingEnabled) return;
      const last = s.billingLastRunAt ? s.billingLastRunAt.getTime() : 0;
      const dueMs = s.billingIntervalMinutes * 60_000;
      if (Date.now() - last < dueMs) return;
      await db.update(platformSettings).set({ billingLastRunAt: new Date() }).where(eq(platformSettings.id, 1));
      const res = await runBilling(log);
      log.info({ ...res }, "billing tick");
    } catch (err) {
      log.error({ err }, "billing scheduler tick failed");
    }
  };
  const handle = setInterval(() => void tick(), 30_000);
  log.info("agendador de cobrança iniciado (verifica a cada 30s)");
  return () => clearInterval(handle);
}
