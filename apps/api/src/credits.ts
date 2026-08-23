/**
 * Razão de créditos por usuário. Saldo GASTÁVEL = dinheiro + bônus = soma de
 * todos os lançamentos (amount_cents). O `kind` só distingue a ORIGEM:
 *   admin_money / admin_credit (legado) = dinheiro   ·   admin_bonus = bônus/cortesia
 *   admin_debit / billing_* (negativos) = consumo/estorno
 */
import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { creditTransactions } from "./db/schema";

const BONUS_KINDS = new Set(["admin_bonus"]);

export interface BalanceBreakdown {
  /** Saldo total gastável (dinheiro + bônus). */
  totalCents: number;
  /** Parte concedida como bônus. */
  bonusCents: number;
  /** Parte que é dinheiro (total − bônus). */
  moneyCents: number;
}

export function breakdownCredits(rows: { amountCents: number; kind: string }[]): BalanceBreakdown {
  let totalCents = 0;
  let bonusCents = 0;
  for (const r of rows) {
    totalCents += r.amountCents;
    if (BONUS_KINDS.has(r.kind) && r.amountCents > 0) bonusCents += r.amountCents;
  }
  // Bônus exibido nunca passa do saldo total (débitos consomem o bônus por último).
  bonusCents = Math.max(0, Math.min(bonusCents, totalCents));
  return { totalCents, bonusCents, moneyCents: totalCents - bonusCents };
}

/** Saldo detalhado (dinheiro/bônus) de um usuário. */
export async function balanceBreakdown(userId: string): Promise<BalanceBreakdown> {
  const rows = await db
    .select({ amountCents: creditTransactions.amountCents, kind: creditTransactions.kind })
    .from(creditTransactions)
    .where(eq(creditTransactions.userId, userId));
  return breakdownCredits(rows);
}

/** Saldo total gastável (dinheiro + bônus), em centavos. */
export async function balanceCents(userId: string): Promise<number> {
  return (await balanceBreakdown(userId)).totalCents;
}

/** Saldo detalhado de TODOS os usuários, de uma vez (para listagens do admin). */
export async function balanceBreakdownByUser(): Promise<Map<string, BalanceBreakdown>> {
  const rows = await db
    .select({ userId: creditTransactions.userId, amountCents: creditTransactions.amountCents, kind: creditTransactions.kind })
    .from(creditTransactions);
  const byUser = new Map<string, { amountCents: number; kind: string }[]>();
  for (const r of rows) {
    const arr = byUser.get(r.userId) ?? [];
    arr.push({ amountCents: r.amountCents, kind: r.kind });
    byUser.set(r.userId, arr);
  }
  const out = new Map<string, BalanceBreakdown>();
  for (const [uid, arr] of byUser) out.set(uid, breakdownCredits(arr));
  return out;
}
