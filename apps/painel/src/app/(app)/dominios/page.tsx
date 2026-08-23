"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Globe,
  Plus,
  Copy,
  Check,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldAlert,
  HelpCircle,
  ChevronRight,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { createZoneInput, type DnsZone, type DnsZoneStatus, type CreateZoneResult } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

const STATUS_META: Record<
  DnsZoneStatus,
  { tone: "success" | "warning" | "danger" | "info" | "neutral"; icon: LucideIcon; label: string }
> = {
  active: { tone: "success", icon: CheckCircle2, label: "Ativo" },
  active_no_redundancy: { tone: "info", icon: CheckCircle2, label: "Ativo" },
  pending: { tone: "warning", icon: Clock, label: "Aguardando delegação" },
  pending_verification: { tone: "warning", icon: ShieldAlert, label: "Confirme a posse" },
  error: { tone: "danger", icon: ShieldAlert, label: "Erro" },
  unknown: { tone: "neutral", icon: HelpCircle, label: "Verificando…" },
};

function ZoneStatusBadge({ status }: { status: DnsZoneStatus }) {
  const s = STATUS_META[status];
  const Icon = s.icon;
  return (
    <Badge tone={s.tone} aria-label={`Status: ${s.label}`}>
      <Icon size={13} aria-hidden="true" />
      <span>{s.label}</span>
    </Badge>
  );
}

function CopyBtn({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ } }}
      aria-label={`Copiar ${label}`}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text3 transition-colors hover:bg-bg hover:text-text"
    >
      {copied ? <Check size={14} aria-hidden="true" className="text-success" /> : <Copy size={14} aria-hidden="true" />}
    </button>
  );
}

export default function DomainsPage() {
  const zonesQuery = useQuery({ queryKey: ["domains"], queryFn: api.listDomains });
  const infoQuery = useQuery({ queryKey: ["domain-server-info"], queryFn: api.domainServerInfo });
  const [adding, setAdding] = React.useState(false);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight text-text">Meus domínios</h1>
          <p className="mt-1 text-sm text-text2">
            Aponte um domínio para um ambiente com um clique, ou gerencie os registros manualmente.
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden="true" /> Adicionar domínio
        </Button>
      </header>

      {infoQuery.data ? (
        <Card className="mb-6">
          <div className="flex items-start gap-3">
            <Globe size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-brand-strong" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-text">Servidores de nomes (nameservers)</p>
              <p className="mt-0.5 text-sm text-text2">
                No painel do seu registrador de domínio, troque os nameservers para os abaixo. Depois é só apontar para um ambiente.
              </p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {infoQuery.data.nameservers.map((ns) => (
                  <li key={ns.host} className="flex items-center gap-1 rounded-lg border border-border-subtle bg-bg px-2.5 py-1.5">
                    <span className="font-mono text-sm text-text">{ns.host}</span>
                    <CopyBtn value={ns.host} label={ns.host} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      ) : null}

      {zonesQuery.isPending ? (
        <div className="vp-card-shadow h-40 animate-pulse rounded-xl border border-border-subtle bg-surface" />
      ) : zonesQuery.isError ? (
        <Card className="flex items-start gap-3">
          <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          <p role="alert" className="font-medium text-text">Não foi possível carregar seus domínios.</p>
        </Card>
      ) : zonesQuery.data.length === 0 ? (
        <Card className="text-center">
          <Globe size={28} aria-hidden="true" className="mx-auto text-text3" />
          <p className="mt-2 font-medium text-text">Você ainda não tem domínios</p>
          <p className="mt-1 text-sm text-text2">Adicione um domínio para apontá-lo aos seus ambientes.</p>
          <div className="mt-4"><Button onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" /> Adicionar domínio</Button></div>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {zonesQuery.data.map((z) => (
            <li key={z.name}>
              <div className="vp-card-shadow flex items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface p-4 transition-colors hover:border-brand-strong">
                <Link href={`/dominios/${encodeURIComponent(z.name)}`} className="min-w-0 flex-1">
                  <p className="truncate font-mono font-semibold text-text">{z.name}</p>
                  <p className="mt-0.5 text-xs text-text3">{z.recordCount} registro(s)</p>
                </Link>
                <div className="flex shrink-0 items-center gap-2">
                  <ZoneStatusBadge status={z.status} />
                  <DeleteDomainButton zone={z} />
                  <Link href={`/dominios/${encodeURIComponent(z.name)}`} aria-label={`Gerenciar ${z.name}`} className="text-text3 hover:text-text">
                    <ChevronRight size={18} aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AddDomainDialog open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function DeleteDomainButton({ zone }: { zone: DnsZone }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = React.useState(false);
  const [text, setText] = React.useState("");

  const remove = useMutation({
    mutationFn: () => api.deleteDomain(zone.name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["domains"] });
      toast.show("success", "Domínio removido.");
      setConfirm(false);
    },
    onError: (err) => toast.show("error", err instanceof Error ? err.message : "Falha ao remover o domínio."),
  });

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setConfirm(true)}
        disabled={!zone.deletable}
        aria-label={`Excluir ${zone.name}`}
        title={zone.undeletableReason ?? "Excluir domínio"}
      >
        <Trash2 size={16} aria-hidden="true" />
      </Button>
      <Dialog
        open={confirm}
        onClose={() => { setConfirm(false); setText(""); }}
        title="Excluir domínio"
        description="Remove o domínio e todos os seus registros do servidor DNS. Não é possível desfazer."
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`confirm-${zone.name}`}>Digite <strong>{zone.name}</strong> para confirmar</Label>
            <Input id={`confirm-${zone.name}`} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono" />
          </div>
          {remove.isError ? (
            <p role="alert" className="flex items-center gap-2 text-sm font-medium text-danger">
              <AlertTriangle size={16} aria-hidden="true" />
              {remove.error instanceof Error ? remove.error.message : "Falha ao excluir."}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setConfirm(false); setText(""); }}>Cancelar</Button>
            <Button variant="danger" onClick={() => remove.mutate()} disabled={text !== zone.name || remove.isPending}>
              {remove.isPending ? "Excluindo…" : "Excluir definitivamente"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

function AddDomainDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<CreateZoneResult | null>(null);

  React.useEffect(() => { if (open) { setName(""); setError(null); setResult(null); } }, [open]);

  const create = useMutation({
    mutationFn: (n: string) => api.createDomain({ name: n }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["domains"] });
      if (res.alreadyResolves) setResult(res);
      else { toast.show("success", `Domínio ${res.zone.name} adicionado.`); onClose(); }
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Falha ao adicionar o domínio."),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = createZoneInput.safeParse({ name: name.trim() });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Domínio inválido."); return; }
    create.mutate(parsed.data.name);
  }

  if (result) {
    return (
      <Dialog open={open} onClose={onClose} title="Domínio adicionado — confirme a posse" description={undefined}>
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-text">
            <AlertTriangle size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
            <div>
              <p className="font-semibold">Este domínio já está em uso na internet.</p>
              <p className="mt-1 text-text2">
                {result.resolvesTo.length ? `Hoje aponta para ${result.resolvesTo.join(", ")}. ` : ""}
                Troque os nameservers no seu registrador e abra o domínio para <strong>verificar</strong> antes de mexer nos registros.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Fechar</Button>
            <Link href={`/dominios/${encodeURIComponent(result.zone.name)}`}><Button onClick={onClose}>Abrir domínio</Button></Link>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} title="Adicionar domínio" description="Informe um domínio que você já tem registrado (ou um subdomínio).">
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dom-name">Domínio</Label>
          <Input id="dom-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="meusite.com.br" autoComplete="off" spellCheck={false} autoFocus className="font-mono" />
        </div>
        {error ? (
          <p role="alert" className="flex items-center gap-2 text-sm font-medium text-danger"><AlertTriangle size={16} aria-hidden="true" /> {error}</p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={create.isPending}>{create.isPending ? "Adicionando…" : "Adicionar"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
