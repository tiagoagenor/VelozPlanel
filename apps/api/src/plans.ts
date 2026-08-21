import { eq, asc } from "drizzle-orm";
import { db } from "./db/client";
import { plans } from "./db/schema";
import type { PlanRow } from "./db/schema";
import type { Plan, PlanSpec } from "@velozplanel/contracts";

export function rowToPlan(p: PlanRow): Plan {
  return {
    id: p.id,
    label: p.label,
    vcpu: p.vcpu,
    memMb: p.memMb,
    diskGb: p.diskGb,
    priceMonthCents: p.priceMonthCents,
    maxEnvironments: p.maxEnvironments,
    active: p.active,
  };
}

/** Um plano pelo id (slug), ou undefined. */
export async function getPlan(id: string): Promise<PlanRow | undefined> {
  const rows = await db.select().from(plans).where(eq(plans.id, id)).limit(1);
  return rows[0];
}

/** Limites (vcpu/memMb/diskGb) de um plano — lança se não existir. */
export async function planLimits(id: string): Promise<PlanSpec> {
  const p = await getPlan(id);
  if (!p) throw new Error(`plano desconhecido: ${id}`);
  return { id: p.id, label: p.label, vcpu: p.vcpu, memMb: p.memMb, diskGb: p.diskGb, priceMonthCents: p.priceMonthCents, maxEnvironments: p.maxEnvironments };
}

export async function listPlans(activeOnly = false): Promise<PlanRow[]> {
  const rows = await db.select().from(plans).orderBy(asc(plans.sortOrder), asc(plans.id));
  return activeOnly ? rows.filter((p) => p.active) : rows;
}
