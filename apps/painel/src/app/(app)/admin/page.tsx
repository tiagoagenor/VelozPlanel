"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Box,
  Play,
  Pause,
  Server,
  ShieldAlert,
  ArrowRight,
} from "lucide-react";
import * as api from "@/lib/api";
import { StatCard } from "@/components/StatCard";
import { Card } from "@/components/ui/card";

export default function AdminOverviewPage() {
  const meQuery = useQuery({ queryKey: ["me"], queryFn: api.me });
  const isAdmin = meQuery.data?.role === "admin";

  const envQuery = useQuery({
    queryKey: ["environments"],
    queryFn: api.listEnvironments,
    enabled: isAdmin,
  });
  const nodesQuery = useQuery({
    queryKey: ["nodes"],
    queryFn: api.listNodes,
    enabled: isAdmin,
  });

  const envs = envQuery.data ?? [];
  const nodes = nodesQuery.data ?? [];
  const running = envs.filter((e) => e.state === "running").length;
  const paused = envs.filter((e) => e.state === "paused").length;
  const onlineNodes = nodes.filter((n) => n.status === "online").length;

  return (
    <>
      <header className="mb-8">
        <h1 className="text-[28px] font-bold leading-tight text-text">
          Visão geral
        </h1>
        <p className="mt-1 text-sm text-text2">
          Estado da frota de ambientes e nós (visão de administrador).
        </p>
      </header>

      {meQuery.isPending ? (
        <p className="text-text2">Verificando permissões…</p>
      ) : !isAdmin ? (
        <Card className="flex items-start gap-3">
          <ShieldAlert
            size={20}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-danger"
          />
          <div>
            <p role="alert" className="font-medium text-text">
              Acesso restrito. Esta área é exclusiva de administradores.
            </p>
            <p className="mt-2 text-sm">
              <Link href="/" className="text-link hover:underline">
                Voltar aos ambientes
              </Link>
            </p>
          </div>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Ambientes"
              value={envs.length}
              icon={Box}
              tone="brand"
              hint="Total na frota"
            />
            <StatCard
              label="Ativos"
              value={running}
              icon={Play}
              tone="success"
              hint="Rodando agora"
            />
            <StatCard
              label="Em pausa"
              value={paused}
              icon={Pause}
              tone="warning"
              hint="Cobrança suspensa"
            />
            <StatCard
              label="Nós online"
              value={`${onlineNodes}/${nodes.length}`}
              icon={Server}
              tone="info"
              hint="Servidores disponíveis"
            />
          </div>

          <Card className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-text">Nós</h2>
              <p className="text-sm text-text2">
                Capacidade, status e último contato de cada servidor.
              </p>
            </div>
            <Link
              href="/admin/nodes"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 text-sm font-semibold text-text hover:border-brand-strong hover:bg-bg"
            >
              Ver nós
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </Card>
        </>
      )}
    </>
  );
}
