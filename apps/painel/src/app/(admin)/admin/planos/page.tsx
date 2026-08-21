"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  Ban,
  Boxes,
} from "lucide-react";
import {
  createPlanInput,
  updatePlanInput,
  type Plan,
} from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { CenterLoader } from "@/components/Skeletons";
import {
  formatBytes,
  formatCents,
  formatCentsFine,
  parseReaisToCents,
  centsToReaisInput,
  hourlyActiveFromMonthly,
} from "@/lib/format";

function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge tone="success" aria-label="Status: ativo">
      <CheckCircle2 size={13} aria-hidden="true" />
      Ativo
    </Badge>
  ) : (
    <Badge tone="neutral" aria-label="Status: inativo">
      <Ban size={13} aria-hidden="true" />
      Inativo
    </Badge>
  );
}

export default function AdminPlansPage() {
  const q = useQuery({ queryKey: ["admin", "plans"], queryFn: api.listAdminPlans });

  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<Plan | null>(null);
  const [deleting, setDeleting] = React.useState<Plan | null>(null);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight text-text">Planos</h1>
          <p className="mt-1 text-sm text-text2">
            Cotas e preços de cada plano oferecido. Crie, edite, ative ou remova.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus size={16} aria-hidden="true" />
          Criar plano
        </Button>
      </header>

      {q.isPending ? (
        <CenterLoader minHeight="40vh" />
      ) : q.isError ? (
        <Card className="flex items-start gap-3">
          <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          <p role="alert" className="font-medium text-text">Não foi possível carregar os planos.</p>
        </Card>
      ) : q.data.length === 0 ? (
        <Card>
          <p className="text-text2">Nenhum plano cadastrado. Crie o primeiro.</p>
        </Card>
      ) : (
        <>
          {/* Desktop: tabela */}
          <Card className="hidden overflow-x-auto p-0 lg:block">
            <table className="w-full min-w-[56rem] border-collapse text-sm">
              <caption className="sr-only">Planos com cotas de vCPU, RAM, disco, preços e status.</caption>
              <thead>
                <tr className="border-b border-border-subtle bg-bg text-left text-text3">
                  <th scope="col" className="px-4 py-3 font-semibold">Plano</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Slug</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">vCPU</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">RAM</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Disco</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    <span className="inline-flex items-center justify-end gap-1">
                      <Boxes size={14} aria-hidden="true" />
                      Máx. ambientes
                    </span>
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">R$/mês</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">R$/h ativo</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((p) => (
                  <tr key={p.id} className="border-b border-border-subtle last:border-0 hover:bg-bg">
                    <td className="px-4 py-3 font-medium text-text">{p.label}</td>
                    <td className="px-4 py-3 font-mono text-xs text-text2">{p.id}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text2">{p.vcpu}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text2">{formatBytes(p.memMb * 1024 * 1024)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text2">{p.diskGb} GB</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text2">{p.maxEnvironments}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-text">{formatCents(p.priceMonthCents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text2">{formatCentsFine(hourlyActiveFromMonthly(p.priceMonthCents))}</td>
                    <td className="px-4 py-3"><ActiveBadge active={p.active} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <ToggleActiveButton plan={p} />
                        <Button variant="ghost" size="sm" onClick={() => setEditing(p)} aria-label={`Editar ${p.label}`}>
                          <Pencil size={15} aria-hidden="true" />
                          Editar
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setDeleting(p)} aria-label={`Excluir ${p.label}`} className="text-danger hover:bg-danger/10">
                          <Trash2 size={15} aria-hidden="true" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Mobile/tablet: cards */}
          <ul className="flex flex-col gap-3 lg:hidden">
            {q.data.map((p) => (
              <li key={p.id} className="vp-card-shadow rounded-xl border border-border-subtle bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-text">{p.label}</p>
                    <p className="font-mono text-xs text-text3">{p.id}</p>
                  </div>
                  <ActiveBadge active={p.active} />
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border-subtle pt-3 text-sm">
                  <div><dt className="text-xs text-text3">vCPU</dt><dd className="tabular-nums text-text">{p.vcpu}</dd></div>
                  <div><dt className="text-xs text-text3">RAM</dt><dd className="tabular-nums text-text">{formatBytes(p.memMb * 1024 * 1024)}</dd></div>
                  <div><dt className="text-xs text-text3">Disco</dt><dd className="tabular-nums text-text">{p.diskGb} GB</dd></div>
                  <div className="col-span-3 flex items-center gap-1.5"><dt className="inline-flex items-center gap-1 text-xs text-text3"><Boxes size={13} aria-hidden="true" />Máx. ambientes</dt><dd className="tabular-nums text-text">{p.maxEnvironments}</dd></div>
                </dl>
                <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-border-subtle pt-3 text-sm">
                  <div><dt className="text-xs text-text3">R$/mês</dt><dd className="font-semibold tabular-nums text-text">{formatCents(p.priceMonthCents)}</dd></div>
                  <div><dt className="text-xs text-text3">R$/h ativo</dt><dd className="tabular-nums text-text2">{formatCentsFine(hourlyActiveFromMonthly(p.priceMonthCents))}</dd></div>
                </dl>
                <div className="mt-3 flex flex-wrap gap-2 border-t border-border-subtle pt-3">
                  <ToggleActiveButton plan={p} />
                  <Button variant="outline" size="sm" onClick={() => setEditing(p)}>
                    <Pencil size={15} aria-hidden="true" />
                    Editar
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setDeleting(p)} className="text-danger">
                    <Trash2 size={15} aria-hidden="true" />
                    Excluir
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <PlanFormDialog mode="create" open={creating} onClose={() => setCreating(false)} />
      <PlanFormDialog mode="edit" plan={editing} open={editing !== null} onClose={() => setEditing(null)} />
      <DeletePlanDialog plan={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}

/* ─────────────── Ativar / desativar ─────────────── */

function ToggleActiveButton({ plan }: { plan: Plan }) {
  const qc = useQueryClient();
  const toast = useToast();

  const m = useMutation({
    mutationFn: () => api.updatePlan(plan.id, { active: !plan.active }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "plans"] });
      qc.invalidateQueries({ queryKey: ["plans"] });
      toast.show("success", plan.active ? "Plano desativado." : "Plano ativado.");
    },
    onError: (e) => toast.show("error", e instanceof Error ? e.message : "Falha ao alterar status."),
  });

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => m.mutate()}
      disabled={m.isPending}
      aria-label={plan.active ? `Desativar ${plan.label}` : `Ativar ${plan.label}`}
    >
      {plan.active ? (
        <>
          <Ban size={15} aria-hidden="true" />
          Desativar
        </>
      ) : (
        <>
          <CheckCircle2 size={15} aria-hidden="true" />
          Ativar
        </>
      )}
    </Button>
  );
}

/* ─────────────── Criar / editar ─────────────── */

function PlanFormDialog({
  mode,
  plan,
  open,
  onClose,
}: {
  mode: "create" | "edit";
  plan?: Plan | null;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [id, setId] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [vcpu, setVcpu] = React.useState("1");
  const [memMb, setMemMb] = React.useState("512");
  const [diskGb, setDiskGb] = React.useState("10");
  const [maxEnvironments, setMaxEnvironments] = React.useState("5");
  const [price, setPrice] = React.useState(""); // em R$
  const [active, setActive] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    if (mode === "edit" && plan) {
      setId(plan.id);
      setLabel(plan.label);
      setVcpu(String(plan.vcpu));
      setMemMb(String(plan.memMb));
      setDiskGb(String(plan.diskGb));
      setMaxEnvironments(String(plan.maxEnvironments));
      setPrice(centsToReaisInput(plan.priceMonthCents));
      setActive(plan.active);
    } else {
      setId("");
      setLabel("");
      setVcpu("1");
      setMemMb("512");
      setDiskGb("10");
      setMaxEnvironments("5");
      setPrice("");
      setActive(true);
    }
    setError(null);
  }, [open, mode, plan]);

  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      mode === "create"
        ? api.createPlan(body as never)
        : api.updatePlan(plan!.id, body as never),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "plans"] });
      qc.invalidateQueries({ queryKey: ["plans"] });
      toast.show("success", mode === "create" ? "Plano criado." : "Plano atualizado.");
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Falha ao salvar o plano."),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const priceMonthCents = parseReaisToCents(price);
    if (priceMonthCents == null || priceMonthCents < 0) {
      setError("Informe um preço válido em R$ (ex.: 30,50).");
      return;
    }

    const nums = {
      vcpu: Number(vcpu),
      memMb: Number(memMb),
      diskGb: Number(diskGb),
      maxEnvironments: Number(maxEnvironments),
      priceMonthCents,
    };

    if (mode === "create") {
      const parsed = createPlanInput.safeParse({ id, label, active, ...nums });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "Verifique os campos.");
        return;
      }
      m.mutate(parsed.data);
    } else {
      const parsed = updatePlanInput.safeParse({ label, active, ...nums });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "Verifique os campos.");
        return;
      }
      m.mutate(parsed.data);
    }
  }

  const cents = parseReaisToCents(price);
  const hourlyHint =
    cents != null && cents >= 0
      ? `${formatCentsFine(hourlyActiveFromMonthly(cents))}/hora ativo`
      : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === "create" ? "Criar plano" : `Editar — ${plan?.label ?? ""}`}
      description={mode === "create" ? "Defina cotas e preço do novo plano." : "O id (slug) não pode ser alterado."}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pf-id">Id (slug)</Label>
            <Input
              id="pf-id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="start"
              autoComplete="off"
              className="font-mono"
              disabled={mode === "edit"}
            />
            {mode === "create" ? (
              <p className="text-xs text-text3">Minúsculas, números e hífen; começa com letra.</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pf-label">Nome</Label>
            <Input id="pf-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Start" autoComplete="off" />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pf-vcpu">vCPU</Label>
            <Input id="pf-vcpu" inputMode="decimal" value={vcpu} onChange={(e) => setVcpu(e.target.value)} placeholder="1" autoComplete="off" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pf-mem">RAM (MB)</Label>
            <Input id="pf-mem" inputMode="numeric" value={memMb} onChange={(e) => setMemMb(e.target.value)} placeholder="512" autoComplete="off" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pf-disk">Disco (GB)</Label>
            <Input id="pf-disk" inputMode="numeric" value={diskGb} onChange={(e) => setDiskGb(e.target.value)} placeholder="10" autoComplete="off" />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pf-maxenv">Máx. ambientes por cliente</Label>
          <Input id="pf-maxenv" type="number" min={1} inputMode="numeric" value={maxEnvironments} onChange={(e) => setMaxEnvironments(e.target.value)} placeholder="5" autoComplete="off" />
          <p className="text-xs text-text3">Quantas máquinas (ambientes) um cliente pode ter neste plano.</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pf-price">Preço mensal (R$)</Label>
          <Input id="pf-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="30,50" autoComplete="off" />
          {hourlyHint ? <p className="text-xs text-text3">{hourlyHint}</p> : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="block text-sm font-medium text-text2">Status</span>
          <SegmentedControl<"active" | "inactive">
            label="Status do plano"
            value={active ? "active" : "inactive"}
            onChange={(v) => setActive(v === "active")}
            options={[
              { value: "active", label: "Ativo" },
              { value: "inactive", label: "Inativo" },
            ]}
            fluid
          />
        </div>

        {error ? (
          <p role="alert" className="flex items-center gap-2 text-sm font-medium text-danger">
            <AlertTriangle size={16} aria-hidden="true" />
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={m.isPending}>
            {m.isPending ? "Salvando…" : mode === "create" ? "Criar plano" : "Salvar"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ─────────────── Excluir ─────────────── */

function DeletePlanDialog({ plan, onClose }: { plan: Plan | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = React.useState<string | null>(null);
  const [inUse, setInUse] = React.useState(false);

  React.useEffect(() => {
    if (plan) {
      setError(null);
      setInUse(false);
    }
  }, [plan]);

  const m = useMutation({
    mutationFn: () => api.deletePlan(plan!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "plans"] });
      qc.invalidateQueries({ queryKey: ["plans"] });
      toast.show("success", "Plano excluído.");
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        setInUse(true);
        setError(e.message || "Este plano está em uso por ambientes.");
      } else {
        setError(e instanceof Error ? e.message : "Falha ao excluir o plano.");
      }
    },
  });

  if (!plan) return null;

  return (
    <Dialog open={plan !== null} onClose={onClose} title="Excluir plano" description="Esta ação não pode ser desfeita.">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text2">
          Excluir o plano <strong className="text-text">{plan.label}</strong> (<span className="font-mono">{plan.id}</span>)?
        </p>
        {error ? (
          <div className="flex flex-col gap-2 rounded-lg border border-danger/40 bg-danger/5 p-3">
            <p role="alert" className="flex items-center gap-2 text-sm font-medium text-danger">
              <AlertTriangle size={16} aria-hidden="true" />
              {error}
            </p>
            {inUse ? (
              <p className="text-sm text-text2">
                Há ambientes usando este plano. Em vez de excluir, você pode
                <strong className="text-text"> desativá-lo</strong> — ele deixa de aparecer para novos ambientes sem afetar os existentes.
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" onClick={() => m.mutate()} disabled={m.isPending}>
            {m.isPending ? "Excluindo…" : "Excluir definitivamente"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
