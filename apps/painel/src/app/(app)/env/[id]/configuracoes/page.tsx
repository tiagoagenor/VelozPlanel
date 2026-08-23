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

  const [startup, setStartup] = React.useState<string>("");
  React.useEffect(() => {
    setStartup(env?.startupScript ?? "");
  }, [env?.startupScript]);
  const startupDirty = startup !== (env?.startupScript ?? "");
  const saveStartup = useMutation({
    mutationFn: () => api.setStartupScript(id, startup.trim() === "" ? null : startup),
    onSuccess: (updated) => {
      qc.setQueryData(["environment", id], updated);
      toast.show(
        "success",
        "Comandos salvos. Aplicam na próxima criação/recriação do container.",
      );
    },
    onError: (err) =>
      toast.show("error", err instanceof Error ? err.message : "Falha ao salvar."),
  });

  // Arquivo de inicialização do Node (ex.: server.js). Só em ambiente Node.
  const [startFile, setStartFile] = React.useState<string>("");
  React.useEffect(() => {
    setStartFile(env?.nodeStartFile ?? "");
  }, [env?.nodeStartFile]);
  const startFileDirty = startFile !== (env?.nodeStartFile ?? "");
  const saveStartFile = useMutation({
    mutationFn: () => api.setNodeStartFile(id, startFile.trim() === "" ? null : startFile.trim()),
    onSuccess: (updated) => {
      qc.setQueryData(["environment", id], updated);
      toast.show(
        "success",
        `App reiniciado com ${updated.nodeStartFile ?? "index.js"}.`,
      );
    },
    onError: (err) =>
      toast.show("error", err instanceof Error ? err.message : "Falha ao salvar."),
  });

  // Node via nvm — só ambientes PHP. Versão escolhida + leitura ao vivo do
  // container (reflete troca feita no terminal).
  const isPhp = env?.runtime.kind === "php";
  const [phpNode, setPhpNode] = React.useState<string>("22");
  React.useEffect(() => {
    setPhpNode(env?.phpNodeVersion ?? "22");
  }, [env?.phpNodeVersion]);
  const phpNodeLive = useQuery({
    queryKey: ["php-node-current", id],
    queryFn: () => api.getPhpNodeCurrent(id),
    enabled: !!env && isPhp && env.state === "running",
    refetchOnWindowFocus: true,
  });
  const savePhpNode = useMutation({
    mutationFn: () => api.setPhpNodeVersion(id, phpNode),
    onSuccess: (updated) => {
      qc.setQueryData(["environment", id], updated);
      qc.invalidateQueries({ queryKey: ["php-node-current", id] });
      toast.show("success", `Node ${updated.phpNodeVersionFull ?? phpNode} aplicado.`);
    },
    onError: (err) =>
      toast.show("error", err instanceof Error ? err.message : "Falha ao aplicar a versão do Node."),
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
              {labelKind(env.runtime.kind)} {env.runtimeVersionFull ?? env.runtime.version}
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

      {/* Arquivo de inicialização do Node */}
      {env.runtime.kind === "node" && (
        <Card>
          <h2 className="vp-accent-bar mb-1 text-base font-semibold text-text">
            Arquivo de inicialização
          </h2>
          <p className="mb-4 text-sm text-text2">
            Qual arquivo o Node executa ao iniciar (dentro de <code>/app</code>) — ex.:{" "}
            <code>server.js</code>, <code>index.js</code> ou <code>dist/main.js</code>.
            Ao salvar, o app <strong>reinicia</strong> com esse arquivo (seus arquivos
            são mantidos). Vazio = <code>index.js</code>.
          </p>
          <input
            value={startFile}
            onChange={(e) => setStartFile(e.target.value)}
            spellCheck={false}
            aria-label="Arquivo de inicialização do Node"
            placeholder="index.js"
            className="w-full rounded-lg border border-border bg-surface p-3 font-mono text-sm text-text placeholder:text-text3 focus:border-brand-strong"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              onClick={() => saveStartFile.mutate()}
              disabled={!startFileDirty || saveStartFile.isPending}
            >
              {saveStartFile.isPending ? "Reiniciando…" : "Salvar e reiniciar"}
            </Button>
            <span className="text-sm text-text3">
              O app reinicia na hora, sem recriar o container.
            </span>
          </div>
        </Card>
      )}

      {/* Node.js via nvm — só ambientes PHP */}
      {env.runtime.kind === "php" && (
        <Card>
          <h2 className="vp-accent-bar mb-1 text-base font-semibold text-text">
            Node.js (via nvm)
          </h2>
          <p className="mb-4 text-sm text-text2">
            Todo ambiente PHP vem com <strong>Node.js</strong>. Escolha a versão aqui — aplica
            <strong> na hora</strong>, sem recriar o container. Você também pode trocar no
            terminal com <code>nvm use &lt;versão&gt;</code> / <code>nvm alias default &lt;versão&gt;</code>.
          </p>
          <SegmentedControl
            label="Versão do Node"
            value={phpNode}
            onChange={setPhpNode}
            options={RUNTIME_VERSIONS.node.map((v) => ({ value: v, label: v }))}
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              onClick={() => savePhpNode.mutate()}
              disabled={savePhpNode.isPending}
            >
              {savePhpNode.isPending ? "Aplicando…" : "Aplicar versão"}
            </Button>
            <span className="text-sm text-text3">
              {phpNodeLive.data?.current
                ? `Atual no container: ${phpNodeLive.data.current}`
                : env.phpNodeVersionFull
                  ? `Atual: ${env.phpNodeVersionFull}`
                  : "Atual: default da imagem (22)"}
            </span>
          </div>
          <p className="mt-2 text-xs text-text3">
            A escolha no painel é a permanente (reaplicada se o container for recriado). Uma
            troca feita só no terminal vale até o container ser recriado. Versões ainda não
            baixadas são instaladas na 1ª troca (precisa de internet no ambiente).
          </p>
        </Card>
      )}

      {/* Comandos de inicialização */}
      <Card>
        <h2 className="vp-accent-bar mb-1 text-base font-semibold text-text">
          Comandos de inicialização
        </h2>
        <p className="mb-4 text-sm text-text2">
          Shell rodado <strong>uma vez</strong>, quando o container é criado — ex.:{" "}
          <code>apt-get update</code>, instalar pacotes, ou criar aliases. Aplica na
          próxima criação/recriação do container.
        </p>
        <textarea
          value={startup}
          onChange={(e) => setStartup(e.target.value)}
          spellCheck={false}
          rows={8}
          aria-label="Comandos de inicialização"
          placeholder={"apt-get update\napt-get install -y htop\necho \"alias ll='ls -la'\" > /etc/profile.d/veloz.sh"}
          className="w-full resize-y rounded-lg border border-border bg-surface p-3 font-mono text-sm text-text placeholder:text-text3 focus:border-brand-strong"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            onClick={() => saveStartup.mutate()}
            disabled={!startupDirty || saveStartup.isPending}
          >
            {saveStartup.isPending ? "Salvando…" : "Salvar"}
          </Button>
          <span className="text-sm text-text3">
            Para valer agora, recrie o container (reaplique a versão acima).
          </span>
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
