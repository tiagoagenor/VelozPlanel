"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  ChevronLeft,
  Copy,
  Check,
  Plus,
  Pencil,
  Trash2,
  Lock,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Download,
  type LucideIcon,
} from "lucide-react";
import {
  upsertRRsetInput,
  type DnsRRset,
  type DnsRecordType,
  type VerifyResult,
  type DiscoverResult,
} from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

const RECORD_TYPES: DnsRecordType[] = ["A", "AAAA", "CNAME", "MX", "TXT", "SRV", "CAA"];

const TYPE_HINT: Record<string, string> = {
  A: "Um IPv4 por linha (ex.: 187.127.49.205).",
  AAAA: "Um IPv6 por linha (ex.: 2001:db8::1).",
  CNAME: "Um destino (ex.: destino.exemplo.com). Não use no domínio raiz (@).",
  MX: "Uma linha por servidor: prioridade destino (ex.: 10 mail.exemplo.com).",
  TXT: "Um valor por linha (ex.: v=spf1 include:_spf.google.com ~all).",
  SRV: "prioridade peso porta destino (ex.: 10 5 5060 sip.exemplo.com).",
  CAA: 'flags tag "valor" (ex.: 0 issue "letsencrypt.org").',
};

function CopyInline({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ }
      }}
      aria-label={`Copiar ${label}`}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text3 transition-colors hover:bg-bg hover:text-text"
    >
      {copied ? <Check size={14} aria-hidden="true" className="text-success" /> : <Copy size={14} aria-hidden="true" />}
    </button>
  );
}

export default function ZoneDetailPage() {
  const params = useParams<{ zona: string }>();
  const zone = decodeURIComponent(params.zona);
  const qc = useQueryClient();
  const toast = useToast();

  const rrQuery = useQuery({ queryKey: ["dns-rrsets", zone], queryFn: () => api.getDnsRRsets(zone) });
  const infoQuery = useQuery({ queryKey: ["dns-server-info"], queryFn: api.dnsServerInfo });

  const [editing, setEditing] = React.useState<DnsRRset | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [verifyResult, setVerifyResult] = React.useState<VerifyResult | null>(null);

  const verify = useMutation({
    mutationFn: () => api.verifyDnsZone(zone),
    onSuccess: (r) => {
      setVerifyResult(r);
      qc.invalidateQueries({ queryKey: ["dns-zones"] });
    },
    onError: (err) => toast.show("error", err instanceof Error ? err.message : "Falha ao verificar."),
  });

  const removeRRset = useMutation({
    mutationFn: (r: DnsRRset) => api.deleteDnsRRset(zone, { name: r.name, type: r.type }),
    onSuccess: (list) => {
      qc.setQueryData(["dns-rrsets", zone], list);
      qc.invalidateQueries({ queryKey: ["dns-zones"] });
      toast.show("success", "Registro removido.");
    },
    onError: (err) => toast.show("error", err instanceof Error ? err.message : "Falha ao remover o registro."),
  });
  const [confirmDel, setConfirmDel] = React.useState<DnsRRset | null>(null);

  return (
    <>
      {/* Breadcrumb */}
      <nav aria-label="Trilha" className="mb-4 flex items-center gap-1 text-sm text-text3">
        <Link href="/admin/dominios" className="text-link hover:underline">Domínios</Link>
        <ChevronRight size={15} aria-hidden="true" />
        <span aria-current="page" className="truncate font-mono text-text2">{zone}</span>
      </nav>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/dominios" className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-link hover:underline">
            <ChevronLeft size={14} aria-hidden="true" /> Domínios
          </Link>
          <h1 className="font-mono text-[26px] font-bold leading-tight text-text">{zone}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImporting(true)}>
            <Download size={16} aria-hidden="true" /> Importar registros atuais
          </Button>
          <Button onClick={() => setAdding(true)}>
            <Plus size={16} aria-hidden="true" /> Adicionar registro
          </Button>
        </div>
      </header>

      {/* Painel de delegação + verificação */}
      {infoQuery.data ? (
        <Card className="mb-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-semibold text-text">Delegação</p>
              <p className="mt-0.5 text-sm text-text2">
                No registrador de <span className="font-mono">{zone}</span>, aponte os nameservers para:
              </p>
              <ul className="mt-2 space-y-1">
                {infoQuery.data.nameservers.map((ns) => (
                  <li key={ns.host} className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-text">{ns.host}</span>
                    <CopyInline value={ns.host} label={ns.host} />
                    <span className="text-text3">→</span>
                    <span className="font-mono text-xs text-text2">{ns.ip}</span>
                    <CopyInline value={ns.ip} label={ns.ip} />
                  </li>
                ))}
              </ul>
            </div>
            <div className="shrink-0">
              <Button variant="outline" onClick={() => verify.mutate()} disabled={verify.isPending} aria-busy={verify.isPending}>
                <RefreshCw size={16} aria-hidden="true" className={verify.isPending ? "animate-spin" : ""} />
                {verify.isPending ? "Verificando…" : "Verificar agora"}
              </Button>
            </div>
          </div>
          {verifyResult ? (
            <div className="mt-4 grid gap-2 border-t border-border-subtle pt-4 sm:grid-cols-3" aria-live="polite">
              <VerifyCheck ok={verifyResult.delegatedAtParent} label="Delegado no registrador" />
              <VerifyCheck ok={verifyResult.primaryAnswering} label="Primário respondendo" />
              <VerifyCheck ok={verifyResult.secondaryAnswering} label="Secundário respondendo" />
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* Tabela de registros */}
      {rrQuery.isPending ? (
        <div className="vp-card-shadow h-40 animate-pulse rounded-xl border border-border-subtle bg-surface" />
      ) : rrQuery.isError ? (
        <Card className="flex items-start gap-3">
          <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          <div>
            <p role="alert" className="font-medium text-text">Não foi possível carregar os registros.</p>
            <p className="mt-1 text-sm text-text2">{rrQuery.error instanceof Error ? rrQuery.error.message : ""}</p>
          </div>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <caption className="sr-only">Registros DNS da zona {zone}.</caption>
            <thead>
              <tr className="border-b border-border-subtle bg-bg text-left text-text3">
                <th scope="col" className="px-4 py-3 font-semibold">Nome</th>
                <th scope="col" className="px-4 py-3 font-semibold">Tipo</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">TTL</th>
                <th scope="col" className="px-4 py-3 font-semibold">Valor</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {rrQuery.data.map((r) => {
                const canEdit = r.protectedReason !== "system";
                const canDelete = !r.protected;
                return (
                  <tr key={`${r.name}-${r.type}`} className="border-b border-border-subtle align-top last:border-0 hover:bg-bg">
                    <td className="px-4 py-3 font-mono font-medium text-text">
                      <div className="flex items-center gap-1.5">
                        <span>{r.name}</span>
                        {r.protected ? (
                          <span title={r.protectedMsg ?? undefined} aria-label={r.protectedMsg ?? "Protegido"}>
                            {r.protectedReason === "system" ? (
                              <Lock size={13} aria-hidden="true" className="text-text3" />
                            ) : (
                              <ShieldAlert size={13} aria-hidden="true" className="text-warning" />
                            )}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone="neutral">{r.type}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-text2">{r.ttl}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5 font-mono text-xs text-text2">
                        {r.records.map((c, i) => (<span key={i} className="break-all">{c}</span>))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {canEdit ? (
                          <Button variant="ghost" size="sm" onClick={() => setEditing(r)} aria-label={`Editar ${r.name} ${r.type}`}>
                            <Pencil size={15} aria-hidden="true" />
                          </Button>
                        ) : null}
                        {canDelete ? (
                          <Button variant="ghost" size="sm" onClick={() => setConfirmDel(r)} aria-label={`Excluir ${r.name} ${r.type}`}>
                            <Trash2 size={15} aria-hidden="true" />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <RecordDialog zone={zone} open={adding} initial={null} onClose={() => setAdding(false)} />
      <RecordDialog zone={zone} open={editing !== null} initial={editing} onClose={() => setEditing(null)} />
      <ImportDialog zone={zone} open={importing} onClose={() => setImporting(false)} />

      <Dialog
        open={confirmDel !== null}
        onClose={() => setConfirmDel(null)}
        title="Excluir registro"
        description={confirmDel ? `Remove o conjunto ${confirmDel.name} ${confirmDel.type}. Não é possível desfazer.` : undefined}
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmDel(null)}>Cancelar</Button>
          <Button
            variant="danger"
            disabled={removeRRset.isPending}
            onClick={() => { if (confirmDel) removeRRset.mutate(confirmDel, { onSuccess: () => setConfirmDel(null) }); }}
          >
            {removeRRset.isPending ? "Excluindo…" : "Excluir"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function VerifyCheck({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-bg p-3">
      {ok ? (
        <CheckCircle2 size={18} aria-hidden="true" className="shrink-0 text-success" />
      ) : (
        <XCircle size={18} aria-hidden="true" className="shrink-0 text-text3" />
      )}
      <span className="text-sm text-text2">{label}</span>
    </div>
  );
}

/* ─────────────── Dialog de adicionar/editar registro ─────────────── */

function RecordDialog({
  zone,
  open,
  initial,
  onClose,
}: {
  zone: string;
  open: boolean;
  initial: DnsRRset | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const isEdit = initial !== null;

  const [type, setType] = React.useState<DnsRecordType>("A");
  const [name, setName] = React.useState("@");
  const [ttl, setTtl] = React.useState("300");
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setType((initial?.type as DnsRecordType) ?? "A");
      setName(initial?.name ?? "@");
      setTtl(String(initial?.ttl ?? 300));
      setValue(initial ? initial.records.join("\n") : "");
      setError(null);
    }
  }, [open, initial]);

  const save = useMutation({
    mutationFn: (input: { name: string; type: DnsRecordType; ttl: number; records: string[] }) =>
      api.putDnsRRset(zone, input),
    onSuccess: (list) => {
      qc.setQueryData(["dns-rrsets", zone], list);
      qc.invalidateQueries({ queryKey: ["dns-zones"] });
      toast.show("success", isEdit ? "Registro atualizado." : "Registro adicionado.");
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Falha ao salvar o registro."),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const records = value.split("\n").map((l) => l.trim()).filter(Boolean);
    const parsed = upsertRRsetInput.safeParse({
      name: name.trim() || "@",
      type,
      ttl: Number(ttl),
      records,
    });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Dados inválidos."); return; }
    save.mutate(parsed.data);
  }

  const panelWarn = isEdit && initial?.protectedReason === "panel";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? "Editar registro" : "Adicionar registro"}
      description={isEdit ? undefined : "O conjunto (nome + tipo) é substituído inteiro pelos valores abaixo."}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        {panelWarn ? (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            <ShieldAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
            <span className="text-text2">{initial?.protectedMsg}</span>
          </div>
        ) : null}

        {/* Tipo (chips) */}
        <div className="flex flex-col gap-1.5">
          <Label>Tipo</Label>
          <div className="flex flex-wrap gap-1.5">
            {RECORD_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                disabled={isEdit}
                aria-pressed={type === t}
                className={
                  "rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors " +
                  (type === t
                    ? "border-brand-strong bg-brand-soft text-brand-strong"
                    : "border-border bg-surface text-text2 hover:bg-bg disabled:opacity-40")
                }
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rr-name">Nome</Label>
            <Input
              id="rr-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isEdit}
              placeholder="@ (raiz) ou www"
              autoComplete="off"
              spellCheck={false}
              className="font-mono disabled:opacity-60"
            />
            <p className="text-xs text-text3">Use <span className="font-mono">@</span> para o domínio raiz.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rr-ttl">TTL (seg)</Label>
            <Input
              id="rr-ttl"
              type="number"
              min={60}
              max={604800}
              value={ttl}
              onChange={(e) => setTtl(e.target.value)}
              className="w-28 font-mono"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rr-value">Valor</Label>
          <textarea
            id="rr-value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={4}
            placeholder={TYPE_HINT[type]}
            className="w-full resize-y rounded-lg border border-border bg-bg p-3 font-mono text-sm text-text outline-none focus:border-brand-strong"
          />
          <p className="text-xs text-text3">{TYPE_HINT[type]} Um valor por linha.</p>
        </div>

        {error ? (
          <p role="alert" className="flex items-center gap-2 text-sm font-medium text-danger">
            <AlertTriangle size={16} aria-hidden="true" /> {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? "Salvando…" : "Salvar"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ─────────────── Importar registros atuais ─────────────── */

function ImportDialog({ zone, open, onClose }: { zone: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [data, setData] = React.useState<DiscoverResult | null>(null);
  const [selected, setSelected] = React.useState<Set<number>>(new Set());

  const discover = useMutation({
    mutationFn: () => api.discoverDnsZone(zone),
    onSuccess: (res) => {
      setData(res);
      setSelected(new Set(res.rrsets.map((_, i) => i)));
    },
    onError: (err) => toast.show("error", err instanceof Error ? err.message : "Falha ao varrer os registros."),
  });

  React.useEffect(() => {
    if (open) { setData(null); setSelected(new Set()); discover.mutate(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const doImport = useMutation({
    mutationFn: async () => {
      if (!data) return;
      const chosen = data.rrsets.filter((_, i) => selected.has(i));
      for (const r of chosen) {
        await api.putDnsRRset(zone, { name: r.name, type: r.type as DnsRecordType, ttl: r.ttl, records: r.records });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dns-rrsets", zone] });
      qc.invalidateQueries({ queryKey: ["dns-zones"] });
      toast.show("success", "Registros importados.");
      onClose();
    },
    onError: (err) => toast.show("error", err instanceof Error ? err.message : "Falha ao importar."),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Importar registros atuais"
      description="Varremos o que o domínio resolve hoje, para você recriar aqui antes de trocar os nameservers (evita indisponibilidade)."
    >
      <div className="flex flex-col gap-4">
        {discover.isPending ? (
          <div className="h-24 animate-pulse rounded-lg border border-border-subtle bg-bg" />
        ) : !data || data.rrsets.length === 0 ? (
          <p className="text-sm text-text2">Nenhum registro encontrado no mundo para este domínio (ou ele ainda não resolve).</p>
        ) : (
          <>
            {data.partial ? (
              <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
                <span className="text-text2">A varredura foi parcial — alguns servidores não responderam. Confira antes de delegar.</span>
              </div>
            ) : null}
            <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
              {data.rrsets.map((r, i) => (
                <li key={`${r.name}-${r.type}`}>
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border-subtle p-2.5 hover:bg-bg">
                    <input
                      type="checkbox"
                      checked={selected.has(i)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(i); else next.delete(i);
                        setSelected(next);
                      }}
                      className="mt-1"
                    />
                    <div className="min-w-0">
                      <p className="font-mono text-sm text-text"><span className="font-semibold">{r.name}</span> <Badge tone="neutral">{r.type}</Badge></p>
                      <p className="mt-0.5 break-all font-mono text-xs text-text2">{r.records.join("  ·  ")}</p>
                    </div>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={() => doImport.mutate()}
            disabled={doImport.isPending || !data || selected.size === 0}
          >
            {doImport.isPending ? "Importando…" : `Importar ${selected.size} registro(s)`}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
