"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Copy,
  Check,
  Plus,
  Pencil,
  Trash2,
  Lock,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Circle,
  RefreshCw,
  Download,
  Rocket,
  Mail,
  ShieldCheck,
  Info,
} from "lucide-react";
import {
  upsertRRsetInput,
  DNS_TYPE_INFO,
  DNS_PRESETS,
  DNS_TTL_OPTIONS,
  type DnsRRset,
  type DnsRecordType,
  type ServingStatus,
  type DnsZoneEffective,
  type Environment,
} from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

/** Tipos oferecidos no editor (SOA/NS ficam de fora — são estruturais). */
const EDITOR_TYPES: DnsRecordType[] = ["A", "AAAA", "CNAME", "MX", "TXT", "SRV", "CAA"];

const LADDER: Record<ServingStatus, { step: string; tone: "neutral" | "warning" | "info" | "success"; label: string }> = {
  sem_apontamento: { step: "—", tone: "neutral", label: "Sem apontamento" },
  aguardando_propagacao: { step: "②", tone: "warning", label: "DNS propagando" },
  dns_pronto: { step: "③", tone: "success", label: "DNS pronto" },
  publicado: { step: "✓", tone: "success", label: "Publicado" },
};

function CopyInline({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ } }}
      aria-label={`Copiar ${label}`} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text3 transition-colors hover:bg-bg hover:text-text">
      {copied ? <Check size={14} aria-hidden="true" className="text-success" /> : <Copy size={14} aria-hidden="true" />}
    </button>
  );
}

export default function ClientZonePage() {
  const params = useParams<{ zona: string }>();
  const zone = decodeURIComponent(params.zona);
  const qc = useQueryClient();
  const toast = useToast();

  const rrQuery = useQuery({ queryKey: ["domain-rrsets", zone], queryFn: () => api.getDomainRRsets(zone) });
  const infoQuery = useQuery({ queryKey: ["domain-server-info"], queryFn: api.domainServerInfo });
  const effQuery = useQuery({ queryKey: ["domain-effective", zone], queryFn: () => api.getDomainEffective(zone) });
  const zonesQuery = useQuery({ queryKey: ["domains"], queryFn: api.listDomains });
  const meta = zonesQuery.data?.find((z) => z.name === zone);
  const needsVerification = meta?.status === "pending_verification";

  const verify = useMutation({
    mutationFn: () => api.verifyDomain(zone),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["domains"] });
      qc.invalidateQueries({ queryKey: ["domain-effective", zone] });
      toast.show("success",
        r.delegatedAtParent ? "Delegação confirmada!" : "Ainda não vejo os nameservers apontando para nós. Pode levar algumas horas.");
    },
    onError: (err) => toast.show("error", err instanceof Error ? err.message : "Falha ao verificar."),
  });

  return (
    <>
      <nav aria-label="Trilha" className="mb-4 flex items-center gap-1 text-sm text-text3">
        <Link href="/dominios" className="text-link hover:underline">Meus domínios</Link>
        <ChevronRight size={15} aria-hidden="true" />
        <span aria-current="page" className="truncate font-mono text-text2">{zone}</span>
      </nav>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dominios" className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-link hover:underline">
            <ChevronLeft size={14} aria-hidden="true" /> Meus domínios
          </Link>
          <h1 className="font-mono text-[26px] font-bold leading-tight text-text">{zone}</h1>
        </div>
        <Button variant="outline" onClick={() => verify.mutate()} disabled={verify.isPending} aria-busy={verify.isPending}>
          <RefreshCw size={16} aria-hidden="true" className={verify.isPending ? "animate-spin" : ""} />
          {verify.isPending ? "Verificando…" : "Verificar propagação"}
        </Button>
      </header>

      {/* Portão de verificação quando o domínio já resolvia (anti-tomada) */}
      {needsVerification ? (
        <Card className="mb-6 border-warning/40">
          <div className="flex items-start gap-3">
            <ShieldAlert size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
            <div className="min-w-0">
              <p className="font-semibold text-text">Confirme que este domínio é seu</p>
              <p className="mt-1 text-sm text-text2">
                Este domínio já resolve na internet. Para liberar a edição, troque os nameservers no seu registrador para os nossos e clique em <strong>Verificar propagação</strong>.
              </p>
              {infoQuery.data ? (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {infoQuery.data.nameservers.map((ns) => (
                    <li key={ns.host} className="flex items-center gap-1 rounded-lg border border-border-subtle bg-bg px-2.5 py-1.5">
                      <span className="font-mono text-sm text-text">{ns.host}</span>
                      <CopyInline value={ns.host} label={ns.host} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        </Card>
      ) : (
        <>
          {/* 1) Apontar para um ambiente (fácil) */}
          <PointCard zone={zone} effective={effQuery.data} />

          {/* 2) Registros DNS (avançado) */}
          <RecordsEditor zone={zone} rrsets={rrQuery.data} loading={rrQuery.isPending} error={rrQuery.isError} />

          {/* 3) Resumo da configuração (preview) */}
          <EffectivePreview zone={zone} effective={effQuery.data} loading={effQuery.isPending} />
        </>
      )}
    </>
  );
}

/* ─────────────── 1) Apontar para um ambiente ─────────────── */

function PointCard({ zone, effective }: { zone: string; effective?: DnsZoneEffective }) {
  const qc = useQueryClient();
  const toast = useToast();
  const envsQuery = useQuery({ queryKey: ["environments"], queryFn: api.listEnvironments });
  const [mode, setMode] = React.useState<"env" | "ip">("env");
  const [envId, setEnvId] = React.useState("");
  const [ip, setIp] = React.useState("");
  const [label, setLabel] = React.useState("@");
  const [includeWww, setIncludeWww] = React.useState(true);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["domain-effective", zone] });
    qc.invalidateQueries({ queryKey: ["domain-rrsets", zone] });
  };

  const point = useMutation({
    mutationFn: () => api.pointDomain(zone, { label: label.trim() || "@", environmentId: envId, includeWww }),
    onSuccess: () => { invalidate(); toast.show("success", "Domínio apontado para o ambiente."); setEnvId(""); setLabel("@"); },
    onError: (err) => toast.show("error", err instanceof Error ? err.message : "Falha ao apontar."),
  });
  // Apontar direto para um IP público = criar um registro A (reusa o PUT de rrset).
  const pointIp = useMutation({
    mutationFn: async () => {
      const l = label.trim() || "@";
      await api.putDomainRRset(zone, { name: l, type: "A", ttl: 300, records: [ip.trim()] });
      if (l === "@" && includeWww) await api.putDomainRRset(zone, { name: "www", type: "A", ttl: 300, records: [ip.trim()] });
    },
    onSuccess: () => { invalidate(); toast.show("success", "Subdomínio apontado para o IP."); setIp(""); setLabel("@"); },
    onError: (err) => toast.show("error", err instanceof Error ? err.message : "Falha ao apontar. Confira o IP."),
  });
  const unpoint = useMutation({
    mutationFn: (l: string) => api.unpointDomain(zone, l),
    onSuccess: () => { invalidate(); toast.show("success", "Apontamento removido."); },
    onError: (err) => toast.show("error", err instanceof Error ? err.message : "Falha ao remover."),
  });

  const isApex = label.trim() === "" || label.trim() === "@";
  const fqdnPreview = isApex ? zone : `${label.trim().replace(/\.$/, "")}.${zone}`;
  const envs = (envsQuery.data ?? []).filter((e: Environment) => e.category !== "service");
  const points = effective?.points ?? [];

  return (
    <Card className="mb-6">
      <div className="flex items-center gap-2">
        <Rocket size={18} aria-hidden="true" className="text-brand-strong" />
        <h2 className="font-semibold text-text">Apontar (sub)domínio</h2>
      </div>
      <p className="mt-1 text-sm text-text2">A forma fácil: aponte para um ambiente seu, ou direto para um endereço IP público.</p>

      {/* Seletor de destino */}
      <div className="mt-4 inline-flex rounded-lg border border-border p-0.5" role="tablist" aria-label="Destino do apontamento">
        <button type="button" role="tab" aria-selected={mode === "env"} onClick={() => setMode("env")}
          className={"rounded-md px-3 py-1.5 text-sm font-medium transition-colors " + (mode === "env" ? "bg-brand-soft text-brand-strong" : "text-text2 hover:text-text")}>
          Ambiente
        </button>
        <button type="button" role="tab" aria-selected={mode === "ip"} onClick={() => setMode("ip")}
          className={"rounded-md px-3 py-1.5 text-sm font-medium transition-colors " + (mode === "ip" ? "bg-brand-soft text-brand-strong" : "text-text2 hover:text-text")}>
          Endereço (IP)
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pt-label">Nome</Label>
          <Input id="pt-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="@ (raiz) ou www, loja…" className="font-mono" autoComplete="off" spellCheck={false} />
        </div>
        {mode === "env" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pt-env">Ambiente</Label>
            <select id="pt-env" value={envId} onChange={(e) => setEnvId(e.target.value)}
              className="h-11 rounded-lg border border-border bg-bg px-3 text-sm text-text outline-none focus:border-brand-strong">
              <option value="">Selecione…</option>
              {envs.map((e: Environment) => (<option key={e.id} value={e.id}>{e.name}</option>))}
            </select>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pt-ip">Endereço IP (IPv4)</Label>
            <Input id="pt-ip" value={ip} onChange={(e) => setIp(e.target.value)} placeholder="Ex.: 187.127.49.205" className="font-mono" autoComplete="off" spellCheck={false} inputMode="decimal" />
          </div>
        )}
        {mode === "env" ? (
          <Button onClick={() => point.mutate()} disabled={!envId || point.isPending}>{point.isPending ? "Apontando…" : "Apontar"}</Button>
        ) : (
          <Button onClick={() => pointIp.mutate()} disabled={!ip.trim() || pointIp.isPending}>{pointIp.isPending ? "Apontando…" : "Apontar"}</Button>
        )}
      </div>
      <p className="mt-2 text-xs text-text3">Vai criar: <span className="font-mono text-text2">{fqdnPreview}</span>{mode === "ip" && ip.trim() ? <> <span className="text-text3">→</span> <span className="font-mono text-text2">{ip.trim()}</span></> : null}</p>
      {isApex ? (
        <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-sm text-text2">
          <input type="checkbox" checked={includeWww} onChange={(e) => setIncludeWww(e.target.checked)} />
          Apontar também <span className="font-mono">www.{zone}</span>
        </label>
      ) : null}

      {points.length ? (
        <ul className="mt-4 flex flex-col gap-2 border-t border-border-subtle pt-4">
          {points.map((p) => {
            const l = LADDER[p.servingStatus];
            return (
              <li key={p.label} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle bg-bg p-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm text-text">{p.fqdn} <span className="text-text3">→</span> {p.environmentName}</p>
                  <p className="mt-0.5 text-xs text-text3">
                    {p.resolvedTo ? `Hoje resolve para ${p.resolvedTo}` : "Ainda não resolve na internet"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={l.tone}>{l.step} {l.label}</Badge>
                  <Button variant="ghost" size="sm" onClick={() => unpoint.mutate(p.label)} disabled={unpoint.isPending} aria-label={`Remover apontamento de ${p.fqdn}`}>
                    <Trash2 size={15} aria-hidden="true" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}

/* ─────────────── 2) Editor de registros (estilo Hostinger) ─────────────── */

function splitPrio(type: string, content: string): { prio: string; rest: string } {
  if ((type === "MX" || type === "SRV")) {
    const m = content.match(/^(\d+)\s+(.+)$/);
    if (m) return { prio: m[1]!, rest: m[2]! };
  }
  return { prio: "", rest: content };
}

function TypePicker({ value, onChange, disabled }: { value: DnsRecordType; onChange: (t: DnsRecordType) => void; disabled?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}
        className="flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-border bg-bg px-3 text-sm text-text outline-none focus:border-brand-strong disabled:opacity-50">
        <span className="font-semibold">{value}</span>
        <ChevronDown size={16} aria-hidden="true" className="text-text3" />
      </button>
      {open ? (
        <ul role="listbox" className="absolute z-20 mt-1 max-h-72 w-[min(92vw,26rem)] overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg">
          {EDITOR_TYPES.map((t) => (
            <li key={t}>
              <button type="button" role="option" aria-selected={t === value}
                onClick={() => { onChange(t); setOpen(false); }}
                className="flex w-full gap-3 rounded-md p-2 text-left hover:bg-bg">
                <Badge tone="neutral" className="mt-0.5 shrink-0">{t}</Badge>
                <span className="text-xs text-text2">{DNS_TYPE_INFO[t].description}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function RecordsEditor({ zone, rrsets, loading, error }: { zone: string; rrsets?: DnsRRset[]; loading: boolean; error: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();

  const [type, setType] = React.useState<DnsRecordType>("A");
  const [name, setName] = React.useState("");
  const [prio, setPrio] = React.useState("10");
  const [value, setValue] = React.useState("");
  const [ttl, setTtl] = React.useState(300);
  const [editing, setEditing] = React.useState<DnsRRset | null>(null);
  const [confirmDel, setConfirmDel] = React.useState<DnsRRset | null>(null);
  const info = DNS_TYPE_INFO[type];

  const save = useMutation({
    mutationFn: (body: { name: string; type: DnsRecordType; ttl: number; records: string[] }) => api.putDomainRRset(zone, body),
    onSuccess: (list) => {
      qc.setQueryData(["domain-rrsets", zone], list);
      qc.invalidateQueries({ queryKey: ["domain-effective", zone] });
      toast.show("success", "Registro salvo.");
      setName(""); setValue(""); setEditing(null);
    },
    onError: (err) => toast.show("error", err instanceof Error ? err.message : "Falha ao salvar."),
  });
  const remove = useMutation({
    mutationFn: (r: DnsRRset) => api.deleteDomainRRset(zone, { name: r.name, type: r.type }),
    onSuccess: (list) => {
      qc.setQueryData(["domain-rrsets", zone], list);
      qc.invalidateQueries({ queryKey: ["domain-effective", zone] });
      toast.show("success", "Registro removido.");
      setConfirmDel(null);
    },
    onError: (err) => toast.show("error", err instanceof Error ? err.message : "Falha ao remover."),
  });

  function composeContent(): string {
    const v = value.trim();
    return info.hasPriority ? `${prio.trim() || "10"} ${v}` : v;
  }
  function onAdd() {
    const body = { name: name.trim() || "@", type, ttl, records: [composeContent()] };
    const parsed = upsertRRsetInput.safeParse(body);
    if (!parsed.success) { toast.show("error", parsed.error.issues[0]?.message ?? "Dados inválidos."); return; }
    save.mutate(parsed.data);
  }
  function applyPreset(p: (typeof DNS_PRESETS)[number]) {
    setType(p.type); setName(p.recordLabel);
    if (DNS_TYPE_INFO[p.type].hasPriority) {
      const s = splitPrio(p.type, p.template); setPrio(s.prio || "10"); setValue(s.rest);
    } else setValue(p.template);
  }

  async function onExport() {
    try {
      const { content } = await api.exportDomain(zone);
      await navigator.clipboard.writeText(content);
      toast.show("success", "Registros copiados (formato de zona).");
    } catch { toast.show("error", "Falha ao exportar."); }
  }

  return (
    <Card className="mb-6 p-0">
      <details open>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-4">
          <span className="flex items-center gap-2 font-semibold text-text"><ChevronDown size={16} aria-hidden="true" className="text-text3" /> Registros DNS (avançado)</span>
          <span className="text-xs text-text3">{rrsets ? rrsets.filter((r) => r.protectedReason !== "system").length : 0} registro(s)</span>
        </summary>

        <div className="border-t border-border-subtle p-4">
          {/* Presets */}
          <div className="mb-3 flex flex-wrap gap-1.5">
            <span className="mr-1 self-center text-xs text-text3">Atalhos:</span>
            {DNS_PRESETS.map((p) => (
              <button key={p.id} type="button" onClick={() => applyPreset(p)} title={p.help}
                className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text2 hover:bg-bg hover:text-text">{p.label}</button>
            ))}
          </div>

          {/* Linha de adicionar */}
          <div className="grid gap-2 rounded-lg border border-border-subtle bg-bg p-3 md:grid-cols-[10rem_1fr_auto]">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Tipo</Label>
              <TypePicker value={type} onChange={(t) => { setType(t); setValue(""); }} />
            </div>
            <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
              <div className="flex flex-col gap-1">
                <Label htmlFor="rec-name" className="text-xs">Nome</Label>
                <Input id="rec-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="@ ou www" className="font-mono" autoComplete="off" spellCheck={false} />
              </div>
              <div className="flex gap-2">
                {info.hasPriority ? (
                  <div className="flex w-20 flex-col gap-1">
                    <Label htmlFor="rec-prio" className="text-xs">Prioridade</Label>
                    <Input id="rec-prio" type="number" value={prio} onChange={(e) => setPrio(e.target.value)} className="font-mono" />
                  </div>
                ) : null}
                <div className="flex flex-1 flex-col gap-1">
                  <Label htmlFor="rec-val" className="text-xs">Valor</Label>
                  <Input id="rec-val" value={value} onChange={(e) => setValue(e.target.value)} placeholder={info.placeholder} className="font-mono" autoComplete="off" spellCheck={false} />
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="rec-ttl" className="text-xs">TTL</Label>
              <div className="flex items-end gap-2">
                <select id="rec-ttl" value={ttl} onChange={(e) => setTtl(Number(e.target.value))}
                  className="h-11 rounded-lg border border-border bg-surface px-2 text-sm text-text outline-none focus:border-brand-strong" title={`${ttl}s`}>
                  {DNS_TTL_OPTIONS.map((o) => (<option key={o.seconds} value={o.seconds}>{o.label}</option>))}
                </select>
                <Button onClick={onAdd} disabled={save.isPending || !value.trim()}><Plus size={16} aria-hidden="true" /> Adicionar</Button>
              </div>
            </div>
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-text3"><Info size={13} aria-hidden="true" className="mt-0.5 shrink-0" /> {info.description}</p>

          {/* Tabela */}
          <div className="mt-4 overflow-x-auto">
            {loading ? (
              <div className="h-24 animate-pulse rounded-lg border border-border-subtle bg-bg" />
            ) : error ? (
              <p role="alert" className="text-sm text-danger">Não foi possível carregar os registros.</p>
            ) : (
              <table className="w-full min-w-[40rem] border-collapse text-sm">
                <caption className="sr-only">Registros DNS de {zone}.</caption>
                <thead>
                  <tr className="border-b border-border-subtle text-left text-text3">
                    <th scope="col" className="py-2 pr-3 font-semibold">Tipo</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Nome</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Prioridade</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Conteúdo</th>
                    <th scope="col" className="py-2 pr-3 text-right font-semibold">TTL</th>
                    <th scope="col" className="py-2 text-right font-semibold"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {(rrsets ?? []).map((r) => r.records.map((c, ci) => {
                    const sp = splitPrio(r.type, c);
                    const canEdit = r.protectedReason !== "system";
                    const canDelete = !r.protected;
                    return (
                      <tr key={`${r.name}-${r.type}-${ci}`} className="border-b border-border-subtle last:border-0 hover:bg-bg">
                        <td className="py-2 pr-3"><Badge tone="neutral">{r.type}</Badge></td>
                        <td className="py-2 pr-3 font-mono text-text">
                          <span className="inline-flex items-center gap-1.5">{r.name}
                            {r.protected ? (r.protectedReason === "system"
                              ? <Lock size={12} aria-hidden="true" className="text-text3" />
                              : <ShieldAlert size={12} aria-hidden="true" className="text-warning" />) : null}
                          </span>
                        </td>
                        <td className="py-2 pr-3 tabular-nums text-text2">{sp.prio || "—"}</td>
                        <td className="py-2 pr-3 break-all font-mono text-xs text-text2">{sp.rest}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-text3">{r.ttl}</td>
                        <td className="py-2">
                          <div className="flex items-center justify-end gap-1">
                            {ci === 0 && canEdit ? (
                              <Button variant="ghost" size="sm" onClick={() => setEditing(r)} aria-label={`Editar ${r.name} ${r.type}`}><Pencil size={14} aria-hidden="true" /></Button>
                            ) : null}
                            {ci === 0 && canDelete ? (
                              <Button variant="ghost" size="sm" onClick={() => setConfirmDel(r)} aria-label={`Excluir ${r.name} ${r.type}`}><Trash2 size={14} aria-hidden="true" /></Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  }))}
                </tbody>
              </table>
            )}
          </div>

          <div className="mt-3 flex justify-end">
            <Button variant="outline" size="sm" onClick={onExport}><Download size={15} aria-hidden="true" /> Exportar</Button>
          </div>
        </div>
      </details>

      <EditRecordDialog zone={zone} rrset={editing} onClose={() => setEditing(null)} />

      <Dialog open={confirmDel !== null} onClose={() => setConfirmDel(null)} title="Excluir registro"
        description={confirmDel ? `Remove ${confirmDel.name} ${confirmDel.type}.` : undefined}>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmDel(null)}>Cancelar</Button>
          <Button variant="danger" disabled={remove.isPending} onClick={() => confirmDel && remove.mutate(confirmDel)}>{remove.isPending ? "Excluindo…" : "Excluir"}</Button>
        </div>
      </Dialog>
    </Card>
  );
}

function EditRecordDialog({ zone, rrset, onClose }: { zone: string; rrset: DnsRRset | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [value, setValue] = React.useState("");
  const [ttl, setTtl] = React.useState(300);

  React.useEffect(() => {
    if (rrset) { setValue(rrset.records.join("\n")); setTtl(rrset.ttl); }
  }, [rrset]);

  const save = useMutation({
    mutationFn: () => api.putDomainRRset(zone, { name: rrset!.name, type: rrset!.type, ttl, records: value.split("\n").map((l) => l.trim()).filter(Boolean) }),
    onSuccess: (list) => { qc.setQueryData(["domain-rrsets", zone], list); qc.invalidateQueries({ queryKey: ["domain-effective", zone] }); toast.show("success", "Registro atualizado."); onClose(); },
    onError: (err) => toast.show("error", err instanceof Error ? err.message : "Falha ao salvar."),
  });

  if (!rrset) return null;
  return (
    <Dialog open={rrset !== null} onClose={onClose} title={`Editar ${rrset.name} ${rrset.type}`} description="Um valor por linha.">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-val">Valor</Label>
          <textarea id="edit-val" value={value} onChange={(e) => setValue(e.target.value)} rows={4}
            className="w-full resize-y rounded-lg border border-border bg-bg p-3 font-mono text-sm text-text outline-none focus:border-brand-strong" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-ttl">TTL</Label>
          <select id="edit-ttl" value={ttl} onChange={(e) => setTtl(Number(e.target.value))} className="h-11 w-48 rounded-lg border border-border bg-bg px-2 text-sm text-text outline-none focus:border-brand-strong">
            {DNS_TTL_OPTIONS.map((o) => (<option key={o.seconds} value={o.seconds}>{o.label}</option>))}
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Salvando…" : "Salvar"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ─────────────── 3) Resumo da configuração (preview) ─────────────── */

function EffectivePreview({ zone, effective, loading }: { zone: string; effective?: DnsZoneEffective; loading: boolean }) {
  if (loading) return <Card className="h-28 animate-pulse" />;
  if (!effective) return null;
  const { points, mail, ssl, verifications, warnings } = effective;
  const empty = !points.length && !mail.length && !ssl.length && !verifications.length;

  return (
    <Card>
      <h2 className="font-semibold text-text">Como está ficando a configuração</h2>
      <p className="mt-1 text-sm text-text2">Resumo do que este domínio faz hoje.</p>

      <div className="mt-4 flex flex-col gap-3">
        {warnings.map((w) => (
          <div key={w.label} className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
            <span className="text-text2">{w.msg}</span>
          </div>
        ))}

        {points.map((p) => {
          const l = LADDER[p.servingStatus];
          return (
            <div key={p.label} className="flex items-start gap-3 rounded-lg border border-border-subtle bg-bg p-3">
              {p.servingStatus === "dns_pronto" || p.servingStatus === "publicado"
                ? <CheckCircle2 size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
                : <Circle size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-text3" />}
              <div className="min-w-0 text-sm">
                <p className="text-text"><span className="font-mono">{p.fqdn}</span> abre o ambiente <strong>{p.environmentName}</strong></p>
                <p className="mt-0.5 text-text3">{l.step} {l.label}{p.resolvedTo ? ` · resolve para ${p.resolvedTo}` : ""}</p>
              </div>
            </div>
          );
        })}

        {mail.map((m, i) => (
          <div key={`mx${i}`} className="flex items-center gap-3 rounded-lg border border-border-subtle bg-bg p-3 text-sm">
            <Mail size={18} aria-hidden="true" className="shrink-0 text-info" />
            <span className="text-text">E-mails vão para <span className="font-mono">{m.via}</span> <span className="text-text3">(prioridade {m.prio})</span></span>
          </div>
        ))}

        {verifications.map((v, i) => (
          <div key={`vf${i}`} className="flex items-center gap-3 rounded-lg border border-border-subtle bg-bg p-3 text-sm">
            <ShieldCheck size={18} aria-hidden="true" className="shrink-0 text-brand-strong" />
            <span className="text-text">Verificação <strong>{v.kind}</strong> em <span className="font-mono">{v.label}</span></span>
          </div>
        ))}

        {ssl.map((s, i) => (
          <div key={`caa${i}`} className="flex items-center gap-3 rounded-lg border border-border-subtle bg-bg p-3 text-sm">
            <ShieldCheck size={18} aria-hidden="true" className="shrink-0 text-success" />
            <span className="text-text">Só <span className="font-mono">{s.ca}</span> pode emitir certificados SSL</span>
          </div>
        ))}

        {empty ? <p className="text-sm text-text3">Nenhum apontamento ou serviço configurado ainda. Use “Apontar para um ambiente” acima para começar.</p> : null}
      </div>
    </Card>
  );
}
