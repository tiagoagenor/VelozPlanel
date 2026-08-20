"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SlidersHorizontal, AlertTriangle, Info } from "lucide-react";
import {
  resourceChangeInput,
  PLANS,
  type AdminEnvironment,
} from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { CenterLoader } from "@/components/Skeletons";
import { EnvStateBadge } from "@/components/EnvStateBadge";
import { formatDateTime } from "@/lib/format";

const VCPU_OPTIONS = ["0.5", "1", "1.5", "2", "3", "4"];
const MEM_OPTIONS = ["512", "1024", "2048", "4096", "8192"];

function memLabel(mb: string): string {
  const n = Number(mb);
  return n >= 1024 ? `${n / 1024} GB` : `${n} MB`;
}

export default function AdminEnvironmentsPage() {
  const q = useQuery({
    queryKey: ["admin", "environments"],
    queryFn: api.listAllEnvironments,
  });
  const [editing, setEditing] = React.useState<AdminEnvironment | null>(null);

  return (
    <>
      <header className="mb-6">
        <h1 className="text-[28px] font-bold leading-tight text-text">
          Ambientes
        </h1>
        <p className="mt-1 text-sm text-text2">
          Frota completa: dono, nó, plano, runtime e estado.
        </p>
      </header>

      {q.isPending ? (
        <CenterLoader minHeight="45vh" />
      ) : q.isError ? (
        <Card className="flex items-start gap-3">
          <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          <p role="alert" className="font-medium text-text">
            Não foi possível carregar os ambientes.
          </p>
        </Card>
      ) : q.data.length === 0 ? (
        <Card>
          <p className="text-text2">Nenhum ambiente na frota.</p>
        </Card>
      ) : (
        <>
          {/* Desktop: tabela */}
          <Card className="hidden overflow-x-auto p-0 lg:block">
            <table className="w-full min-w-[60rem] border-collapse text-sm">
              <caption className="sr-only">
                Frota de ambientes com nome, dono, nó, plano, runtime, estado e data de criação.
              </caption>
              <thead>
                <tr className="border-b border-border-subtle bg-bg text-left text-text3">
                  <th scope="col" className="px-4 py-3 font-semibold">Nome</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Dono</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Nó</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Plano</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Runtime</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Estado</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Criado</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((env) => (
                  <tr key={env.id} className="border-b border-border-subtle last:border-0 hover:bg-bg">
                    <td className="px-4 py-3 font-medium text-text">{env.name}</td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-text2">{env.ownerEmail}</span>
                    </td>
                    <td className="px-4 py-3 text-text2">{env.nodeName ?? "—"}</td>
                    <td className="px-4 py-3 text-text2">{PLANS[env.plan]?.label ?? env.plan}</td>
                    <td className="px-4 py-3 text-text2">{env.runtime.kind} {env.runtime.version}</td>
                    <td className="px-4 py-3"><EnvStateBadge state={env.state} /></td>
                    <td className="px-4 py-3 text-text2">{formatDateTime(env.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(env)} aria-label={`Alterar recursos de ${env.name}`}>
                        <SlidersHorizontal size={15} aria-hidden="true" />
                        Alterar recursos
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Mobile/tablet: cards */}
          <ul className="flex flex-col gap-3 lg:hidden">
            {q.data.map((env) => (
              <li key={env.id} className="vp-card-shadow rounded-xl border border-border-subtle bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-text">{env.name}</p>
                    <p className="truncate font-mono text-xs text-text3">{env.ownerEmail}</p>
                  </div>
                  <EnvStateBadge state={env.state} />
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border-subtle pt-3 text-sm">
                  <div><dt className="text-xs text-text3">Nó</dt><dd className="text-text">{env.nodeName ?? "—"}</dd></div>
                  <div><dt className="text-xs text-text3">Plano</dt><dd className="text-text">{PLANS[env.plan]?.label ?? env.plan}</dd></div>
                  <div><dt className="text-xs text-text3">Runtime</dt><dd className="text-text">{env.runtime.kind} {env.runtime.version}</dd></div>
                </dl>
                <p className="mt-3 text-xs text-text3">Criado: {formatDateTime(env.createdAt)}</p>
                <div className="mt-3">
                  <Button variant="outline" size="sm" onClick={() => setEditing(env)} className="w-full">
                    <SlidersHorizontal size={15} aria-hidden="true" />
                    Alterar recursos
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <ChangeResourcesDialog env={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function ChangeResourcesDialog({
  env,
  onClose,
}: {
  env: AdminEnvironment | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [vcpu, setVcpu] = React.useState("1");
  const [mem, setMem] = React.useState("1024");
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (env) {
      const plan = PLANS[env.plan];
      setVcpu(plan ? String(plan.vcpu) : "1");
      setMem(plan ? String(plan.memMb) : "1024");
      setReason("");
      setError(null);
    }
  }, [env]);

  const m = useMutation({
    mutationFn: () =>
      api.changeResources(env!.id, {
        vcpu: Number(vcpu),
        memMb: Number(mem),
        reason,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "environments"] });
      qc.invalidateQueries({ queryKey: ["admin", "audit"] });
      toast.show("success", "Recursos atualizados.");
      onClose();
    },
    onError: (e) => toast.show("error", e instanceof Error ? e.message : "Falha ao alterar recursos."),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = resourceChangeInput.safeParse({
      vcpu: Number(vcpu),
      memMb: Number(mem),
      reason,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Verifique os campos.");
      return;
    }
    m.mutate();
  }

  if (!env) return null;

  return (
    <Dialog open={env !== null} onClose={onClose} title={`Alterar recursos — ${env.name}`} description="Ajuste a cota de CPU e memória do ambiente.">
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <div className="flex flex-col gap-1.5">
          <span className="block text-sm font-medium text-text2">vCPU</span>
          <SegmentedControl
            label="Cota de vCPU"
            value={vcpu}
            onChange={setVcpu}
            options={VCPU_OPTIONS.map((v) => ({ value: v, label: v }))}
            variant="strip"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="block text-sm font-medium text-text2">Memória (RAM)</span>
          <SegmentedControl
            label="Teto de memória"
            value={mem}
            onChange={setMem}
            options={MEM_OPTIONS.map((v) => ({ value: v, label: memLabel(v) }))}
            variant="strip"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cr-reason">Motivo (obrigatório)</Label>
          <Input id="cr-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: upgrade solicitado pelo cliente #123" autoComplete="off" />
          <p className="text-xs text-text3">Fica registrado na auditoria.</p>
        </div>

        <p className="flex items-start gap-2 rounded-lg border border-border-subtle bg-bg p-3 text-sm text-text2">
          <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-info" />
          <span>
            Se o ambiente estiver <strong>rodando</strong>, a mudança é aplicada a
            quente (sem recriar o container).
          </span>
        </p>

        {error ? (
          <p role="alert" className="flex items-center gap-2 text-sm font-medium text-danger">
            <AlertTriangle size={16} aria-hidden="true" />
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={m.isPending}>
            {m.isPending ? "Aplicando…" : "Aplicar"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
