"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatCents, parseReaisToCents, centsToReaisInput } from "@/lib/format";
import { PlansSection } from "./PlansSection";
import { EnvTypesSection } from "./EnvTypesSection";

/**
 * Tela unificada "Planos e preços" (Modelo B). Reúne, numa rolagem só:
 *   A) Planos (recursos = preço de compute)  ·  B) Tipos (adicional + mínimos)
 *   C) Taxas & regras globais (calculadora + disco pausado + domínio)
 */
export default function PlanosEPrecosPage() {
  return (
    <div className="flex flex-col">
      <PlansSection />
      <hr className="my-10 border-border" />
      <EnvTypesSection />
      <hr className="my-10 border-border" />
      <RatesSection />
    </div>
  );
}

function RatesSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["admin", "billing"], queryFn: api.getBilling });

  const [vcpu, setVcpu] = React.useState("");
  const [ram, setRam] = React.useState("");
  const [disk, setDisk] = React.useState("");
  const [domain, setDomain] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (q.data) {
      setVcpu(centsToReaisInput(q.data.rateVcpuMonthCents));
      setRam(centsToReaisInput(q.data.rateRamGbMonthCents));
      setDisk(centsToReaisInput(q.data.rateDiskGbMonthCents));
      setDomain(centsToReaisInput(q.data.domainPriceMonthCents));
    }
  }, [q.data]);

  const mutation = useMutation({
    mutationFn: api.updateBilling,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "billing"] });
      toast.show("success", "Taxas atualizadas.");
    },
    onError: (e) => toast.show("error", e instanceof ApiError ? e.message : "Falha ao salvar."),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const v = parseReaisToCents(vcpu), r = parseReaisToCents(ram), d = parseReaisToCents(disk), dm = parseReaisToCents(domain);
    if ([v, r, d, dm].some((x) => x === null || x < 0)) return setError("Informe valores válidos (ex.: 20,00).");
    mutation.mutate({
      rateVcpuMonthCents: v!, rateRamGbMonthCents: r!, rateDiskGbMonthCents: d!, domainPriceMonthCents: dm!,
    });
  }

  return (
    <section>
      <header className="mb-6">
        <h1 className="text-[28px] font-bold leading-tight text-text">Taxas &amp; regras globais</h1>
        <p className="mt-1 max-w-2xl text-sm text-text2">
          As taxas por recurso são só uma <strong>calculadora</strong> — o preço cobrado é sempre o valor gravado em
          cada plano. A taxa de <strong>disco</strong> também é o que cobra o estado <strong>pausado</strong>.
        </p>
      </header>

      {q.isPending ? (
        <Card><p className="text-text2">Carregando…</p></Card>
      ) : q.isError ? (
        <Card className="flex items-start gap-3">
          <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          <p role="alert" className="font-medium text-text">Não foi possível carregar as taxas.</p>
        </Card>
      ) : (
        <Card>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <RateField id="r-vcpu" label="Por vCPU / mês" value={vcpu} onChange={setVcpu} />
              <RateField id="r-ram" label="Por GB de RAM / mês" value={ram} onChange={setRam} />
              <RateField id="r-disk" label="Por GB de disco / mês" value={disk} onChange={setDisk} hint="também cobra o pausado" />
              <RateField id="r-domain" label="Domínio / mês" value={domain} onChange={setDomain} />
            </div>
            <p className="text-xs text-text3">
              Sugestão de plano pela taxa = vCPU × (por vCPU) + RAM(GB) × (por GB) + disco(GB) × (por GB).
              {q.data ? ` Ex.: 2 vCPU · 2 GB · 40 GB ≈ ${formatCents(2 * q.data.rateVcpuMonthCents + 2 * q.data.rateRamGbMonthCents + 40 * q.data.rateDiskGbMonthCents)}.` : ""}
            </p>
            {error ? (
              <p role="alert" className="flex items-center gap-2 text-sm font-medium text-danger">
                <AlertTriangle size={16} aria-hidden="true" /> {error}
              </p>
            ) : null}
            <div className="flex justify-end">
              <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Salvando…" : "Salvar taxas"}</Button>
            </div>
          </form>
        </Card>
      )}
    </section>
  );
}

function RateField({ id, label, value, onChange, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0,00" className="font-mono" />
      {hint ? <p className="text-[11px] text-text3">{hint}</p> : null}
    </div>
  );
}
