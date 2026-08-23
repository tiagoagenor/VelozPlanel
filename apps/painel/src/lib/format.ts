import {
  hourlyActiveCents,
  hourlyPausedCents,
  type PlanSpec,
} from "@velozplanel/contracts";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const brl4 = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

/** Centavos → "R$ 30,50". */
export function formatCents(cents: number): string {
  return brl.format(cents / 100);
}

/** Centavos → "R$ 0,0424" (para tarifas horárias pequenas). */
export function formatCentsFine(cents: number): string {
  return brl4.format(cents / 100);
}

/** Centavos → "+R$ 30,50" / "−R$ 30,50" (com sinal explícito). */
export function formatSignedCents(cents: number): string {
  const sign = cents < 0 ? "−" : "+";
  return `${sign}${brl.format(Math.abs(cents) / 100)}`;
}

/**
 * Texto de um campo de preço em R$ ("30,50", "R$ 30,50", "1.234,56") →
 * centavos inteiros. Retorna null se não for um número válido.
 */
export function parseReaisToCents(input: string): number | null {
  const cleaned = input
    .replace(/[R$\s ]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  if (cleaned === "" || cleaned === "-") return null;
  const reais = Number(cleaned);
  if (!Number.isFinite(reais)) return null;
  return Math.round(reais * 100);
}

/** Centavos → "30,50" (sem símbolo, para popular um campo de edição). */
export function centsToReaisInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/** Tarifa horária ativa (centavos/hora) derivada do preço mensal (720 h). */
export function hourlyActiveFromMonthly(priceMonthCents: number): number {
  return priceMonthCents / 720;
}

/** Preço mensal do plano formatado. */
export function planMonthly(plan: PlanSpec): string {
  return formatCents(plan.priceMonthCents);
}

/** Tarifa por hora (ativo) formatada. */
export function planHourly(plan: PlanSpec): string {
  return formatCentsFine(hourlyActiveCents(plan));
}

/** Tarifa por hora (pausado, só disco) formatada. */
export function planHourlyPaused(plan: PlanSpec): string {
  return formatCentsFine(hourlyPausedCents(plan));
}

/** Bytes → "512 MB" / "1,5 GB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  const nf = new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: value < 10 && i > 1 ? 1 : 0,
  });
  return `${nf.format(value)} ${units[i]}`;
}

/** ISO → data/hora local pt-BR. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}

/**
 * Estimativa de duração do saldo → texto amigável.
 * null = sem máquina ativa (não está gastando) → "—".
 */
export function formatEstimate(months: number | null): string {
  if (months == null || !isFinite(months) || months <= 0) return "—";
  if (months >= 1) {
    const m = Math.floor(months);
    return `${m} ${m === 1 ? "mês" : "meses"}`;
  }
  const days = Math.max(1, Math.round(months * 30));
  return `${days} ${days === 1 ? "dia" : "dias"}`;
}
