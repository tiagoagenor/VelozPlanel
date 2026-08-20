"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  PLANS,
  RUNTIME_VERSIONS,
  createEnvironmentInput,
  type PlanId,
  type RuntimeKind,
} from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { planMonthly, planHourly } from "@/lib/format";

const PLAN_IDS = Object.keys(PLANS) as PlanId[];
const RUNTIME_KINDS = Object.keys(RUNTIME_VERSIONS) as RuntimeKind[];

export function CreateEnvironmentDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = React.useState("");
  const [plan, setPlan] = React.useState<PlanId>("start");
  const [kind, setKind] = React.useState<RuntimeKind>("php");
  const [version, setVersion] = React.useState<string>(RUNTIME_VERSIONS.php[0]!);
  const [error, setError] = React.useState<string | null>(null);

  const versions = RUNTIME_VERSIONS[kind];

  // Ao trocar de runtime, garante uma versão válida selecionada.
  React.useEffect(() => {
    if (!versions.includes(version)) setVersion(versions[0]!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

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
    setPlan("start");
    setKind("php");
    setVersion(RUNTIME_VERSIONS.php[0]!);
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

  const selectedPlan = PLANS[plan];

  return (
    <Dialog
      open={open}
      onClose={resetAndClose}
      title="Criar ambiente"
      description="Escolha um nome, um plano e o runtime. O container sobe em seguida."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="env-runtime">Runtime</Label>
            <Select
              id="env-runtime"
              value={kind}
              onChange={(e) => setKind(e.target.value as RuntimeKind)}
              options={RUNTIME_KINDS.map((k) => ({
                value: k,
                label: k === "php" ? "PHP" : "Node.js",
              }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="env-version">Versão</Label>
            <Select
              id="env-version"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              options={versions.map((v) => ({ value: v, label: v }))}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="env-plan">Plano</Label>
          <Select
            id="env-plan"
            value={plan}
            onChange={(e) => setPlan(e.target.value as PlanId)}
            options={PLAN_IDS.map((p) => ({
              value: p,
              label: `${PLANS[p].label} — ${PLANS[p].vcpu} vCPU · ${PLANS[p].memMb} MB`,
            }))}
          />
          <p className="text-xs text-text3">
            {selectedPlan.label}: {planMonthly(selectedPlan)}/mês ·{" "}
            {planHourly(selectedPlan)}/hora ativo · {selectedPlan.diskGb} GB de disco
          </p>
        </div>

        {error ? (
          <p role="alert" className="text-sm font-medium text-danger">
            ⚠ {error}
          </p>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="outline" onClick={resetAndClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Criando…" : "Criar ambiente"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
