"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Rocket, Plus, ArrowRight, Trash2, AlertTriangle, CheckCircle2, Circle, ExternalLink, Copy, Check, Pencil } from "lucide-react";
import { ApiError } from "@/lib/api";
import type { ServingStatus } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

const SERVING: Record<ServingStatus, { tone: "neutral" | "warning" | "success"; label: string }> = {
  sem_apontamento: { tone: "neutral", label: "Sem apontamento" },
  aguardando_propagacao: { tone: "warning", label: "DNS propagando" },
  dns_pronto: { tone: "success", label: "DNS pronto" },
  publicado: { tone: "success", label: "Publicado" },
};

/**
 * Aba "Domínio & DNS" do ambiente — mostra os domínios/subdomínios apontando
 * para ESTE ambiente (com remover) e um atalho para apontar mais um.
 */
export default function EnvDomainPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const qc = useQueryClient();
  const toast = useToast();

  const envQuery = useQuery({ queryKey: ["environment", id], queryFn: () => api.getEnvironment(id) });
  const zonesQuery = useQuery({ queryKey: ["domains"], queryFn: api.listDomains });
  const pointsQuery = useQuery({ queryKey: ["env-domains", id], queryFn: () => api.domainsForEnvironment(id) });
  const infoQuery = useQuery({ queryKey: ["domain-server-info"], queryFn: api.domainServerInfo });
  const env = envQuery.data;

  const [zone, setZone] = React.useState(""); // começa em "Selecionar domínio"
  const [label, setLabel] = React.useState("@");
  const [includeWww, setIncludeWww] = React.useState(true);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["env-domains", id] });
    qc.invalidateQueries({ queryKey: ["environment", id] });
    if (zone) qc.invalidateQueries({ queryKey: ["domain-effective", zone] });
  };

  const point = useMutation({
    mutationFn: () => api.pointDomain(zone, { label: label.trim() || "@", environmentId: id, includeWww }),
    onSuccess: () => { refresh(); toast.show("success", "Domínio apontado para este ambiente."); setLabel("@"); },
    onError: (err) => toast.show("error", err instanceof Error ? err.message : "Falha ao apontar."),
  });
  const unpoint = useMutation({
    mutationFn: (v: { zone: string; label: string }) => api.unpointDomain(v.zone, v.label),
    onSuccess: () => { refresh(); toast.show("success", "Domínio removido deste ambiente."); },
    onError: (err) => toast.show("error", err instanceof Error ? err.message : "Falha ao remover."),
  });

  const zones = zonesQuery.data ?? [];
  const points = pointsQuery.data ?? [];
  const isApex = label.trim() === "" || label.trim() === "@";
  const fqdn = isApex ? (zone || "seu-dominio") : `${label.trim().replace(/\.$/, "")}.${zone || "seu-dominio"}`;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-lg font-semibold text-text">Domínio & DNS</h2>
        <p className="mt-1 text-sm text-text2">Domínios e subdomínios que abrem o ambiente {env?.name ? <strong>{env.name}</strong> : "atual"}.</p>
      </header>

      {env?.autoSubdomain ? <SubdomainCard id={id} sub={env.autoSubdomain} /> : null}

      {/* Lista de domínios apontando para este ambiente */}
      {pointsQuery.isPending ? (
        <div className="h-24 animate-pulse rounded-xl border border-border-subtle bg-surface" />
      ) : points.length > 0 ? (
        <Card className="p-0">
          <ul className="divide-y divide-border-subtle">
            {points.map((p) => {
              const s = SERVING[p.servingStatus];
              const ready = p.servingStatus === "dns_pronto" || p.servingStatus === "publicado";
              return (
                <li key={`${p.zone}-${p.label}`} className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div className="flex min-w-0 items-center gap-2.5">
                    {ready ? <CheckCircle2 size={18} aria-hidden="true" className="shrink-0 text-success" /> : <Circle size={18} aria-hidden="true" className="shrink-0 text-text3" />}
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm text-text">{p.fqdn}</p>
                      <p className="text-xs text-text3">{p.resolvedTo ? `Resolve para ${p.resolvedTo}` : "Ainda não resolve na internet"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={s.tone}>{s.label}</Badge>
                    <Button variant="ghost" size="sm" aria-label={`Remover ${p.fqdn}`}
                      onClick={() => unpoint.mutate({ zone: p.zone, label: p.label })} disabled={unpoint.isPending}>
                      <Trash2 size={15} aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-text2">Nenhum domínio aponta para este ambiente ainda.</p>
        </Card>
      )}

      {/* Apontar mais um domínio */}
      {zonesQuery.isPending ? null : zones.length === 0 ? (
        <Card className="text-center">
          <Globe size={28} aria-hidden="true" className="mx-auto text-text3" />
          <p className="mt-2 font-medium text-text">Você ainda não tem um domínio</p>
          <p className="mt-1 text-sm text-text2">Adicione um domínio para poder apontá-lo a este ambiente.</p>
          <div className="mt-4"><Link href="/dominios"><Button><Plus size={16} aria-hidden="true" /> Adicionar domínio</Button></Link></div>
        </Card>
      ) : (
        <Card>
          <div className="flex items-center gap-2">
            <Rocket size={18} aria-hidden="true" className="text-brand-strong" />
            <h3 className="font-semibold text-text">Apontar um domínio para este ambiente</h3>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 sm:items-end">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="d-zone">Domínio</Label>
              <select id="d-zone" value={zone} onChange={(e) => setZone(e.target.value)}
                className="h-11 rounded-lg border border-border bg-bg px-3 text-sm text-text outline-none focus:border-brand-strong">
                <option value="">Selecionar domínio…</option>
                {zones.map((z) => (<option key={z.name} value={z.name}>{z.name}</option>))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="d-label">Nome</Label>
              <Input id="d-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="@ (raiz) ou www, loja…" className="font-mono" autoComplete="off" spellCheck={false} />
            </div>
          </div>
          <p className="mt-2 text-xs text-text3">Vai apontar <span className="font-mono text-text2">{fqdn}</span> para este ambiente.</p>
          {isApex ? (
            <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-sm text-text2">
              <input type="checkbox" checked={includeWww} onChange={(e) => setIncludeWww(e.target.checked)} />
              Apontar também <span className="font-mono">www</span>
            </label>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={() => point.mutate()} disabled={!zone || point.isPending}>{point.isPending ? "Apontando…" : "Apontar para este ambiente"}</Button>
            {zone ? (
              <Link href={`/dominios/${encodeURIComponent(zone)}`} className="inline-flex items-center gap-1 text-sm font-medium text-link hover:underline">
                Gerenciar todos os registros <ArrowRight size={14} aria-hidden="true" />
              </Link>
            ) : null}
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 p-3 text-xs text-text2">
            <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-info" />
            <span>
              O apontamento cria o registro DNS. Se o domínio ainda não usa nossos servidores de nomes
              {infoQuery.data ? <> (<span className="font-mono">{infoQuery.data.nameservers.map((n) => n.host).join(", ")}</span>)</> : null}, troque-os no seu registrador para o site abrir.
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}

/** Card do endereço temporário <sub>.jamees.top — editável pelo cliente. */
function SubdomainCard({ id, sub }: { id: string; sub: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(sub);
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { setValue(sub); }, [sub]);

  const url = `https://${sub}.jamees.top`;
  const mutation = useMutation({
    mutationFn: (s: string) => api.updateSubdomain(id, s),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["environment", id] });
      toast.show("success", "Subdomínio atualizado.");
      setEditing(false);
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Falha ao salvar."),
  });

  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* */ }
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-text"><Globe size={15} className="text-brand-strong" /> Endereço temporário</h3>
        {!editing ? (
          <Button variant="ghost" size="sm" onClick={() => { setEditing(true); setError(null); }}><Pencil size={14} /> Personalizar</Button>
        ) : null}
      </div>

      {!editing ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a href={url} target="_blank" rel="noopener noreferrer" className="font-mono text-sm text-link hover:underline">{sub}.jamees.top</a>
          <button type="button" onClick={copy} aria-label="Copiar" className="rounded p-1 text-text3 hover:text-brand-strong">{copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}</button>
          <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Abrir" className="rounded p-1 text-text3 hover:text-brand-strong"><ExternalLink size={14} /></a>
        </div>
      ) : (
        <form className="mt-3 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); setError(null); mutation.mutate(value); }}>
          <div className="flex items-stretch gap-0">
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
              className="w-full min-w-0 rounded-l-[10px] border border-border bg-surface px-3 py-2 font-mono text-sm text-text outline-none focus:border-brand-strong focus:ring-2 focus:ring-brand/20"
              placeholder="meu-site"
            />
            <span className="inline-flex items-center rounded-r-[10px] border border-l-0 border-border bg-bg px-3 font-mono text-sm text-text3">.jamees.top</span>
          </div>
          {error ? <p role="alert" className="flex items-center gap-1.5 text-xs font-medium text-danger"><AlertTriangle size={13} /> {error}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={mutation.isPending}>{mutation.isPending ? "Salvando…" : "Salvar"}</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setEditing(false); setValue(sub); setError(null); }}>Cancelar</Button>
          </div>
        </form>
      )}
      <p className="mt-2 text-xs text-text3">Endereço automático do ambiente. Um domínio próprio (abaixo) tem prioridade quando configurado.</p>
    </Card>
  );
}
