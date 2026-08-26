"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AppWindow,
  ExternalLink,
  Copy,
  Check,
  Eye,
  EyeOff,
  Info,
  AlertTriangle,
  Loader2,
  ShieldAlert,
  Database,
} from "lucide-react";
import type { AdminPanelStatus } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

/** Linha copiável (URL/usuário/senha), com opção de mascarar e revelar. */
function CopyRow({
  label,
  value,
  href,
  secret,
}: {
  label: string;
  value: string;
  href?: string;
  secret?: boolean;
}) {
  const [copied, setCopied] = React.useState(false);
  const [revealed, setRevealed] = React.useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard indisponível */
    }
  }
  const shown = secret && !revealed ? "•".repeat(Math.min(value.length, 16)) : value;
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="shrink-0 text-[13.5px] text-text2">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-right font-mono text-[13.5px] font-medium text-text">
          {shown}
        </span>
        {secret ? (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? `Ocultar ${label}` : `Mostrar ${label}`}
            className="shrink-0 rounded p-1 text-text3 hover:text-brand-strong"
          >
            {revealed ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
          </button>
        ) : null}
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Abrir ${label}`}
            className="shrink-0 rounded p-1 text-text3 hover:text-brand-strong"
          >
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        ) : null}
        <button
          type="button"
          onClick={copy}
          aria-label={`Copiar ${label}`}
          className="shrink-0 rounded p-1 text-text3 hover:text-brand-strong"
        >
          {copied ? (
            <Check size={14} aria-hidden="true" className="text-success" />
          ) : (
            <Copy size={14} aria-hidden="true" />
          )}
        </button>
      </dd>
    </div>
  );
}

export default function EnvAdminPanelPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const qc = useQueryClient();
  const toast = useToast();

  const panelQuery = useQuery({
    queryKey: ["admin-panel", id],
    queryFn: () => api.getAdminPanel(id),
  });
  const panel = panelQuery.data;

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.setAdminPanel(id, enabled),
    onSuccess: (updated: AdminPanelStatus) => {
      qc.setQueryData(["admin-panel", id], updated);
      qc.invalidateQueries({ queryKey: ["environment", id] });
      toast.show(
        "success",
        updated.enabled ? "Painel admin exposto." : "Painel admin desligado.",
      );
    },
    onError: (err) =>
      toast.show("error", err instanceof Error ? err.message : "Não foi possível salvar."),
  });

  if (panelQuery.isPending) {
    return (
      <div className="flex min-h-40 items-center justify-center" role="status" aria-live="polite">
        <Loader2 size={28} aria-hidden="true" className="animate-spin text-brand-strong" />
        <span className="sr-only">Carregando…</span>
      </div>
    );
  }

  if (panelQuery.isError || !panel) {
    return (
      <Card className="flex items-start gap-3">
        <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
        <p role="alert" className="font-medium text-text">
          Não foi possível carregar o painel admin deste ambiente.
        </p>
      </Card>
    );
  }

  const toolName = panel.tool ?? "painel";
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold text-text">
          <AppWindow size={20} aria-hidden="true" className="text-brand-strong" />
          Painel admin
        </h1>
        <p className="mt-1 text-sm text-text2">
          Exponha o <strong>{toolName}</strong> numa URL própria. Ligue só quando
          precisar; desligue para fechar o acesso.
        </p>
      </header>

      {/* Toggle expor painel */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2 font-semibold text-text">
              Expor painel admin
              {panel.enabled ? (
                <Badge tone="success">
                  <Check size={14} aria-hidden="true" />
                  Exposto
                </Badge>
              ) : (
                <Badge tone="neutral">Desligado</Badge>
              )}
            </span>
            <span className="max-w-md text-sm text-text2">
              Publica a interface em <strong>https://&lt;aleatório&gt;.jamees.top</strong> com
              HTTPS automático. O subdomínio é sorteado uma vez e mantido.
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={panel.enabled}
            aria-label="Expor painel admin"
            disabled={toggle.isPending}
            onClick={() => toggle.mutate(!panel.enabled)}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full",
              "transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
              panel.enabled ? "bg-brand" : "bg-border",
            )}
          >
            <span
              className={cn(
                "inline-block h-5 w-5 transform rounded-full bg-surface shadow transition-transform duration-150",
                panel.enabled ? "translate-x-5" : "translate-x-0.5",
              )}
              aria-hidden="true"
            />
          </button>
        </div>
        {toggle.isPending ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-text3">
            <Loader2 size={14} aria-hidden="true" className="animate-spin" />
            Aplicando… (pode levar alguns segundos para subir a ferramenta e emitir o HTTPS)
          </p>
        ) : null}
      </Card>

      {/* Banco inicial */}
      {panel.database ? (
        <p className="flex items-start gap-2 rounded-lg border border-border-subtle bg-bg p-3 text-sm text-text2">
          <Database size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-brand-strong" />
          <span>
            Banco inicial: <strong className="font-mono">{panel.database}</strong>. É o banco
            criado junto com o ambiente — você pode criar outros bancos dentro do {toolName}.
          </span>
        </p>
      ) : null}

      {/* Acesso (quando ligado) */}
      {panel.enabled && panel.url ? (
        <Card>
          <div className="flex flex-col gap-1">
            <h2 className="vp-accent-bar text-base font-semibold text-text">Acesso</h2>
            <dl className="mt-1 divide-y divide-border-subtle">
              <CopyRow label="URL" value={panel.url} href={panel.url} />
              {panel.user ? <CopyRow label="Usuário" value={panel.user} /> : null}
              {panel.password ? <CopyRow label="Senha" value={panel.password} secret /> : null}
            </dl>
          </div>
        </Card>
      ) : null}

      {/* Mensagem da API */}
      {panel.message ? (
        <p className="flex items-start gap-2 rounded-lg border border-border-subtle bg-bg p-3 text-sm text-text2">
          <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-info" />
          <span>{panel.message}</span>
        </p>
      ) : null}

      {/* Nota de segurança */}
      <p className="flex items-start gap-2 rounded-lg border border-border-subtle bg-bg p-3 text-sm text-text2">
        <ShieldAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
        <span>
          Enquanto exposto, qualquer pessoa com a URL vê a tela de login do {toolName} — o
          acesso é protegido pelo usuário e senha acima. Desligue quando não estiver usando.
          No primeiro acesso, o certificado HTTPS pode levar alguns segundos para emitir.
        </span>
      </p>
    </div>
  );
}
