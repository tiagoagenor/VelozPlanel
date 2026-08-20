"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { PLANS } from "@velozplanel/contracts";
import type { MetricSample } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { AppHeader } from "@/components/AppHeader";
import { AuthGuard } from "@/components/AuthGuard";
import { EnvStateBadge } from "@/components/EnvStateBadge";
import { TimeSeries } from "@/components/TimeSeries";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { formatBytes, formatDateTime } from "@/lib/format";

export default function EnvDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState("");

  const envQuery = useQuery({
    queryKey: ["environment", id],
    queryFn: () => api.getEnvironment(id),
  });

  const metricsQuery = useQuery({
    queryKey: ["metrics", id],
    queryFn: () => api.getMetrics(id, "15m"),
    refetchInterval: 5000,
  });

  const env = envQuery.data;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["environment", id] });
    qc.invalidateQueries({ queryKey: ["environments"] });
  };

  const pause = useMutation({
    mutationFn: () => api.pauseEnvironment(id),
    onSuccess: refresh,
  });
  const start = useMutation({
    mutationFn: () => api.startEnvironment(id),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteEnvironment(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["environments"] });
      router.replace("/");
    },
  });

  const samples: MetricSample[] = metricsQuery.data?.samples ?? [];
  const timestamps = samples.map((s) => s.ts);
  const cpu = samples.map((s) => s.cpuPct);
  const mem = samples.map((s) => s.memBytes);
  const memLimit = samples.length ? samples[samples.length - 1]!.memLimitBytes : 0;

  const busy = pause.isPending || start.isPending || remove.isPending;

  return (
    <AuthGuard>
    <div className="min-h-screen bg-bg">
      <AppHeader />
      <main id="conteudo" className="mx-auto max-w-5xl px-4 py-8">
        <nav aria-label="Trilha de navegação" className="mb-4 text-sm text-text3">
          <Link href="/" className="text-link hover:underline">
            Ambientes
          </Link>
          <span aria-hidden="true"> › </span>
          <span aria-current="page">{env?.name ?? "…"}</span>
        </nav>

        {envQuery.isPending ? (
          <p className="text-text2">Carregando ambiente…</p>
        ) : envQuery.isError || !env ? (
          <p role="alert" className="text-danger">
            ⚠ Não foi possível carregar este ambiente.
          </p>
        ) : (
          <>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-text">{env.name}</h1>
                <EnvStateBadge state={env.state} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {env.state === "running" ? (
                  <Button
                    variant="warning"
                    size="sm"
                    onClick={() => pause.mutate()}
                    disabled={busy}
                  >
                    ⏸ Pausar
                  </Button>
                ) : env.state === "paused" ? (
                  <Button
                    variant="success"
                    size="sm"
                    onClick={() => start.mutate()}
                    disabled={busy}
                  >
                    ▶ Iniciar
                  </Button>
                ) : null}

                {env.state === "running" && env.httpPort ? (
                  <a
                    href={`http://localhost:${env.httpPort}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm text-link hover:bg-bg"
                  >
                    Abrir site ↗
                  </a>
                ) : null}

                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setConfirmDelete(true)}
                  disabled={busy}
                >
                  🗑 Excluir
                </Button>
              </div>
            </div>

            <Card className="mb-6 bg-elevated">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
                <Field label="Runtime">
                  {env.runtime.kind === "php" ? "PHP" : "Node.js"}{" "}
                  {env.runtime.version}
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

            <section aria-labelledby="metrics-title">
              <h2 id="metrics-title" className="mb-3 text-lg font-semibold text-text">
                Consumo{" "}
                <span className="text-sm font-normal text-text3">
                  (atualiza a cada 5s)
                </span>
              </h2>

              {metricsQuery.isPending ? (
                <p className="text-text2">Carregando métricas…</p>
              ) : samples.length === 0 ? (
                <Card>
                  <p className="text-text2">
                    Sem amostras ainda. O coletor grava a cada 5s enquanto o
                    ambiente está ativo.
                  </p>
                </Card>
              ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <Card className="bg-elevated">
                    <CardHeader>
                      <CardTitle>CPU</CardTitle>
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

                  <Card className="bg-elevated">
                    <CardHeader>
                      <CardTitle>Memória</CardTitle>
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
      </main>

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
            <p role="alert" className="text-sm font-medium text-danger">
              ⚠ Falha ao excluir. Tente novamente.
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
    </div>
    </AuthGuard>
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
