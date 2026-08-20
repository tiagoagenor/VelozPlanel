"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { NodeStatus } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { AppHeader } from "@/components/AppHeader";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";

const STATUS_META: Record<
  NodeStatus,
  { tone: "success" | "warning" | "danger"; icon: string; label: string }
> = {
  online: { tone: "success", icon: "✓", label: "Online" },
  degraded: { tone: "warning", icon: "⚠", label: "Degradado" },
  offline: { tone: "danger", icon: "⚠", label: "Offline" },
};

export default function AdminNodesPage() {
  const meQuery = useQuery({ queryKey: ["me"], queryFn: api.me });

  const isAdmin = meQuery.data?.role === "admin";

  const nodesQuery = useQuery({
    queryKey: ["nodes"],
    queryFn: api.listNodes,
    enabled: isAdmin,
  });

  return (
    <div className="min-h-screen bg-bg">
      <AppHeader />
      <main id="conteudo" className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-text">Nós</h1>
          <p className="text-sm text-text2">
            Servidores que executam os ambientes (visão de administrador).
          </p>
        </div>

        {meQuery.isPending ? (
          <p className="text-text2">Verificando permissões…</p>
        ) : !isAdmin ? (
          <Card>
            <p role="alert" className="text-text">
              ⚠ Acesso restrito. Esta página é exclusiva de administradores.
            </p>
            <p className="mt-2 text-sm text-text2">
              <Link href="/" className="text-link hover:underline">
                Voltar aos ambientes
              </Link>
            </p>
          </Card>
        ) : nodesQuery.isPending ? (
          <p className="text-text2">Carregando nós…</p>
        ) : nodesQuery.isError ? (
          <p role="alert" className="text-danger">
            ⚠ Não foi possível carregar os nós.
          </p>
        ) : nodesQuery.data.length === 0 ? (
          <Card>
            <p className="text-text2">Nenhum nó registrado.</p>
          </Card>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <caption className="sr-only">
                Lista de nós com nome, região, status, capacidade e último contato.
              </caption>
              <thead>
                <tr className="border-b border-border text-left text-text3">
                  <th scope="col" className="py-2 pr-4 font-medium">Nome</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Região</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                  <th scope="col" className="py-2 pr-4 font-medium">vCPU</th>
                  <th scope="col" className="py-2 pr-4 font-medium">RAM (MB)</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Ambientes</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Último contato</th>
                </tr>
              </thead>
              <tbody>
                {nodesQuery.data.map((node) => {
                  const s = STATUS_META[node.status];
                  return (
                    <tr key={node.id} className="border-b border-border-subtle">
                      <td className="py-3 pr-4 font-medium text-text">{node.name}</td>
                      <td className="py-3 pr-4 text-text2">{node.region}</td>
                      <td className="py-3 pr-4">
                        <Badge tone={s.tone} aria-label={`Status: ${s.label}`}>
                          <span aria-hidden="true">{s.icon}</span>
                          <span>{s.label}</span>
                        </Badge>
                      </td>
                      <td className="py-3 pr-4 text-text2">{node.vcpuTotal}</td>
                      <td className="py-3 pr-4 text-text2">{node.memMbTotal}</td>
                      <td className="py-3 pr-4 text-text2">{node.envCount}</td>
                      <td className="py-3 pr-4 text-text2">
                        {formatDateTime(node.lastSeenAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
