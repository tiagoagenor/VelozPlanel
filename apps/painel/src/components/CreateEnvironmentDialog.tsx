"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import {
  RUNTIME_VERSIONS,
  RECOMMENDED_VERSION,
  createEnvironmentInput,
  planMeetsType,
  type RuntimeKind,
  type EnvType,
  type RegionOption,
} from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import { usePlans } from "@/lib/usePlans";
import { Dialog } from "@/components/ui/dialog";
import { TechIconById } from "@/components/TechIcon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatCents } from "@/lib/format";

type Mode = "code" | "service";
type Step = 1 | 2;
type Filter = "all" | "code" | "service";

function validateName(v: string): string | null {
  if (v.length < 2) return "Use ao menos 2 caracteres.";
  if (v.length > 40) return "Máximo de 40 caracteres.";
  if (!/^[a-z0-9-]+$/.test(v)) return "Use só letras minúsculas, números e hífen.";
  return null;
}

export function CreateEnvironmentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { plans, byId } = usePlans();

  const [step, setStep] = React.useState<Step>(1);
  const [filter, setFilter] = React.useState<Filter>("all");
  const [mode, setMode] = React.useState<Mode | undefined>(undefined);
  const [name, setName] = React.useState("");
  const [nameTouched, setNameTouched] = React.useState(false);
  const [plan, setPlan] = React.useState<string>("");
  const [kind, setKind] = React.useState<RuntimeKind>("php");
  const [version, setVersion] = React.useState<string>(RECOMMENDED_VERSION.php);
  const [serviceType, setServiceType] = React.useState<string>("");
  const [region, setRegion] = React.useState<string>("");
  const [error, setError] = React.useState<string | null>(null);

  const nameRef = React.useRef<HTMLInputElement>(null);

  const typesQ = useQuery({ queryKey: ["env-types-public"], queryFn: api.listServiceTypes, enabled: open });
  const regionsQ = useQuery({ queryKey: ["regions"], queryFn: api.listRegions, enabled: open });
  const balanceQ = useQuery({ queryKey: ["balance"], queryFn: api.getBalance, enabled: open });
  const regions = regionsQ.data ?? [];
  const selectedRegion = regions.find((r) => r.region === region) ?? null;
  const allTypes = typesQ.data ?? [];
  const codeTypes = allTypes.filter((t) => t.category === "app");
  const serviceTypes = allTypes.filter((t) => t.category !== "app");
  const ordered = [...codeTypes, ...serviceTypes];
  const shownTypes = filter === "code" ? codeTypes : filter === "service" ? serviceTypes : ordered;
  const versions = RUNTIME_VERSIONS[kind];

  React.useEffect(() => {
    setVersion(RECOMMENDED_VERSION[kind]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  React.useEffect(() => {
    if (!open) return;
    if (plans.length > 0 && !byId.has(plan)) setPlan(plans[0]!.id);
  }, [open, plans, byId, plan]);

  React.useEffect(() => {
    if (!open || region) return;
    const firstOnline = regions.find((r) => r.online) ?? regions[0];
    if (firstOnline) setRegion(firstOnline.region);
  }, [open, regions, region]);

  const nameError = nameTouched ? validateName(name) : null;
  const isService = mode === "service";
  const selectedPlan = byId.get(plan);
  const selectedType = isService ? serviceTypes.find((t) => t.id === serviceType) ?? null : null;
  const currentKey = mode === "code" ? `code:${kind}` : mode === "service" && serviceType ? `svc:${serviceType}` : "";

  // Preço: cobra 1× o container (mesmo em stack — o banco-filho vai junto, não
  // dobra). O requisito mínimo de recursos, sim, considera o banco-filho.
  const containersOf = (_t: EnvType) => 1;
  const adderTotalOf = React.useCallback((t: EnvType) => t.priceMonthCents, []);
  const effectiveMin = React.useCallback((t: EnvType) => {
    let minVcpu = t.minVcpu, minMemMb = t.minMemMb;
    if (t.category === "stack" && t.childType) {
      const child = allTypes.find((c) => c.id === t.childType);
      if (child) { minVcpu = Math.max(minVcpu, child.minVcpu); minMemMb = Math.max(minMemMb, child.minMemMb); }
    }
    return { minVcpu, minMemMb };
  }, [allTypes]);
  const planMeets = React.useCallback((p: { vcpu: number; memMb: number }, t: EnvType) => planMeetsType(p, effectiveMin(t)), [effectiveMin]);

  // "A partir de": menor plano que atende o tipo (para o card do passo 1).
  const fromPriceOf = React.useCallback((t: EnvType): number | null => {
    const valid = plans.filter((p) => planMeets(p, t)).sort((a, b) => a.priceMonthCents - b.priceMonthCents);
    const p = valid[0];
    return p ? p.priceMonthCents * containersOf(t) + adderTotalOf(t) : null;
  }, [plans, planMeets, adderTotalOf]);

  const curType: EnvType | null = mode === "code" ? codeTypes.find((t) => t.id === kind) ?? null : selectedType;
  const runningMonthCents = selectedPlan
    ? selectedPlan.priceMonthCents * (curType ? containersOf(curType) : 1) + (curType ? adderTotalOf(curType) : 0)
    : 0;

  // Trava de saldo: (dinheiro + bônus) precisa cobrir ao menos 1 hora do container.
  const hourlyCents = Math.ceil(runningMonthCents / 720);
  const balanceCents = balanceQ.data?.balanceCents ?? null;
  const insufficientBalance = balanceCents != null && !!selectedPlan && balanceCents < hourlyCents;

  const selectedLabel = mode === "code" ? codeTypes.find((t) => t.id === kind)?.label ?? kind : selectedType?.label ?? "";

  // Auto-seleciona o menor plano que atende ao tipo escolhido (passo 2).
  React.useEffect(() => {
    if (!curType || !selectedPlan) return;
    if (planMeets(selectedPlan, curType)) return;
    const valid = plans.filter((p) => planMeets(p, curType)).sort((a, b) => a.priceMonthCents - b.priceMonthCents);
    if (valid[0]) setPlan(valid[0].id);
  }, [curType, selectedPlan, plans, planMeets]);

  function pick(key: string) {
    if (key.startsWith("code:")) {
      setMode("code");
      setKind(key.slice(5) as RuntimeKind);
    } else if (key.startsWith("svc:")) {
      setMode("service");
      setServiceType(key.slice(4));
    }
  }

  const mutation = useMutation({
    mutationFn: api.createEnvironment,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["environments"] });
      resetAndClose();
    },
    onError: (err) => setError(err instanceof ApiError && err.message ? err.message : err instanceof Error ? err.message : "Falha ao criar ambiente."),
  });

  function resetAndClose() {
    setStep(1);
    setFilter("all");
    setMode(undefined);
    setName("");
    setNameTouched(false);
    setPlan(plans[0]?.id ?? "");
    setKind("php");
    setVersion(RECOMMENDED_VERSION.php);
    setServiceType("");
    setRegion("");
    setError(null);
    onClose();
  }

  React.useEffect(() => {
    if (step === 2) requestAnimationFrame(() => nameRef.current?.focus());
  }, [step]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (step === 1) {
      if (!currentKey) return;
      setStep(2);
      return;
    }
    setNameTouched(true);
    if (validateName(name)) { nameRef.current?.focus(); return; }
    const base = { name, plan, region: region || undefined };
    const body = isService ? { ...base, type: serviceType } : { ...base, runtime: { kind, version } };
    const parsed = createEnvironmentInput.safeParse(body);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Dados inválidos. Revise os campos."); return; }
    mutation.mutate(parsed.data);
  }

  const canAdvance = step === 1 ? !!currentKey : !validateName(name) && !!plan;

  return (
    <Dialog
      open={open}
      onClose={resetAndClose}
      title="Criar ambiente"
      description={step === 1 ? "Passo 1 de 2 — escolha o tipo" : "Passo 2 de 2 — configure"}
      className="w-[min(94vw,54rem)]"
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <div className="min-h-[420px]">
          {step === 1 ? (
            <div className="flex flex-col gap-4">
              {/* Filtro */}
              <div className="flex gap-1">
                {([["all", "Tudo"], ["code", "Código"], ["service", "Serviços"]] as const).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setFilter(v)}
                    className={cn(
                      "rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                      filter === v ? "bg-brand-soft text-brand-strong" : "text-text2 hover:bg-bg hover:text-text",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {typesQ.isPending ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-[128px] animate-pulse rounded-[12px] border border-border bg-bg" />)}
                </div>
              ) : typesQ.isError ? (
                <div className="flex flex-col items-start gap-2 text-sm">
                  <p className="flex items-center gap-2 text-danger"><AlertTriangle size={16} /> Não foi possível carregar as opções.</p>
                  <Button variant="outline" size="sm" onClick={() => typesQ.refetch()}>Tentar novamente</Button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {shownTypes.map((t) => {
                    const code = t.category === "app";
                    const key = code ? `code:${t.id}` : `svc:${t.id}`;
                    return (
                      <TypeCard
                        key={t.id}
                        id={key}
                        typeId={t.id}
                        label={t.label}
                        category={code ? "Código" : t.category === "stack" ? "App + banco" : "Serviço"}
                        fromCents={fromPriceOf(t)}
                        selected={currentKey === key}
                        onPick={pick}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[1fr_248px]">
              {/* Form */}
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="env-name" className="text-[13px] font-medium text-text2">Nome do ambiente</label>
                  <input
                    id="env-name"
                    ref={nameRef}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => setNameTouched(true)}
                    placeholder={isService ? "meu-banco" : "meu-site"}
                    autoComplete="off"
                    aria-invalid={!!nameError}
                    className={cn(fieldCls, nameError && "border-danger")}
                  />
                  <p className={cn("text-xs", nameError ? "text-danger" : "text-text3")}>
                    {nameError ?? "2 a 40 caracteres: letras minúsculas, números e hífen."}
                  </p>
                </div>

                {mode === "code" ? (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="env-version" className="text-[13px] font-medium text-text2">Versão</label>
                    <select id="env-version" value={version} onChange={(e) => setVersion(e.target.value)} className={fieldCls}>
                      {versions.map((v) => (
                        <option key={v} value={v}>{kind === "php" ? "PHP" : "Node.js"} {v}</option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="env-plan" className="text-[13px] font-medium text-text2">Plano</label>
                  <select id="env-plan" value={plan} onChange={(e) => setPlan(e.target.value)} className={fieldCls}>
                    {(curType ? plans.filter((p) => planMeets(p, curType)) : plans).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label} · {p.vcpu} vCPU · {p.memMb} MB · {p.diskGb} GB
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-[13px] font-medium text-text2">Região</span>
                  {regionsQ.isPending ? (
                    <div className="h-16 animate-pulse rounded-[10px] border border-border bg-bg" />
                  ) : regions.length === 0 ? (
                    <p className="text-sm text-text2">Nenhuma região disponível.</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {regions.map((r) => (
                        <RegionCard key={r.region} r={r} selected={region === r.region} onSelect={() => setRegion(r.region)} />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Resumo */}
              <aside className="h-fit rounded-[12px] border border-border bg-bg/60 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text3">Resumo</p>
                <dl className="mt-3 flex flex-col gap-2.5 text-[13px]">
                  <SummaryRow label="Tipo" value={selectedLabel} />
                  <SummaryRow label="Plano" value={selectedPlan?.label ?? "—"} />
                  <SummaryRow label="vCPU" value={selectedPlan ? String(selectedPlan.vcpu) : "—"} />
                  <SummaryRow label="Memória" value={selectedPlan ? `${selectedPlan.memMb} MB` : "—"} />
                  <SummaryRow label="Disco" value={selectedPlan ? `${selectedPlan.diskGb} GB` : "—"} />
                  <SummaryRow label="Região" value={selectedRegion?.region ?? "—"} />
                </dl>
                <div className="mt-3 border-t border-border pt-3">
                  <p className="text-[13px] text-text2">Estimativa</p>
                  <p className="mt-0.5 font-bold leading-none text-text">
                    <span className="text-[30px]">{formatCents(runningMonthCents)}</span>
                    <span className="ml-0.5 text-[12px] font-normal text-text3">/mês</span>
                  </p>
                  <p className="mt-1 text-[12px] text-text3">
                    ≈ {formatCents(hourlyCents)}/hora · debitado do saldo. Pause quando quiser.
                  </p>
                  {balanceCents != null ? (
                    <p className="mt-2 text-[12px] text-text2">
                      Seu saldo: <span className="font-semibold text-text">{formatCents(balanceCents)}</span>
                      {balanceQ.data?.bonusCents ? <span className="text-text3"> (bônus {formatCents(balanceQ.data.bonusCents)})</span> : null}
                    </p>
                  ) : null}
                  {insufficientBalance ? (
                    <p role="alert" className="mt-2 flex items-start gap-1.5 rounded-lg bg-danger/10 px-2.5 py-2 text-[12px] font-medium text-danger">
                      <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                      Saldo insuficiente: você precisa de ao menos {formatCents(hourlyCents)} (1 hora) para criar. Adicione saldo.
                    </p>
                  ) : null}
                </div>
              </aside>
            </div>
          )}
        </div>

        {error ? (
          <p role="alert" className="flex items-center gap-2 text-sm font-medium text-danger">
            <AlertTriangle size={16} aria-hidden="true" /> {error}
          </p>
        ) : null}

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <div aria-hidden="true" className="flex items-center gap-1.5">
            <span className={cn("h-1.5 rounded-full transition-all", step === 1 ? "w-6 bg-brand" : "w-3 bg-border")} />
            <span className={cn("h-1.5 rounded-full transition-all", step === 2 ? "w-6 bg-brand" : "w-3 bg-border")} />
          </div>
          <div className="flex items-center gap-2">
            {step === 1 ? (
              <Button variant="outline" type="button" onClick={resetAndClose}>Cancelar</Button>
            ) : (
              <Button variant="outline" type="button" onClick={() => setStep(1)}>Voltar</Button>
            )}
            <Button type="submit" disabled={!canAdvance || (step === 2 && (mutation.isPending || insufficientBalance))}>
              {step === 1 ? "Continuar" : mutation.isPending ? "Criando…" : "Criar ambiente"}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

const fieldCls =
  "w-full rounded-[10px] border border-border bg-surface px-3.5 py-2.5 text-[14px] text-text outline-none transition-colors placeholder:text-text3 focus:border-brand-strong focus:ring-2 focus:ring-brand/20";

/* ─────────────── Passo 1: card do tipo ─────────────── */

function TypeCard({
  id,
  typeId,
  label,
  category,
  fromCents,
  selected,
  onPick,
}: {
  id: string;
  typeId: string;
  label: string;
  category: string;
  fromCents: number | null;
  selected: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col gap-2 rounded-[12px] border p-3.5 transition-colors",
        selected ? "border-brand-strong bg-brand-soft/60" : "border-border hover:border-brand-strong/50 hover:bg-bg",
      )}
    >
      <input type="radio" name="pick" value={id} className="sr-only" checked={selected} onChange={() => onPick(id)} />
      <TechIconById id={typeId} size={34} />
      <div className="mt-0.5">
        <p className="text-[15px] font-semibold text-text">{label}</p>
        <p className="text-[12px] text-text3">{category}</p>
      </div>
      <p className="text-[12.5px] font-medium tabular-nums text-text2">
        {fromCents == null ? "sem plano compatível" : `a partir de ${formatCents(fromCents)}/mês`}
      </p>
    </label>
  );
}

/* ─────────────── Passo 2: radio-card de região + resumo ─────────────── */

function RegionCard({ r, selected, onSelect }: { r: RegionOption; selected: boolean; onSelect: () => void }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-[10px] border p-3 transition-colors",
        selected ? "border-brand-strong bg-brand-soft/50" : "border-border hover:border-brand-strong/50",
        !r.online && "opacity-60",
      )}
    >
      <input type="radio" name="region" className="mt-0.5 h-4 w-4 accent-brand" checked={selected} onChange={onSelect} disabled={!r.online} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-medium text-text">{r.region}</span>
          {r.alert ? (
            <span className="vp-pill vp-pill-warning inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium">
              <AlertTriangle size={11} aria-hidden="true" /> {r.alert}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-[12.5px] text-text3">{r.online ? "Servidor disponível." : "Offline no momento."}</p>
      </div>
    </label>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-text2">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-text">{value}</dd>
    </div>
  );
}
