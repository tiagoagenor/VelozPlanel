"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Cpu,
  MemoryStick,
  HardDrive,
} from "lucide-react";
import { PLANS } from "@velozplanel/contracts";
import type { MetricSample } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { TimeSeries } from "@/components/TimeSeries";
import { MeterBar } from "@/components/ResourceMeter";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented";
import { formatBytes, formatDateTime } from "@/lib/format";

const METRIC_WINDOWS = ["15m", "1h", "24h"] as const;
type MetricWindow = (typeof METRIC_WINDOWS)[number];

export default function EnvOverviewPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [metricWindow, setMetricWindow] = React.useState<MetricWindow>("15m");

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

  const samples: MetricSample[] = metricsQuery.data?.samples ?? [];
  const timestamps = samples.map((s) => s.ts);
  const cpu = samples.map((s) => s.cpuPct);
  const mem = samples.map((s) => s.memBytes);
  const lastSample = samples.at(-1);
  const memLimit = lastSample ? lastSample.memLimitBytes : 0;
  const curCpu = lastSample ? lastSample.cpuPct : null;
  const curMemPct =
    lastSample && lastSample.memLimitBytes > 0
      ? (lastSample.memBytes / lastSample.memLimitBytes) * 100
      : null;
  const plan = env ? PLANS[env.plan] : null;

  if (envQuery.isPending) {
    return (
      <div className="vp-card-shadow h-40 animate-pulse rounded-xl border border-border-subtle bg-surface" />
    );
  }
  if (envQuery.isError || !env) {
    return (
      <Card className="flex items-start gap-3">
        <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
        <p role="alert" className="font-medium text-text">
          Não foi possível carregar este ambiente.
        </p>
      </Card>
    );
  }

  return (
    <>
      {/* Dados do ambiente */}
      <Card className="mb-6">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          <Field label="Runtime">
            {env.runtime.kind === "php" ? "PHP" : "Node.js"} {env.runtime.version}
          </Field>
          <Field label="Plano">
            {PLANS[env.plan].label} · {PLANS[env.plan].vcpu} vCPU ·{" "}
            {PLANS[env.plan].memMb} MB
          </Field>
          <Field label="Endereço">
            {env.httpPort ? `localhost:${env.httpPort}` : "—"}
          </Field>
          <Field label="Domínio">{env.domain ?? "Não configurado"}</Field>
          <Field label="Criado em">{formatDateTime(env.createdAt)}</Field>
          <Field label="Container">
            <span className="break-all font-mono text-xs">
              {env.containerId ? env.containerId.slice(0, 12) : "—"}
            </span>
          </Field>
        </dl>
      </Card>

      {/* Resumo de uso atual: CPU / RAM / Disco */}
      <Card className="mb-6">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <MeterBar
            icon={Cpu}
            label="CPU"
            tone="cpu"
            pct={curCpu}
            valueText={curCpu == null ? "—" : `${curCpu.toFixed(0)}%`}
          />
          <MeterBar
            icon={MemoryStick}
            label="RAM"
            tone="ram"
            pct={curMemPct}
            valueText={
              lastSample
                ? `${formatBytes(lastSample.memBytes)} / ${formatBytes(memLimit)}`
                : "—"
            }
          />
          <MeterBar
            icon={HardDrive}
            label="Disco"
            tone="disk"
            pct={null}
            valueText={plan ? `${plan.diskGb} GB` : "—"}
          />
        </div>
      </Card>

      {/* Consumo */}
      <section aria-labelledby="metrics-title">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <h2 id="metrics-title" className="text-lg font-semibold text-text">
              Consumo
            </h2>
            <span className="text-sm text-text3">(atualiza a cada 5s)</span>
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

        {metricsQuery.isPending ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="vp-card-shadow h-64 animate-pulse rounded-xl border border-border-subtle bg-surface" />
            <div className="vp-card-shadow h-64 animate-pulse rounded-xl border border-border-subtle bg-surface" />
          </div>
        ) : samples.length === 0 ? (
          <Card>
            <p className="text-text2">
              Sem amostras ainda. O coletor grava a cada 5s enquanto o ambiente
              está ativo.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Cpu size={18} aria-hidden="true" className="text-brand-strong" />
                  CPU
                </CardTitle>
                <p className="text-sm text-text2">
                  Percentual relativo à cota do plano.
                </p>
              </CardHeader>
              <TimeSeries
                timestamps={timestamps}
                values={cpu}
                label="CPU %"
                tone="brand"
                format={(v) => (v == null ? "—" : `${v.toFixed(1)}%`)}
              />
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MemoryStick size={18} aria-hidden="true" className="text-info" />
                  Memória
                </CardTitle>
                <p className="text-sm text-text2">
                  Uso de RAM · teto {formatBytes(memLimit)}.
                </p>
              </CardHeader>
              <TimeSeries
                timestamps={timestamps}
                values={mem}
                label="RAM"
                tone="info"
                format={(v) => (v == null ? "—" : formatBytes(v))}
              />
            </Card>
          </div>
        )}
      </section>
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-text3">{label}</dt>
      <dd className="font-medium text-text">{children}</dd>
    </div>
  );
}
