"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Pencil,
  type LucideIcon,
} from "lucide-react";
import {
  updateNodeInput,
  type Node,
  type NodeStatus,
} from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format";

const PUBLIC_HOST_HELP =
  "Endereço público que os clientes usam para SSH/SFTP e no registro A do DNS.";

const STATUS_META: Record<
  NodeStatus,
  { tone: "success" | "warning" | "danger"; icon: LucideIcon; label: string }
> = {
  online: { tone: "success", icon: CheckCircle2, label: "Online" },
  degraded: { tone: "warning", icon: AlertTriangle, label: "Degradado" },
  offline: { tone: "danger", icon: XCircle, label: "Offline" },
};

function StatusBadge({ status }: { status: NodeStatus }) {
  const s = STATUS_META[status];
  const Icon = s.icon;
  return (
    <Badge tone={s.tone} aria-label={`Status: ${s.label}`}>
      <Icon size={13} aria-hidden="true" />
      <span>{s.label}</span>
    </Badge>
  );
}

export default function AdminNodesPage() {
  const nodesQuery = useQuery({
    queryKey: ["nodes"],
    queryFn: api.listNodes,
  });

  const [editing, setEditing] = React.useState<Node | null>(null);

  return (
    <>
      <header className="mb-6">
        <h1 className="text-[28px] font-bold leading-tight text-text">
          Servidores
        </h1>
        <p className="mt-1 text-sm text-text2">
          Nós que executam os ambientes: status, capacidade e host público.
        </p>
      </header>

      <DefaultRegionCard />

      {nodesQuery.isPending ? (
        <div className="vp-card-shadow h-40 animate-pulse rounded-xl border border-border-subtle bg-surface" />
      ) : nodesQuery.isError ? (
        <Card className="flex items-start gap-3">
          <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          <p role="alert" className="font-medium text-text">
            Não foi possível carregar os nós.
          </p>
        </Card>
      ) : nodesQuery.data.length === 0 ? (
        <Card>
          <p className="text-text2">Nenhum nó registrado.</p>
        </Card>
      ) : (
        <>
          {/* Desktop: tabela densa */}
          <Card className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <caption className="sr-only">
                Lista de nós com nome, região, status, host público, capacidade e último contato.
              </caption>
              <thead>
                <tr className="border-b border-border-subtle bg-bg text-left text-text3">
                  <th scope="col" className="px-4 py-3 font-semibold">Nome</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Região</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Host público</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">vCPU</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">RAM (MB)</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Ambientes</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Último contato</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {nodesQuery.data.map((node) => (
                  <tr
                    key={node.id}
                    className="border-b border-border-subtle last:border-0 hover:bg-bg"
                  >
                    <td className="px-4 py-3 font-medium text-text">{node.name}</td>
                    <td className="px-4 py-3 text-text2">{node.region}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={node.status} />
                    </td>
                    <td className="px-4 py-3">
                      {node.publicHost ? (
                        <span className="font-mono text-text2">{node.publicHost}</span>
                      ) : (
                        <span className="text-text3" aria-label="Sem host público">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-text2">{node.vcpuTotal}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text2">{node.memMbTotal}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text2">{node.envCount}</td>
                    <td className="px-4 py-3 text-text2">{formatDateTime(node.lastSeenAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(node)}
                        aria-label={`Editar endereços de ${node.name}`}
                      >
                        <Pencil size={15} aria-hidden="true" />
                        Editar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Mobile: uma linha = um card */}
          <ul className="flex flex-col gap-3 md:hidden">
            {nodesQuery.data.map((node) => (
              <li key={node.id}>
                <NodeCard node={node} onEdit={() => setEditing(node)} />
              </li>
            ))}
          </ul>
        </>
      )}

      <EditPublicHostDialog
        node={editing}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

function NodeCard({ node, onEdit }: { node: Node; onEdit: () => void }) {
  return (
    <div className="vp-card-shadow rounded-xl border border-border-subtle bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-text">{node.name}</p>
          <p className="text-xs text-text3">{node.region}</p>
        </div>
        <StatusBadge status={node.status} />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border-subtle pt-3 text-sm">
        <NodeStat label="vCPU" value={node.vcpuTotal} />
        <NodeStat label="RAM (MB)" value={node.memMbTotal} />
        <NodeStat label="Ambientes" value={node.envCount} />
      </dl>
      <div className="mt-3 border-t border-border-subtle pt-3">
        <p className="text-xs text-text3">Host público</p>
        {node.publicHost ? (
          <p className="mt-0.5 break-all font-mono text-sm text-text">{node.publicHost}</p>
        ) : (
          <p className="mt-0.5 text-sm text-text3">—</p>
        )}
      </div>
      <p className="mt-3 text-xs text-text3">
        Último contato: {formatDateTime(node.lastSeenAt)}
      </p>
      <div className="mt-3">
        <Button
          variant="outline"
          size="sm"
          onClick={onEdit}
          className="w-full"
          aria-label={`Editar endereços de ${node.name}`}
        >
          <Pencil size={15} aria-hidden="true" />
          Editar endereços
        </Button>
      </div>
    </div>
  );
}

function NodeStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-text3">{label}</dt>
      <dd className="font-medium tabular-nums text-text">{value}</dd>
    </div>
  );
}

function EditPublicHostDialog({
  node,
  onClose,
}: {
  node: Node | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [value, setValue] = React.useState("");
  const [httpValue, setHttpValue] = React.useState("");
  const [alertValue, setAlertValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  // Pré-preenche com o valor atual sempre que abrir para um nó.
  React.useEffect(() => {
    if (node) {
      setValue(node.publicHost ?? "");
      setHttpValue(node.httpHost ?? "");
      setAlertValue(node.alertMessage ?? "");
      setError(null);
    }
  }, [node]);

  const mutation = useMutation({
    mutationFn: (patch: { publicHost: string | null; httpHost: string | null; alertMessage: string | null }) =>
      api.updateNode(node!.id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nodes"] });
      toast.show("success", "Nó atualizado.");
      onClose();
    },
    onError: (err) => {
      toast.show(
        "error",
        err instanceof Error ? err.message : "Falha ao atualizar o nó.",
      );
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const pub = value.trim();
    const http = httpValue.trim();
    const alert = alertValue.trim();
    const patch = {
      publicHost: pub === "" ? null : pub,
      httpHost: http === "" ? null : http,
      alertMessage: alert === "" ? null : alert,
    };
    const parsed = updateNodeInput.safeParse(patch);
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ??
          "Informe um IP ou hostname válido.",
      );
      return;
    }
    mutation.mutate({
      publicHost: parsed.data.publicHost ?? null,
      httpHost: parsed.data.httpHost ?? null,
      alertMessage: parsed.data.alertMessage ?? null,
    });
  }

  if (!node) return null;

  return (
    <Dialog
      open={node !== null}
      onClose={onClose}
      title={`Endereços — ${node.name}`}
      description={PUBLIC_HOST_HELP}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="node-public-host">Host público (SSH/SFTP, DNS)</Label>
          <Input
            id="node-public-host"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="200.9.22.2 ou node1.jamees.com"
            aria-describedby="node-public-host-help"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
          <p id="node-public-host-help" className="text-xs text-text3">
            IP ou hostname para SSH/SFTP e registro A do DNS. Deixe em branco para remover.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="node-http-host">Host HTTP (Abrir site)</Label>
          <Input
            id="node-http-host"
            value={httpValue}
            onChange={(e) => setHttpValue(e.target.value)}
            placeholder="192.168.2.111 (deixe em branco = usa o host público)"
            aria-describedby="node-http-host-help"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
          <p id="node-http-host-help" className="text-xs text-text3">
            Endereço onde as portas HTTP publicadas dos ambientes são alcançáveis
            (botão &ldquo;Abrir site&rdquo;). Num nó local atrás de NAT, use o IP da
            LAN. Em branco = usa o host público.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="node-alert">Aviso da máquina (mostrado na criação)</Label>
          <textarea
            id="node-alert"
            value={alertValue}
            onChange={(e) => setAlertValue(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Ex.: Servidor local instável — use só para testes."
            aria-describedby="node-alert-help"
            className="w-full resize-y rounded-lg border border-border bg-bg p-3 text-sm text-text outline-none focus:border-brand-strong"
          />
          <p id="node-alert-help" className="text-xs text-text3">
            Aparece como alerta quando o cliente escolhe esta região ao criar um ambiente. Em branco = sem aviso.
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
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Super admin escolhe a região pré-selecionada no wizard de criar ambiente. */
function DefaultRegionCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const regionsQuery = useQuery({ queryKey: ["regions"], queryFn: api.listRegions });
  const regions = regionsQuery.data ?? [];
  const current = regions.find((r) => r.isDefault)?.region ?? "";

  const save = useMutation({
    mutationFn: (region: string) => api.setDefaultRegion(region),
    onSuccess: (_r, region) => {
      qc.invalidateQueries({ queryKey: ["regions"] });
      toast.show("success", `Região padrão: ${region}.`);
    },
    onError: (e) => toast.show("error", e instanceof Error ? e.message : "Falha ao salvar."),
  });

  return (
    <Card className="mb-6 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="vp-accent-bar text-base font-semibold text-text">Região padrão</h2>
          <p className="mt-0.5 text-sm text-text2">
            Região já selecionada no wizard de criar ambiente (o cliente pode trocar).
          </p>
        </div>
        <select
          value={current}
          disabled={regionsQuery.isPending || save.isPending || regions.length === 0}
          onChange={(e) => save.mutate(e.target.value)}
          aria-label="Região padrão"
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-brand-strong"
        >
          {regions.length === 0 ? <option value="">—</option> : null}
          {regions.map((r) => (
            <option key={r.region} value={r.region}>
              {r.region}{r.online ? "" : " (offline)"}
            </option>
          ))}
        </select>
      </div>
    </Card>
  );
}
