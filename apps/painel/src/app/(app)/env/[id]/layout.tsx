"use client";

/*
 * ─────────────────────────────────────────────────────────────────────────
 *  Contexto de gerência de um ambiente (design Jamees, tela interna).
 *
 *  Layout de 2 colunas (abaixo do topbar+rail globais):
 *   - Submenu de contexto (esquerda, colado no rail, alinhado ao TOPO):
 *       rótulo "AMBIENTE" + seletor do ambiente (troca rápida) + itens de seção
 *       (ativo em caixa lavanda accent-200; "Em breve" com selo).
 *   - Conteúdo (direita): breadcrumb + "← Ambientes", cabeçalho com nome +
 *       estado + ações (pausar/iniciar · abrir · excluir, botões-ícone), e a
 *       seção atual ({children}).
 * ─────────────────────────────────────────────────────────────────────────
 */

import * as React from "react";
import Link from "next/link";
import { usePathname, useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronsUpDown,
  Box as BoxIcon,
  LayoutDashboard,
  Globe,
  Settings,
  FolderOpen,
  Database,
  ShieldCheck,
  TerminalSquare,
  FolderSync,
  Rocket,
  Braces,
  ScrollText,
  Archive,
  Table2,
  Play,
  Pause,
  RotateCw,
  ExternalLink,
  Trash2,
  AlertTriangle,
  Check,
  type LucideIcon,
} from "lucide-react";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { NavIcon, LinkPending } from "@/components/nav-pending";
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
  dbOnly?: boolean; // só aparece em ambientes-serviço de banco (Jamees Studio)
}

const STUDIO_ENGINES = new Set(["mysql", "mariadb", "postgres", "mongodb"]);
function isDbServiceEnv(env: { category?: string | null; type?: string | null } | undefined): boolean {
  return !!env && env.category === "service" && !!env.type && STUDIO_ENGINES.has(env.type);
}

// Todas as seções são telas REAIS e funcionais — só "Backups" é placeholder
// (ComingSoon). NÃO marcar as demais como "Em breve" (o mock estático marcava,
// mas elas já funcionam no app: Domínio & DNS, Arquivos, Banco, SSL, SSH, SFTP,
// Deploy, Variáveis).
const SECTIONS: Section[] = [
  { seg: "", label: "Visão geral", icon: LayoutDashboard },
  { seg: "dominio", label: "Domínio & DNS", icon: Globe },
  { seg: "configuracoes", label: "Configurações", icon: Settings },
  { seg: "arquivos", label: "Arquivos", icon: FolderOpen },
  { seg: "banco", label: "Banco de dados", icon: Database },
  { seg: "ssl", label: "SSL", icon: ShieldCheck },
  { seg: "ssh", label: "SSH", icon: TerminalSquare },
  { seg: "sftp", label: "SFTP", icon: FolderSync },
  { seg: "deploy", label: "Deploy", icon: Rocket },
  { seg: "variaveis", label: "Variáveis", icon: Braces },
  { seg: "studio", label: "Data Studio", icon: Table2, dbOnly: true },
  { seg: "logs", label: "Logs", icon: ScrollText },
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

  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState("");

  const envQuery = useQuery({
    queryKey: ["environment", id],
    queryFn: () => api.getEnvironment(id),
    refetchInterval: (q) =>
      q.state.data && (q.state.data.state === "provisioning" || q.state.data.state === "deleting") ? 3000 : false,
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
    onError: (err) =>
      toast.show(
        "error",
        err instanceof ApiError && err.code === "insufficient_balance"
          ? err.message
          : err instanceof ApiError && err.message
            ? err.message
            : "Não foi possível iniciar o ambiente.",
      ),
  });
  const restart = useMutation({
    mutationFn: () => api.restartEnvironment(id),
    onSuccess: () => {
      refresh();
      toast.show("success", "Reiniciando o ambiente — as alterações de arquivo serão aplicadas.");
    },
    onError: () => toast.show("error", "Não foi possível reiniciar o ambiente."),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteEnvironment(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["environments"] });
      toast.show("success", "Removendo o ambiente…");
      router.replace("/");
    },
    onError: () => toast.show("error", "Falha ao iniciar a remoção do ambiente."),
  });

  const transitioning = env?.state === "provisioning" || env?.state === "deleting";
  const busy = pause.isPending || start.isPending || remove.isPending || transitioning;

  return (
    <>
      {/* Mobile: submenu empilhado acima do conteúdo. Desktop: submenu é `fixed`
          (fora do fluxo, colado no rail) → conteúdo ocupa a largura toda (o
          padding-esquerdo p/ reservar a faixa vem do AppShell). */}
      <div className="flex flex-col gap-6 lg:block lg:gap-0">
        {/* ── Submenu de contexto: 2ª coluna FIXA branca, colada ao rail ── */}
        <aside
          aria-label="Menu do ambiente"
          className={cn(
            "lg:fixed lg:top-16 lg:bottom-0 lg:left-20 lg:z-10 lg:w-[var(--vp-submenu-w)]",
            "lg:flex lg:flex-col lg:border-r lg:border-border lg:bg-surface",
          )}
        >
          {/* Cabeçalho (não rola) — mantém o popover do seletor sem corte */}
          <div className="lg:px-4 lg:pt-6 lg:pb-3">
            <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.09em] text-text3">
              Ambiente
            </p>
            <EnvSwitcher id={id} name={env?.name ?? "…"} />
          </div>

          {/* Só a lista de seções rola (11 itens) */}
          <nav
            className={cn(
              "mt-3 flex gap-1 overflow-x-auto pb-1",
              "lg:mt-0 lg:min-h-0 lg:flex-1 lg:flex-col lg:gap-0.5",
              "lg:overflow-x-visible lg:overflow-y-auto lg:px-3 lg:pb-4",
            )}
          >
              {SECTIONS.filter((s) => !s.dbOnly || isDbServiceEnv(env)).map((s) => {
                const active = s.seg === currentSeg;
                const brevePill = (
                  <span className="ml-auto shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.04em] text-text3">
                    Em breve
                  </span>
                );

                // "Em breve": item não-clicável (conforme o design). As telas
                // reais seguem no código — basta remover `soon` para reativar.
                if (s.soon) {
                  return (
                    <span
                      key={s.seg || "overview"}
                      aria-disabled="true"
                      title="Em breve"
                      className="flex h-[38px] shrink-0 cursor-default items-center gap-2.5 whitespace-nowrap rounded-[8px] px-[11px] text-[13.5px] font-medium text-text2"
                    >
                      <s.icon size={17} aria-hidden="true" />
                      <span>{s.label}</span>
                      {brevePill}
                    </span>
                  );
                }

                const href = s.seg ? `${base}/${s.seg}` : base;
                return (
                  <Link
                    key={s.seg || "overview"}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className="block shrink-0 rounded-[8px]"
                  >
                    <LinkPending>
                      {(pending) => {
                        const on = active || pending;
                        return (
                          <span
                            className={cn(
                              "flex h-[38px] items-center gap-2.5 whitespace-nowrap rounded-[8px] px-[11px] text-[13.5px] font-medium transition-colors",
                              on
                                ? "bg-brand-soft text-[#2f2354]"
                                : "text-text2 hover:bg-bg hover:text-text",
                            )}
                          >
                            <NavIcon icon={s.icon} size={17} active={on} />
                            <span>{s.label}</span>
                          </span>
                        );
                      }}
                    </LinkPending>
                  </Link>
                );
              })}
            </nav>
        </aside>

        {/* ── Conteúdo da seção ── */}
        <div className="min-w-0">
          {/* Breadcrumb + voltar */}
          <div className="mb-3">
            <nav aria-label="Trilha de navegação" className="flex min-w-0 items-center gap-1.5 text-[13px] text-text3">
              <Link href="/" className="hover:text-text2 hover:underline">Ambientes</Link>
              <span aria-hidden="true">/</span>
              <span className="truncate text-text2">{env?.name ?? "…"}</span>
            </nav>
            <Link href="/" className="mt-1.5 inline-flex items-center gap-1.5 text-[13px] font-medium text-text2 hover:text-text">
              <ChevronLeft size={15} aria-hidden="true" />
              Ambientes
            </Link>
          </div>

          {/* Cabeçalho: nome + estado + ações */}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <h1 className="truncate text-[26px] font-bold leading-tight text-text">{env?.name ?? "…"}</h1>
              {env ? <EnvStateBadge state={env.state} /> : null}
            </div>

            {env ? (
              <div className="flex items-center gap-2">
                {env.state === "running" ? (
                  <>
                    <IconButton label="Reiniciar" onClick={() => restart.mutate()} disabled={busy || restart.isPending}>
                      <RotateCw size={17} aria-hidden="true" className={restart.isPending ? "animate-spin" : undefined} />
                    </IconButton>
                    <IconButton label="Pausar" onClick={() => pause.mutate()} disabled={busy}>
                      <Pause size={17} aria-hidden="true" />
                    </IconButton>
                  </>
                ) : env.state === "paused" ? (
                  <IconButton label="Iniciar" onClick={() => start.mutate()} disabled={busy}>
                    <Play size={17} aria-hidden="true" />
                  </IconButton>
                ) : null}

                {env.state === "running" && env.accessUrl ? (
                  <IconButton label="Abrir site" href={env.accessUrl} external brand>
                    <ExternalLink size={17} aria-hidden="true" />
                  </IconButton>
                ) : null}

                <IconButton label="Excluir" danger onClick={() => setConfirmDelete(true)} disabled={busy}>
                  <Trash2 size={17} aria-hidden="true" />
                </IconButton>
              </div>
            ) : null}
          </div>

          {children}
        </div>
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

/** Botão-ícone quadrado (ações do cabeçalho). */
function IconButton({
  label,
  children,
  onClick,
  disabled,
  danger,
  brand,
  href,
  external,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  brand?: boolean; // estilo destacado (roxo preenchido), ex.: "Abrir site"
  href?: string; // renderiza como link
  external?: boolean; // abre em nova aba
}) {
  const cls = cn(
    "grid h-9 w-9 place-items-center rounded-[8px] border transition-colors disabled:opacity-50",
    brand
      ? "border-transparent bg-brand text-white hover:bg-brand-strong"
      : danger
        ? "border-border bg-surface text-text2 hover:border-danger hover:bg-danger/10 hover:text-danger"
        : "border-border bg-surface text-text2 hover:border-brand-strong hover:text-brand-strong",
  );
  return (
    <span className="group relative inline-flex">
      {href ? (
        <a
          href={href}
          target={external ? "_blank" : undefined}
          rel={external ? "noopener noreferrer" : undefined}
          aria-label={label}
          className={cls}
        >
          {children}
        </a>
      ) : (
        <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className={cls}>
          {children}
        </button>
      )}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-[#2f2354] px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-[0_6px_20px_rgba(0,0,0,0.22)] transition-opacity duration-100 group-hover:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}

/** Seletor do ambiente (troca rápida) — popover, sem <select> nativo. */
function EnvSwitcher({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const list = useQuery({ queryKey: ["environments"], queryFn: api.listEnvironments, staleTime: 30_000, enabled: open });

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const envs = list.data ?? [];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-[10px] border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-brand-strong"
      >
        <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-brand-soft text-brand-strong">
          <BoxIcon size={16} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-text">{name}</span>
        <ChevronsUpDown size={16} aria-hidden="true" className="shrink-0 text-text3" />
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 max-h-[320px] overflow-y-auto rounded-[10px] border border-border bg-surface p-1 shadow-[0_10px_28px_rgba(38,38,46,0.18)]"
        >
          {envs.length === 0 ? (
            <p className="px-3 py-2 text-sm text-text3">Carregando…</p>
          ) : (
            envs.map((e) => (
              <Link
                key={e.id}
                href={`/env/${e.id}`}
                role="option"
                aria-selected={e.id === id}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-2 rounded-[7px] px-2.5 py-2 text-[13.5px] transition-colors hover:bg-bg",
                  e.id === id ? "font-semibold text-text" : "text-text2",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{e.name}</span>
                {e.id === id ? <Check size={15} aria-hidden="true" className="shrink-0 text-brand-strong" /> : null}
              </Link>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
