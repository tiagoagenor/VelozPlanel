"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Info } from "lucide-react";
import * as api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { CenterLoader } from "@/components/Skeletons";
import { formatBytes } from "@/lib/format";
import { formatCents, formatCentsFine } from "@/lib/format";

export default function AdminPlansPage() {
  const q = useQuery({ queryKey: ["admin", "plans"], queryFn: api.listPlans });

  return (
    <>
      <header className="mb-6">
        <h1 className="text-[28px] font-bold leading-tight text-text">Planos</h1>
        <p className="mt-1 text-sm text-text2">
          Cotas e preços de cada plano oferecido.
        </p>
      </header>

      <p className="mb-5 flex items-start gap-2 rounded-lg border border-border-subtle bg-bg p-3 text-sm text-text2">
        <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-info" />
        <span>Somente leitura por enquanto. A edição de preços entra com o billing.</span>
      </p>

      {q.isPending ? (
        <CenterLoader minHeight="40vh" />
      ) : q.isError ? (
        <Card className="flex items-start gap-3">
          <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          <p role="alert" className="font-medium text-text">Não foi possível carregar os planos.</p>
        </Card>
      ) : (
        <>
          {/* Desktop: tabela */}
          <Card className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full min-w-[48rem] border-collapse text-sm">
              <caption className="sr-only">Planos com cotas de vCPU, RAM, disco e preços.</caption>
              <thead>
                <tr className="border-b border-border-subtle bg-bg text-left text-text3">
                  <th scope="col" className="px-4 py-3 font-semibold">Plano</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">vCPU</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">RAM</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Disco</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">R$/mês</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">R$/h ativo</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">R$/h pausado</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((p) => (
                  <tr key={p.id} className="border-b border-border-subtle last:border-0 hover:bg-bg">
                    <td className="px-4 py-3 font-medium text-text">{p.label}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text2">{p.vcpu}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text2">{formatBytes(p.memMb * 1024 * 1024)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text2">{p.diskGb} GB</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-text">{formatCents(p.priceMonthCents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text2">{formatCentsFine(p.hourlyActiveCents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text2">{formatCentsFine(p.hourlyPausedCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Mobile: cards */}
          <ul className="flex flex-col gap-3 md:hidden">
            {q.data.map((p) => (
              <li key={p.id} className="vp-card-shadow rounded-xl border border-border-subtle bg-surface p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-text">{p.label}</p>
                  <p className="font-semibold text-text">{formatCents(p.priceMonthCents)}<span className="text-xs font-normal text-text3">/mês</span></p>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border-subtle pt-3 text-sm">
                  <div><dt className="text-xs text-text3">vCPU</dt><dd className="tabular-nums text-text">{p.vcpu}</dd></div>
                  <div><dt className="text-xs text-text3">RAM</dt><dd className="tabular-nums text-text">{formatBytes(p.memMb * 1024 * 1024)}</dd></div>
                  <div><dt className="text-xs text-text3">Disco</dt><dd className="tabular-nums text-text">{p.diskGb} GB</dd></div>
                </dl>
                <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-border-subtle pt-3 text-sm">
                  <div><dt className="text-xs text-text3">R$/h ativo</dt><dd className="tabular-nums text-text2">{formatCentsFine(p.hourlyActiveCents)}</dd></div>
                  <div><dt className="text-xs text-text3">R$/h pausado</dt><dd className="tabular-nums text-text2">{formatCentsFine(p.hourlyPausedCents)}</dd></div>
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
