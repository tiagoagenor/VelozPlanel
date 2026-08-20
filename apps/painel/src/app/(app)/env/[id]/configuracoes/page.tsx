"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings, RefreshCw, AlertTriangle } from "lucide-react";
import {
  PLANS,
  RUNTIME_VERSIONS,
  type RuntimeKind,
} from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

const VERSION_HINT: Record<RuntimeKind, Record<string, string>> = {
  php: { "8.3": "recomendada", "7.4": "fim de vida" },
  node: { "22": "LTS", "20": "LTS" },
};

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

  const [kind, setKind] = React.useState<RuntimeKind>("php");
  const [version, setVersion] = React.useState<string>(RUNTIME_VERSIONS.php[0]!);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  // Reflete o runtime atual quando o ambiente carrega.
  React.useEffect(() => {
    if (env) {
      setKind(env.runtime.kind);
      setVersion(env.runtime.version);
    }
  }, [env?.runtime.kind, env?.runtime.version]);

  const versions = RUNTIME_VERSIONS[kind];
  // Ao trocar de linguagem, garante uma versão válida.
  React.useEffect(() => {
    if (!versions.includes(version)) setVersion(versions[0]!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const change = useMutation({
    mutationFn: () => api.changeRuntime(id, { kind, version }),
    onSuccess: (updated) => {
      qc.setQueryData(["environment", id], updated);
      qc.invalidateQueries({ queryKey: ["environments"] });
      qc.invalidateQueries({ queryKey: ["metrics", id] });
      setConfirmOpen(false);
      toast.show(
        "success",
        `Runtime alterado para ${labelKind(updated.runtime.kind)} ${updated.runtime.version}.`,
      );
    },
    onError: (err) => {
      setConfirmOpen(false);
      toast.show(
        "error",
        err instanceof Error ? err.message : "Não foi possível trocar o runtime.",
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

  const plan = PLANS[env.plan];
  const dirty =
    kind !== env.runtime.kind || version !== env.runtime.version;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold text-text">
          <Settings size={20} aria-hidden="true" className="text-brand-strong" />
          Configurações
        </h1>
        <p className="mt-1 text-sm text-text2">
          Ajuste o runtime deste ambiente. O plano é definido na criação.
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
              {plan.label} · {plan.vcpu} vCPU · {plan.memMb} MB
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-text3">Disco</dt>
            <dd className="font-medium text-text">{plan.diskGb} GB</dd>
          </div>
        </dl>
      </Card>

      {/* Trocar runtime */}
      <Card>
        <h2 className="vp-accent-bar mb-1 text-base font-semibold text-text">
          Versão do runtime
        </h2>
        <p className="mb-4 text-sm text-text2">
          Escolha a linguagem e a versão. Trocar recria o container do ambiente.
        </p>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-text2">Linguagem</span>
            <SegmentedControl<RuntimeKind>
              label="Linguagem do runtime"
              value={kind}
              onChange={setKind}
              options={[
                { value: "php", label: "PHP" },
                { value: "node", label: "Node.js" },
              ]}
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-text2">Versão</span>
            <SegmentedControl
              label={`Versão do ${labelKind(kind)}`}
              value={version}
              onChange={setVersion}
              options={versions.map((v) => ({
                value: v,
                label: v,
                hint: VERSION_HINT[kind][v],
              }))}
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
                De {labelKind(env.runtime.kind)} {env.runtime.version} para{" "}
                {labelKind(kind)} {version}.
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
        description="Trocar o runtime recria o container com a nova versão. O ambiente fica indisponível por alguns segundos durante a troca."
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text2">
            Alterar de{" "}
            <strong>
              {labelKind(env.runtime.kind)} {env.runtime.version}
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
