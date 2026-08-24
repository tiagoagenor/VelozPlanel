"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Wallet,
  TrendingDown,
  Clock,
  Gift,
  Server,
  Globe,
  Plus,
  Minus,
  LifeBuoy,
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
  ArrowDownCircle,
  ArrowUpCircle,
} from "lucide-react";
import { type Environment, type Balance, type CreditTransaction } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CenterLoader } from "@/components/Skeletons";
import { formatCents, formatSignedCents, formatCentsFine, formatDateTime, formatEstimate } from "@/lib/format";

export default function FinanceiroPage() {
  const balanceQ = useQuery({ queryKey: ["balance"], queryFn: api.getBalance, staleTime: 30_000 });
  const envsQ = useQuery({ queryKey: ["environments"], queryFn: api.listEnvironments });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="flex items-center gap-2 text-[28px] font-bold leading-tight text-text">
          <Wallet size={24} aria-hidden="true" className="text-brand-strong" />
          Financeiro
        </h1>
        <p className="mt-1 text-sm text-text2">
          Saldo pré-pago e o fechamento de cada mês (consumo e recargas).
        </p>
      </header>

      {balanceQ.isPending ? (
        <CenterLoader minHeight="40vh" />
      ) : balanceQ.isError ? (
        <Card className="flex items-start gap-3">
          <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          <p role="alert" className="font-medium text-text">Não foi possível carregar o financeiro.</p>
        </Card>
      ) : (
        <>
          <StatusBanner balance={balanceQ.data} envs={envsQ.data ?? []} />
          <BalanceSummary balance={balanceQ.data} />
          <MonthlyStatement transactions={balanceQ.data.transactions} />
          <AddBalanceCard />
        </>
      )}
    </div>
  );
}

/* ─────────────── Faixa de estado (situação atual) ─────────────── */

function StatusBanner({ balance, envs }: { balance: Balance; envs: Environment[] }) {
  const hasActive = envs.some((e) => e.state === "running");
  if (balance.balanceCents <= 0 && hasActive) {
    return (
      <Banner
        tone="danger"
        action={
          <Link href="/suporte" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-strong">
            <LifeBuoy size={15} aria-hidden="true" /> Falar com suporte
          </Link>
        }
      >
        Seu saldo acabou. Seus ambientes ativos serão <strong>pausados automaticamente</strong>. Adicione saldo para mantê-los no ar.
      </Banner>
    );
  }
  if (balance.estimateMonths != null && balance.estimateMonths < 0.5) {
    const days = Math.max(1, Math.round(balance.estimateMonths * 30));
    return <Banner tone="warning">Saldo baixo: no ritmo atual, dura <strong>~{days} {days === 1 ? "dia" : "dias"}</strong>.</Banner>;
  }
  if (balance.estimateMonths == null && balance.balanceCents > 0) {
    return <Banner tone="info">Você não tem ambientes ativos — nada está sendo cobrado no momento.</Banner>;
  }
  return null;
}

function Banner({ tone, children, action }: { tone: "danger" | "warning" | "info"; children: React.ReactNode; action?: React.ReactNode }) {
  const styles = {
    danger: "border-danger/40 bg-danger/10 text-text",
    warning: "border-warning/40 bg-warning/10 text-text",
    info: "border-border bg-bg text-text2",
  }[tone];
  const iconColor = { danger: "text-danger", warning: "text-warning", info: "text-text3" }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm", styles)}>
      <span className="flex items-center gap-2">
        <AlertTriangle size={16} aria-hidden="true" className={cn("shrink-0", iconColor)} />
        <span>{children}</span>
      </span>
      {action}
    </div>
  );
}

/* ─────────────── Situação atual (saldo ao vivo) ─────────────── */

function BalanceSummary({ balance }: { balance: Balance }) {
  const negative = balance.balanceCents < 0;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card>
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-text3">
          <Wallet size={14} aria-hidden="true" /> Saldo atual
        </div>
        <p className={cn("mt-1 text-[26px] font-bold tabular-nums", negative ? "text-danger" : "text-text")}>{formatCents(balance.balanceCents)}</p>
        <p className="mt-1 text-xs text-text2">
          Dinheiro <span className="font-medium text-text">{formatCents(balance.moneyCents)}</span>
          {" · "}Bônus <span className="font-medium text-text">{formatCents(balance.bonusCents)}</span>
        </p>
      </Card>
      <Card>
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-text3">
          <TrendingDown size={14} aria-hidden="true" /> Gasto mensal estimado
        </div>
        <p className="mt-1 text-[26px] font-bold tabular-nums text-text">{formatCents(balance.monthlyBurnCents)}</p>
        <p className="mt-1 text-xs text-text2">≈ {formatCents(Math.round(balance.monthlyBurnCents / 30))}/dia · {formatCentsFine(balance.monthlyBurnCents / 720)}/hora</p>
      </Card>
      <Card>
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-text3">
          <Clock size={14} aria-hidden="true" /> Duração estimada
        </div>
        <p className="mt-1 text-[26px] font-bold text-text">{formatEstimate(balance.estimateMonths)}</p>
        <p className="mt-1 text-xs text-text2">{balance.estimateMonths == null ? "sem ambiente ativo" : "no ritmo de consumo atual"}</p>
      </Card>
    </div>
  );
}

/* ─────────────── Fechamento mês a mês ─────────────── */

function monthKeyOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthKey(year: number, month0: number): string {
  return `${year}-${String(month0 + 1).padStart(2, "0")}`;
}
function isEntry(kind: string): boolean {
  return kind === "admin_money" || kind === "admin_bonus" || kind === "admin_credit";
}

function MonthlyStatement({ transactions }: { transactions: CreditTransaction[] }) {
  const now = new Date();
  const [sel, setSel] = React.useState<{ year: number; month0: number }>({ year: now.getFullYear(), month0: now.getMonth() });

  // Mês mais antigo com lançamento (limite do "voltar").
  const earliest = React.useMemo(() => {
    if (transactions.length === 0) return { year: now.getFullYear(), month0: now.getMonth() };
    let min = Infinity;
    for (const t of transactions) { const ms = new Date(t.createdAt).getTime(); if (ms < min) min = ms; }
    const d = new Date(min);
    return { year: d.getFullYear(), month0: d.getMonth() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions]);

  const selKey = monthKey(sel.year, sel.month0);
  const isCurrent = sel.year === now.getFullYear() && sel.month0 === now.getMonth();
  const atEarliest = sel.year === earliest.year && sel.month0 === earliest.month0;

  function shift(delta: number) {
    const d = new Date(sel.year, sel.month0 + delta, 1);
    setSel({ year: d.getFullYear(), month0: d.getMonth() });
  }

  // Lançamentos do mês selecionado.
  const monthTxs = React.useMemo(
    () => transactions.filter((t) => monthKeyOf(t.createdAt) === selKey),
    [transactions, selKey],
  );

  // Totais do mês.
  const consumedCents = monthTxs.filter((t) => t.kind === "usage").reduce((s, t) => s + Math.abs(t.amountCents), 0);
  const addedCents = monthTxs.filter((t) => isEntry(t.kind)).reduce((s, t) => s + t.amountCents, 0);
  // Saldo ao fim do mês = soma de tudo até o fim do mês selecionado.
  const endOfMonth = new Date(sel.year, sel.month0 + 1, 1).getTime();
  const endBalanceCents = transactions.reduce((s, t) => (new Date(t.createdAt).getTime() < endOfMonth ? s + t.amountCents : s), 0);

  // Consumo por ambiente no mês (estimado a partir do texto do lançamento).
  const byEnv = React.useMemo(() => {
    const m = new Map<string, { cents: number; domain: boolean }>();
    for (const t of monthTxs) {
      if (t.kind !== "usage") continue;
      const raw = (t.reason ?? "consumo").split(" · ")[0]!.trim();
      const domain = raw.toLowerCase().startsWith("domínio");
      const label = domain ? raw.replace(/^dom[íi]nio\s+/i, "") : raw;
      const prev = m.get(label) ?? { cents: 0, domain };
      prev.cents += Math.abs(t.amountCents);
      m.set(label, prev);
    }
    return [...m.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.cents - a.cents);
  }, [monthTxs]);

  const monthLabel = new Date(sel.year, sel.month0, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <Card className="p-0">
      {/* Seletor de mês */}
      <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-5 py-4">
        <h2 className="text-sm font-semibold text-text">Fechamento mensal</h2>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => shift(-1)} disabled={atEarliest} aria-label="Mês anterior" className="grid h-8 w-8 place-items-center rounded-lg border border-border text-text2 hover:text-text disabled:opacity-40">
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span className="min-w-[9.5rem] text-center text-sm font-medium capitalize text-text">{monthLabel}</span>
          <button type="button" onClick={() => shift(1)} disabled={isCurrent} aria-label="Próximo mês" className="grid h-8 w-8 place-items-center rounded-lg border border-border text-text2 hover:text-text disabled:opacity-40">
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Resumo do mês */}
      <div className="grid grid-cols-1 gap-px bg-border-subtle sm:grid-cols-3">
        <MonthStat icon={ArrowUpCircle} label="Consumido no mês" value={formatCents(consumedCents)} tone="danger" />
        <MonthStat icon={ArrowDownCircle} label="Adicionado no mês" value={formatCents(addedCents)} tone="success" />
        <MonthStat icon={Wallet} label="Saldo no fim do mês" value={formatCents(endBalanceCents)} tone={endBalanceCents < 0 ? "danger" : "neutral"} />
      </div>

      {monthTxs.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-text2">Nenhum lançamento em {monthLabel}.</p>
      ) : (
        <>
          {/* Consumo por ambiente no mês */}
          {byEnv.length > 0 ? (
            <section className="border-t border-border-subtle px-5 py-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text3">Consumo por ambiente</h3>
              <ul className="mt-2 flex flex-col gap-1.5">
                {byEnv.map((e) => (
                  <li key={e.label} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2 text-text">
                      {e.domain ? <Globe size={14} aria-hidden="true" className="shrink-0 text-text3" /> : <Server size={14} aria-hidden="true" className="shrink-0 text-text3" />}
                      <span className="truncate">{e.label}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-text2">{formatCents(e.cents)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-text3">Estimativa a partir do histórico de cobrança do mês.</p>
            </section>
          ) : null}

          {/* Lançamentos do mês */}
          <section className="border-t border-border-subtle">
            <h3 className="px-5 pt-4 text-xs font-semibold uppercase tracking-wide text-text3">Lançamentos</h3>
            <MonthEntries txs={monthTxs} />
          </section>
        </>
      )}
    </Card>
  );
}

function MonthStat({ icon: Icon, label, value, tone }: { icon: React.ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>; label: string; value: string; tone: "danger" | "success" | "neutral" }) {
  const color = tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-text";
  return (
    <div className="bg-surface px-5 py-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-text3">
        <Icon size={14} aria-hidden={true} /> {label}
      </div>
      <p className={cn("mt-1 text-xl font-bold tabular-nums", color)}>{value}</p>
    </div>
  );
}

/* Lançamentos do mês: recargas individuais + consumo agrupado por dia. */
type DayGroup = { day: string; iso: string; totalCents: number; items: CreditTransaction[] };

function localDayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function MonthEntries({ txs }: { txs: CreditTransaction[] }) {
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const rows = React.useMemo(() => {
    const nonUsage = txs.filter((t) => t.kind !== "usage");
    const byDay = new Map<string, DayGroup>();
    for (const t of txs) {
      if (t.kind !== "usage") continue;
      const key = localDayKey(t.createdAt);
      const g = byDay.get(key) ?? { day: key, iso: t.createdAt, totalCents: 0, items: [] };
      g.totalCents += t.amountCents;
      g.items.push(t);
      if (t.createdAt > g.iso) g.iso = t.createdAt;
      byDay.set(key, g);
    }
    const list: Array<{ kind: "tx"; tx: CreditTransaction } | { kind: "day"; group: DayGroup }> = [
      ...nonUsage.map((tx) => ({ kind: "tx" as const, tx })),
      ...[...byDay.values()].map((group) => ({ kind: "day" as const, group })),
    ];
    return list.sort((a, b) => {
      const da = a.kind === "tx" ? a.tx.createdAt : a.group.iso;
      const db = b.kind === "tx" ? b.tx.createdAt : b.group.iso;
      return db.localeCompare(da);
    });
  }, [txs]);

  function toggle(day: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day); else next.add(day);
      return next;
    });
  }

  return (
    <ul className="mt-2 divide-y divide-border-subtle">
      {rows.map((row) =>
        row.kind === "tx" ? (
          <TxRow key={row.tx.id} tx={row.tx} />
        ) : (
          <DayRow key={row.group.day} group={row.group} open={expanded.has(row.group.day)} onToggle={() => toggle(row.group.day)} />
        ),
      )}
    </ul>
  );
}

function kindMeta(kind: string): { label: string; icon: React.ReactNode; bonus?: boolean } {
  if (kind === "admin_bonus") return { label: "Bônus", icon: <Gift size={16} aria-hidden="true" />, bonus: true };
  if (kind === "admin_money" || kind === "admin_credit") return { label: "Saldo adicionado", icon: <Plus size={16} aria-hidden="true" /> };
  if (kind === "admin_debit") return { label: "Ajuste / estorno", icon: <Minus size={16} aria-hidden="true" /> };
  return { label: "Consumo", icon: <Server size={16} aria-hidden="true" /> };
}

function TxRow({ tx }: { tx: CreditTransaction }) {
  const meta = kindMeta(tx.kind);
  const positive = tx.amountCents > 0;
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", positive ? "bg-success/12 text-success" : "bg-danger/10 text-danger")}>{meta.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium text-text">{meta.label}{meta.bonus ? <Badge tone="success">bônus</Badge> : null}</p>
        {tx.reason ? <p className="truncate text-xs text-text3">{tx.reason}</p> : null}
      </div>
      <div className="shrink-0 text-right">
        <p className={cn("text-sm font-semibold tabular-nums", positive ? "text-success" : "text-danger")}>{formatSignedCents(tx.amountCents)}</p>
        <p className="text-[11px] text-text3">{formatDateTime(tx.createdAt)}</p>
      </div>
    </li>
  );
}

function DayRow({ group, open, onToggle }: { group: DayGroup; open: boolean; onToggle: () => void }) {
  return (
    <li>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-bg">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-danger/10 text-danger"><Server size={16} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text">Consumo · {dayLabel(group.iso)}</p>
          <p className="text-xs text-text3">{group.items.length} lançamento(s) no dia</p>
        </div>
        <p className="shrink-0 text-sm font-semibold tabular-nums text-danger">{formatSignedCents(group.totalCents)}</p>
        <ChevronDown size={16} aria-hidden="true" className={cn("shrink-0 text-text3 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <ul className="bg-bg/60">
          {group.items.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-5 py-2 pl-16 text-xs">
              <span className="min-w-0 flex-1 truncate text-text3">{t.reason ?? "consumo"}</span>
              <span className="shrink-0 text-text3">{formatDateTime(t.createdAt)}</span>
              <span className="shrink-0 tabular-nums text-danger">{formatSignedCents(t.amountCents)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/* ─────────────── Adicionar saldo (placeholder honesto) ─────────────── */

function AddBalanceCard() {
  return (
    <Card className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><Info size={18} aria-hidden="true" /></span>
        <div>
          <p className="font-semibold text-text">Adicionar saldo</p>
          <p className="mt-0.5 text-sm text-text2">As recargas são feitas pela nossa equipe. Fale com o suporte para adicionar saldo à sua conta.</p>
        </div>
      </div>
      <Link href="/suporte" className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-strong">
        <LifeBuoy size={16} aria-hidden="true" /> Falar com suporte
      </Link>
    </Card>
  );
}
