"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import {
  RUNTIME_VERSIONS,
  RECOMMENDED_VERSION,
  createEnvironmentInput,
  type RuntimeKind,
} from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { usePlans } from "@/lib/usePlans";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { planMonthly, planHourly } from "@/lib/format";


export function CreateEnvironmentDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { plans, byId, isPending: plansPending, isError: plansError } = usePlans();
  const [name, setName] = React.useState("");
  const [plan, setPlan] = React.useState<string>("");
  const [kind, setKind] = React.useState<RuntimeKind>("php");
  const [version, setVersion] = React.useState<string>(RECOMMENDED_VERSION.php);
  const [error, setError] = React.useState<string | null>(null);

  const versions = RUNTIME_VERSIONS[kind];

  // Ao trocar de linguagem, pré-seleciona a versão recomendada dela.
  React.useEffect(() => {
    setVersion(RECOMMENDED_VERSION[kind]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  // Assim que os planos carregam (ou o diálogo abre), garante uma seleção válida.
  React.useEffect(() => {
    if (!open) return;
    if (plans.length > 0 && !byId.has(plan)) {
      setPlan(plans[0]!.id);
    }
  }, [open, plans, byId, plan]);

  const mutation = useMutation({
    mutationFn: api.createEnvironment,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["environments"] });
      resetAndClose();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Falha ao criar ambiente.");
    },
  });

  function resetAndClose() {
    setName("");
    setPlan(plans[0]?.id ?? "");
    setKind("php");
    setVersion(RECOMMENDED_VERSION.php);
    setError(null);
    onClose();
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = createEnvironmentInput.safeParse({
      name,
      plan,
      runtime: { kind, version },
    });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ??
          "Dados inválidos. Revise o nome e as opções.",
      );
      return;
    }
    mutation.mutate(parsed.data);
  }

  const selectedPlan = byId.get(plan);

  return (
    <Dialog
      open={open}
      onClose={resetAndClose}
      title="Criar ambiente"
      description="Escolha um nome, um plano e o runtime. O container sobe em seguida."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
        {/* Nome */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="env-name">Nome</Label>
          <Input
            id="env-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="meu-site"
            aria-describedby="env-name-help"
            autoComplete="off"
            required
          />
          <p id="env-name-help" className="text-xs text-text3">
            2 a 40 caracteres: apenas letras minúsculas, números e hífen.
          </p>
        </div>

        {/* Runtime */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-text2">Runtime</span>
          <SegmentedControl<RuntimeKind>
            label="Runtime"
            value={kind}
            onChange={setKind}
            fluid
            options={[
              { value: "php", label: "PHP" },
              { value: "node", label: "Node.js" },
            ]}
          />
        </div>

        {/* Versão */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-text2">Versão</span>
          <SegmentedControl
            label={`Versão do ${kind === "php" ? "PHP" : "Node.js"}`}
            value={version}
            onChange={setVersion}
            variant="strip"
            options={versions.map((v) => ({ value: v, label: v }))}
          />
        </div>

        {/* Plano */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-text2">Plano</span>
          {plansPending ? (
            <div className="h-11 animate-pulse rounded-lg border border-border-subtle bg-bg" />
          ) : plansError ? (
            <p className="flex items-center gap-2 text-sm text-danger">
              <AlertTriangle size={16} aria-hidden="true" />
              Não foi possível carregar os planos.
            </p>
          ) : plans.length === 0 ? (
            <p className="text-sm text-text2">Nenhum plano disponível no momento.</p>
          ) : (
            <>
              <SegmentedControl<string>
                label="Plano"
                value={plan}
                onChange={setPlan}
                fluid
                options={plans.map((p) => ({
                  value: p.id,
                  label: p.label,
                  hint: `${p.memMb} MB`,
                }))}
              />
              {selectedPlan ? (
                <p className="text-xs text-text3">
                  {selectedPlan.label}: {selectedPlan.vcpu} vCPU · {selectedPlan.memMb}{" "}
                  MB · {selectedPlan.diskGb} GB de disco — {planMonthly(selectedPlan)}
                  /mês · {planHourly(selectedPlan)}/hora ativo.
                </p>
              ) : null}
            </>
          )}
        </div>

        {error ? (
          <p
            role="alert"
            className="flex items-center gap-2 text-sm font-medium text-danger"
          >
            <AlertTriangle size={16} aria-hidden="true" />
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={resetAndClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={mutation.isPending || !plan}>
            {mutation.isPending ? "Criando…" : "Criar ambiente"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
