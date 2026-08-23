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
  Trash2,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { createZoneInput, type DnsZone, type DnsZoneStatus, type CreateZoneResult } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format";

const STATUS_META: Record<
  DnsZoneStatus,
  { tone: "success" | "warning" | "danger" | "info" | "neutral"; icon: LucideIcon; label: string }
> = {
  active: { tone: "success", icon: CheckCircle2, label: "Ativo" },
  active_no_redundancy: { tone: "info", icon: CheckCircle2, label: "Ativo · 1 de 2 NS" },
  pending: { tone: "warning", icon: Clock, label: "Aguardando delegação" },
  pending_verification: { tone: "warning", icon: ShieldAlert, label: "Confirmar posse" },
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

/** Botão de copiar reutilizável (host/IP dos nameservers). */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard indisponível */
        }
      }}
      aria-label={`Copiar ${label}`}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text3 transition-colors hover:bg-bg hover:text-text"
    >
      {copied ? <Check size={14} aria-hidden="true" className="text-success" /> : <Copy size={14} aria-hidden="true" />}
    </button>
  );
}

export default function AdminDomainsPage() {
  const zonesQuery = useQuery({ queryKey: ["dns-zones"], queryFn: api.listDnsZones });
  const infoQuery = useQuery({ queryKey: ["dns-server-info"], queryFn: api.dnsServerInfo });
  const [adding, setAdding] = React.useState(false);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight text-text">Domínios do sistema</h1>
          <p className="mt-1 text-sm text-text2">
            Domínios do próprio painel (ex.: <span className="font-mono">geestao.top</span>). Cadastre
            quantos quiser. Os domínios dos clientes ficam com cada um em <strong>Meus domínios</strong>, não aqui.
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden="true" />
          Adicionar domínio
        </Button>
      </header>

      <div className="mb-6"><ReservedSubdomainsCard /></div>

      {/* Card dos nameservers deste servidor (o que colar no registrador) */}
      {infoQuery.data ? (
        <Card className="mb-6">
          <div className="flex items-start gap-3">
            <Globe size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-brand-strong" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-text">Nameservers deste servidor</p>
              <p className="mt-0.5 text-sm text-text2">
                No registrador do seu domínio, aponte os nameservers para os abaixo (e cadastre o
                glue com os IPs). Depois, delegando o domínio, o painel passa a servi-lo.
              </p>
              <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                {infoQuery.data.nameservers.map((ns, i) => (
                  <NsRow key={ns.host} label={`Nameserver ${i + 1}`} host={ns.host} ip={ns.ip} />
                ))}
              </dl>
            </div>
          </div>
        </Card>
      ) : null}

      {zonesQuery.isPending ? (
        <div className="vp-card-shadow h-40 animate-pulse rounded-xl border border-border-subtle bg-surface" />
      ) : zonesQuery.isError ? (
        <Card className="flex items-start gap-3">
          <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          <div>
            <p role="alert" className="font-medium text-text">
              Não foi possível carregar os domínios.
            </p>
            <p className="mt-1 text-sm text-text2">
              {zonesQuery.error instanceof Error ? zonesQuery.error.message : "Verifique se o servidor DNS está no ar."}
            </p>
          </div>
        </Card>
      ) : zonesQuery.data.length === 0 ? (
        <Card className="text-center">
          <Globe size={28} aria-hidden="true" className="mx-auto text-text3" />
          <p className="mt-2 font-medium text-text">Nenhum domínio ainda</p>
          <p className="mt-1 text-sm text-text2">
            Adicione o primeiro domínio para começar a gerenciar o DNS.
          </p>
          <div className="mt-4">
            <Button onClick={() => setAdding(true)}>
              <Plus size={16} aria-hidden="true" />
              Adicionar domínio
            </Button>
          </div>
        </Card>
      ) : (
        <>
          {/* Desktop */}
          <Card className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full min-w-[48rem] border-collapse text-sm">
              <caption className="sr-only">Domínios com status, registros, serial e última verificação.</caption>
              <thead>
                <tr className="border-b border-border-subtle bg-bg text-left text-text3">
                  <th scope="col" className="px-4 py-3 font-semibold">Domínio</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Dono</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Registros</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Serial</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Última verificação</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {zonesQuery.data.map((z) => (
                  <tr key={z.name} className="border-b border-border-subtle last:border-0 hover:bg-bg">
                    <td className="px-4 py-3">
                      <Link href={`/admin/dominios/${encodeURIComponent(z.name)}`} className="font-medium text-link hover:underline">
                        {z.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {z.ownerEmail ? (
                        <span className="text-text2">{z.ownerEmail}</span>
                      ) : (
                        <Badge tone="brand">Sistema</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3"><ZoneStatusBadge status={z.status} /></td>
                    <td className="px-4 py-3 text-right tabular-nums text-text2">{z.recordCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text3">{z.serial ?? "—"}</td>
                    <td className="px-4 py-3 text-text2">{z.checkedAt ? formatDateTime(z.checkedAt) : "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link href={`/admin/dominios/${encodeURIComponent(z.name)}`} aria-label={`Gerenciar ${z.name}`}>
                          <Button variant="ghost" size="sm">Gerenciar <ChevronRight size={14} aria-hidden="true" /></Button>
                        </Link>
                        <DeleteZoneButton zone={z} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Mobile */}
          <ul className="flex flex-col gap-3 md:hidden">
            {zonesQuery.data.map((z) => (
              <li key={z.name}>
                <div className="vp-card-shadow rounded-xl border border-border-subtle bg-surface p-4">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/admin/dominios/${encodeURIComponent(z.name)}`} className="truncate font-semibold text-link hover:underline">
                      {z.name}
                    </Link>
                    <ZoneStatusBadge status={z.status} />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    {z.ownerEmail ? (
                      <span className="text-xs text-text2">{z.ownerEmail}</span>
                    ) : (
                      <Badge tone="brand">Sistema</Badge>
                    )}
                    <span className="text-xs text-text3">· {z.recordCount} registro(s)</span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Link href={`/admin/dominios/${encodeURIComponent(z.name)}`} className="flex-1">
                      <Button variant="outline" size="sm" className="w-full">Gerenciar</Button>
                    </Link>
                    <DeleteZoneButton zone={z} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <AddZoneDialog open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function NsRow({ label, host, ip }: { label: string; host: string; ip: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg p-3">
      <p className="text-xs font-medium text-text3">{label}</p>
      <div className="mt-1 flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate font-mono text-sm text-text">{host}</span>
        <CopyButton value={host} label={`nameserver ${host}`} />
      </div>
      <div className="mt-1 flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-text2">{ip}</span>
        <CopyButton value={ip} label={`IP ${ip}`} />
      </div>
    </div>
  );
}

function DeleteZoneButton({ zone }: { zone: DnsZone }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = React.useState(false);
  const [text, setText] = React.useState("");

  const remove = useMutation({
    mutationFn: () => api.deleteDnsZone(zone.name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dns-zones"] });
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
        title={zone.undeletableReason ?? undefined}
      >
        <Trash2 size={15} aria-hidden="true" />
      </Button>
      <Dialog
        open={confirm}
        onClose={() => { setConfirm(false); setText(""); }}
        title="Excluir domínio"
        description="Remove a zona e todos os seus registros do servidor DNS. Não é possível desfazer."
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-zone">Digite <strong>{zone.name}</strong> para confirmar</Label>
            <Input id="confirm-zone" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono" />
          </div>
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

function AddZoneDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<CreateZoneResult | null>(null);

  React.useEffect(() => {
    if (open) { setName(""); setError(null); setResult(null); }
  }, [open]);

  const create = useMutation({
    mutationFn: (n: string) => api.createDnsZone({ name: n }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["dns-zones"] });
      if (res.alreadyResolves) {
        setResult(res); // mostra alerta anti-takeover antes de fechar
      } else {
        toast.show("success", `Domínio ${res.zone.name} criado.`);
        onClose();
      }
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Falha ao criar o domínio."),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = createZoneInput.safeParse({ name: name.trim() });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Domínio inválido."); return; }
    create.mutate(parsed.data.name);
  }

  // Segunda etapa: criado, mas já resolvia → avisa para importar antes de delegar.
  if (result) {
    return (
      <Dialog open={open} onClose={onClose} title="Domínio criado — atenção antes de delegar" description={undefined}>
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
            <AlertTriangle size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
            <div className="text-sm text-text">
              <p className="font-semibold">Este domínio já está no ar hoje.</p>
              <p className="mt-1 text-text2">
                {result.resolvesTo.length ? `Aponta para ${result.resolvesTo.join(", ")}. ` : ""}
                Antes de trocar os nameservers no registrador, abra o domínio e use
                <strong> “Importar registros atuais”</strong> para não derrubar nada.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Fechar</Button>
            <Link href={`/admin/dominios/${encodeURIComponent(result.zone.name)}`}>
              <Button onClick={onClose}>Abrir domínio</Button>
            </Link>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} title="Adicionar domínio" description="Informe o domínio (ou subdomínio). O SOA, os NS e o glue nascem automaticamente.">
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="zone-name">Domínio</Label>
          <Input
            id="zone-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="exemplo.com ou lab.exemplo.com"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            className="font-mono"
          />
          <p className="text-xs text-text3">
            Dica: para estrear sem risco, comece por um subdomínio (ex.: <span className="font-mono">lab.geestao.top</span>).
          </p>
        </div>
        {error ? (
          <p role="alert" className="flex items-center gap-2 text-sm font-medium text-danger">
            <AlertTriangle size={16} aria-hidden="true" />
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={create.isPending}>{create.isPending ? "Criando…" : "Criar zona"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Card super-admin: subdomínios jamees.top que ninguém pode selecionar. */
function ReservedSubdomainsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "reserved-subdomains"], queryFn: api.listReservedSubdomains });
  const [name, setName] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const add = useMutation({
    mutationFn: () => api.createReservedSubdomain({ name: name.trim(), reason: reason.trim() || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "reserved-subdomains"] }); setName(""); setReason(""); setError(null); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Falha ao reservar."),
  });
  const del = useMutation({
    mutationFn: (n: string) => api.deleteReservedSubdomain(n),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "reserved-subdomains"] }),
  });

  return (
    <Card>
      <h2 className="text-sm font-semibold text-text">Subdomínios reservados (jamees.top)</h2>
      <p className="mt-1 text-xs text-text3">Nomes que nenhum cliente pode escolher para o endereço temporário. Os travados (infra/marca) não são removíveis.</p>

      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setError(null); add.mutate(); }}>
        <div className="flex flex-col gap-1">
          <label htmlFor="rs-name" className="text-xs text-text3">Subdomínio</label>
          <input id="rs-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: loja" className="rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-text outline-none focus:border-brand-strong" />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="rs-reason" className="text-xs text-text3">Motivo (opcional)</label>
          <input id="rs-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="marca, campanha…" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-brand-strong" />
        </div>
        <Button type="submit" size="sm" disabled={add.isPending || !name.trim()}>Reservar</Button>
      </form>
      {error ? <p role="alert" className="mt-2 text-xs font-medium text-danger">{error}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {q.data?.map((r) => (
          <span key={r.name} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg px-2.5 py-1 text-xs">
            <span className="font-mono text-text">{r.name}</span>
            {r.locked ? (
              <span className="text-text3" title="travado (infra/marca)">🔒</span>
            ) : (
              <button type="button" onClick={() => del.mutate(r.name)} aria-label={`Remover ${r.name}`} className="text-text3 hover:text-danger">✕</button>
            )}
          </span>
        ))}
        {q.data && q.data.length === 0 ? <p className="text-sm text-text3">Nenhum reservado.</p> : null}
      </div>
    </Card>
  );
}
