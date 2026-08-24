"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ShieldCheck,
  Eye,
  EyeOff,
  Plug,
  Check,
  Lock,
  FileCode2,
  MapPin,
  ExternalLink,
  Copy,
  CircleCheck,
} from "lucide-react";
import { RUNTIME_LABEL, runtimeHasVersions, type MetricSample, type Environment } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { usePlans } from "@/lib/usePlans";
import { TimeSeries } from "@/components/TimeSeries";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import { formatBytes, formatDateTime, planMonthly, planHourly } from "@/lib/format";

const METRIC_WINDOWS = ["15m", "1h", "24h"] as const;
type MetricWindow = (typeof METRIC_WINDOWS)[number];

/** CPU: casas decimais quando é pequeno (evita "0.0%" para uso mínimo). */
function fmtCpu(v: number | null): string {
  if (v == null) return "—";
  if (v >= 10) return `${v.toFixed(0)}%`;
  if (v >= 1) return `${v.toFixed(1)}%`;
  return `${v.toFixed(2)}%`;
}

function runtimeText(env: Environment): string {
  if (env.category === "service") return `${env.type ?? "serviço"} ${env.runtime.version}`;
  const label = RUNTIME_LABEL[env.runtime.kind];
  // Estático não tem versão real — mostra só o rótulo.
  return runtimeHasVersions(env.runtime.kind) ? `${label} ${env.runtimeVersionFull ?? env.runtime.version}` : label;
}

export default function EnvOverviewPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [metricWindow, setMetricWindow] = React.useState<MetricWindow>("15m");
  const [showLimit, setShowLimit] = React.useState(false);
  const [cpuUnit, setCpuUnit] = React.useState<"pct" | "vcpu">("pct");

  const diskQuery = useQuery({
    queryKey: ["disk", id],
    queryFn: () => api.getDisk(id),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const diskBytes = diskQuery.data?.diskBytes ?? null;

  const envQuery = useQuery({
    queryKey: ["environment", id],
    queryFn: () => api.getEnvironment(id),
  });

  const metricsQuery = useQuery({
    queryKey: ["metrics", id, metricWindow],
    queryFn: () => api.getMetrics(id, metricWindow),
    refetchInterval: 5000,
  });

  const env = envQuery.data;
  const { byId: plansById } = usePlans();
  const plan = env ? plansById.get(env.plan) ?? null : null;

  const samples: MetricSample[] = metricsQuery.data?.samples ?? [];
  const timestamps = samples.map((s) => s.ts);
  const cpu = samples.map((s) => s.cpuPct);
  const mem = samples.map((s) => s.memBytes);
  const lastSample = samples.at(-1);
  const memLimit = lastSample ? lastSample.memLimitBytes : 0;
  const curCpu = lastSample ? lastSample.cpuPct : null;
  const curMem = lastSample ? lastSample.memBytes : null;

  if (envQuery.isPending) {
    return <div className="h-40 animate-pulse rounded-[14px] border border-border bg-surface" />;
  }
  if (envQuery.isError || !env) {
    return (
      <Card className="flex items-start gap-3">
        <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
        <p role="alert" className="font-medium text-text">Não foi possível carregar este ambiente.</p>
      </Card>
    );
  }

  const isService = env.category === "service" && !!env.connection;
  const https = (env.accessUrl ?? "").startsWith("https");

  // Estatísticas dos gráficos
  const cpuAvg = cpu.length ? cpu.reduce((a, b) => a + b, 0) / cpu.length : null;
  const cpuPeak = cpu.length ? Math.max(...cpu) : null;
  const memAvg = mem.length ? mem.reduce((a, b) => a + b, 0) / mem.length : null;
  const memPeak = mem.length ? Math.max(...mem) : null;
  const CPU_LIMIT = 80; // limite de atenção (%)
  const cpuOk = cpuPeak == null || cpuPeak < CPU_LIMIT;
  const memOk = memPeak == null || memLimit === 0 || memPeak < memLimit * 0.9;

  // CPU em % (relativo à cota) OU em vCPU real (0-100% → 0..vcpu do plano).
  const vcpu = plan?.vcpu ?? null;
  const canVcpu = vcpu != null && vcpu > 0;
  const asVcpu = cpuUnit === "vcpu" && canVcpu;
  const toVcpu = (pct: number) => (pct / 100) * (vcpu ?? 1);
  const fmtVcpu = (v: number | null) => (v == null ? "—" : `${v.toFixed(2)} vCPU`);
  const cpuValues = asVcpu ? cpu.map(toVcpu) : cpu;
  const cpuFormat = asVcpu ? fmtVcpu : fmtCpu;
  const cpuCur = curCpu == null ? null : asVcpu ? toVcpu(curCpu) : curCpu;
  const cpuAvgU = cpuAvg == null ? null : asVcpu ? toVcpu(cpuAvg) : cpuAvg;
  const cpuPeakU = cpuPeak == null ? null : asVcpu ? toVcpu(cpuPeak) : cpuPeak;
  const cpuLimitVal = asVcpu ? (vcpu ?? 0) : 100;
  const cpuLimitTxt = asVcpu ? `${(vcpu ?? 0).toFixed(2)} vCPU` : "100%";

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* ── Coluna esquerda: chips + dados + endereços + conexão ── */}
      <div className="flex flex-col gap-6">
        {/* Chips de meta */}
        <div className="flex flex-wrap gap-2">
          {env.state === "running" ? <Chip tone="success" icon={CircleCheck}>Ativo</Chip> : null}
          {https ? <Chip tone="success" icon={Lock}>HTTPS ativo</Chip> : null}
          <Chip tone="neutral" icon={FileCode2}>{runtimeText(env)}</Chip>
          {env.region ? <Chip tone="neutral" icon={MapPin}>{env.region}</Chip> : null}
        </div>

        {/* Dados do ambiente */}
        <Card>
          <div className="mb-3 flex items-center justify-between gap-3">
            <CardTitle>Dados do ambiente</CardTitle>
            <Link
              href={`/env/${id}/configuracoes`}
              className="inline-flex items-center rounded-[8px] border border-border px-3 py-1.5 text-[13px] font-medium text-brand-strong transition-colors hover:border-brand-strong hover:bg-brand-soft/50"
            >
              Alterar plano
            </Link>
          </div>
          <dl className="flex flex-col divide-y divide-border/70">
            <DataRow label="Plano">
              {plan ? `${plan.label} · ${plan.vcpu} vCPU · ${plan.memMb} MB RAM · ${plan.diskGb} GB` : env.plan}
            </DataRow>
            {plan ? (
              <DataRow label="Preço">
                {planMonthly(plan)}/mês · {planHourly(plan)}/hora
              </DataRow>
            ) : null}
            <DataRow label="Região">{env.region ?? "—"}</DataRow>
            <DataRow label="Runtime">{runtimeText(env)}{env.category === "service" ? "" : " (contêiner Docker)"}</DataRow>
            <DataRow label="Criado em">{formatDateTime(env.createdAt)}</DataRow>
          </dl>
        </Card>

        {/* Endereços */}
        <Card>
          <CardTitle className="mb-3">Endereços</CardTitle>
          <dl className="flex flex-col divide-y divide-border/70">
            <CopyRow label="Principal" value={env.accessUrl ?? "—"} href={env.accessUrl ?? undefined} />
            <CopyRow label="Domínio" value={env.domain ?? "Não configurado"} muted={!env.domain} />
            {env.internalIp ? <CopyRow label="IP interno" value={env.internalIp} mono /> : null}
            {env.containerId ? <CopyRow label="Container" value={env.containerId.slice(0, 12)} mono /> : null}
          </dl>
        </Card>

        {isService && env.connection ? (
          <ServiceConnectionCard connection={env.connection} typeLabel={env.type ?? "serviço"} />
        ) : null}
      </div>

      {/* ── Coluna direita: monitoramento ── */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold text-text">Monitoramento</h2>
            <span className="flex items-center gap-1.5 text-[13px] text-text3">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />
              coletando · a cada 5s
            </span>
          </div>
          <SegmentedControl<MetricWindow>
            label="Intervalo dos gráficos"
            value={metricWindow}
            onChange={setMetricWindow}
            options={[
              { value: "15m", label: "15 min" },
              { value: "1h", label: "1 h" },
              { value: "24h", label: "24 h" },
            ]}
          />
        </div>

        {samples.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <button
              type="button"
              role="switch"
              aria-checked={showLimit}
              onClick={() => setShowLimit((v) => !v)}
              className="inline-flex items-center gap-2 text-[13px] text-text2"
            >
              <span className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors", showLimit ? "bg-brand" : "bg-border")}>
                <span className={cn("inline-block h-4 w-4 transform rounded-full bg-surface shadow transition-transform", showLimit ? "translate-x-4" : "translate-x-0.5")} />
              </span>
              Linha do limite
            </button>

            <label className="inline-flex items-center gap-2 text-[13px] text-text2">
              CPU em
              <SegmentedControl<"pct" | "vcpu">
                label="Unidade da CPU"
                value={cpuUnit}
                onChange={setCpuUnit}
                options={[
                  { value: "pct", label: "%" },
                  { value: "vcpu", label: "vCPU", disabled: !canVcpu },
                ]}
              />
            </label>
          </div>
        ) : null}

        {samples.length === 0 ? (
          <Card>
            <p className="text-text2">Sem amostras ainda. O coletor grava a cada 5s enquanto o ambiente está ativo.</p>
          </Card>
        ) : (
          <>
            <MetricCard
              title="Uso de CPU"
              subtitle={asVcpu ? "vCPU realmente em uso (cota do plano)" : "Percentual relativo à cota do plano"}
              bigValue={cpuFormat(cpuCur)}
              ok={cpuOk}
              tone="cpu"
              timestamps={timestamps}
              values={cpuValues}
              format={cpuFormat}
              limit={showLimit ? cpuLimitVal : null}
              limitLabel={`limite ${cpuLimitTxt}`}
              stats={[
                { label: "Média", value: cpuFormat(cpuAvgU) },
                { label: "Pico", value: cpuFormat(cpuPeakU) },
                { label: "Limite", value: cpuLimitTxt },
              ]}
            />
            <MetricCard
              title="Memória"
              subtitle={`Uso de RAM · teto ${formatBytes(memLimit)}`}
              bigValue={curMem == null ? "—" : formatBytes(curMem)}
              ok={memOk}
              tone="mem"
              timestamps={timestamps}
              values={mem}
              format={(v) => (v == null ? "—" : formatBytes(v))}
              limit={showLimit && memLimit > 0 ? memLimit : null}
              limitLabel={`limite ${formatBytes(memLimit)}`}
              stats={[
                { label: "Média", value: memAvg == null ? "—" : formatBytes(memAvg) },
                { label: "Pico", value: memPeak == null ? "—" : formatBytes(memPeak) },
                { label: "Teto", value: formatBytes(memLimit) },
              ]}
            />
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────────── UI helpers ─────────────── */

type ChipTone = "success" | "neutral" | "accent" | "warning";
const CHIP_TONE: Record<ChipTone, string> = {
  success: "vp-pill vp-pill-success",
  neutral: "vp-pill vp-pill-neutral",
  accent: "vp-pill vp-pill-accent",
  warning: "vp-pill vp-pill-warning",
};
function Chip({ tone, icon: Icon, children }: { tone: ChipTone; icon: React.ComponentType<{ size?: number; className?: string }>; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-medium", CHIP_TONE[tone])}>
      <Icon size={14} aria-hidden="true" />
      {children}
    </span>
  );
}

function DataRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-[13.5px] text-text2">{label}</dt>
      <dd className="min-w-0 truncate text-right text-[13.5px] font-medium text-text">{children}</dd>
    </div>
  );
}

function CopyRow({ label, value, href, mono, muted }: { label: string; value: string; href?: string; mono?: boolean; muted?: boolean }) {
  const [copied, setCopied] = React.useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard indisponível */
    }
  }
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="shrink-0 text-[13.5px] text-text2">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2">
        <span className={cn("min-w-0 truncate text-right text-[13.5px]", mono && "font-mono", muted ? "text-text3" : "font-medium text-text")}>
          {value}
        </span>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${label}`} className="shrink-0 rounded p-1 text-text3 hover:text-brand-strong">
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        ) : null}
        {!muted ? (
          <button type="button" onClick={copy} aria-label={`Copiar ${label}`} className="shrink-0 rounded p-1 text-text3 hover:text-brand-strong">
            {copied ? <Check size={14} aria-hidden="true" className="text-success" /> : <Copy size={14} aria-hidden="true" />}
          </button>
        ) : null}
      </dd>
    </div>
  );
}

function MetricCard({
  title,
  subtitle,
  bigValue,
  ok,
  tone,
  timestamps,
  values,
  format,
  stats,
  limit,
  limitLabel,
}: {
  title: string;
  subtitle: string;
  bigValue: string;
  ok: boolean;
  tone: "cpu" | "mem";
  timestamps: number[];
  values: number[];
  format: (v: number | null) => string;
  stats: { label: string; value: string }[];
  limit?: number | null;
  limitLabel?: string;
}) {
  return (
    <Card>
      <div className="mb-1 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-text">{title}</h3>
          <p className="mt-0.5 text-[12.5px] text-text3">{subtitle}</p>
        </div>
        <span className="text-[26px] font-bold leading-none tabular-nums text-text">{bigValue}</span>
      </div>
      <div className="mb-3">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium",
            ok ? "vp-pill vp-pill-success" : "vp-pill vp-pill-warning",
          )}
        >
          <CircleCheck size={12} aria-hidden="true" />
          {ok ? "dentro do normal" : "atenção"}
        </span>
      </div>
      <TimeSeries timestamps={timestamps} values={values} label={title} tone={tone} format={format} height={170} showHeader={false} limit={limit} limitLabel={limitLabel} />
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border/70 pt-3">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.05em] text-text3">{s.label}</dt>
            <dd className="mt-0.5 text-[15px] font-bold tabular-nums text-text">{s.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/* ─────────────── Conexão do serviço (envs de serviço) ─────────────── */

const CONN_LABELS: Record<string, string> = {
  host: "Host interno",
  port: "Porta",
  user: "Usuário",
  password: "Senha",
  database: "Banco",
  url: "URL de conexão",
};
const CONN_ORDER = ["host", "port", "database", "user", "password", "url"];

function ServiceConnectionCard({ connection, typeLabel }: { connection: Record<string, string>; typeLabel: string }) {
  const [reveal, setReveal] = React.useState(false);
  const [copied, setCopied] = React.useState<string | null>(null);
  const keys = CONN_ORDER.filter((k) => k in connection);

  async function copy(k: string, v: string) {
    try {
      await navigator.clipboard.writeText(v);
      setCopied(k);
      setTimeout(() => setCopied((c) => (c === k ? null : c)), 1200);
    } catch {
      /* clipboard indisponível */
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug size={16} className="text-brand-strong" /> Dados de conexão
        </CardTitle>
      </CardHeader>
      <p className="mb-3 flex items-start gap-2 rounded-lg border border-border-subtle bg-bg p-2.5 text-xs text-text2">
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-info" />
        Sem porta pública. Acessível só pela rede interna — um ambiente de código <strong>do mesmo dono</strong> conecta por este host interno.
      </p>
      <dl className="flex flex-col divide-y divide-border-subtle">
        {keys.map((k) => {
          const secret = k === "password" || k === "url";
          const shown = secret && !reveal ? "••••••••" : connection[k]!;
          return (
            <div key={k} className="flex items-center gap-3 py-2">
              <dt className="w-32 shrink-0 text-xs text-text3">{CONN_LABELS[k] ?? k}</dt>
              <dd className="min-w-0 flex-1 truncate font-mono text-sm text-text">{shown}</dd>
              {secret ? (
                <button type="button" onClick={() => setReveal((r) => !r)} className="rounded p-1 text-text2 hover:text-text" aria-label={reveal ? "Ocultar" : "Mostrar"}>
                  {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              ) : null}
              <button type="button" onClick={() => copy(k, connection[k]!)} className="rounded px-2 py-1 text-xs text-link hover:bg-bg" aria-label={`Copiar ${CONN_LABELS[k] ?? k}`}>
                {copied === k ? "copiado" : "copiar"}
              </button>
            </div>
          );
        })}
      </dl>
      <p className="mt-3 text-xs text-text3">
        Tipo: <span className="font-mono">{typeLabel}</span>. As credenciais também podem ser injetadas automaticamente ao vincular um ambiente de código (em breve).
      </p>
    </Card>
  );
}
