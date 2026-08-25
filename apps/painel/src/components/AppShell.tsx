"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Globe,
  CreditCard,
  LifeBuoy,
  ShieldCheck,
  Menu,
  X,
  LogOut,
  Wallet,
  Search,
  type LucideIcon,
} from "lucide-react";
import * as api from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatCents, formatEstimate } from "@/lib/format";
import type { Balance } from "@velozplanel/contracts";
import { LinkPending } from "@/components/nav-pending";

/* ─────────────────────────────────────────────────────────────────────────
 *  AppShell — design Jamees: rail escuro estreito (80px) + topbar (64px) com
 *  marca, busca global, saldo e avatar. Conteúdo à direita.
 * ─────────────────────────────────────────────────────────────────────── */

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  exact?: boolean;
  soon?: boolean;
}

const NAV: NavItem[] = [
  { label: "Ambientes", href: "/", icon: LayoutDashboard, exact: true },
  { label: "Meus domínios", href: "/dominios", icon: Globe },
  { label: "Financeiro", href: "/financeiro", icon: CreditCard },
  { label: "Suporte", href: "/suporte", icon: LifeBuoy, soon: true },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  // Rotas /env/[id]/* ganham o submenu branco FIXO (2ª coluna colada no rail).
  // Só elas: as demais telas mantêm o <main> centralizado (max-w-1320).
  const isEnv = /^\/env\/[^/]+/.test(pathname);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      {/* Topbar FULL-WIDTH (marca jamees.com no canto esquerdo) */}
      <Topbar onOpenMobile={() => setMobileOpen(true)} />

      <div className="flex flex-1">
        {/* Rail escuro (desktop) — abaixo do topbar, sem "J" */}
        <Rail pathname={pathname} className="sticky top-16 hidden h-[calc(100vh-4rem)] shrink-0 self-start lg:flex" />

        {/* Drawer mobile */}
        {mobileOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              aria-label="Fechar menu"
              onClick={() => setMobileOpen(false)}
              className="absolute inset-0 bg-[#1b1730]/55 backdrop-blur-sm"
            />
            <Rail pathname={pathname} onCloseMobile={() => setMobileOpen(false)} className="absolute inset-y-0 left-0 flex" />
          </div>
        ) : null}

        <main id="conteudo" className="min-w-0 flex-1">
          {isEnv ? (
            // Full-bleed: sem centralização. O padding-esquerdo (não margin) reserva
            // a faixa do submenu branco fixo (246px) + goteira. O submenu vive na env layout.
            <div className="w-full px-5 py-8 sm:px-6 lg:py-8 lg:pr-10 lg:pl-[calc(var(--vp-submenu-w)+2.5rem)]">
              {children}
            </div>
          ) : (
            <div className="mx-auto w-full max-w-[1320px] px-5 py-8 sm:px-6 lg:px-10">
              {children}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

/* ─────────────── Rail (coluna escura estreita) ─────────────── */

function Rail({
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
      aria-label="Navegação principal"
      className={cn("w-20 flex-col bg-[#2f2354] text-white", className)}
    >
      {/* Fechar (só no mobile) — sem "J": a marca vive no topbar */}
      {onCloseMobile ? (
        <div className="flex h-14 items-center justify-center">
          <button type="button" onClick={onCloseMobile} aria-label="Fechar menu" className="grid h-8 w-8 place-items-center rounded-lg text-white/70 hover:bg-white/10">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {/* Itens verticais (faixas full-width, sem "box") */}
      <nav className="flex flex-1 flex-col items-stretch gap-0.5 px-0 py-2">
        {NAV.map((item) => (
          <RailItem key={item.href} item={item} active={isActive(pathname, item)} />
        ))}
      </nav>

      {/* Sair */}
      <LogoutRailButton />
    </aside>
  );
}

function RailItem({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className="group relative block w-full"
      title={item.soon ? `${item.label} (em breve)` : item.label}
    >
      <LinkPending>
        {(pending) => {
          const on = active || pending;
          return (
            <span
              className={cn(
                "flex w-full flex-col items-center gap-1 px-1 py-3 text-[10.5px] font-normal transition-colors",
                on
                  ? "bg-brand text-white"
                  : "text-[#d3ccea] group-hover:bg-white/[0.07] group-hover:text-white",
              )}
            >
              <item.icon size={20} aria-hidden="true" strokeWidth={on ? 2.2 : 2} />
              <span className="text-center leading-tight">{item.label}</span>
            </span>
          );
        }}
      </LinkPending>
      {/* Tooltip no hover — balão claro à direita */}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-full top-1/2 z-50 ml-1.5 -translate-y-1/2 whitespace-nowrap rounded-md bg-white px-2.5 py-1 text-[11px] font-medium text-[#2f2354] opacity-0 shadow-[0_6px_20px_rgba(0,0,0,0.22)] transition-opacity duration-100 group-hover:opacity-100"
      >
        {item.soon ? `${item.label} · em breve` : item.label}
      </span>
    </Link>
  );
}

function LogoutRailButton() {
  const router = useRouter();
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => { qc.clear(); router.replace("/login"); },
  });
  return (
    <button
      type="button"
      onClick={() => logout.mutate()}
      disabled={logout.isPending}
      aria-label="Sair"
      className="flex w-full flex-col items-center gap-1 bg-[#4a3880] px-1 py-3.5 text-[10.5px] font-normal text-[#eae7f4] transition-colors hover:bg-[#5a4699] hover:text-white disabled:opacity-50"
    >
      <LogOut size={20} aria-hidden="true" />
      <span className="leading-none">Sair</span>
    </button>
  );
}

/* ─────────────── Saldo (texto + balão colado no topbar) ─────────────── */

function BalanceMenu({ balance }: { balance: Balance }) {
  const [open, setOpen] = React.useState(false);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const openNow = () => { if (closeTimer.current) clearTimeout(closeTimer.current); setOpen(true); };
  const closeSoon = () => { if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setOpen(false), 120); };
  React.useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  const negative = balance.balanceCents < 0;

  return (
    <div
      className="relative hidden items-center gap-2 text-[13px] sm:flex"
      tabIndex={0}
      onMouseEnter={openNow}
      onMouseLeave={closeSoon}
      onFocus={openNow}
      onBlur={closeSoon}
      aria-describedby="saldo-tip"
    >
      <Wallet size={17} aria-hidden="true" />
      <span className="text-current/90">Saldo <strong className={cn("font-semibold", negative && "text-danger")}>{formatCents(balance.balanceCents)}</strong></span>
      {balance.monthlyBurnCents > 0 ? (
        <span className="hidden border-l border-border pl-2 text-xs text-text3 md:inline">
          ~{formatCents(Math.round(balance.monthlyBurnCents / 30))}/dia
        </span>
      ) : null}

      {open ? (
        // Balão colado na linha do header: cantos só embaixo + setinha no topo.
        <div
          id="saldo-tip"
          role="tooltip"
          className="absolute right-0 top-[calc(50%+31px)] z-40 w-[236px] rounded-b-[14px] border border-border bg-surface p-4 text-sm text-text shadow-[0_10px_28px_rgba(38,38,46,0.18)]"
        >
          <span aria-hidden="true" className="absolute -top-[7px] right-[26px] h-3 w-3 rotate-45 border-l border-t border-border bg-surface" />
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3">
            <dt className="text-text2">Dinheiro</dt>
            <dd className="m-0 text-right tabular-nums">{formatCents(balance.moneyCents)}</dd>
            <dt className="text-text2">Bônus</dt>
            <dd className="m-0 text-right tabular-nums">{formatCents(balance.bonusCents)}</dd>
            <dt className="font-medium text-text">Saldo total</dt>
            <dd className="m-0 text-right font-medium tabular-nums">{formatCents(balance.balanceCents)}</dd>
            <dt className="text-text2">Estimativa</dt>
            <dd className="m-0 text-right">{formatEstimate(balance.estimateMonths)}</dd>
          </dl>
        </div>
      ) : null}
    </div>
  );
}


/* ─────────────── Topbar ─────────────── */

function Topbar({ onOpenMobile }: { onOpenMobile: () => void }) {
  const { data: user } = useQuery({ queryKey: ["me"], queryFn: api.me });
  const isAdmin = user?.role === "admin";
  const { data: balance } = useQuery({
    queryKey: ["balance"],
    queryFn: api.getBalance,
    enabled: user?.role === "client" || user?.role === "admin",
    staleTime: 30_000,
  });
  const initials = (user?.name ?? "?").trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const firstName = (user?.name ?? "").trim().split(/\s+/)[0] ?? "";

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur sm:px-6 lg:px-8">
      <button
        type="button"
        onClick={onOpenMobile}
        aria-label="Abrir menu"
        className="grid h-9 w-9 place-items-center rounded-lg text-text2 hover:bg-bg lg:hidden"
      >
        <Menu size={20} aria-hidden="true" />
      </button>

      {/* Marca (full — sem "J") */}
      <Link href="/" className="flex min-w-16 items-center whitespace-nowrap text-[19px] font-normal tracking-[-0.02em] text-text" style={{ fontFamily: "var(--font-inter)" }}>
        <span>jamees<span className="text-text">.</span><span className="text-[0.72em] text-text3">com</span></span>
      </Link>

      {/* Busca global */}
      <div className="mx-auto hidden w-full max-w-[460px] items-center gap-2.5 rounded-full border border-border bg-bg px-4 py-2 text-text2 md:flex">
        <Search size={16} aria-hidden="true" className="opacity-75" />
        <input
          type="search"
          placeholder="Buscar ambiente, domínio, registro…"
          aria-label="Busca global"
          className="w-full bg-transparent text-[13.5px] text-text outline-none placeholder:text-text3"
        />
      </div>

      <div className="ml-auto flex items-center gap-4">
        {balance ? <BalanceMenu balance={balance} /> : null}
        {isAdmin ? (
          <Link
            href="/admin"
            aria-label="Ir para o painel administrador"
            title="Ir para o painel administrador"
            className="inline-flex items-center gap-[7px] whitespace-nowrap rounded-full border border-border px-[13px] py-1.5 text-[12.5px] font-medium text-text2 transition-colors hover:border-brand-strong hover:text-brand-strong"
          >
            <ShieldCheck size={16} aria-hidden="true" />
            <span className="hidden sm:inline">Admin</span>
          </Link>
        ) : null}
        {user ? (
          <div className="flex items-center gap-2 text-[13px]">
            <span aria-hidden="true" className="grid h-[26px] w-[26px] place-items-center rounded-full bg-[#d3ccea] text-xs font-semibold text-[#2f2354]">{initials}</span>
            <span className="hidden text-text sm:inline">{firstName}</span>
          </div>
        ) : null}
      </div>
    </header>
  );
}
