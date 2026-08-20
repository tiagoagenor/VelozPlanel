"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
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
import { SegmentedControl } from "@/components/ui/segmented";
import { planMonthly, planHourly } from "@/lib/format";

const PLAN_IDS = Object.keys(PLANS) as PlanId[];

/** Micro-rótulos por versão (detalhe de produto real, não decorativo). */
const VERSION_HINT: Record<RuntimeKind, Record<string, string>> = {
  php: { "8.3": "recomendada", "7.4": "fim de vida" },
  node: { "22": "LTS", "20": "LTS" },
};

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
            fluid
            options={versions.map((v) => ({
              value: v,
              label: v,
              hint: VERSION_HINT[kind][v],
            }))}
          />
        </div>

        {/* Plano */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-text2">Plano</span>
          <SegmentedControl<PlanId>
            label="Plano"
            value={plan}
            onChange={setPlan}
            fluid
            options={PLAN_IDS.map((p) => ({
              value: p,
              label: PLANS[p].label,
              hint: `${PLANS[p].memMb} MB`,
            }))}
          />
          <p className="text-xs text-text3">
            {selectedPlan.label}: {selectedPlan.vcpu} vCPU · {selectedPlan.memMb}{" "}
            MB · {selectedPlan.diskGb} GB de disco — {planMonthly(selectedPlan)}
            /mês · {planHourly(selectedPlan)}/hora ativo.
          </p>
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
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Criando…" : "Criar ambiente"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
