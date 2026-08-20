"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Play,
  Pause,
  Trash2,
  ExternalLink,
  ChevronRight,
  AlertTriangle,
  Cpu,
  MemoryStick,
  HardDrive,
  Code,
} from "lucide-react";
import { PLANS } from "@velozplanel/contracts";
import type { MetricSample } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { EnvStateBadge } from "@/components/EnvStateBadge";
import { TimeSeries } from "@/components/TimeSeries";
import { MeterBar } from "@/components/ResourceMeter";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { formatBytes, formatDateTime } from "@/lib/format";

const METRIC_WINDOWS = ["15m", "1h", "24h"] as const;
type MetricWindow = (typeof METRIC_WINDOWS)[number];

export default function EnvDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState("");
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

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["environment", id] });
    qc.invalidateQueries({ queryKey: ["environments"] });
  };

  const pause = useMutation({
    mutationFn: () => api.pauseEnvironment(id),
    onSuccess: () => {
      refresh();
      toast.show("success", "Ambiente pausado — cobrança suspensa.");
    },
    onError: () => toast.show("error", "Não foi possível pausar o ambiente."),
  });
  const start = useMutation({
    mutationFn: () => api.startEnvironment(id),
    onSuccess: () => {
      refresh();
      toast.show("success", "Ambiente iniciado.");
    },
    onError: () => toast.show("error", "Não foi possível iniciar o ambiente."),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteEnvironment(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["environments"] });
      toast.show("success", "Ambiente excluído.");
      router.replace("/");
    },
    onError: () => toast.show("error", "Falha ao excluir o ambiente."),
  });

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

  const busy = pause.isPending || start.isPending || remove.isPending;

  return (
    <>
      <nav aria-label="Trilha de navegação" className="mb-4 flex items-center gap-1 text-sm text-text3">
        <Link href="/" className="text-link hover:underline">
          Ambientes
        </Link>
        <ChevronRight size={15} aria-hidden="true" />
        <span aria-current="page" className="text-text2">
          {env?.name ?? "…"}
        </span>
      </nav>

      {envQuery.isPending ? (
        <div className="vp-card-shadow h-28 animate-pulse rounded-xl border border-border-subtle bg-surface" />
      ) : envQuery.isError || !env ? (
        <Card className="flex items-start gap-3">
          <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          <p role="alert" className="font-medium text-text">
            Não foi possível carregar este ambiente.
          </p>
        </Card>
      ) : (
        <>
          {/* Cabeçalho do ambiente */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong"
              >
                <Code size={22} />
              </span>
              <div>
                <div className="flex items-center gap-2.5">
                  <h1 className="text-2xl font-bold text-text">{env.name}</h1>
                  <EnvStateBadge state={env.state} />
                </div>
                <p className="text-sm text-text3">
                  {env.runtime.kind === "php" ? "PHP" : "Node.js"}{" "}
                  {env.runtime.version} · {PLANS[env.plan].label}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {env.state === "running" ? (
                <Button variant="outline" size="sm" onClick={() => pause.mutate()} disabled={busy}>
                  <Pause size={16} aria-hidden="true" />
                  Pausar
                </Button>
              ) : env.state === "paused" ? (
                <Button size="sm" onClick={() => start.mutate()} disabled={busy}>
                  <Play size={16} aria-hidden="true" />
                  Iniciar
                </Button>
              ) : null}

              {env.state === "running" && env.httpPort ? (
                <a
                  href={`http://localhost:${env.httpPort}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-link hover:bg-bg"
                >
                  Abrir site
                  <ExternalLink size={15} aria-hidden="true" />
                </a>
              ) : null}

              <Button
                variant="danger"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
              >
                <Trash2 size={16} aria-hidden="true" />
                Excluir
              </Button>
            </div>
          </div>

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
              <Field label="Porta HTTP">
                {env.httpPort ? `localhost:${env.httpPort}` : "—"}
              </Field>
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
                  Sem amostras ainda. O coletor grava a cada 5s enquanto o
                  ambiente está ativo.
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
      )}

      <Dialog
        open={confirmDelete}
        onClose={() => {
          setConfirmDelete(false);
          setConfirmText("");
        }}
        title="Excluir ambiente"
        description="Esta ação para e remove o container. Não é possível desfazer."
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-name">
              Digite <strong>{env?.name}</strong> para confirmar
            </Label>
            <Input
              id="confirm-name"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
            />
          </div>
          {remove.isError ? (
            <p role="alert" className="flex items-center gap-2 text-sm font-medium text-danger">
              <AlertTriangle size={16} aria-hidden="true" />
              Falha ao excluir. Tente novamente.
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setConfirmDelete(false);
                setConfirmText("");
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={() => remove.mutate()}
              disabled={confirmText !== env?.name || remove.isPending}
            >
              {remove.isPending ? "Excluindo…" : "Excluir definitivamente"}
            </Button>
          </div>
        </div>
      </Dialog>
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
