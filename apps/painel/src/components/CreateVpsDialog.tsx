"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { AlertTriangle, Copy, Check, Download, KeyRound, Loader2, Server } from "lucide-react";
import {
  VPS_IMAGES,
  VPS_DEFAULT_IMAGE,
  slugify,
  createEnvironmentInput,
  type GeneratedKeypair,
  type RegionOption,
} from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import { usePlans } from "@/lib/usePlans";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

type Step = 1 | 2 | 3;
type KeyMode = "paste" | "generate";

const fieldCls =
  "w-full rounded-[10px] border border-border bg-surface px-3.5 py-2.5 text-[14px] text-text outline-none transition-colors placeholder:text-text3 focus:border-brand-strong focus:ring-2 focus:ring-brand/20";

function validateName(v: string): string | null {
  const t = v.trim();
  if (t.length < 2) return "Use ao menos 2 caracteres.";
  if (t.length > 40) return "Máximo de 40 caracteres.";
  return null;
}

export function CreateVpsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const { plans, byId } = usePlans();

  const [step, setStep] = React.useState<Step>(1);
  const [name, setName] = React.useState("");
  const [nameTouched, setNameTouched] = React.useState(false);
  const [plan, setPlan] = React.useState<string>("");
  const [image, setImage] = React.useState<string>(VPS_DEFAULT_IMAGE);
  const [region, setRegion] = React.useState<string>("");
  const [keyMode, setKeyMode] = React.useState<KeyMode>("paste");
  const [keyLabel, setKeyLabel] = React.useState("");
  const [pastedKey, setPastedKey] = React.useState("");
  const [generated, setGenerated] = React.useState<GeneratedKeypair | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const regionsQ = useQuery({ queryKey: ["regions"], queryFn: api.listRegions, enabled: open });
  const regions = regionsQ.data ?? [];
  const selectedRegion = regions.find((r) => r.region === region) ?? null;
  const selectedPlan = byId.get(plan);

  // Plano padrão: 1º ativo.
  React.useEffect(() => {
    if (!open) return;
    if (plans.length > 0 && !byId.has(plan)) setPlan(plans[0]!.id);
  }, [open, plans, byId, plan]);

  // Região padrão (isDefault online → isDefault → 1ª online → 1ª).
  React.useEffect(() => {
    if (!open || region) return;
    const def =
      regions.find((r) => r.isDefault && r.online) ??
      regions.find((r) => r.isDefault) ??
      regions.find((r) => r.online) ??
      regions[0];
    if (def) setRegion(def.region);
  }, [open, regions, region]);

  const nameError = nameTouched ? validateName(name) : null;
  const nameSlug = slugify(name);
  const imageLabel = VPS_IMAGES.find((i) => i.id === image)?.label ?? image;

  const publicKey = keyMode === "paste" ? pastedKey.trim() : generated?.publicKey ?? "";
  const keyLabelOk = keyLabel.trim().length > 0;
  const keyOk = keyMode === "paste" ? publicKey.length > 20 : generated != null;

  const genMutation = useMutation({
    mutationFn: () => api.generateKeypair(keyLabel.trim()),
    onSuccess: (kp) => {
      setGenerated(kp);
      setError(null);
    },
    onError: (err) =>
      setError(err instanceof Error && err.message ? err.message : "Falha ao gerar o par de chaves."),
  });

  const createMutation = useMutation({
    mutationFn: api.createEnvironment,
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["environments"] });
      toast.show("success", "VPS criada. Provisionando sua máquina…");
      reset();
      onClose();
      router.push(`/env/${created.id}/vps`);
    },
    onError: (err) =>
      setError(
        err instanceof ApiError && err.message
          ? err.message
          : err instanceof Error
            ? err.message
            : "Falha ao criar a VPS.",
      ),
  });

  function reset() {
    setStep(1);
    setName("");
    setNameTouched(false);
    setPlan(plans[0]?.id ?? "");
    setImage(VPS_DEFAULT_IMAGE);
    setRegion("");
    setKeyMode("paste");
    setKeyLabel("");
    setPastedKey("");
    setGenerated(null);
    setError(null);
  }

  function resetAndClose() {
    reset();
    onClose();
  }

  const canAdvance =
    step === 1
      ? !validateName(name) && !!plan && !!image && !!region
      : step === 2
        ? keyLabelOk && keyOk
        : true;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (step === 1) {
      setNameTouched(true);
      if (validateName(name)) return;
      if (!canAdvance) return;
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!canAdvance) return;
      setStep(3);
      return;
    }
    // Step 3 — cria.
    const body = {
      name,
      plan,
      region: region || undefined,
      type: "vps",
      image,
      sshPublicKey: publicKey,
      sshKeyLabel: keyLabel.trim(),
    };
    const parsed = createEnvironmentInput.safeParse(body);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Dados inválidos. Revise os campos.");
      return;
    }
    createMutation.mutate(parsed.data);
  }

  const stepLabel = step === 1 ? "Passo 1 de 3 — máquina" : step === 2 ? "Passo 2 de 3 — chave SSH" : "Passo 3 de 3 — revisão";

  return (
    <Dialog
      open={open}
      onClose={resetAndClose}
      title="Criar VPS"
      description={stepLabel}
      widthClass="w-[min(94vw,48rem)]"
      scrollBody={false}
    >
      <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {step === 1 ? (
            <StepMachine
              name={name}
              setName={setName}
              nameError={nameError}
              nameSlug={nameSlug}
              onNameBlur={() => setNameTouched(true)}
              plan={plan}
              setPlan={setPlan}
              plans={plans}
              image={image}
              setImage={setImage}
              regionsPending={regionsQ.isPending}
              regions={regions}
              region={region}
              setRegion={setRegion}
            />
          ) : step === 2 ? (
            <StepKey
              keyMode={keyMode}
              setKeyMode={setKeyMode}
              keyLabel={keyLabel}
              setKeyLabel={setKeyLabel}
              pastedKey={pastedKey}
              setPastedKey={setPastedKey}
              generated={generated}
              keyLabelOk={keyLabelOk}
              generating={genMutation.isPending}
              onGenerate={() => {
                setError(null);
                genMutation.mutate();
              }}
              onRegenerate={() => setGenerated(null)}
            />
          ) : (
            <StepReview
              name={name}
              planLabel={selectedPlan?.label ?? plan ?? "—"}
              planSpecs={
                selectedPlan
                  ? `${selectedPlan.vcpu} vCPU · ${selectedPlan.memMb} MB · ${selectedPlan.diskGb} GB`
                  : null
              }
              imageLabel={imageLabel}
              region={selectedRegion?.region ?? "—"}
              keyLabel={keyLabel.trim()}
              keyMode={keyMode}
            />
          )}
        </div>

        {error ? (
          <p role="alert" className="flex shrink-0 items-center gap-2 text-sm font-medium text-danger">
            <AlertTriangle size={16} aria-hidden="true" /> {error}
          </p>
        ) : null}

        {/* Rodapé */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border pt-4">
          <div aria-hidden="true" className="flex items-center gap-1.5">
            {[1, 2, 3].map((s) => (
              <span
                key={s}
                className={cn("h-1.5 rounded-full transition-all", step === s ? "w-6 bg-brand" : "w-3 bg-border")}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {step === 1 ? (
              <Button variant="outline" type="button" onClick={resetAndClose}>
                Cancelar
              </Button>
            ) : (
              <Button variant="outline" type="button" onClick={() => setStep((s) => (s === 3 ? 2 : 1))}>
                Voltar
              </Button>
            )}
            <Button type="submit" disabled={!canAdvance || (step === 3 && createMutation.isPending)}>
              {step === 3 ? (createMutation.isPending ? "Criando…" : "Criar VPS") : "Continuar"}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

/* ─────────────── Passo 1: Máquina ─────────────── */

function StepMachine({
  name,
  setName,
  nameError,
  nameSlug,
  onNameBlur,
  plan,
  setPlan,
  plans,
  image,
  setImage,
  regionsPending,
  regions,
  region,
  setRegion,
}: {
  name: string;
  setName: (v: string) => void;
  nameError: string | null;
  nameSlug: string;
  onNameBlur: () => void;
  plan: string;
  setPlan: (v: string) => void;
  plans: { id: string; label: string; vcpu: number; memMb: number; diskGb: number }[];
  image: string;
  setImage: (v: string) => void;
  regionsPending: boolean;
  regions: RegionOption[];
  region: string;
  setRegion: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="vps-name" className="text-[13px] font-medium text-text2">
          Nome do VPS
        </label>
        <input
          id="vps-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={onNameBlur}
          placeholder="Minha VPS"
          autoComplete="off"
          aria-invalid={!!nameError}
          className={cn(fieldCls, nameError && "border-danger")}
        />
        <p className={cn("text-xs", nameError ? "text-danger" : "text-text3")}>
          {nameError ? (
            nameError
          ) : nameSlug ? (
            <>
              Pode usar espaços e maiúsculas. Endereço interno:{" "}
              <code className="rounded bg-bg px-1 font-mono text-text2">{nameSlug}</code>
            </>
          ) : (
            "Dê um nome — pode ter espaços e maiúsculas."
          )}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="vps-plan" className="text-[13px] font-medium text-text2">
          Plano
        </label>
        <select id="vps-plan" value={plan} onChange={(e) => setPlan(e.target.value)} className={fieldCls}>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} · {p.vcpu} vCPU · {p.memMb} MB · {p.diskGb} GB
            </option>
          ))}
        </select>
        <p className="text-[12px] text-text3">A VPS exige um plano com recursos mínimos — se o escolhido não bastar, a criação avisa.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="vps-image" className="text-[13px] font-medium text-text2">
          Imagem Linux
        </label>
        <select id="vps-image" value={image} onChange={(e) => setImage(e.target.value)} className={fieldCls}>
          {VPS_IMAGES.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium text-text2">Região</span>
        {regionsPending ? (
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
  );
}

/* ─────────────── Passo 2: Chave SSH ─────────────── */

function StepKey({
  keyMode,
  setKeyMode,
  keyLabel,
  setKeyLabel,
  pastedKey,
  setPastedKey,
  generated,
  keyLabelOk,
  generating,
  onGenerate,
  onRegenerate,
}: {
  keyMode: KeyMode;
  setKeyMode: (v: KeyMode) => void;
  keyLabel: string;
  setKeyLabel: (v: string) => void;
  pastedKey: string;
  setPastedKey: (v: string) => void;
  generated: GeneratedKeypair | null;
  keyLabelOk: boolean;
  generating: boolean;
  onGenerate: () => void;
  onRegenerate: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-start gap-2 rounded-[10px] border border-border bg-bg/60 px-3 py-2.5 text-[13px] text-text2">
        <KeyRound size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-text3" />
        A VM autentica por chave (sem senha). Cole a sua chave pública ou gere um par novo aqui mesmo.
      </p>

      <SegmentedControl<KeyMode>
        label="Origem da chave SSH"
        fluid
        value={keyMode}
        onChange={setKeyMode}
        options={[
          { value: "paste", label: "Colar a minha" },
          { value: "generate", label: "Gerar para mim" },
        ]}
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="vps-keylabel" className="text-[13px] font-medium text-text2">
          Nome da chave <span className="text-danger">*</span>
        </label>
        <input
          id="vps-keylabel"
          value={keyLabel}
          onChange={(e) => setKeyLabel(e.target.value)}
          placeholder="meu-notebook"
          autoComplete="off"
          className={fieldCls}
        />
        <p className="text-[12px] text-text3">Um rótulo para identificar esta chave (vira o comentário da chave).</p>
      </div>

      {keyMode === "paste" ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="vps-pubkey" className="text-[13px] font-medium text-text2">
            Chave SSH pública <span className="text-danger">*</span>
          </label>
          <textarea
            id="vps-pubkey"
            value={pastedKey}
            onChange={(e) => setPastedKey(e.target.value)}
            rows={3}
            spellCheck={false}
            placeholder="ssh-ed25519 AAAA... seu-comentario"
            className={`${fieldCls} font-mono text-[12px] leading-snug`}
          />
          <p className="text-[12px] text-text3">
            Cole a linha do seu <code className="rounded bg-bg px-1 font-mono text-text2">~/.ssh/id_ed25519.pub</code>.
          </p>
        </div>
      ) : generated ? (
        <GeneratedKeyBlock generated={generated} keyLabel={keyLabel} onRegenerate={onRegenerate} />
      ) : (
        <div className="flex flex-col items-start gap-2">
          <Button type="button" onClick={onGenerate} disabled={!keyLabelOk || generating}>
            {generating ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
            {generating ? "Gerando…" : "Gerar par de chaves"}
          </Button>
          {!keyLabelOk ? <p className="text-[12px] text-text3">Informe o nome da chave para gerar.</p> : null}
        </div>
      )}
    </div>
  );
}

function GeneratedKeyBlock({
  generated,
  keyLabel,
  onRegenerate,
}: {
  generated: GeneratedKeypair;
  keyLabel: string;
  onRegenerate: () => void;
}) {
  const [copied, setCopied] = React.useState(false);

  function copy() {
    navigator.clipboard.writeText(generated.privateKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function download() {
    const base = slugify(keyLabel) || "id_ed25519";
    const filename = keyLabel.trim() ? `${base}.pem` : "id_ed25519";
    const blob = new Blob([generated.privateKey], { type: "application/x-pem-file" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-[12px] border border-border bg-bg/50 p-4">
      <p className="flex items-start gap-2 text-[13px] font-medium text-danger">
        <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
        Salve agora — a chave privada NÃO será mostrada de novo.
      </p>
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-text2">Chave privada (id_ed25519)</span>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-[10px] border border-border bg-surface p-3 font-mono text-[11px] leading-snug text-text">
          {generated.privateKey}
        </pre>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? "Copiada" : "Copiar"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          <Download size={15} /> Baixar
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onRegenerate} className="ml-auto">
          Gerar outra
        </Button>
      </div>
      <p className="text-[12px] text-text3">
        A chave pública correspondente será instalada na VM. Guarde a privada em local seguro (ex.:{" "}
        <code className="rounded bg-bg px-1 font-mono text-text2">~/.ssh/</code>).
      </p>
    </div>
  );
}

/* ─────────────── Passo 3: Revisão ─────────────── */

function StepReview({
  name,
  planLabel,
  planSpecs,
  imageLabel,
  region,
  keyLabel,
  keyMode,
}: {
  name: string;
  planLabel: string;
  planSpecs: string | null;
  imageLabel: string;
  region: string;
  keyLabel: string;
  keyMode: KeyMode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand-strong">
          <Server size={22} strokeWidth={1.9} />
        </span>
        <div>
          <p className="text-[15px] font-semibold text-text">{name || "Sua VPS"}</p>
          <p className="text-[12px] text-text3">Revise antes de criar. A cobrança é por hora, no seu saldo.</p>
        </div>
      </div>

      <dl className="flex flex-col gap-2.5 rounded-[12px] border border-border bg-bg/50 p-4 text-[13px]">
        <SummaryRow label="Nome" value={name || "—"} />
        <SummaryRow label="Plano" value={planSpecs ? `${planLabel} · ${planSpecs}` : planLabel} />
        <SummaryRow label="Imagem" value={imageLabel} />
        <SummaryRow label="Região" value={region} />
        <SummaryRow label="Nome da chave" value={keyLabel || "—"} />
        <SummaryRow label="Modo da chave" value={keyMode === "paste" ? "Chave colada" : "Gerada no painel"} />
      </dl>
    </div>
  );
}

/* ─────────────── Compartilhados ─────────────── */

function RegionCard({ r, selected, onSelect }: { r: RegionOption; selected: boolean; onSelect: () => void }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-[10px] border p-3 transition-colors",
        selected ? "border-brand-strong bg-brand-soft/50" : "border-border hover:border-brand-strong/50",
        !r.online && "opacity-60",
      )}
    >
      <input
        type="radio"
        name="vps-region"
        className="mt-0.5 h-4 w-4 accent-brand"
        checked={selected}
        onChange={onSelect}
        disabled={!r.online}
      />
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
