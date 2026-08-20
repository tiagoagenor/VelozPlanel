"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Radio,
  CircleSlash,
  type LucideIcon,
} from "lucide-react";
import {
  addWgPeerInput,
  type WgPeer,
  type WgPeerStatus,
} from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { CenterLoader } from "@/components/Skeletons";
import { formatDateTime } from "@/lib/format";

const STATUS_META: Record<
  WgPeerStatus,
  { tone: "success" | "warning" | "neutral"; icon: LucideIcon; label: string }
> = {
  handshake_ok: { tone: "success", icon: CheckCircle2, label: "Handshake OK" },
  configured: { tone: "warning", icon: Radio, label: "Configurado" },
  offline: { tone: "neutral", icon: CircleSlash, label: "Offline" },
};

function StatusBadge({ status }: { status: WgPeerStatus }) {
  const s = STATUS_META[status];
  const Icon = s.icon;
  return (
    <Badge tone={s.tone} aria-label={`Status: ${s.label}`}>
      <Icon size={13} aria-hidden="true" />
      {s.label}
    </Badge>
  );
}

export default function AdminNetworkPage() {
  const q = useQuery({ queryKey: ["admin", "wg"], queryFn: api.listWgPeers });
  const [adding, setAdding] = React.useState(false);
  const [removing, setRemoving] = React.useState<WgPeer | null>(null);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight text-text">
            Rede WireGuard
          </h1>
          <p className="mt-1 text-sm text-text2">
            Peers da malha privada entre nós e serviços.
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden="true" />
          Adicionar peer
        </Button>
      </header>

      <p className="mb-5 flex items-start gap-2 rounded-lg border border-border-subtle bg-bg p-3 text-sm text-text2">
        <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
        <span>
          A malha WireGuard real é provisionada na fase de infra. Aqui você
          configura os <strong>peers</strong> e o estado desejado — o túnel
          efetivo entra quando os nós forem interligados.
        </span>
      </p>

      {q.isPending ? (
        <CenterLoader minHeight="40vh" />
      ) : q.isError ? (
        <Card className="flex items-start gap-3">
          <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          <p role="alert" className="font-medium text-text">
            Não foi possível carregar os peers.
          </p>
        </Card>
      ) : q.data.length === 0 ? (
        <Card>
          <p className="text-text2">Nenhum peer configurado ainda.</p>
        </Card>
      ) : (
        <>
          {/* Desktop: tabela */}
          <Card className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <caption className="sr-only">Peers WireGuard com nome, IP privado, endpoint, status e ações.</caption>
              <thead>
                <tr className="border-b border-border-subtle bg-bg text-left text-text3">
                  <th scope="col" className="px-4 py-3 font-semibold">Nome</th>
                  <th scope="col" className="px-4 py-3 font-semibold">IP privado</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Endpoint</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Criado</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((p) => (
                  <tr key={p.id} className="border-b border-border-subtle last:border-0 hover:bg-bg">
                    <td className="px-4 py-3 font-medium text-text">{p.name}</td>
                    <td className="px-4 py-3 font-mono text-text2">{p.privateIp}</td>
                    <td className="px-4 py-3 font-mono text-xs text-text2">{p.endpoint ?? "—"}</td>
                    <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                    <td className="px-4 py-3 text-text2">{formatDateTime(p.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setRemoving(p)} aria-label={`Remover ${p.name}`} className="text-danger hover:bg-danger/10">
                        <Trash2 size={15} aria-hidden="true" />
                        Remover
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Mobile: cards */}
          <ul className="flex flex-col gap-3 md:hidden">
            {q.data.map((p) => (
              <li key={p.id} className="vp-card-shadow rounded-xl border border-border-subtle bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-text">{p.name}</p>
                    <p className="truncate font-mono text-xs text-text3">{p.privateIp}</p>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
                {p.endpoint ? (
                  <p className="mt-3 break-all border-t border-border-subtle pt-3 font-mono text-xs text-text2">{p.endpoint}</p>
                ) : null}
                <div className="mt-3">
                  <Button variant="outline" size="sm" onClick={() => setRemoving(p)} className="w-full text-danger">
                    <Trash2 size={15} aria-hidden="true" />
                    Remover peer
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <AddPeerDialog open={adding} onClose={() => setAdding(false)} />
      <RemovePeerDialog peer={removing} onClose={() => setRemoving(null)} />
    </>
  );
}

function AddPeerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const nodesQuery = useQuery({ queryKey: ["nodes"], queryFn: api.listNodes });

  const [name, setName] = React.useState("");
  const [privateIp, setPrivateIp] = React.useState("10.77.0.");
  const [nodeId, setNodeId] = React.useState("");
  const [endpoint, setEndpoint] = React.useState("");
  const [publicKey, setPublicKey] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setName("");
      setPrivateIp("10.77.0.");
      setNodeId("");
      setEndpoint("");
      setPublicKey("");
      setError(null);
    }
  }, [open]);

  const m = useMutation({
    mutationFn: () =>
      api.addWgPeer({
        name,
        privateIp,
        nodeId: nodeId === "" ? null : nodeId,
        endpoint: endpoint.trim() === "" ? null : endpoint.trim(),
        publicKey: publicKey.trim() === "" ? null : publicKey.trim(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "wg"] });
      toast.show("success", "Peer adicionado.");
      onClose();
    },
    onError: (e) => toast.show("error", e instanceof Error ? e.message : "Falha ao adicionar peer."),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = addWgPeerInput.safeParse({
      name,
      privateIp,
      nodeId: nodeId === "" ? null : nodeId,
      endpoint: endpoint.trim() === "" ? null : endpoint.trim(),
      publicKey: publicKey.trim() === "" ? null : publicKey.trim(),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Verifique os campos.");
      return;
    }
    m.mutate();
  }

  const nodeOptions = [
    { value: "", label: "Nenhum" },
    ...(nodesQuery.data ?? []).map((n) => ({ value: n.id, label: n.name })),
  ];

  return (
    <Dialog open={open} onClose={onClose} title="Adicionar peer" description="Configura um peer na malha WireGuard.">
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wg-name">Nome</Label>
          <Input id="wg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: node1-gw" autoComplete="off" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wg-ip">IP privado</Label>
          <Input id="wg-ip" value={privateIp} onChange={(e) => setPrivateIp(e.target.value)} placeholder="10.77.0.2" autoComplete="off" spellCheck={false} className="font-mono" />
          <p className="text-xs text-text3">Faixa da malha: 10.77.x.x</p>
        </div>
        {nodeOptions.length > 1 ? (
          <div className="flex flex-col gap-1.5">
            <span className="block text-sm font-medium text-text2">Nó (opcional)</span>
            <SegmentedControl label="Nó associado" value={nodeId} onChange={setNodeId} options={nodeOptions} variant="strip" />
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wg-endpoint">Endpoint (opcional)</Label>
          <Input id="wg-endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="200.9.22.2:51820" autoComplete="off" spellCheck={false} className="font-mono" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wg-key">Chave pública (opcional)</Label>
          <Input id="wg-key" value={publicKey} onChange={(e) => setPublicKey(e.target.value)} placeholder="base64…" autoComplete="off" spellCheck={false} className="font-mono" />
        </div>
        {error ? (
          <p role="alert" className="flex items-center gap-2 text-sm font-medium text-danger">
            <AlertTriangle size={16} aria-hidden="true" />
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={m.isPending}>
            {m.isPending ? "Adicionando…" : "Adicionar peer"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function RemovePeerDialog({ peer, onClose }: { peer: WgPeer | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();

  const m = useMutation({
    mutationFn: () => api.deleteWgPeer(peer!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "wg"] });
      toast.show("success", "Peer removido.");
      onClose();
    },
    onError: (e) => toast.show("error", e instanceof Error ? e.message : "Falha ao remover peer."),
  });

  if (!peer) return null;

  return (
    <Dialog open={peer !== null} onClose={onClose} title="Remover peer" description="Esta ação não pode ser desfeita.">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text2">
          Remover o peer <strong className="text-text">{peer.name}</strong> ({peer.privateIp})?
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" onClick={() => m.mutate()} disabled={m.isPending}>
            {m.isPending ? "Removendo…" : "Remover"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
