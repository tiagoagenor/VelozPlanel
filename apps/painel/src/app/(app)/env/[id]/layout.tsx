"use client";

/*
 * ─────────────────────────────────────────────────────────────────────────
 *  Contexto de gerência de um ambiente (navegação de 2 níveis, estilo hPanel).
 *
 *  Este layout aninhado envolve TODAS as seções de /env/[id]/* e renderiza:
 *   - Breadcrumb:  Ambientes › <nome> › <seção>
 *   - Toolbar de estado (Pausar/Iniciar · Abrir site · Excluir) — compartilhada
 *     entre as seções, com o modal de confirmação de exclusão.
 *   - Submenu contextual à esquerda (cabeçalho com nome+estado e link
 *     "‹ Ambientes"; itens com ícone Lucide; ativo em roxo + aria-current):
 *       Visão geral (/env/[id]) · Domínio & DNS (/dominio) ·
 *       Configurações (/configuracoes) · e "Em breve": Arquivos, Banco de
 *       dados, SSL, Backups (telas honestas, não 404).
 *   - {children} = a seção atual.
 *  SEM <select>/dropdown de seleção — o dono não quer selects (ADENDO 11).
 * ─────────────────────────────────────────────────────────────────────────
 */

import * as React from "react";
import Link from "next/link";
import { usePathname, useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  Globe,
  Settings,
  FolderOpen,
  Database,
  ShieldCheck,
  Archive,
  Play,
  Pause,
  ExternalLink,
  Trash2,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import * as api from "@/lib/api";
import { cn } from "@/lib/cn";
import { EnvStateBadge } from "@/components/EnvStateBadge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

interface Section {
  seg: string; // segmento após /env/[id] ("" = Visão geral)
  label: string;
  icon: LucideIcon;
  soon?: boolean;
}

const SECTIONS: Section[] = [
  { seg: "", label: "Visão geral", icon: LayoutDashboard },
  { seg: "dominio", label: "Domínio & DNS", icon: Globe },
  { seg: "configuracoes", label: "Configurações", icon: Settings },
  { seg: "arquivos", label: "Arquivos", icon: FolderOpen, soon: true },
  { seg: "banco", label: "Banco de dados", icon: Database, soon: true },
  { seg: "ssl", label: "SSL", icon: ShieldCheck, soon: true },
  { seg: "backups", label: "Backups", icon: Archive, soon: true },
];

export default function EnvContextLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();

  const base = `/env/${id}`;
  const currentSeg = pathname.startsWith(base)
    ? pathname.slice(base.length).replace(/^\//, "")
    : "";
  const activeSection =
    SECTIONS.find((s) => s.seg === currentSeg) ?? SECTIONS[0]!;

  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState("");

  const envQuery = useQuery({
    queryKey: ["environment", id],
    queryFn: () => api.getEnvironment(id),
  });
  const env = envQuery.data;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["environment", id] });
    qc.invalidateQueries({ queryKey: ["environments"] });
  };

  const pause = useMutation({
    mutationFn: () => api.pauseEnvironment(id),
    onSuccess: () => {
      refresh();
      toast.show("success", "Ambiente pausado — cobrança suspensa.");
    },
    onError: () => toast.show("error", "Não foi possível pausar o ambiente."),
  });
  const start = useMutation({
    mutationFn: () => api.startEnvironment(id),
    onSuccess: () => {
      refresh();
      toast.show("success", "Ambiente iniciado.");
    },
    onError: () => toast.show("error", "Não foi possível iniciar o ambiente."),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteEnvironment(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["environments"] });
      toast.show("success", "Ambiente excluído.");
      router.replace("/");
    },
    onError: () => toast.show("error", "Falha ao excluir o ambiente."),
  });

  const busy = pause.isPending || start.isPending || remove.isPending;

  return (
    <>
      {/* Breadcrumb + toolbar de estado (compartilhados entre as seções) */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <nav
          aria-label="Trilha de navegação"
          className="flex min-w-0 items-center gap-1 text-sm text-text3"
        >
          <Link href="/" className="text-link hover:underline">
            Ambientes
          </Link>
          <ChevronRight size={15} aria-hidden="true" className="shrink-0" />
          <Link
            href={base}
            className="max-w-[12rem] truncate text-link hover:underline"
          >
            {env?.name ?? "…"}
          </Link>
          <ChevronRight size={15} aria-hidden="true" className="shrink-0" />
          <span aria-current="page" className="truncate text-text2">
            {activeSection.label}
          </span>
        </nav>

        {env ? (
          <div className="flex flex-wrap items-center gap-2">
            {env.state === "running" ? (
              <Button variant="outline" size="sm" onClick={() => pause.mutate()} disabled={busy}>
                <Pause size={16} aria-hidden="true" />
                Pausar
              </Button>
            ) : env.state === "paused" ? (
              <Button size="sm" onClick={() => start.mutate()} disabled={busy}>
                <Play size={16} aria-hidden="true" />
                Iniciar
              </Button>
            ) : null}

            {env.state === "running" && env.httpPort ? (
              <a
                href={`http://localhost:${env.httpPort}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-link hover:bg-bg"
              >
                Abrir site
                <ExternalLink size={15} aria-hidden="true" />
              </a>
            ) : null}

            <Button
              variant="danger"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
            >
              <Trash2 size={16} aria-hidden="true" />
              Excluir
            </Button>
          </div>
        ) : null}
      </div>

      {/* Submenu contextual + conteúdo da seção */}
      <div className="flex flex-col gap-6 lg:flex-row">
        <aside aria-label="Menu do ambiente" className="lg:w-60 lg:shrink-0">
          <div className="mb-3 rounded-xl border border-border-subtle bg-surface p-3">
            <Link
              href="/"
              className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-link hover:underline"
            >
              <ChevronLeft size={14} aria-hidden="true" />
              Ambientes
            </Link>
            <p className="truncate text-sm font-semibold text-text">
              {env?.name ?? "…"}
            </p>
            <div className="mt-1.5">
              {env ? <EnvStateBadge state={env.state} /> : null}
            </div>
          </div>

          <nav className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {SECTIONS.map((s) => {
              const href = s.seg ? `${base}/${s.seg}` : base;
              const active = s.seg === currentSeg;
              const Icon = s.icon;
              return (
                <Link
                  key={s.seg || "overview"}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-10 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors",
                    active
                      ? "bg-brand-soft text-brand-strong"
                      : "text-text2 hover:bg-bg hover:text-text",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute left-0 top-1/2 hidden h-5 w-[3px] -translate-y-1/2 rounded-full lg:block",
                      active ? "bg-brand" : "bg-transparent",
                    )}
                  />
                  <Icon
                    size={18}
                    aria-hidden="true"
                    className={cn("shrink-0", active ? "text-brand-strong" : "text-text3")}
                  />
                  <span>{s.label}</span>
                  {s.soon ? (
                    <span className="ml-auto hidden shrink-0 rounded-full bg-border-subtle px-2 py-0.5 text-[10px] font-semibold text-text3 lg:inline">
                      Em breve
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">{children}</div>
      </div>

      <Dialog
        open={confirmDelete}
        onClose={() => {
          setConfirmDelete(false);
          setConfirmText("");
        }}
        title="Excluir ambiente"
        description="Esta ação para e remove o container. Não é possível desfazer."
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-name">
              Digite <strong>{env?.name}</strong> para confirmar
            </Label>
            <Input
              id="confirm-name"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
            />
          </div>
          {remove.isError ? (
            <p role="alert" className="flex items-center gap-2 text-sm font-medium text-danger">
              <AlertTriangle size={16} aria-hidden="true" />
              Falha ao excluir. Tente novamente.
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setConfirmDelete(false);
                setConfirmText("");
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={() => remove.mutate()}
              disabled={confirmText !== env?.name || remove.isPending}
            >
              {remove.isPending ? "Excluindo…" : "Excluir definitivamente"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
