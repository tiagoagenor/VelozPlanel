import { z } from "zod";

/**
 * Contratos compartilhados do VelozPlanel (fonte única de verdade).
 * API valida entrada/saída com estes schemas; painel e agente reusam os tipos.
 * Dinheiro sempre em centavos (bigint-safe: usamos number inteiro de centavos no núcleo).
 */

/* ─────────────── Runtimes (linguagem + versão) ─────────────── */

export const runtimeKind = z.enum(["php", "node"]);
export type RuntimeKind = z.infer<typeof runtimeKind>;

/** Versões oferecidas no núcleo. Novas entram sem tocar no core (catálogo). */
export const RUNTIME_VERSIONS: Record<RuntimeKind, string[]> = {
  php: ["8.3", "8.2", "8.1", "7.4"],
  node: ["22", "20", "18"],
};

export const runtimeSpec = z.object({
  kind: runtimeKind,
  version: z.string().min(1),
});
export type RuntimeSpec = z.infer<typeof runtimeSpec>;

/* ─────────────── Planos ─────────────── */

export const planId = z.enum(["start", "light", "plus", "pro"]);
export type PlanId = z.infer<typeof planId>;

export interface PlanSpec {
  id: PlanId;
  label: string;
  vcpu: number; // cota de CPU (1.0 = 1 vCPU)
  memMb: number; // teto de memória
  diskGb: number;
  priceMonthCents: number; // preço mensal ativo, em centavos
}

export const PLANS: Record<PlanId, PlanSpec> = {
  start: { id: "start", label: "Start", vcpu: 1, memMb: 512, diskGb: 10, priceMonthCents: 3050 },
  light: { id: "light", label: "Light", vcpu: 1.5, memMb: 1024, diskGb: 20, priceMonthCents: 4900 },
  plus: { id: "plus", label: "Plus", vcpu: 2, memMb: 2048, diskGb: 40, priceMonthCents: 9800 },
  pro: { id: "pro", label: "Pro", vcpu: 3, memMb: 4096, diskGb: 80, priceMonthCents: 17200 },
};

/** Tarifa horária ativa derivada do preço mensal (mês contábil = 720 h). */
export function hourlyActiveCents(plan: PlanSpec): number {
  return plan.priceMonthCents / 720;
}
/** Pausado cobra só disco: R$ 0,25/GB/mês. */
export function hourlyPausedCents(plan: PlanSpec): number {
  return (plan.diskGb * 25) / 720;
}

/* ─────────────── Estados do ambiente ─────────────── */

export const envState = z.enum([
  "provisioning",
  "running",
  "paused",
  "error",
  "deleting",
]);
export type EnvState = z.infer<typeof envState>;

/* ─────────────── Ambiente ─────────────── */

export const environment = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  ownerId: z.string().uuid(),
  nodeId: z.string().uuid().nullable(),
  plan: planId,
  runtime: runtimeSpec,
  state: envState,
  containerId: z.string().nullable(),
  httpPort: z.number().int().nullable(), // porta publicada no host de dev
  createdAt: z.string().datetime(),
});
export type Environment = z.infer<typeof environment>;

export const createEnvironmentInput = z.object({
  name: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "use apenas letras minúsculas, números e hífen"),
  plan: planId,
  runtime: runtimeSpec,
});
export type CreateEnvironmentInput = z.infer<typeof createEnvironmentInput>;

/* ─────────────── Nó ─────────────── */

export const nodeStatus = z.enum(["online", "degraded", "offline"]);
export type NodeStatus = z.infer<typeof nodeStatus>;

export const node = z.object({
  id: z.string().uuid(),
  name: z.string(),
  region: z.string(),
  status: nodeStatus,
  vcpuTotal: z.number(),
  memMbTotal: z.number(),
  envCount: z.number().int(),
  lastSeenAt: z.string().datetime().nullable(),
});
export type Node = z.infer<typeof node>;

/* ─────────────── Métricas ─────────────── */

export const metricSample = z.object({
  ts: z.number(), // epoch ms
  cpuPct: z.number(), // 0..100 (relativo à cota do ambiente)
  memBytes: z.number(),
  memLimitBytes: z.number(),
});
export type MetricSample = z.infer<typeof metricSample>;

export const metricSeries = z.object({
  envId: z.string().uuid(),
  samples: z.array(metricSample),
});
export type MetricSeries = z.infer<typeof metricSeries>;

/* ─────────────── Auth ─────────────── */

export const userRole = z.enum(["admin", "client"]);
export type UserRole = z.infer<typeof userRole>;

export const loginInput = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginInput>;

export const sessionUser = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: userRole,
});
export type SessionUser = z.infer<typeof sessionUser>;

/* ─────────────── Erro padronizado da API ─────────────── */

export const apiError = z.object({
  error: z.string(),
  message: z.string(),
});
export type ApiError = z.infer<typeof apiError>;
