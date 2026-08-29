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
  Globe,
  Tags,
  Receipt,
  Blocks,
  ScrollText,
  Activity,
  X,
  Menu,
  LogOut,
  ArrowLeft,
  ShieldCheck,
  Search,
  type LucideIcon,
} from "lucide-react";
import * as api from "@/lib/api";
import { cn } from "@/lib/cn";
import { LinkPending } from "@/components/nav-pending";

/* ─────────────────────────────────────────────────────────────────────────
 *  AdminShell — mesmo shell do cliente (rail escuro + topbar) porém em modo
 *  administrador: topbar ESCURO + selo "Modo administrador". Design Jamees.
 * ─────────────────────────────────────────────────────────────────────── */

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  exact?: boolean;
}

const NAV: NavItem[] = [
  { label: "Geral", href: "/admin", icon: Gauge, exact: true },
  { label: "Servidores", href: "/admin/nodes", icon: Server },
  { label: "Usuários", href: "/admin/usuarios", icon: Users },
  { label: "Ambientes", href: "/admin/ambientes", icon: Boxes },
  { label: "Rede", href: "/admin/rede", icon: Network },
  { label: "Velocidade", href: "/admin/velocidade", icon: Activity },
  { label: "Domínios", href: "/admin/dominios", icon: Globe },
  { label: "Planos e preços", href: "/admin/planos-e-precos", icon: Tags },
  { label: "Cobrança", href: "/admin/faturamento", icon: Receipt },
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

  React.useEffect(() => { setMobileOpen(false); }, [pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <Topbar onOpenMobile={() => setMobileOpen(true)} />

      <div className="flex flex-1">
        <Rail pathname={pathname} className="sticky top-16 hidden h-[calc(100vh-4rem)] shrink-0 self-start lg:flex" />

        {mobileOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button type="button" aria-label="Fechar menu" onClick={() => setMobileOpen(false)} className="absolute inset-0 bg-[#1b1730]/55 backdrop-blur-sm" />
            <Rail pathname={pathname} onCloseMobile={() => setMobileOpen(false)} className="absolute inset-y-0 left-0 flex" />
          </div>
        ) : null}

        <main id="conteudo" className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-[1320px] px-5 py-8 sm:px-6 lg:px-10">{children}</div>
        </main>
      </div>
    </div>
  );
}

/* ─────────────── Rail ─────────────── */

function Rail({ pathname, onCloseMobile, className }: { pathname: string; onCloseMobile?: () => void; className?: string }) {
  return (
    <aside aria-label="Navegação de administração" className={cn("w-20 flex-col bg-[#2f2354] text-white", className)}>
      {onCloseMobile ? (
        <div className="flex h-14 items-center justify-center">
          <button type="button" onClick={onCloseMobile} aria-label="Fechar menu" className="grid h-8 w-8 place-items-center rounded-lg text-white/70 hover:bg-white/10">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <nav className="flex flex-1 flex-col items-stretch gap-0.5 px-0 py-2">
        {NAV.map((item) => (
          <RailItem key={item.href} item={item} active={isActive(pathname, item)} />
        ))}
      </nav>

      <LogoutRailButton />
    </aside>
  );
}

function RailItem({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className="group relative block w-full" title={item.label}>
      <LinkPending>
        {(pending) => {
          const on = active || pending;
          return (
            <span className={cn(
              "flex w-full flex-col items-center gap-1 px-1 py-3 text-[10.5px] font-normal transition-colors",
              on
                ? "bg-brand text-white"
                : "text-[#d3ccea] group-hover:bg-white/[0.07] group-hover:text-white",
            )}>
              <item.icon size={20} aria-hidden="true" strokeWidth={on ? 2.2 : 2} />
              <span className="text-center leading-tight">{item.label}</span>
            </span>
          );
        }}
      </LinkPending>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-full top-1/2 z-50 ml-1.5 -translate-y-1/2 whitespace-nowrap rounded-md bg-white px-2.5 py-1 text-[11px] font-medium text-[#2f2354] opacity-0 shadow-[0_6px_20px_rgba(0,0,0,0.22)] transition-opacity duration-100 group-hover:opacity-100"
      >
        {item.label}
      </span>
    </Link>
  );
}

function LogoutRailButton() {
  const router = useRouter();
  const qc = useQueryClient();
  const logout = useMutation({ mutationFn: api.logout, onSuccess: () => { qc.clear(); router.replace("/login"); } });
  return (
    <button type="button" onClick={() => logout.mutate()} disabled={logout.isPending} aria-label="Sair"
      className="flex w-full flex-col items-center gap-1 bg-[#4a3880] px-1 py-3.5 text-[10.5px] font-normal text-[#eae7f4] transition-colors hover:bg-[#5a4699] hover:text-white disabled:opacity-50">
      <LogOut size={20} aria-hidden="true" />
      <span className="leading-none">Sair</span>
    </button>
  );
}

/* ─────────────── Topbar (ESCURO no admin — como o design) ─────────────── */

function Topbar({ onOpenMobile }: { onOpenMobile: () => void }) {
  const { data: user } = useQuery({ queryKey: ["me"], queryFn: api.me });
  const initials = (user?.name ?? "?").trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const firstName = (user?.name ?? "").trim().split(/\s+/)[0] ?? "";

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-[#4a3880] bg-[#161826] px-4 text-[#e4e4ea] sm:px-6 lg:px-8">
      <button type="button" onClick={onOpenMobile} aria-label="Abrir menu" className="grid h-9 w-9 place-items-center rounded-lg text-white/70 hover:bg-white/10 lg:hidden">
        <Menu size={20} aria-hidden="true" />
      </button>

      <Link href="/admin" className="flex items-center gap-2 whitespace-nowrap text-[19px] font-normal tracking-[-0.02em] text-white" style={{ fontFamily: "var(--font-inter)" }}>
        <span>jamees<span className="text-white">.</span><span className="text-[0.72em] text-white/45">com</span></span>
      </Link>

      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#8a78c1] bg-white/5 px-2.5 py-1 text-xs font-medium text-[#d3ccea]">
        <ShieldCheck size={13} aria-hidden="true" />
        <span className="hidden sm:inline">Modo administrador</span>
      </span>

      {/* Busca global (escura) */}
      <div className="mx-auto hidden w-full max-w-[460px] items-center gap-2.5 rounded-full border border-[#4a3880] bg-[#2f2354] px-4 py-2 text-[#d3ccea] md:flex">
        <Search size={16} aria-hidden="true" className="opacity-75" />
        <input type="search" placeholder="Buscar servidor, usuário, ambiente…" aria-label="Busca global"
          className="w-full bg-transparent text-[13.5px] text-white outline-none placeholder:text-white/40" />
      </div>

      <div className="ml-auto flex items-center gap-4">
        <Link
          href="/"
          aria-label="Voltar ao painel do cliente"
          title="Voltar ao painel do cliente"
          className="inline-flex items-center gap-[7px] whitespace-nowrap rounded-full border border-[#8a78c1] px-[13px] py-1.5 text-[12.5px] font-medium text-[#d3ccea] transition-colors hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          <span className="hidden sm:inline">Sair do admin</span>
        </Link>
        {user ? (
          <div className="flex items-center gap-2 text-[13px]">
            <span aria-hidden="true" className="grid h-[26px] w-[26px] place-items-center rounded-full bg-[#d3ccea] text-xs font-semibold text-[#2f2354]">{initials}</span>
            <span className="hidden text-white/85 sm:inline">{firstName}</span>
          </div>
        ) : null}
      </div>
    </header>
  );
}
