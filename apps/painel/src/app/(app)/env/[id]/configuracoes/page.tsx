"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings, RefreshCw, Lock, AlertTriangle } from "lucide-react";
import { RUNTIME_VERSIONS, type RuntimeKind } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import { usePlans } from "@/lib/usePlans";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

export default function EnvSettingsPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const qc = useQueryClient();
  const toast = useToast();

  const envQuery = useQuery({
    queryKey: ["environment", id],
    queryFn: () => api.getEnvironment(id),
  });
  const env = envQuery.data;
  const { byId: plansById } = usePlans();

  // A linguagem é fixa (definida na criação); só a VERSÃO pode mudar.
  const kind: RuntimeKind = env?.runtime.kind ?? "php";
  const [version, setVersion] = React.useState<string>("");
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  // Reflete a versão atual quando o ambiente carrega.
  React.useEffect(() => {
    if (env) setVersion(env.runtime.version);
  }, [env?.runtime.version]);

  const versions = RUNTIME_VERSIONS[kind];

  const change = useMutation({
    mutationFn: () => api.changeRuntime(id, { kind, version }),
    onSuccess: (updated) => {
      qc.setQueryData(["environment", id], updated);
      qc.invalidateQueries({ queryKey: ["environments"] });
      qc.invalidateQueries({ queryKey: ["metrics", id] });
      setConfirmOpen(false);
      toast.show(
        "success",
        `Versão alterada para ${labelKind(updated.runtime.kind)} ${updated.runtime.version}.`,
      );
    },
    onError: (err) => {
      setConfirmOpen(false);
      if (err instanceof ApiError && err.code === "language_locked") {
        toast.show(
          "error",
          "A linguagem não pode ser trocada após a criação — só a versão.",
        );
        return;
      }
      toast.show(
        "error",
        err instanceof Error ? err.message : "Não foi possível trocar a versão.",
      );
    },
  });

  if (envQuery.isPending) {
    return (
      <div className="vp-card-shadow h-40 animate-pulse rounded-xl border border-border-subtle bg-surface" />
    );
  }
  if (envQuery.isError || !env) {
    return (
      <Card className="flex items-start gap-3">
        <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
        <p role="alert" className="font-medium text-text">
          Não foi possível carregar este ambiente.
        </p>
      </Card>
    );
  }

  const plan = plansById.get(env.plan);
  const dirty = version !== env.runtime.version;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold text-text">
          <Settings size={20} aria-hidden="true" className="text-brand-strong" />
          Configurações
        </h1>
        <p className="mt-1 text-sm text-text2">
          Ajuste a versão do runtime deste ambiente. O plano é definido na criação.
        </p>
      </header>

      {/* Estado atual */}
      <Card>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-text3">Runtime atual</dt>
            <dd className="font-medium text-text">
              {labelKind(env.runtime.kind)} {env.runtime.version}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-text3">Plano</dt>
            <dd className="font-medium text-text">
              {plan
                ? `${plan.label} · ${plan.vcpu} vCPU · ${plan.memMb} MB`
                : env.plan}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-text3">Disco</dt>
            <dd className="font-medium text-text">{plan ? `${plan.diskGb} GB` : "—"}</dd>
          </div>
        </dl>
      </Card>

      {/* Trocar versão (linguagem travada) */}
      <Card>
        <h2 className="vp-accent-bar mb-1 text-base font-semibold text-text">
          Versão do {labelKind(kind)}
        </h2>
        <p className="mb-4 text-sm text-text2">
          Escolha a versão. Trocar recria o container do ambiente.
        </p>

        <div className="flex flex-col gap-5">
          {/* Linguagem: só leitura */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-text2">Linguagem</span>
            <div className="inline-flex w-fit items-center gap-2 rounded-lg border border-border-subtle bg-bg px-3 py-2 text-sm">
              <Lock size={15} aria-hidden="true" className="text-text3" />
              <span className="font-medium text-text">{labelKind(kind)}</span>
              <span className="text-text3">· definida na criação</span>
            </div>
          </div>

          {/* Versão: faixa conectada */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-text2">Versão</span>
            <SegmentedControl
              label={`Versão do ${labelKind(kind)}`}
              value={version}
              onChange={setVersion}
              variant="strip"
              options={versions.map((v) => ({ value: v, label: v }))}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={!dirty || change.isPending}
            >
              <RefreshCw size={16} aria-hidden="true" />
              Aplicar alteração
            </Button>
            {dirty ? (
              <span className="text-sm text-text3">
                De {labelKind(kind)} {env.runtime.version} para {labelKind(kind)}{" "}
                {version}.
              </span>
            ) : (
              <span className="text-sm text-text3">
                Nenhuma alteração pendente.
              </span>
            )}
          </div>
        </div>
      </Card>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Recriar o container?"
        description="Trocar a versão recria o container. O ambiente fica indisponível por alguns segundos durante a troca."
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text2">
            Alterar de{" "}
            <strong>
              {labelKind(kind)} {env.runtime.version}
            </strong>{" "}
            para{" "}
            <strong>
              {labelKind(kind)} {version}
            </strong>
            .
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => change.mutate()} disabled={change.isPending}>
              {change.isPending ? "Aplicando…" : "Recriar container"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function labelKind(kind: RuntimeKind): string {
  return kind === "php" ? "PHP" : "Node.js";
}
