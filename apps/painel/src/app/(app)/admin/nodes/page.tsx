"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import type { Node, NodeStatus } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";

const STATUS_META: Record<
  NodeStatus,
  { tone: "success" | "warning" | "danger"; icon: LucideIcon; label: string }
> = {
  online: { tone: "success", icon: CheckCircle2, label: "Online" },
  degraded: { tone: "warning", icon: AlertTriangle, label: "Degradado" },
  offline: { tone: "danger", icon: XCircle, label: "Offline" },
};

function StatusBadge({ status }: { status: NodeStatus }) {
  const s = STATUS_META[status];
  const Icon = s.icon;
  return (
    <Badge tone={s.tone} aria-label={`Status: ${s.label}`}>
      <Icon size={13} aria-hidden="true" />
      <span>{s.label}</span>
    </Badge>
  );
}

export default function AdminNodesPage() {
  const meQuery = useQuery({ queryKey: ["me"], queryFn: api.me });

  const isAdmin = meQuery.data?.role === "admin";

  const nodesQuery = useQuery({
    queryKey: ["nodes"],
    queryFn: api.listNodes,
    enabled: isAdmin,
  });

  return (
    <>
      <header className="mb-6">
        <h1 className="text-[28px] font-bold leading-tight text-text">Nós</h1>
        <p className="mt-1 text-sm text-text2">
          Servidores que executam os ambientes (visão de administrador).
        </p>
      </header>

      {meQuery.isPending ? (
        <div className="vp-card-shadow h-40 animate-pulse rounded-xl border border-border-subtle bg-surface" />
      ) : !isAdmin ? (
        <Card className="flex items-start gap-3">
          <ShieldAlert size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          <div>
            <p role="alert" className="font-medium text-text">
              Acesso restrito. Esta página é exclusiva de administradores.
            </p>
            <p className="mt-2 text-sm">
              <Link href="/" className="text-link hover:underline">
                Voltar aos ambientes
              </Link>
            </p>
          </div>
        </Card>
      ) : nodesQuery.isPending ? (
        <div className="vp-card-shadow h-40 animate-pulse rounded-xl border border-border-subtle bg-surface" />
      ) : nodesQuery.isError ? (
        <Card className="flex items-start gap-3">
          <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          <p role="alert" className="font-medium text-text">
            Não foi possível carregar os nós.
          </p>
        </Card>
      ) : nodesQuery.data.length === 0 ? (
        <Card>
          <p className="text-text2">Nenhum nó registrado.</p>
        </Card>
      ) : (
        <>
          {/* Desktop: tabela densa */}
          <Card className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full min-w-[44rem] border-collapse text-sm">
              <caption className="sr-only">
                Lista de nós com nome, região, status, capacidade e último contato.
              </caption>
              <thead>
                <tr className="border-b border-border-subtle bg-bg text-left text-text3">
                  <th scope="col" className="px-4 py-3 font-semibold">Nome</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Região</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">vCPU</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">RAM (MB)</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Ambientes</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Último contato</th>
                </tr>
              </thead>
              <tbody>
                {nodesQuery.data.map((node) => (
                  <tr
                    key={node.id}
                    className="border-b border-border-subtle last:border-0 hover:bg-bg"
                  >
                    <td className="px-4 py-3 font-medium text-text">{node.name}</td>
                    <td className="px-4 py-3 text-text2">{node.region}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={node.status} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-text2">{node.vcpuTotal}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text2">{node.memMbTotal}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text2">{node.envCount}</td>
                    <td className="px-4 py-3 text-text2">{formatDateTime(node.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Mobile: uma linha = um card */}
          <ul className="flex flex-col gap-3 md:hidden">
            {nodesQuery.data.map((node) => (
              <li key={node.id}>
                <NodeCard node={node} />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function NodeCard({ node }: { node: Node }) {
  return (
    <div className="vp-card-shadow rounded-xl border border-border-subtle bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-text">{node.name}</p>
          <p className="text-xs text-text3">{node.region}</p>
        </div>
        <StatusBadge status={node.status} />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border-subtle pt-3 text-sm">
        <NodeStat label="vCPU" value={node.vcpuTotal} />
        <NodeStat label="RAM (MB)" value={node.memMbTotal} />
        <NodeStat label="Ambientes" value={node.envCount} />
      </dl>
      <p className="mt-3 text-xs text-text3">
        Último contato: {formatDateTime(node.lastSeenAt)}
      </p>
    </div>
  );
}

function NodeStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-text3">{label}</dt>
      <dd className="font-medium tabular-nums text-text">{value}</dd>
    </div>
  );
}
