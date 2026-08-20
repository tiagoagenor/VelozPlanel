"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Database,
  CreditCard,
  LifeBuoy,
  ShieldCheck,
  Menu,
  X,
  LogOut,
  PanelLeftClose,
  PanelLeft,
  type LucideIcon,
} from "lucide-react";
import * as api from "@/lib/api";
import { cn } from "@/lib/cn";
import { NavIcon, LinkPending } from "@/components/nav-pending";

/* ─────────────────────────────────────────────────────────────────────────
 *  AppShell — casca de 3 zonas (sidebar 256px · topbar 56px · conteúdo).
 *  Ver src/app/(app)/layout.tsx para a estrutura de navegação e decisões.
 * ─────────────────────────────────────────────────────────────────────── */

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Casamento exato de rota (senão, prefixo). */
  exact?: boolean;
  soon?: boolean;
}

interface NavSection {
  title: string;
  adminOnly?: boolean;
  items: NavItem[];
}

const NAV: NavSection[] = [
  {
    title: "Principal",
    items: [
      { label: "Ambientes", href: "/", icon: LayoutDashboard, exact: true },
      { label: "Bancos", href: "/bancos", icon: Database, soon: true },
      { label: "Financeiro", href: "/financeiro", icon: CreditCard, soon: true },
      { label: "Suporte", href: "/suporte", icon: LifeBuoy, soon: true },
    ],
  },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

const STORAGE_KEY = "vp-sidebar-collapsed";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  // Restaura a preferência de colapso (só no cliente).
  React.useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  };

  // Fecha o drawer ao trocar de rota.
  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-bg">
      {/* Sidebar desktop */}
      <SidebarNav
        pathname={pathname}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
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
            collapsed={false}
            onCloseMobile={() => setMobileOpen(false)}
            className="absolute inset-y-0 left-0 flex"
          />
        </div>
      ) : null}

      {/* Coluna de conteúdo (deslocada pela largura da sidebar no desktop) */}
      <div
        className={cn(
          "flex min-h-screen flex-col transition-[padding] duration-200",
          collapsed ? "lg:pl-[72px]" : "lg:pl-64",
        )}
      >
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
  collapsed,
  onToggleCollapsed,
  onCloseMobile,
  className,
}: {
  pathname: string;
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  onCloseMobile?: () => void;
  className?: string;
}) {
  const { data: user } = useQuery({ queryKey: ["me"], queryFn: api.me });
  const isAdmin = user?.role === "admin";

  return (
    <aside
      aria-label="Navegação principal"
      className={cn(
        "flex-col border-r border-border-subtle bg-surface",
        collapsed ? "w-[72px]" : "w-64",
        className,
      )}
    >
      {/* Marca */}
      <div className="flex h-14 items-center gap-2 px-3">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-lg font-extrabold tracking-tight text-text"
        >
          <span
            aria-hidden="true"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand text-sm font-black text-on-solid"
          >
            V
          </span>
          {!collapsed ? (
            <span>
              Veloz<span className="text-brand-strong">Panel</span>
            </span>
          ) : null}
        </Link>
        {onCloseMobile ? (
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Fechar menu"
            className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-text2 hover:bg-bg"
          >
            <X size={18} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {/* Itens */}
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {NAV.map((section) => {
          if (section.adminOnly && !isAdmin) return null;
          return (
            <div key={section.title} className="mb-4">
              {!collapsed ? (
                <p className="px-3 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text3">
                  {section.title}
                </p>
              ) : (
                <div className="mx-2 mb-2 border-t border-border-subtle" aria-hidden="true" />
              )}
              <ul className="flex flex-col gap-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <NavRow
                      item={item}
                      active={isActive(pathname, item)}
                      collapsed={collapsed}
                    />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Colapsar (só desktop) */}
      {onToggleCollapsed ? (
        <div className="border-t border-border-subtle p-3">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-pressed={collapsed}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
            className={cn(
              "flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-text2 hover:bg-bg",
              collapsed && "justify-center px-0",
            )}
          >
            {collapsed ? (
              <PanelLeft size={20} aria-hidden="true" />
            ) : (
              <>
                <PanelLeftClose size={20} aria-hidden="true" />
                <span>Recolher</span>
              </>
            )}
          </button>
        </div>
      ) : null}
    </aside>
  );
}

function NavRow({
  item,
  active,
  collapsed,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
}) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className="block rounded-lg"
    >
      <LinkPending>
        {(pending) => {
          const on = active || pending;
          return (
            <span
              className={cn(
                "relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                collapsed && "justify-center px-0",
                on
                  ? "bg-brand-soft text-brand-strong"
                  : "text-text2 hover:bg-bg hover:text-text",
              )}
            >
              {/* Barra de acento roxa no item ativo/pendente */}
              <span
                aria-hidden="true"
                className={cn(
                  "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full",
                  on ? "bg-brand" : "bg-transparent",
                )}
              />
              <NavIcon icon={item.icon} size={20} active={on} />
              {!collapsed ? (
                <>
                  <span className="truncate">{item.label}</span>
                  {item.soon ? (
                    <span className="ml-auto shrink-0 rounded-full bg-border-subtle px-2 py-0.5 text-[10px] font-semibold text-text3">
                      Em breve
                    </span>
                  ) : null}
                </>
              ) : null}
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
  const isAdmin = user?.role === "admin";

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

      <div className="ml-auto flex items-center gap-3">
        {isAdmin ? (
          <Link
            href="/admin"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-accent-soft bg-accent-soft px-3.5 text-sm font-semibold text-accent transition-colors hover:brightness-95"
          >
            <ShieldCheck size={16} aria-hidden="true" />
            <span className="hidden sm:inline">Administração</span>
          </Link>
        ) : null}
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
