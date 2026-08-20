"use client";

/*
 * ─────────────────────────────────────────────────────────────────────────
 *  VelozPanel — Painel (Next.js 15 App Router)
 *
 *  COMO RODAR (a partir da raiz do monorepo velozPanel):
 *    1. pnpm install                     # instalação central (NÃO rodar aqui)
 *    2. pnpm dev:db && pnpm db:push      # sobe Postgres + schema/seed
 *    3. pnpm dev:agent                   # agente Docker  (porta 4100)
 *    4. pnpm dev:api                     # API Fastify    (porta 4000)
 *    5. pnpm dev:painel                  # este painel    (porta 3000)
 *    6. abrir http://localhost:3000  →  login client@veloz.dev / veloz123
 *
 *  SUPOSIÇÕES:
 *    - A API responde em http://localhost:4000/api/v1 com CORS liberado para
 *      http://localhost:3000 e credentials:true (cookie de sessão vp_session).
 *    - Os endpoints seguem NUCLEO-SPEC.md exatamente (login/me/environments/…).
 *    - Tipos e catálogos (PLANS, RUNTIME_VERSIONS, Environment…) vêm de
 *      @velozplanel/contracts (workspace).
 *    - 401 em qualquer query → redireciona para /login (QueryCache em providers).
 * ─────────────────────────────────────────────────────────────────────────
 */

import * as React from "react";
import Link from "next/link";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Environment } from "@velozplanel/contracts";
import { PLANS } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { AppHeader } from "@/components/AppHeader";
import { AuthGuard } from "@/components/AuthGuard";
import { EnvStateBadge } from "@/components/EnvStateBadge";
import { CreateEnvironmentDialog } from "@/components/CreateEnvironmentDialog";
import { Button } from "@/components/ui/button";
import { Card, CardFooter } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";

export default function DashboardPage() {
  const [createOpen, setCreateOpen] = React.useState(false);

  const query = useQuery({
    queryKey: ["environments"],
    queryFn: api.listEnvironments,
  });

  return (
    <AuthGuard>
    <div className="min-h-screen bg-bg">
      <AppHeader />
      <main id="conteudo" className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-text">Ambientes</h1>
            <p className="text-sm text-text2">
              Seus ambientes de hospedagem, com estado e consumo em tempo real.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>+ Criar ambiente</Button>
        </div>

        {query.isPending ? (
          <p className="text-text2">Carregando ambientes…</p>
        ) : query.isError ? (
          <p role="alert" className="text-danger">
            ⚠ Não foi possível carregar os ambientes.
          </p>
        ) : query.data.length === 0 ? (
          <Card className="text-center">
            <p className="text-text2">
              Você ainda não tem ambientes. Crie o primeiro para começar.
            </p>
          </Card>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {query.data.map((env) => (
              <li key={env.id}>
                <EnvCard env={env} />
              </li>
            ))}
          </ul>
        )}
      </main>

      <CreateEnvironmentDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
    </AuthGuard>
  );
}

function EnvCard({ env }: { env: Environment }) {
  const qc = useQueryClient();
  const plan = PLANS[env.plan];

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["environments"] });

  const pause = useMutation({
    mutationFn: () => api.pauseEnvironment(env.id),
    onSuccess: invalidate,
  });
  const start = useMutation({
    mutationFn: () => api.startEnvironment(env.id),
    onSuccess: invalidate,
  });

  const busy = pause.isPending || start.isPending;

  return (
    <Card className="h-full">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold text-text">
          <Link
            href={`/env/${env.id}`}
            className="text-link underline-offset-2 hover:underline"
          >
            {env.name}
          </Link>
        </h2>
        <EnvStateBadge state={env.state} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-text3">Runtime</dt>
        <dd className="text-right text-text2">
          {env.runtime.kind === "php" ? "PHP" : "Node.js"} {env.runtime.version}
        </dd>
        <dt className="text-text3">Plano</dt>
        <dd className="text-right text-text2">{plan.label}</dd>
        <dt className="text-text3">Criado</dt>
        <dd className="text-right text-text2">{formatDateTime(env.createdAt)}</dd>
      </dl>

      <CardFooter>
        {env.state === "running" ? (
          <Button
            variant="warning"
            size="sm"
            onClick={() => pause.mutate()}
            disabled={busy}
          >
            ⏸ Pausar
          </Button>
        ) : env.state === "paused" ? (
          <Button
            variant="success"
            size="sm"
            onClick={() => start.mutate()}
            disabled={busy}
          >
            ▶ Iniciar
          </Button>
        ) : null}

        {env.state === "running" && env.httpPort ? (
          <a
            href={`http://localhost:${env.httpPort}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm text-link hover:bg-bg"
          >
            Abrir site ↗
          </a>
        ) : null}

        <Link
          href={`/env/${env.id}`}
          className="ml-auto inline-flex h-9 items-center rounded-md px-3 text-sm text-text2 hover:bg-bg"
        >
          Detalhes →
        </Link>
      </CardFooter>
    </Card>
  );
}
