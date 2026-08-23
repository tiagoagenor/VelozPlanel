"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Pencil, CheckCircle2, Ban } from "lucide-react";
import { updateEnvTypeInput, type EnvType } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { CenterLoader } from "@/components/Skeletons";
import { formatCents, parseReaisToCents, centsToReaisInput } from "@/lib/format";

const CATEGORY_LABEL: Record<EnvType["category"], string> = {
  app: "Código",
  service: "Serviço",
  stack: "Stack (app + banco)",
};
const GROUPS: Array<{ cat: EnvType["category"]; title: string }> = [
  { cat: "app", title: "Código" },
  { cat: "service", title: "Serviços" },
  { cat: "stack", title: "Stacks — app + banco" },
];

function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge tone="success" aria-label="Status: ativo"><CheckCircle2 size={13} aria-hidden="true" /> Ativo</Badge>
  ) : (
    <Badge tone="neutral" aria-label="Status: inativo"><Ban size={13} aria-hidden="true" /> Inativo</Badge>
  );
}

export function EnvTypesSection() {
  const q = useQuery({ queryKey: ["admin", "env-types"], queryFn: api.listEnvTypes });
  const [editing, setEditing] = React.useState<EnvType | null>(null);

  return (
    <>
      <header className="mb-6">
        <h1 className="text-[28px] font-bold leading-tight text-text">Tipos de ambiente</h1>
        <p className="mt-1 max-w-2xl text-sm text-text2">
          O preço de compute vem do <strong>plano</strong>. Aqui cada tipo tem um <strong>adicional</strong> opcional
          (padrão R$ 0) e o <strong>requisito mínimo</strong> de recursos — planos abaixo do mínimo ficam bloqueados
          na criação.
        </p>
      </header>

      {q.isPending ? (
        <CenterLoader />
      ) : q.isError ? (
        <Card className="flex items-start gap-3">
          <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          <p role="alert" className="font-medium text-text">Não foi possível carregar os tipos.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {GROUPS.map(({ cat, title }) => {
            const rows = q.data.filter((t) => t.category === cat);
            if (rows.length === 0) return null;
            return (
              <div key={cat}>
                <h2 className="mb-2 text-sm font-semibold text-text2">{title}</h2>
                <Card className="overflow-x-auto p-0">
                  <table className="w-full min-w-[44rem] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border-subtle bg-bg text-left text-text3">
                        <th scope="col" className="px-4 py-2.5 font-semibold">Tipo</th>
                        <th scope="col" className="px-4 py-2.5 font-semibold">Slug</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold">Adicional/mês</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold">vCPU mín.</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold">RAM mín.</th>
                        <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold"><span className="sr-only">Ações</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((t) => (
                        <tr key={t.id} className="border-b border-border-subtle last:border-0 hover:bg-bg">
                          <td className="px-4 py-2.5 font-medium text-text">{t.label}</td>
                          <td className="px-4 py-2.5 font-mono text-xs text-text3">{t.id}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-text">{formatCents(t.priceMonthCents)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-text2">{t.minVcpu || "—"}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-text2">{t.minMemMb ? `${t.minMemMb} MB` : "—"}</td>
                          <td className="px-4 py-2.5"><ActiveBadge active={t.active} /></td>
                          <td className="px-4 py-2.5 text-right">
                            <Button variant="ghost" size="sm" onClick={() => setEditing(t)} aria-label={`Editar ${t.label}`}>
                              <Pencil size={15} aria-hidden="true" /> Editar
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </div>
            );
          })}
        </div>
      )}

      <EditTypeDialog envType={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function EditTypeDialog({ envType, onClose }: { envType: EnvType | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [label, setLabel] = React.useState("");
  const [adder, setAdder] = React.useState("");
  const [minPlanId, setMinPlanId] = React.useState("");
  const [active, setActive] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const plansQ = useQuery({ queryKey: ["admin", "plans"], queryFn: api.listAdminPlans });
  const plans = React.useMemo(
    () => [...(plansQ.data ?? [])].filter((p) => p.active).sort((a, b) => a.vcpu - b.vcpu || a.memMb - b.memMb || a.priceMonthCents - b.priceMonthCents),
    [plansQ.data],
  );

  React.useEffect(() => {
    if (envType) {
      setLabel(envType.label);
      setAdder(centsToReaisInput(envType.priceMonthCents));
      const hasMin = envType.minVcpu > 0 || envType.minMemMb > 0;
      // "Plano mínimo" = o menor plano que já atende o mínimo gravado (0/0 = nenhum).
      const mp = hasMin ? plans.find((p) => p.vcpu >= envType.minVcpu && p.memMb >= envType.minMemMb) : null;
      setMinPlanId(mp ? mp.id : "");
      setActive(envType.active);
      setError(null);
    }
  }, [envType, plans]);

  const mutation = useMutation({
    mutationFn: (input: { label: string; priceMonthCents: number; minVcpu: number; minMemMb: number; active: boolean }) =>
      api.updateEnvType(envType!.id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "env-types"] });
      qc.invalidateQueries({ queryKey: ["env-types-public"] });
      toast.show("success", "Tipo atualizado.");
      onClose();
    },
    onError: (e) => toast.show("error", e instanceof ApiError ? e.message : "Falha ao salvar."),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = parseReaisToCents(adder);
    if (cents === null || cents < 0) return setError("Adicional inválido, ex.: 0,00");
    // O mínimo do tipo = recursos do plano mínimo escolhido (0/0 = sem mínimo).
    const mp = plans.find((p) => p.id === minPlanId);
    const vcpu = mp ? mp.vcpu : 0;
    const mem = mp ? mp.memMb : 0;
    const body = { label: label.trim(), priceMonthCents: cents, minVcpu: vcpu, minMemMb: mem, active };
    const parsed = updateEnvTypeInput.safeParse(body);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
    mutation.mutate(body);
  }

  if (!envType) return null;

  return (
    <Dialog open={envType !== null} onClose={onClose} title={`Tipo — ${envType.label}`} description="Adicional opcional e requisito mínimo de recursos.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-border-subtle bg-bg/40 p-3 text-xs">
          <div><dt className="text-text3">Slug</dt><dd className="font-mono text-text">{envType.id}</dd></div>
          <div><dt className="text-text3">Categoria</dt><dd className="text-text">{CATEGORY_LABEL[envType.category]}</dd></div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="et-label">Nome exibido</Label>
          <Input id="et-label" value={label} onChange={(e) => setLabel(e.target.value)} autoComplete="off" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="et-adder">Adicional do tipo (R$/mês)</Label>
          <Input id="et-adder" inputMode="decimal" value={adder} onChange={(e) => setAdder(e.target.value)} placeholder="0,00" className="font-mono" />
          <p className="text-xs text-text3">Somado ao preço do plano na cobrança. Deixe 0 se o tipo não tem custo extra.</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="et-minplan">Plano mínimo</Label>
          <select
            id="et-minplan"
            value={minPlanId}
            onChange={(e) => setMinPlanId(e.target.value)}
            className="w-full rounded-[10px] border border-border bg-surface px-3.5 py-2.5 text-[14px] text-text outline-none focus:border-brand-strong focus:ring-2 focus:ring-brand/20"
          >
            <option value="">Sem mínimo — roda em qualquer plano</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>{p.label} · {p.vcpu} vCPU · {p.memMb} MB · {p.diskGb} GB</option>
            ))}
          </select>
          <p className="text-xs text-text3">
            O cliente pode escolher este plano <strong>ou maiores</strong> (e aumentar depois); planos menores ficam bloqueados.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-text2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Tipo ativo (aparece na criação de ambientes)
        </label>

        {error ? (
          <p role="alert" className="flex items-center gap-2 text-sm font-medium text-danger">
            <AlertTriangle size={16} aria-hidden="true" /> {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Salvando…" : "Salvar"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

