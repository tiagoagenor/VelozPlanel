"use client";

/*
 * ─────────────────────────────────────────────────────────────────────────
 *  VelozPanel — Ambientes (tela de ouro 1). Roda dentro de (app)/layout.tsx,
 *  que já provê <AuthGuard> + <AppShell> (sidebar · topbar · conteúdo).
 *
 *  COMO RODAR (a partir da raiz do monorepo): pnpm dev:db && pnpm db:push →
 *  pnpm dev:agent → pnpm dev:api → pnpm dev:painel → http://localhost:3000
 *  (login client@veloz.dev / veloz123). API em NEXT_PUBLIC_API_URL
 *  (default http://localhost:4000/api/v1), cookie de sessão vp_session.
 * ─────────────────────────────────────────────────────────────────────────
 */

import * as React from "react";
import Link from "next/link";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Plus,
  Play,
  Pause,
  ExternalLink,
  ArrowRight,
  Code,
  Box,
  Cpu,
  MemoryStick,
  AlertTriangle,
  Server,
} from "lucide-react";
import type { Environment } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { usePlans } from "@/lib/usePlans";
import { EnvStateBadge } from "@/components/EnvStateBadge";
import { CreateEnvironmentDialog } from "@/components/CreateEnvironmentDialog";
import { StatCard } from "@/components/StatCard";
import { MeterBar, PlanChips } from "@/components/ResourceMeter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { formatBytes, formatDateTime } from "@/lib/format";

export default function DashboardPage() {
  const [createOpen, setCreateOpen] = React.useState(false);

  const query = useQuery({
    queryKey: ["environments"],
    queryFn: api.listEnvironments,
  });

  const envs = query.data ?? [];
  const running = envs.filter((e) => e.state === "running").length;
  const paused = envs.filter((e) => e.state === "paused").length;

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight text-text">
            Ambientes
          </h1>
          <p className="mt-1 text-sm text-text2">
            Seus ambientes de hospedagem, com estado e consumo em tempo real.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={18} aria-hidden="true" />
          Criar ambiente
        </Button>
      </header>

      {envs.length > 0 ? (
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Ambientes" value={envs.length} icon={Box} tone="brand" />
          <StatCard label="Ativos" value={running} icon={Play} tone="success" />
          <StatCard label="Em pausa" value={paused} icon={Pause} tone="warning" />
        </div>
      ) : null}

      {query.isPending ? (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <li key={i}>
              <div className="vp-card-shadow h-40 animate-pulse rounded-xl border border-border-subtle bg-surface" />
            </li>
          ))}
        </ul>
      ) : query.isError ? (
        <Card className="flex items-start gap-3">
          <AlertTriangle
            size={20}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-danger"
          />
          <div>
            <p role="alert" className="font-medium text-text">
              Não foi possível carregar os ambientes.
            </p>
            <button
              type="button"
              onClick={() => query.refetch()}
              className="mt-1 text-sm text-link hover:underline"
            >
              Tentar de novo
            </button>
          </div>
        </Card>
      ) : envs.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-14 text-center">
          <span
            aria-hidden="true"
            className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand-strong"
          >
            <Server size={28} strokeWidth={1.75} />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-text">
              Você ainda não tem ambientes
            </h2>
            <p className="mt-1 text-sm text-text2">
              Crie o primeiro para colocar seu site ou aplicação no ar.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={18} aria-hidden="true" />
            Criar ambiente
          </Button>
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {envs.map((env) => (
            <li key={env.id}>
              <EnvCard env={env} />
            </li>
          ))}
        </ul>
      )}

      <CreateEnvironmentDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </>
  );
}

function EnvCard({ env }: { env: Environment }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { byId: plansById } = usePlans();
  const plan = plansById.get(env.plan);
  const runtimeLabel = env.runtime.kind === "php" ? "PHP" : "Node.js";
  const isRunning = env.state === "running";
  const dimmed = env.state === "paused" || env.state === "error";

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["environments"] });

  // Uso atual só faz sentido (e só existe) enquanto o ambiente está ativo.
  const metrics = useQuery({
    queryKey: ["metrics", env.id, "card"],
    queryFn: () => api.getMetrics(env.id, "15m"),
    enabled: isRunning,
    refetchInterval: 15000,
    staleTime: 10000,
  });
  const last = metrics.data?.samples.at(-1);
  const cpuPct = last ? last.cpuPct : null;
  const memPct =
    last && last.memLimitBytes > 0
      ? (last.memBytes / last.memLimitBytes) * 100
      : null;

  const pause = useMutation({
    mutationFn: () => api.pauseEnvironment(env.id),
    onSuccess: () => {
      invalidate();
      toast.show("success", `Ambiente "${env.name}" pausado — cobrança suspensa.`);
    },
    onError: () => toast.show("error", "Não foi possível pausar o ambiente."),
  });
  const start = useMutation({
    mutationFn: () => api.startEnvironment(env.id),
    onSuccess: () => {
      invalidate();
      toast.show("success", `Ambiente "${env.name}" iniciado.`);
    },
    onError: () => toast.show("error", "Não foi possível iniciar o ambiente."),
  });

  const busy = pause.isPending || start.isPending;

  return (
    <div className="vp-card-shadow flex h-full flex-col rounded-xl border border-border-subtle bg-surface p-5 transition-shadow hover:shadow-[var(--vp-shadow-pop)]">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-strong ${dimmed ? "opacity-60" : ""}`}
          >
            <Code size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="min-w-0 truncate text-base font-semibold text-text">
              <Link
                href={`/env/${env.id}`}
                className="rounded hover:text-brand-strong hover:underline"
              >
                {env.name}
              </Link>
            </h2>
            <p className="truncate text-xs text-text3">
              {runtimeLabel} {env.runtime.version} · {plan?.label ?? env.plan}
            </p>
          </div>
        </div>
        <EnvStateBadge state={env.state} />
      </div>

      {/* Uso de recursos: barras ao vivo quando ativo, chips do plano quando não. */}
      <div className="mt-4 min-h-[3.25rem]">
        {isRunning ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <MeterBar
              icon={Cpu}
              label="CPU"
              tone="cpu"
              pct={cpuPct}
              valueText={cpuPct == null ? "—" : `${cpuPct.toFixed(0)}%`}
            />
            <MeterBar
              icon={MemoryStick}
              label="RAM"
              tone="ram"
              pct={memPct}
              valueText={last ? formatBytes(last.memBytes) : "—"}
            />
          </div>
        ) : plan ? (
          <PlanChips plan={plan} />
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            <li className="inline-flex items-center rounded-md border border-border-subtle bg-bg px-2 py-1 text-xs font-medium text-text2">
              {env.plan}
            </li>
          </ul>
        )}
      </div>

      <p className="mt-3 text-xs text-text3">
        Criado em {formatDateTime(env.createdAt)}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border-subtle pt-4">
        {env.state === "running" ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => pause.mutate()}
            disabled={busy}
          >
            <Pause size={16} aria-hidden="true" />
            Pausar
          </Button>
        ) : env.state === "paused" ? (
          <Button
            size="sm"
            onClick={() => start.mutate()}
            disabled={busy}
          >
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

        <Link
          href={`/env/${env.id}`}
          className="ml-auto inline-flex h-9 items-center gap-1 rounded-lg px-3 text-sm font-medium text-text2 hover:bg-bg hover:text-text"
        >
          Detalhes
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
