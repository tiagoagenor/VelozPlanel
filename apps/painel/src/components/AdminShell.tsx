"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Gauge,
  Server,
  Users,
  Boxes,
  Network,
  Layers,
  Blocks,
  ScrollText,
  Menu,
  X,
  LogOut,
  ChevronLeft,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import * as api from "@/lib/api";
import { cn } from "@/lib/cn";
import { NavIcon, LinkPending } from "@/components/nav-pending";

/* ─────────────────────────────────────────────────────────────────────────
 *  AdminShell — casca DISTINTA da área de super admin.
 *
 *  Propositalmente diferente da casca do cliente (AppShell) para nunca
 *  confundir o contexto:
 *   - faixa de acento roxo-forte no topo da sidebar + etiqueta "ADMINISTRAÇÃO";
 *   - marca com escudo (ShieldCheck) em vez do "V";
 *   - topbar com selo "Modo administrador";
 *   - link fixo "‹ Voltar ao painel do cliente".
 *  Mesmo app, layout próprio (route group `(admin)`), URLs em /admin/*.
 * ─────────────────────────────────────────────────────────────────────── */

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  exact?: boolean;
}

const NAV: NavItem[] = [
  { label: "Visão geral", href: "/admin", icon: Gauge, exact: true },
  { label: "Servidores", href: "/admin/nodes", icon: Server },
  { label: "Usuários", href: "/admin/usuarios", icon: Users },
  { label: "Ambientes", href: "/admin/ambientes", icon: Boxes },
  { label: "Rede", href: "/admin/rede", icon: Network },
  { label: "Planos", href: "/admin/planos", icon: Layers },
  { label: "Módulos", href: "/admin/modulos", icon: Blocks },
  { label: "Auditoria", href: "/admin/auditoria", icon: ScrollText },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/admin";
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-bg">
      {/* Sidebar desktop */}
      <SidebarNav
        pathname={pathname}
        className="fixed inset-y-0 left-0 z-30 hidden lg:flex"
      />

      {/* Drawer mobile */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-[#1b1730]/45 backdrop-blur-sm"
          />
          <SidebarNav
            pathname={pathname}
            onCloseMobile={() => setMobileOpen(false)}
            className="absolute inset-y-0 left-0 flex"
          />
        </div>
      ) : null}

      {/* Coluna de conteúdo */}
      <div className="flex min-h-screen flex-col lg:pl-64">
        <Topbar onOpenMobile={() => setMobileOpen(true)} />
        <main id="conteudo" className="flex-1">
          <div className="mx-auto w-full max-w-[1200px] px-5 py-8 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

/* ─────────────── Sidebar ─────────────── */

function SidebarNav({
  pathname,
  onCloseMobile,
  className,
}: {
  pathname: string;
  onCloseMobile?: () => void;
  className?: string;
}) {
  return (
    <aside
      aria-label="Navegação de administração"
      className={cn(
        "w-64 flex-col border-r border-border-subtle bg-surface",
        className,
      )}
    >
      {/* Cabeçalho distinto: faixa de acento roxo-forte + etiqueta ADMIN */}
      <div className="bg-[#4c1d95] px-4 pb-3 pt-3.5 text-white">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/15"
          >
            <ShieldCheck size={18} />
          </span>
          <div className="min-w-0 leading-tight">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/80">
              Administração
            </p>
            <p className="truncate text-sm font-extrabold tracking-tight">
              VelozPanel
            </p>
          </div>
          {onCloseMobile ? (
            <button
              type="button"
              onClick={onCloseMobile}
              aria-label="Fechar menu"
              className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-white/90 hover:bg-white/15"
            >
              <X size={18} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Itens */}
      <nav className="flex-1 overflow-y-auto px-3 py-3">
        <ul className="flex flex-col gap-0.5">
          {NAV.map((item) => (
            <li key={item.href}>
              <NavRow item={item} active={isActive(pathname, item)} />
            </li>
          ))}
        </ul>
      </nav>

      {/* Voltar ao painel do cliente */}
      <div className="border-t border-border-subtle p-3">
        <Link
          href="/"
          className="flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-text2 transition-colors hover:bg-bg hover:text-text"
        >
          <ChevronLeft size={18} aria-hidden="true" />
          <span>Voltar ao painel do cliente</span>
        </Link>
      </div>
    </aside>
  );
}

function NavRow({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className="block rounded-lg"
    >
      <LinkPending>
        {(pending) => {
          const on = active || pending;
          return (
            <span
              className={cn(
                "relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                on
                  ? "bg-accent-soft text-accent"
                  : "text-text2 hover:bg-bg hover:text-text",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full",
                  on ? "bg-accent" : "bg-transparent",
                )}
              />
              <NavIcon icon={item.icon} size={20} active={on} />
              <span className="truncate">{item.label}</span>
            </span>
          );
        }}
      </LinkPending>
    </Link>
  );
}

/* ─────────────── Topbar ─────────────── */

function Topbar({ onOpenMobile }: { onOpenMobile: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: user } = useQuery({ queryKey: ["me"], queryFn: api.me });

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      qc.clear();
      router.replace("/login");
    },
  });

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border-subtle bg-surface/95 px-4 backdrop-blur sm:px-6">
      <button
        type="button"
        onClick={onOpenMobile}
        aria-label="Abrir menu"
        className="grid h-9 w-9 place-items-center rounded-lg text-text2 hover:bg-bg lg:hidden"
      >
        <Menu size={20} aria-hidden="true" />
      </button>

      {/* Selo de contexto — reforça que é a área de administração */}
      <span className="vp-pill vp-pill-accent inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold">
        <ShieldCheck size={13} aria-hidden="true" />
        Modo administrador
      </span>

      <div className="ml-auto flex items-center gap-3">
        {user ? (
          <span className="hidden text-sm text-text2 sm:inline">
            {user.name}
            <span className="text-text3"> · {user.email}</span>
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3.5",
            "text-sm font-semibold text-text transition-colors hover:bg-bg hover:border-brand-strong",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          <LogOut size={16} aria-hidden="true" />
          <span className="hidden sm:inline">Sair</span>
        </button>
      </div>
    </header>
  );
}
