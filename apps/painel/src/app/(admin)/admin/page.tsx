"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Server,
  Boxes,
  Play,
  Pause,
  AlertTriangle,
  Users,
  Database,
  CircleDollarSign,
  Network,
  Layers,
  ScrollText,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import * as api from "@/lib/api";
import { StatCard } from "@/components/StatCard";
import { Card } from "@/components/ui/card";
import { CenterLoader } from "@/components/Skeletons";
import { formatCents } from "@/lib/format";

const QUICK_LINKS: { href: string; label: string; desc: string; icon: LucideIcon }[] = [
  { href: "/admin/nodes", label: "Servidores", desc: "Nós, capacidade e host público", icon: Server },
  { href: "/admin/usuarios", label: "Usuários", desc: "Contas, papéis e status", icon: Users },
  { href: "/admin/ambientes", label: "Ambientes", desc: "Frota completa e recursos", icon: Boxes },
  { href: "/admin/rede", label: "Rede", desc: "Peers WireGuard", icon: Network },
  { href: "/admin/planos", label: "Planos", desc: "Preços e cotas", icon: Layers },
  { href: "/admin/auditoria", label: "Auditoria", desc: "Registro imutável de ações", icon: ScrollText },
];

export default function AdminOverviewPage() {
  const q = useQuery({ queryKey: ["admin", "overview"], queryFn: api.adminOverview });

  return (
    <>
      <header className="mb-8">
        <h1 className="text-[28px] font-bold leading-tight text-text">
          Visão geral
        </h1>
        <p className="mt-1 text-sm text-text2">
          Panorama da operação: frota, contas e receita estimada.
        </p>
      </header>

      {q.isPending ? (
        <CenterLoader minHeight="50vh" />
      ) : q.isError ? (
        <Card className="flex items-start gap-3">
          <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          <p role="alert" className="font-medium text-text">
            Não foi possível carregar a visão geral.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard
              label="Servidores online"
              value={`${q.data.nodes.online}/${q.data.nodes.total}`}
              icon={Server}
              tone="info"
              hint="Nós disponíveis"
            />
            <StatCard
              label="Ambientes ativos"
              value={q.data.environments.running}
              icon={Play}
              tone="success"
              hint={`${q.data.environments.total} na frota`}
            />
            <StatCard
              label="Ambientes pausados"
              value={q.data.environments.paused}
              icon={Pause}
              tone="warning"
              hint="Cobrança suspensa"
            />
            <StatCard
              label="Ambientes com erro"
              value={q.data.environments.error}
              icon={AlertTriangle}
              tone="neutral"
              hint="Precisam de atenção"
            />
            <StatCard
              label="Usuários"
              value={q.data.users.total}
              icon={Users}
              tone="brand"
              hint={`${q.data.users.clients} clientes`}
            />
            <StatCard
              label="Bancos de dados"
              value={q.data.databases}
              icon={Database}
              tone="info"
              hint="Provisionados na frota"
            />
          </div>

          <Card className="mt-4 flex items-center gap-4 border-accent-soft">
            <span
              aria-hidden="true"
              className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"
            >
              <CircleDollarSign size={24} />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-text3">
                Receita estimada / mês
              </p>
              <p className="mt-0.5 text-3xl font-bold leading-tight text-text">
                {formatCents(q.data.monthlyRevenueCents)}
              </p>
              <p className="mt-0.5 text-xs text-text3">
                Projeção a partir dos ambientes ativos e seus planos.
              </p>
            </div>
          </Card>

          <h2 className="mb-3 mt-8 text-lg font-semibold text-text">
            Atalhos
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {QUICK_LINKS.map((l) => {
              const Icon = l.icon;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className="vp-card-shadow group flex items-center gap-3 rounded-xl border border-border-subtle bg-surface p-4 transition-colors hover:border-accent hover:bg-bg"
                >
                  <span
                    aria-hidden="true"
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"
                  >
                    <Icon size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-text">{l.label}</p>
                    <p className="truncate text-xs text-text3">{l.desc}</p>
                  </div>
                  <ArrowRight
                    size={18}
                    aria-hidden="true"
                    className="shrink-0 text-text3 transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
                  />
                </Link>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
