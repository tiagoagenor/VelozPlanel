"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Globe,
  ExternalLink,
  Save,
  Trash2,
  Info,
  AlertTriangle,
} from "lucide-react";
import { setDomainInput } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

// Placeholders de apontamento (a rede real de produção entra na próxima fase).
const SERVER_IP = "203.0.113.10";
const NAMESERVERS = ["ns1.velozplanel.com.br", "ns2.velozplanel.com.br"];

export default function EnvDomainPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const qc = useQueryClient();
  const toast = useToast();

  const envQuery = useQuery({
    queryKey: ["environment", id],
    queryFn: () => api.getEnvironment(id),
  });
  const env = envQuery.data;

  const [domain, setDomainField] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  // Sincroniza o campo com o domínio salvo quando o ambiente carrega.
  React.useEffect(() => {
    if (env) setDomainField(env.domain ?? "");
  }, [env?.domain]);

  const save = useMutation({
    mutationFn: (value: string | null) => api.setDomain(id, value),
    onSuccess: (updated) => {
      qc.setQueryData(["environment", id], updated);
      qc.invalidateQueries({ queryKey: ["environments"] });
      toast.show(
        "success",
        updated.domain
          ? `Domínio ${updated.domain} salvo.`
          : "Domínio removido.",
      );
    },
    onError: (err) =>
      toast.show(
        "error",
        err instanceof Error ? err.message : "Não foi possível salvar o domínio.",
      ),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = domain.trim().toLowerCase();
    const parsed = setDomainInput.safeParse({ domain: value });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? "Informe um domínio válido.",
      );
      return;
    }
    save.mutate(parsed.data.domain);
  }

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

  const currentUrl = env.httpPort ? `http://localhost:${env.httpPort}` : null;
  const hasDomain = Boolean(env.domain);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold text-text">
          <Globe size={20} aria-hidden="true" className="text-brand-strong" />
          Domínio & DNS
        </h1>
        <p className="mt-1 text-sm text-text2">
          Defina um domínio próprio para este ambiente e veja como apontá-lo.
        </p>
      </header>

      {/* Endereços atuais */}
      <Card>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-text3">Endereço de acesso</dt>
            <dd>
              {currentUrl ? (
                <a
                  href={currentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-medium text-link hover:underline"
                >
                  {currentUrl}
                  <ExternalLink size={14} aria-hidden="true" />
                </a>
              ) : (
                <span className="text-text2">Indisponível (ambiente parado)</span>
              )}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-text3">Domínio próprio</dt>
            <dd className="font-medium text-text">
              {env.domain ?? "Não configurado"}
            </dd>
          </div>
        </dl>
      </Card>

      {/* Formulário de domínio */}
      <Card>
        <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="domain">Domínio próprio</Label>
            <Input
              id="domain"
              value={domain}
              onChange={(e) => setDomainField(e.target.value)}
              placeholder="meusite.com.br"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby="domain-help"
              aria-invalid={error ? true : undefined}
            />
            <p id="domain-help" className="text-xs text-text3">
              Sem "http://" nem barras. Ex.: meusite.com.br
            </p>
          </div>

          {error ? (
            <p role="alert" className="flex items-center gap-2 text-sm font-medium text-danger">
              <AlertTriangle size={16} aria-hidden="true" />
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={save.isPending}>
              <Save size={16} aria-hidden="true" />
              {save.isPending ? "Salvando…" : hasDomain ? "Atualizar domínio" : "Salvar domínio"}
            </Button>
            {hasDomain ? (
              <Button
                variant="outline"
                onClick={() => save.mutate(null)}
                disabled={save.isPending}
              >
                <Trash2 size={16} aria-hidden="true" />
                Remover domínio
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      {/* Instruções de apontamento (só quando há domínio) */}
      {hasDomain ? (
        <Card>
          <h2 className="vp-accent-bar mb-1 text-base font-semibold text-text">
            Como apontar {env.domain}
          </h2>
          <p className="mb-4 text-sm text-text2">
            Escolha uma das opções no painel do seu registrador de domínios.
          </p>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-border-subtle bg-bg p-4">
              <p className="mb-2 text-sm font-semibold text-text">
                Opção 1 — Registro A
              </p>
              <p className="mb-3 text-sm text-text2">
                Crie um registro <strong>A</strong> apontando para o IP do
                servidor:
              </p>
              <dl className="flex flex-col gap-1.5 text-sm">
                <Row k="Tipo" v="A" />
                <Row k="Nome" v="@" />
                <Row k="Valor (IP)" v={SERVER_IP} mono />
                <Row k="TTL" v="3600" />
              </dl>
            </div>

            <div className="rounded-lg border border-border-subtle bg-bg p-4">
              <p className="mb-2 text-sm font-semibold text-text">
                Opção 2 — Nameservers
              </p>
              <p className="mb-3 text-sm text-text2">
                Ou configure os nameservers do domínio para:
              </p>
              <ul className="flex flex-col gap-1.5">
                {NAMESERVERS.map((ns) => (
                  <li key={ns} className="font-mono text-sm text-text">
                    {ns}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p className="mt-4 flex items-start gap-2 rounded-lg border border-border-subtle bg-bg p-3 text-sm text-text2">
            <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-info" />
            <span>
              A ativação automática de HTTPS e do vhost entra na próxima fase.
              Por ora, o domínio fica registrado no ambiente e as instruções
              acima permitem preparar o DNS.
            </span>
          </p>
        </Card>
      ) : null}
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-text3">{k}</dt>
      <dd className={mono ? "font-mono text-text" : "font-medium text-text"}>{v}</dd>
    </div>
  );
}
