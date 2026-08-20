"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Shield,
  Globe,
  Info,
  AlertTriangle,
  BadgeCheck,
  Loader2,
} from "lucide-react";
import type { SslStatus, SslCertStatus } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";

type Tone = "success" | "warning" | "info" | "danger" | "neutral";

const CERT_META: Record<
  SslCertStatus,
  { tone: Tone; label: string; Icon: typeof ShieldCheck }
> = {
  active: { tone: "success", label: "Ativo", Icon: ShieldCheck },
  pending: { tone: "warning", label: "Pendente", Icon: ShieldQuestion },
  none: { tone: "neutral", label: "Sem certificado", Icon: Shield },
  error: { tone: "danger", label: "Erro", Icon: ShieldAlert },
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function EnvSslPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const qc = useQueryClient();
  const toast = useToast();

  const sslQuery = useQuery({
    queryKey: ["ssl", id],
    queryFn: () => api.getSsl(id),
  });
  const ssl = sslQuery.data;

  const forceHttps = useMutation({
    mutationFn: (value: boolean) => api.setForceHttps(id, value),
    onSuccess: (updated) => {
      qc.setQueryData(["ssl", id], updated);
      toast.show(
        "success",
        updated.forceHttps
          ? "Forçar HTTPS ativado."
          : "Forçar HTTPS desativado.",
      );
    },
    onError: (err) =>
      toast.show(
        "error",
        err instanceof Error ? err.message : "Não foi possível salvar.",
      ),
  });

  const issue = useMutation({
    mutationFn: () => api.issueSsl(id),
    onSuccess: (updated) => {
      qc.setQueryData(["ssl", id], updated);
      toast.show("success", "Certificado de desenvolvimento emitido.");
    },
    onError: (err) =>
      toast.show(
        "error",
        err instanceof Error
          ? err.message
          : "Não foi possível emitir o certificado.",
      ),
  });

  if (sslQuery.isPending) {
    return (
      <div
        className="flex min-h-40 items-center justify-center"
        role="status"
        aria-live="polite"
      >
        <Loader2
          size={28}
          aria-hidden="true"
          className="animate-spin text-brand-strong"
        />
        <span className="sr-only">Carregando…</span>
      </div>
    );
  }

  if (sslQuery.isError || !ssl) {
    return (
      <Card className="flex items-start gap-3">
        <AlertTriangle
          size={20}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-danger"
        />
        <p role="alert" className="font-medium text-text">
          Não foi possível carregar o SSL deste ambiente.
        </p>
      </Card>
    );
  }

  const hasDomain = Boolean(ssl.domain);
  const meta = CERT_META[ssl.certStatus];
  const StatusIcon = meta.Icon;
  const certActive = ssl.certStatus === "active";

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold text-text">
          <ShieldCheck
            size={20}
            aria-hidden="true"
            className="text-brand-strong"
          />
          SSL / HTTPS
        </h1>
        <p className="mt-1 text-sm text-text2">
          Configure o certificado e o redirecionamento HTTPS deste ambiente.
        </p>
      </header>

      {/* Domínio */}
      <Card>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-text3">Domínio</span>
          {hasDomain ? (
            <span className="flex items-center gap-2 font-medium text-text">
              <Globe size={16} aria-hidden="true" className="text-brand-strong" />
              {ssl.domain}
            </span>
          ) : (
            <div className="flex flex-col items-start gap-2">
              <span className="text-text2">Nenhum domínio configurado.</span>
              <Link
                href={`/env/${id}/dominio`}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-link hover:underline"
              >
                <Globe size={14} aria-hidden="true" />
                Configurar em Domínio &amp; DNS
              </Link>
            </div>
          )}
        </div>
      </Card>

      {/* Status do certificado */}
      <Card>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="vp-accent-bar text-base font-semibold text-text">
              Certificado
            </h2>
            <Badge tone={meta.tone}>
              <StatusIcon size={14} aria-hidden="true" />
              {meta.label}
            </Badge>
          </div>

          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-text3">Emissor</dt>
              <dd className="font-medium text-text">{ssl.issuer ?? "—"}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-text3">Válido até</dt>
              <dd className="font-medium text-text">{formatDate(ssl.notAfter)}</dd>
            </div>
          </dl>

          <div>
            <Button
              onClick={() => issue.mutate()}
              disabled={!hasDomain || issue.isPending}
              title={
                !hasDomain
                  ? "Configure um domínio antes de emitir o certificado"
                  : undefined
              }
            >
              <BadgeCheck size={16} aria-hidden="true" />
              {issue.isPending
                ? "Emitindo…"
                : certActive
                  ? "Reemitir certificado"
                  : "Emitir certificado"}
            </Button>
          </div>
        </div>
      </Card>

      {/* Forçar HTTPS */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-text">Forçar HTTPS</span>
            <span className="max-w-md text-sm text-text2">
              Redireciona todo o tráfego HTTP para HTTPS. Só tem efeito quando
              há um certificado ativo.
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={ssl.forceHttps}
            aria-label="Forçar HTTPS"
            disabled={forceHttps.isPending}
            onClick={() => forceHttps.mutate(!ssl.forceHttps)}
            className={[
              "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full",
              "transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
              ssl.forceHttps ? "bg-brand" : "bg-border",
            ].join(" ")}
          >
            <span
              className={[
                "inline-block h-5 w-5 transform rounded-full bg-surface shadow transition-transform duration-150",
                ssl.forceHttps ? "translate-x-5" : "translate-x-0.5",
              ].join(" ")}
              aria-hidden="true"
            />
          </button>
        </div>
      </Card>

      {/* Mensagem honesta vinda da API */}
      {ssl.message ? (
        <p className="flex items-start gap-2 rounded-lg border border-border-subtle bg-bg p-3 text-sm text-text2">
          <Info
            size={16}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-info"
          />
          <span>{ssl.message}</span>
        </p>
      ) : null}

      {/* Nota honesta sobre a limitação do núcleo */}
      <p className="flex items-start gap-2 rounded-lg border border-border-subtle bg-bg p-3 text-sm text-text2">
        <AlertTriangle
          size={16}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-warning"
        />
        <span>
          A emissão automática via Let&apos;s Encrypt entra quando o domínio
          apontar para o servidor e a borda estiver ativa (próxima fase). Aqui,
          no núcleo local, o certificado é de <strong>desenvolvimento</strong> —
          não há HTTPS público válido ainda.
        </span>
      </p>
    </div>
  );
}
