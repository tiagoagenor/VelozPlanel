"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Search, ShieldCheck, Lock } from "lucide-react";
import type { AuditEntry } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CenterLoader } from "@/components/Skeletons";
import { formatDateTime } from "@/lib/format";

export default function AdminAuditPage() {
  const q = useQuery({ queryKey: ["admin", "audit"], queryFn: () => api.listAudit(200) });
  const [filter, setFilter] = React.useState("");

  const rows = React.useMemo(() => {
    const list = [...(q.data ?? [])].sort(
      (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime(),
    );
    const f = filter.trim().toLowerCase();
    if (!f) return list;
    return list.filter((e) =>
      [e.actorEmail, e.actorRole, e.action, e.target, e.detail, e.ip]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(f)),
    );
  }, [q.data, filter]);

  return (
    <>
      <header className="mb-6">
        <h1 className="text-[28px] font-bold leading-tight text-text">Auditoria</h1>
        <p className="mt-1 text-sm text-text2">
          Registro imutável das ações administrativas (mais recentes primeiro).
        </p>
      </header>

      <p className="mb-5 flex items-start gap-2 rounded-lg border border-border-subtle bg-bg p-3 text-sm text-text2">
        <Lock size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-neutral" />
        <span>Este registro é somente leitura e não pode ser alterado nem apagado pelo painel.</span>
      </p>

      {q.isPending ? (
        <CenterLoader minHeight="40vh" />
      ) : q.isError ? (
        <Card className="flex items-start gap-3">
          <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          <p role="alert" className="font-medium text-text">Não foi possível carregar a auditoria.</p>
        </Card>
      ) : (
        <>
          <div className="relative mb-4 max-w-md">
            <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text3" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filtrar por ator, ação, alvo, IP…"
              aria-label="Filtrar registros de auditoria"
              className="pl-9"
            />
          </div>

          {rows.length === 0 ? (
            <Card>
              <p className="text-text2">
                {filter ? "Nenhum registro corresponde ao filtro." : "Nenhum registro de auditoria."}
              </p>
            </Card>
          ) : (
            <>
              {/* Desktop: tabela */}
              <Card className="hidden overflow-x-auto p-0 lg:block">
                <table className="w-full min-w-[64rem] border-collapse text-sm">
                  <caption className="sr-only">Registros de auditoria: data, ator, papel, ação, alvo, detalhe e IP.</caption>
                  <thead>
                    <tr className="border-b border-border-subtle bg-bg text-left text-text3">
                      <th scope="col" className="px-4 py-3 font-semibold">Data/hora</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Ator</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Papel</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Ação</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Alvo</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Detalhe</th>
                      <th scope="col" className="px-4 py-3 font-semibold">IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((e) => (
                      <tr key={e.id} className="border-b border-border-subtle last:border-0 align-top hover:bg-bg">
                        <td className="whitespace-nowrap px-4 py-3 text-text2">{formatDateTime(e.ts)}</td>
                        <td className="px-4 py-3 font-mono text-xs text-text2">{e.actorEmail}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1 text-xs text-text2">
                            {e.actorRole === "admin" ? <ShieldCheck size={12} aria-hidden="true" /> : null}
                            {e.actorRole}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-text">{e.action}</td>
                        <td className="px-4 py-3 font-mono text-xs text-text2">{e.target ?? "—"}</td>
                        <td className="max-w-[20rem] px-4 py-3 text-text2">{e.detail ?? "—"}</td>
                        <td className="px-4 py-3 font-mono text-xs text-text2">{e.ip ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>

              {/* Mobile/tablet: cards */}
              <ul className="flex flex-col gap-3 lg:hidden">
                {rows.map((e) => (
                  <li key={e.id} className="vp-card-shadow rounded-xl border border-border-subtle bg-surface p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-text">{e.action}</span>
                      <span className="whitespace-nowrap text-xs text-text3">{formatDateTime(e.ts)}</span>
                    </div>
                    <p className="mt-2 font-mono text-xs text-text2">{e.actorEmail} · {e.actorRole}</p>
                    {e.target ? <p className="mt-1 font-mono text-xs text-text2">Alvo: {e.target}</p> : null}
                    {e.detail ? <p className="mt-1 text-sm text-text2">{e.detail}</p> : null}
                    {e.ip ? <p className="mt-1 font-mono text-xs text-text3">IP: {e.ip}</p> : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </>
  );
}
