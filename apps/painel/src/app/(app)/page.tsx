"use client";

/*
 * ─────────────────────────────────────────────────────────────────────────
 *  Jamees — Ambientes (lista em TABELA, conforme design). Roda dentro de
 *  (app)/layout.tsx, que já provê <AuthGuard> + <AppShell>.
 *
 *  Login dev: client@veloz.dev / veloz123. API em NEXT_PUBLIC_API_URL.
 * ─────────────────────────────────────────────────────────────────────────
 */

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Plus,
  Search,
  Loader2,
  AlertTriangle,
  Server,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
} from "lucide-react";
import { RUNTIME_LABEL, runtimeHasVersions, type Environment, type EnvState } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { EnvStateBadge } from "@/components/EnvStateBadge";
import { CreateEnvironmentDialog } from "@/components/CreateEnvironmentDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EnvTechIcon } from "@/components/TechIcon";

const SERVICE_LABELS: Record<string, string> = {
  mariadb: "MariaDB",
  redis: "Redis",
  mysql: "MySQL",
  postgres: "PostgreSQL",
  rabbitmq: "RabbitMQ",
  n8n: "n8n",
  wordpress: "WordPress",
};
function runtimeLabel(env: Environment): string {
  const ver = env.runtimeVersionFull ?? env.runtime.version;
  if (env.category === "service") {
    const t = (env.type ?? "").toLowerCase();
    const label = SERVICE_LABELS[t] ?? env.type ?? "Serviço";
    return ver ? `${label} ${ver}` : label;
  }
  const base = RUNTIME_LABEL[env.runtime.kind];
  return runtimeHasVersions(env.runtime.kind) ? `${base} ${ver}` : base;
}

type SortKey = "name" | "state" | "region" | "ip";
type SortDir = "asc" | "desc";

const STATE_ORDER: Record<EnvState, number> = {
  running: 0,
  provisioning: 1,
  paused: 2,
  error: 3,
  deleting: 4,
};

export default function DashboardPage() {
  const [createOpen, setCreateOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [sortKey, setSortKey] = React.useState<SortKey>("name");
  const [sortDir, setSortDir] = React.useState<SortDir>("asc");

  const query = useQuery({
    queryKey: ["environments"],
    queryFn: api.listEnvironments,
    // Enquanto houver ambiente provisionando/removendo, atualiza sozinho a cada 3s.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((e) => e.state === "provisioning" || e.state === "deleting") ? 3000 : false,
  });

  const envs = query.data ?? [];
  const provisioning = envs.filter((e) => e.state === "provisioning").length;

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = needle
      ? envs.filter(
          (e) =>
            e.name.toLowerCase().includes(needle) ||
            (e.region ?? "").toLowerCase().includes(needle) ||
            (e.internalIp ?? "").toLowerCase().includes(needle) ||
            runtimeLabel(e).toLowerCase().includes(needle),
        )
      : [...envs];
    const dir = sortDir === "asc" ? 1 : -1;
    base.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "state") cmp = STATE_ORDER[a.state] - STATE_ORDER[b.state];
      else if (sortKey === "region") cmp = (a.region ?? "").localeCompare(b.region ?? "");
      else if (sortKey === "ip") cmp = (a.internalIp ?? "").localeCompare(b.internalIp ?? "");
      return cmp * dir;
    });
    return base;
  }, [envs, q, sortKey, sortDir]);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight text-text">Ambientes</h1>
          <p className="mt-1 text-sm text-text2">
            Cada ambiente é um contêiner isolado. Crie quantos precisar, pague por hora.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={18} aria-hidden="true" />
          Criar ambiente
        </Button>
      </header>

      {/* Busca + contador */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex h-11 w-full max-w-[360px] items-center gap-2.5 rounded-[10px] border border-border bg-surface px-3.5 text-text2">
          <Search size={16} aria-hidden="true" className="shrink-0 opacity-75" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar ambiente…"
            aria-label="Buscar ambiente"
            className="w-full bg-transparent text-sm text-text outline-none placeholder:text-text3"
          />
        </label>
        {envs.length > 0 ? (
          <p className="text-sm text-text2">
            {envs.length} {envs.length === 1 ? "ambiente" : "ambientes"}
            {provisioning > 0 ? ` · ${provisioning} provisionando` : ""}
          </p>
        ) : null}
      </div>

      {query.isPending ? (
        <div className="overflow-hidden rounded-[14px] border border-border bg-surface">
          <div className="h-12 border-b border-border bg-surface" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[64px] animate-pulse border-b border-border/60 bg-surface" />
          ))}
        </div>
      ) : query.isError ? (
        <Card className="flex items-start gap-3">
          <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          <div>
            <p role="alert" className="font-medium text-text">
              Não foi possível carregar os ambientes.
            </p>
            <button type="button" onClick={() => query.refetch()} className="mt-1 text-sm text-link hover:underline">
              Tentar de novo
            </button>
          </div>
        </Card>
      ) : envs.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-14 text-center">
          <span aria-hidden="true" className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand-strong">
            <Server size={28} strokeWidth={1.75} />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-text">Você ainda não tem ambientes</h2>
            <p className="mt-1 text-sm text-text2">Crie o primeiro para colocar seu site ou aplicação no ar.</p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={18} aria-hidden="true" />
            Criar ambiente
          </Button>
        </Card>
      ) : filtered.length === 0 ? (
        <div className="rounded-[14px] border border-border bg-surface px-6 py-12 text-center text-sm text-text2">
          Nenhum ambiente encontrado para <strong className="text-text">“{q}”</strong>.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[14px] border border-border bg-surface">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border">
                <Th label="Ambiente" col="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <Th label="Estado" col="state" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <Th label="Região" col="region" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <Th label="IP interno" col="ip" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <th scope="col" className="px-[22px] py-3 text-right">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {filtered.map((env) => (
                <EnvRow key={env.id} env={env} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateEnvironmentDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}

function Th({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  const active = sortKey === col;
  const Icon = !active ? ChevronsUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"} className="px-[22px] py-3">
      <button
        type="button"
        onClick={() => onSort(col)}
        className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-text2 transition-colors hover:text-text"
      >
        {label}
        <Icon size={13} aria-hidden="true" className={active ? "text-brand-strong" : "opacity-45"} />
      </button>
    </th>
  );
}

function EnvRow({ env }: { env: Environment }) {
  const dimmed = env.state === "paused" || env.state === "error";

  return (
    <tr className="group transition-colors hover:bg-bg">
      <td className="px-[22px] py-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* Colmeia (hexágono) com o logo da tecnologia dentro */}
          <span aria-hidden="true" className={`shrink-0 ${dimmed ? "opacity-55" : ""}`}>
            <EnvTechIcon env={env} size={30} />
          </span>
          <div className="min-w-0">
            <Link
              href={`/env/${env.id}`}
              className="block truncate text-[13.5px] font-medium text-text hover:text-brand-strong"
            >
              {env.name}
            </Link>
            <div className="truncate text-xs text-text3">{runtimeLabel(env)}</div>
          </div>
        </div>
      </td>
      <td className="px-[22px] py-3">
        {env.state === "provisioning" ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-text2">
            <Loader2 size={14} className="animate-spin text-brand-strong" aria-hidden="true" />
            Provisionando
          </span>
        ) : (
          <EnvStateBadge state={env.state} />
        )}
      </td>
      <td className="px-[22px] py-3 text-[13.5px] text-text">{env.region ?? "—"}</td>
      <td className="px-[22px] py-3 font-mono text-[13.5px] text-text">{env.internalIp ?? "—"}</td>
      <td className="px-[22px] py-3 text-right">
        <Link
          href={`/env/${env.id}`}
          className="inline-flex items-center rounded-[4px] border border-border px-3 py-1.5 text-[13px] font-normal text-brand-strong transition-colors hover:border-brand-strong hover:bg-brand-soft/50"
        >
          Gerenciar
        </Link>
      </td>
    </tr>
  );
}
