"use client";

/*
 * ─────────────────────────────────────────────────────────────────────────
 *  Jamees — VPS (KVM). Lista só ambientes category === "vps" e oferece um
 *  wizard dedicado de criação (CreateVpsDialog). Roda dentro de
 *  (app)/layout.tsx, que já provê <AuthGuard> + <AppShell>.
 * ─────────────────────────────────────────────────────────────────────────
 */

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus, Server, AlertTriangle, ChevronRight } from "lucide-react";
import type { Environment } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { EnvStateBadge } from "@/components/EnvStateBadge";
import { CreateVpsDialog } from "@/components/CreateVpsDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function VpsListPage() {
  const [createOpen, setCreateOpen] = React.useState(false);

  const query = useQuery({
    queryKey: ["environments"],
    queryFn: api.listEnvironments,
    // Enquanto houver VPS provisionando/removendo, atualiza sozinho a cada 3s.
    refetchInterval: (q) =>
      (q.state.data ?? []).some((e) => e.category === "vps" && (e.state === "provisioning" || e.state === "deleting"))
        ? 3000
        : false,
  });

  const vpsList = (query.data ?? []).filter((e) => e.category === "vps");

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight text-text">VPS</h1>
          <p className="mt-1 text-sm text-text2">
            Máquinas virtuais completas (KVM) — você é root e instala o que quiser. Cobrança por hora.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={18} aria-hidden="true" />
          Criar VPS
        </Button>
      </header>

      {query.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[104px] animate-pulse rounded-[14px] border border-border bg-surface" />
          ))}
        </div>
      ) : query.isError ? (
        <Card className="flex items-start gap-3">
          <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          <div>
            <p role="alert" className="font-medium text-text">
              Não foi possível carregar suas VPS.
            </p>
            <button type="button" onClick={() => query.refetch()} className="mt-1 text-sm text-link hover:underline">
              Tentar de novo
            </button>
          </div>
        </Card>
      ) : vpsList.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-14 text-center">
          <span aria-hidden="true" className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand-strong">
            <Server size={28} strokeWidth={1.75} />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-text">Você ainda não tem VPS</h2>
            <p className="mt-1 text-sm text-text2">
              Crie sua primeira máquina virtual — acesso root, imagem Linux à sua escolha e chave SSH.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={18} aria-hidden="true" />
            Criar VPS
          </Button>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {vpsList.map((env) => (
            <VpsCard key={env.id} env={env} />
          ))}
        </div>
      )}

      <CreateVpsDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}

function VpsCard({ env }: { env: Environment }) {
  return (
    <Link
      href={`/env/${env.id}/vps`}
      className="group flex flex-col gap-3 rounded-[14px] border border-border bg-surface p-4 transition-colors hover:border-brand-strong/50 hover:bg-bg"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-strong">
            <Server size={18} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-text">{env.name}</p>
            <p className="truncate text-[12px] text-text3">{env.region ?? "—"}</p>
          </div>
        </div>
        <ChevronRight size={18} aria-hidden="true" className="mt-1 shrink-0 text-text3 transition-transform group-hover:translate-x-0.5" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <EnvStateBadge state={env.state} />
        <span className="truncate font-mono text-[12px] text-text3">{env.internalIp ?? env.accessUrl ?? ""}</span>
      </div>
    </Link>
  );
}
