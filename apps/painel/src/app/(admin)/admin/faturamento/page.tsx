"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Clock,
  PlayCircle,
  PauseCircle,
  Server,
  Wallet,
  Loader2,
  History,
  type LucideIcon,
} from "lucide-react";
import type { BillingSettings } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatCents, formatDateTime } from "@/lib/format";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { CenterLoader } from "@/components/Skeletons";

const BILLING_KEY = ["admin", "billing"] as const;

export default function AdminBillingPage() {
  const q = useQuery({
    queryKey: BILLING_KEY,
    queryFn: api.getBilling,
    // Mantém o painel de status "vivo": refaz a busca a cada 15 s.
    refetchInterval: 15_000,
  });

  return (
    <>
      <header className="mb-6">
        <h1 className="text-[28px] font-bold leading-tight text-text">
          Faturamento
        </h1>
        <p className="mt-1 text-sm text-text2">
          Configure o cron que cobra os clientes pela hora de uso dos ambientes.
        </p>
      </header>

      {q.isPending ? (
        <CenterLoader minHeight="40vh" />
      ) : q.isError ? (
        <Card className="flex items-start gap-3">
          <AlertTriangle
            size={20}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-danger"
          />
          <p role="alert" className="font-medium text-text">
            Não foi possível carregar a configuração de cobrança.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <ConfigCard settings={q.data} />
            <StatusCard settings={q.data} />
          </div>
          <HistoryCard />
        </div>
      )}
    </>
  );
}

/* ─────────────── Histórico (rollup por hora) ─────────────── */

function HistoryCard() {
  const q = useQuery({
    queryKey: ["admin", "billing-runs"],
    queryFn: api.listBillingRuns,
    refetchInterval: 30_000,
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <History size={18} aria-hidden="true" className="text-text3" />
          <CardTitle>Histórico por hora</CardTitle>
        </div>
        <CardDescription>
          Cada linha resume uma hora de execuções do cron (as últimas 72 h). Mantém o log
          compacto mesmo rodando de poucos em poucos minutos.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {q.isPending ? (
          <div className="h-24 animate-pulse rounded-lg bg-bg" />
        ) : q.isError ? (
          <p role="alert" className="text-sm text-danger">Não foi possível carregar o histórico.</p>
        ) : q.data.length === 0 ? (
          <p className="text-sm text-text2">Nenhuma execução ainda. Assim que o cron rodar, o histórico aparece aqui.</p>
        ) : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <caption className="sr-only">Execuções de cobrança agrupadas por hora.</caption>
              <thead>
                <tr className="border-b border-border-subtle text-left text-text3">
                  <th scope="col" className="px-3 py-2 font-semibold">Hora</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Execuções</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Instâncias</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Cobrado</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Suspensas</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((r) => (
                  <tr key={r.hour} className="border-b border-border-subtle last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 text-text">{formatHour(r.hour)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text2">
                      {r.runs}
                      {r.errors > 0 ? <span className="ml-1 text-danger" title={`${r.errors} com erro`}>⚠</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-text2">{r.instances}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text">{formatCents(r.chargedCents)}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", r.suspended > 0 ? "font-medium text-danger" : "text-text3")}>{r.suspended}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** "23/08 14h" — rótulo curto da hora (fuso local). */
function formatHour(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const hour = String(d.getHours()).padStart(2, "0");
  return `${day}/${month} ${hour}h`;
}

/* ─────────────── Toggle acessível ─────────────── */

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full",
        "transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-brand" : "bg-border",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-surface shadow transition-transform duration-150",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text">{title}</p>
        <p className="mt-0.5 text-sm text-text2">{description}</p>
      </div>
      <Toggle
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        label={title}
      />
    </div>
  );
}

/* ─────────────── Cartão de configuração ─────────────── */

function ConfigCard({ settings }: { settings: BillingSettings }) {
  const qc = useQueryClient();
  const toast = useToast();

  const [enabled, setEnabled] = React.useState(settings.enabled);
  const [suspendOnZero, setSuspendOnZero] = React.useState(
    settings.suspendOnZero,
  );
  const [intervalStr, setIntervalStr] = React.useState(
    String(settings.intervalMinutes),
  );
  const [freeStr, setFreeStr] = React.useState(String(settings.freeMinutes));
  const [domainPriceStr, setDomainPriceStr] = React.useState(
    (settings.domainPriceMonthCents / 100).toFixed(2),
  );

  const parsedInterval = Number.parseInt(intervalStr, 10);
  const intervalValid =
    Number.isFinite(parsedInterval) &&
    parsedInterval >= 1 &&
    parsedInterval <= 1440;

  const parsedFree = Number.parseInt(freeStr, 10);
  const freeValid = Number.isFinite(parsedFree) && parsedFree >= 0 && parsedFree <= 1440;

  const parsedDomainCents = Math.round(
    Number.parseFloat(domainPriceStr.replace(",", ".")) * 100,
  );
  const domainPriceValid = Number.isFinite(parsedDomainCents) && parsedDomainCents >= 0;

  const dirty =
    enabled !== settings.enabled ||
    suspendOnZero !== settings.suspendOnZero ||
    (intervalValid && parsedInterval !== settings.intervalMinutes) ||
    (freeValid && parsedFree !== settings.freeMinutes) ||
    (domainPriceValid && parsedDomainCents !== settings.domainPriceMonthCents);

  const save = useMutation({
    mutationFn: () =>
      api.updateBilling({
        enabled,
        suspendOnZero,
        intervalMinutes: parsedInterval,
        freeMinutes: parsedFree,
        domainPriceMonthCents: parsedDomainCents,
      }),
    onSuccess: (data) => {
      qc.setQueryData(BILLING_KEY, data);
      toast.show("success", "Configuração de cobrança salva.");
    },
    onError: () => {
      toast.show("error", "Não foi possível salvar a configuração.");
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuração</CardTitle>
        <CardDescription>
          Liga/desliga o cron, define a frequência e o comportamento quando o
          saldo do cliente zera.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ToggleRow
          title="Cobrança automática ligada"
          description="Quando ligada, o cron debita os clientes no intervalo definido abaixo."
          checked={enabled}
          onChange={setEnabled}
          disabled={save.isPending}
        />

        <div className="border-t border-border-subtle" />

        <div>
          <Label htmlFor="billing-interval">Rodar a cada (minutos)</Label>
          <Input
            id="billing-interval"
            type="number"
            min={1}
            max={1440}
            step={1}
            inputMode="numeric"
            value={intervalStr}
            onChange={(e) => setIntervalStr(e.target.value)}
            disabled={save.isPending}
            aria-invalid={!intervalValid}
            aria-describedby="billing-interval-hint"
            className="mt-1.5 max-w-[10rem]"
          />
          <p
            id="billing-interval-hint"
            className={cn(
              "mt-1 text-xs",
              intervalValid ? "text-text3" : "text-danger",
            )}
          >
            {intervalValid
              ? "Mínimo 1 minuto, máximo 1440 (24 h)."
              : "Informe um número inteiro entre 1 e 1440."}
          </p>
        </div>

        <div className="border-t border-border-subtle" />

        <div>
          <Label htmlFor="billing-free">Cortesia ao deletar (minutos)</Label>
          <Input
            id="billing-free"
            type="number"
            min={0}
            max={1440}
            step={1}
            inputMode="numeric"
            value={freeStr}
            onChange={(e) => setFreeStr(e.target.value)}
            disabled={save.isPending}
            aria-invalid={!freeValid}
            aria-describedby="billing-free-hint"
            className="mt-1.5 max-w-[10rem]"
          />
          <p
            id="billing-free-hint"
            className={cn("mt-1 text-xs", freeValid ? "text-text3" : "text-danger")}
          >
            {freeValid
              ? "Ambiente com MENOS de X minutos de vida não é cobrado ao ser deletado (protege delete acidental). 0 = sem cortesia."
              : "Informe um número inteiro entre 0 e 1440."}
          </p>
        </div>

        <div className="border-t border-border-subtle" />

        <div>
          <Label htmlFor="domain-price">Gerência por domínio (R$/mês)</Label>
          <Input
            id="domain-price"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={domainPriceStr}
            onChange={(e) => setDomainPriceStr(e.target.value)}
            disabled={save.isPending}
            aria-invalid={!domainPriceValid}
            aria-describedby="domain-price-hint"
            className="mt-1.5 max-w-[10rem]"
          />
          <p
            id="domain-price-hint"
            className={cn("mt-1 text-xs", domainPriceValid ? "text-text3" : "text-danger")}
          >
            {domainPriceValid
              ? "Cobrado por mês de cada domínio do cliente (rateado por hora). 0 = grátis."
              : "Informe um valor em reais (ex.: 1,00)."}
          </p>
        </div>

        <div className="border-t border-border-subtle" />

        <ToggleRow
          title="Suspender o ambiente quando o saldo do cliente zerar"
          description="Se o saldo chegar a zero, os ambientes do cliente são pausados automaticamente."
          checked={suspendOnZero}
          onChange={setSuspendOnZero}
          disabled={save.isPending}
        />

        <p className="rounded-lg bg-bg px-3 py-2.5 text-xs leading-relaxed text-text2">
          A cobrança debita do saldo de cada cliente a tarifa do plano por hora
          de uso (ativo cobra o preço do plano; pausado cobra só o disco).
          Quando o saldo zera e a opção estiver ligada, os ambientes do cliente
          são pausados.
        </p>

        {enabled ? (
          <p
            role="note"
            className="vp-pill vp-pill-warning flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium leading-relaxed"
          >
            <AlertTriangle
              size={15}
              aria-hidden="true"
              className="mt-0.5 shrink-0"
            />
            <span>
              A cobrança automática está ATIVA — clientes serão debitados a cada{" "}
              {settings.intervalMinutes}{" "}
              {settings.intervalMinutes === 1 ? "minuto" : "minutos"}.
            </span>
          </p>
        ) : null}
      </CardContent>

      <CardFooter>
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending || !dirty || !intervalValid || !domainPriceValid}
        >
          {save.isPending ? (
            <>
              <Loader2 size={16} aria-hidden="true" className="animate-spin" />
              Salvando…
            </>
          ) : (
            "Salvar"
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}

/* ─────────────── Cartão de status ─────────────── */

function StatItem({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"
      >
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-text3">
          {label}
        </p>
        <p className="mt-0.5 font-semibold text-text">{value}</p>
      </div>
    </div>
  );
}

function StatusCard({ settings }: { settings: BillingSettings }) {
  const qc = useQueryClient();
  const toast = useToast();

  const run = useMutation({
    mutationFn: api.runBillingNow,
    onSuccess: (data) => {
      qc.setQueryData(BILLING_KEY, data);
      toast.show(
        "success",
        `Cobrança executada. Debitado hoje: ${formatCents(
          data.chargedTodayCents,
        )}.`,
      );
    },
    onError: () => {
      toast.show("error", "Não foi possível rodar a cobrança agora.");
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Status</CardTitle>
          {settings.running ? (
            <Badge tone="info">
              <Loader2 size={12} aria-hidden="true" className="animate-spin" />
              Executando
            </Badge>
          ) : settings.enabled ? (
            <Badge tone="success">Ativa</Badge>
          ) : (
            <Badge tone="neutral">Desligada</Badge>
          )}
        </div>
        <CardDescription>
          Estado atual do cron (atualiza automaticamente).
        </CardDescription>
      </CardHeader>

      <CardContent>
        <StatItem
          icon={Clock}
          label="Última execução"
          value={
            settings.lastRunAt
              ? `${formatDateTime(settings.lastRunAt)}${settings.lastOk === false ? " · com erro" : ""}`
              : "nunca"
          }
        />
        <StatItem
          icon={Server}
          label="Instâncias cobráveis (última)"
          value={settings.lastInstances != null ? String(settings.lastInstances) : "—"}
        />
        <StatItem
          icon={PauseCircle}
          label="Suspensas na última"
          value={settings.lastSuspended != null ? String(settings.lastSuspended) : "—"}
        />
        <StatItem
          icon={PlayCircle}
          label="Próxima execução"
          value={
            settings.enabled && settings.nextRunAt
              ? formatDateTime(settings.nextRunAt)
              : "—"
          }
        />
        <StatItem
          icon={Wallet}
          label="Debitado hoje"
          value={formatCents(settings.chargedTodayCents)}
        />
      </CardContent>

      <CardFooter>
        <Button
          variant="outline"
          onClick={() => run.mutate()}
          disabled={run.isPending || settings.running}
        >
          {run.isPending ? (
            <>
              <Loader2 size={16} aria-hidden="true" className="animate-spin" />
              Rodando…
            </>
          ) : (
            <>
              <PlayCircle size={16} aria-hidden="true" />
              Rodar agora
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
