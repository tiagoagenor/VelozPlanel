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
  Info,
} from "lucide-react";
import {
  hourlyActiveCents,
  hourlyPausedCents,
  type Environment,
  type EnvType,
  type Plan,
  type Balance,
  type CreditTransaction,
} from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { usePlans } from "@/lib/usePlans";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SegmentedControl } from "@/components/ui/segmented";
import { EnvStateBadge } from "@/components/EnvStateBadge";
import { CenterLoader } from "@/components/Skeletons";
import {
  formatCents,
  formatCentsFine,
  formatSignedCents,
  formatDateTime,
  formatEstimate,
} from "@/lib/format";

export default function FinanceiroPage() {
  const balanceQ = useQuery({ queryKey: ["balance"], queryFn: api.getBalance, staleTime: 30_000 });
  const envsQ = useQuery({ queryKey: ["environments"], queryFn: api.listEnvironments });
  const typesQ = useQuery({ queryKey: ["env-types-public"], queryFn: api.listServiceTypes });
  const { byId: plansById } = usePlans();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="flex items-center gap-2 text-[28px] font-bold leading-tight text-text">
          <Wallet size={24} aria-hidden="true" className="text-brand-strong" />
          Financeiro
        </h1>
        <p className="mt-1 text-sm text-text2">
          Saldo pré-pago, consumo de cada ambiente e histórico de lançamentos.
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
          <PerEnvUsage envs={envsQ.data ?? []} types={typesQ.data ?? []} plansById={plansById} loading={envsQ.isPending} />
          <TransactionList transactions={balanceQ.data.transactions} />
          <AddBalanceCard />
        </>
      )}
    </div>
  );
}

/* ─────────────── Faixa de estado ─────────────── */

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
    return (
      <Banner tone="warning">
        <span>Saldo baixo: no ritmo atual, dura <strong>~{days} {days === 1 ? "dia" : "dias"}</strong>.</span>
      </Banner>
    );
  }
  if (balance.estimateMonths == null && balance.balanceCents > 0) {
    return (
      <Banner tone="info">
        <span>Você não tem ambientes ativos — nada está sendo cobrado no momento.</span>
      </Banner>
    );
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

/* ─────────────── Resumo do saldo ─────────────── */

function BalanceSummary({ balance }: { balance: Balance }) {
  const negative = balance.balanceCents < 0;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card>
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-text3">
          <Wallet size={14} aria-hidden="true" /> Saldo total
        </div>
        <p className={cn("mt-1 text-[26px] font-bold tabular-nums", negative ? "text-danger" : "text-text")}>
          {formatCents(balance.balanceCents)}
        </p>
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
        <p className="mt-1 text-xs text-text2">
          ≈ {formatCents(Math.round(balance.monthlyBurnCents / 30))}/dia · {formatCentsFine(balance.monthlyBurnCents / 720)}/hora
        </p>
      </Card>

      <Card>
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-text3">
          <Clock size={14} aria-hidden="true" /> Duração estimada
        </div>
        <p className="mt-1 text-[26px] font-bold text-text">{formatEstimate(balance.estimateMonths)}</p>
        <p className="mt-1 text-xs text-text2">
          {balance.estimateMonths == null ? "sem ambiente ativo" : "no ritmo de consumo atual"}
        </p>
      </Card>
    </div>
  );
}

/* ─────────────── Consumo por ambiente ─────────────── */

type EnvCost = { monthCents: number | null; hourCents: number | null; note?: string };

function computeEnvCost(env: Environment, plansById: Map<string, Plan>, typeById: Map<string, EnvType>): EnvCost {
  const plan = plansById.get(env.plan);
  if (!plan) return { monthCents: null, hourCents: null };
  if (env.state === "running") {
    const adder = env.type ? typeById.get(env.type)?.priceMonthCents ?? 0 : 0;
    return { monthCents: plan.priceMonthCents + adder, hourCents: hourlyActiveCents(plan, adder) };
  }
  if (env.state === "paused") {
    const hour = hourlyPausedCents(plan);
    return { monthCents: Math.round(hour * 720), hourCents: hour, note: "pausado · só disco" };
  }
  return { monthCents: null, hourCents: null };
}

function PerEnvUsage({
  envs,
  types,
  plansById,
  loading,
}: {
  envs: Environment[];
  types: EnvType[];
  plansById: Map<string, Plan>;
  loading: boolean;
}) {
  const typeById = React.useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
  const rows = envs.map((env) => ({ env, cost: computeEnvCost(env, plansById, typeById) }));
  const totalMonth = rows.reduce((s, r) => s + (r.cost.monthCents ?? 0), 0);

  return (
    <Card className="p-0">
      <div className="flex items-center gap-2 px-5 pt-5">
        <Server size={18} aria-hidden="true" className="text-text3" />
        <h2 className="text-sm font-semibold text-text">Consumo por ambiente</h2>
      </div>
      <p className="px-5 pb-3 pt-1 text-xs text-text3">
        Ativo cobra o plano (+ adicional do tipo); pausado cobra só o disco. Valores estimados.
      </p>
      {loading ? (
        <div className="m-5 mt-0 h-24 animate-pulse rounded-lg bg-bg" />
      ) : rows.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-text2">Você ainda não tem ambientes.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] border-collapse text-sm">
            <caption className="sr-only">Custo estimado de cada ambiente por mês e por hora.</caption>
            <thead>
              <tr className="border-y border-border-subtle bg-bg text-left text-text3">
                <th scope="col" className="px-5 py-2.5 font-semibold">Ambiente</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Plano</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Estado</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">R$/mês</th>
                <th scope="col" className="px-5 py-2.5 text-right font-semibold">R$/hora</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ env, cost }) => (
                <tr key={env.id} className="border-b border-border-subtle last:border-0 hover:bg-bg">
                  <td className="px-5 py-3">
                    <Link href={`/env/${env.id}`} className="font-medium text-link hover:underline">{env.name}</Link>
                    {cost.note ? <span className="ml-2 text-xs text-text3">{cost.note}</span> : null}
                  </td>
                  <td className="px-3 py-3 text-text2">{plansById.get(env.plan)?.label ?? env.plan}</td>
                  <td className="px-3 py-3"><EnvStateBadge state={env.state} /></td>
                  <td className="px-3 py-3 text-right tabular-nums text-text">{cost.monthCents == null ? "—" : formatCents(cost.monthCents)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-text2">{cost.hourCents == null ? "—" : formatCentsFine(cost.hourCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border-subtle bg-bg font-semibold">
                <td className="px-5 py-3 text-text" colSpan={3}>Total das máquinas</td>
                <td className="px-3 py-3 text-right tabular-nums text-text">{formatCents(totalMonth)}</td>
                <td className="px-5 py-3 text-right tabular-nums text-text2">{formatCentsFine(totalMonth / 720)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ─────────────── Extrato ─────────────── */

type Filter = "recargas" | "consumo" | "tudo";

function isEntry(kind: string): boolean {
  return kind === "admin_money" || kind === "admin_bonus" || kind === "admin_credit";
}
function localDayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dayLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

type DayGroup = { day: string; iso: string; totalCents: number; items: CreditTransaction[] };

function TransactionList({ transactions }: { transactions: CreditTransaction[] }) {
  const [filter, setFilter] = React.useState<Filter>("recargas");
  const [limit, setLimit] = React.useState(20);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  React.useEffect(() => setLimit(20), [filter]);

  // Constrói as "linhas" conforme o filtro. `usage` sempre agrupado por dia.
  const rows = React.useMemo(() => {
    const nonUsage = transactions.filter((t) => t.kind !== "usage");
    const usage = transactions.filter((t) => t.kind === "usage");
    const byDay = new Map<string, DayGroup>();
    for (const t of usage) {
      const key = localDayKey(t.createdAt);
      const g = byDay.get(key) ?? { day: key, iso: t.createdAt, totalCents: 0, items: [] };
      g.totalCents += t.amountCents;
      g.items.push(t);
      if (t.createdAt > g.iso) g.iso = t.createdAt; // mais recente do dia = ordena
      byDay.set(key, g);
    }
    const groups = [...byDay.values()];
    let list: Array<{ kind: "tx"; tx: CreditTransaction } | { kind: "day"; group: DayGroup }> = [];
    if (filter === "recargas") list = nonUsage.map((tx) => ({ kind: "tx", tx }));
    else if (filter === "consumo") list = groups.map((group) => ({ kind: "day", group }));
    else
      list = [
        ...nonUsage.map((tx) => ({ kind: "tx" as const, tx })),
        ...groups.map((group) => ({ kind: "day" as const, group })),
      ];
    // ordena desc pela data (tx.createdAt ou o mais recente do dia)
    return list.sort((a, b) => {
      const da = a.kind === "tx" ? a.tx.createdAt : a.group.iso;
      const db = b.kind === "tx" ? b.tx.createdAt : b.group.iso;
      return db.localeCompare(da);
    });
  }, [transactions, filter]);

  const shown = rows.slice(0, limit);

  function toggle(day: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <h2 className="text-sm font-semibold text-text">Extrato</h2>
        <SegmentedControl
          label="Filtrar lançamentos"
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
          options={[
            { value: "recargas", label: "Recargas" },
            { value: "consumo", label: "Consumo" },
            { value: "tudo", label: "Tudo" },
          ]}
        />
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-text2">Nenhum lançamento nesta visão.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border-subtle">
          {shown.map((row) =>
            row.kind === "tx" ? (
              <TxRow key={row.tx.id} tx={row.tx} />
            ) : (
              <DayRow key={row.group.day} group={row.group} open={expanded.has(row.group.day)} onToggle={() => toggle(row.group.day)} />
            ),
          )}
        </ul>
      )}

      {rows.length > limit ? (
        <div className="border-t border-border-subtle p-4 text-center">
          <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + 20)}>Ver mais</Button>
        </div>
      ) : null}
    </Card>
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
  const isDomain = tx.kind === "usage" && (tx.reason ?? "").toLowerCase().startsWith("domínio");
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", positive ? "bg-success/12 text-success" : "bg-danger/10 text-danger")}>
        {isDomain ? <Globe size={16} aria-hidden="true" /> : meta.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium text-text">
          {meta.label}
          {meta.bonus ? <Badge tone="success">bônus</Badge> : null}
        </p>
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
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-danger/10 text-danger">
          <Server size={16} aria-hidden="true" />
        </span>
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
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
          <Info size={18} aria-hidden="true" />
        </span>
        <div>
          <p className="font-semibold text-text">Adicionar saldo</p>
          <p className="mt-0.5 text-sm text-text2">
            As recargas são feitas pela nossa equipe. Fale com o suporte para adicionar saldo à sua conta.
          </p>
        </div>
      </div>
      <Link
        href="/suporte"
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-strong"
      >
        <LifeBuoy size={16} aria-hidden="true" /> Falar com suporte
      </Link>
    </Card>
  );
}
