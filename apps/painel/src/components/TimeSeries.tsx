"use client";

import * as React from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

export interface TimeSeriesProps {
  /** Timestamps em epoch ms. */
  timestamps: number[];
  /** Valores da série, mesmo comprimento de timestamps. */
  values: number[];
  /** Rótulo da série (usado na tooltip e na tabela oculta). */
  label: string;
  /** Papel de cor semântica → lê o token CSS correspondente. */
  tone?: "brand" | "info" | "success" | "warning" | "danger" | "cpu" | "mem";
  /** Formata o valor (cabeçalho, eixo Y e tooltip). */
  format?: (v: number | null) => string;
  height?: number;
  /** Mostra o cabeçalho interno (valor atual + horário). Padrão: true. */
  showHeader?: boolean;
  /** Valor do LIMITE: desenha uma linha tracejada e trava o topo do eixo Y nele. */
  limit?: number | null;
  /** Rótulo mostrado na linha do limite (ex.: "limite 100%"). */
  limitLabel?: string;
}

const TONE_VAR: Record<NonNullable<TimeSeriesProps["tone"]>, string> = {
  brand: "--vp-brand",
  info: "--vp-info",
  success: "--vp-success",
  warning: "--vp-warning",
  danger: "--vp-danger",
  cpu: "--vp-chart-cpu",
  mem: "--vp-chart-mem",
};

function readVar(el: HTMLElement, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Envoltório reutilizável de uPlot.
 * - Cabeçalho com o VALOR ATUAL (grande) + horário da última amostra — no lugar
 *   da legenda crua do uPlot (que mostrava "Tempo: —  CPU %: —").
 * - Redesenha no resize (ResizeObserver) e limpa a instância no unmount.
 * - Lê as cores do tema a partir dos tokens CSS (funciona claro/escuro).
 * - Acompanha uma tabela textual visualmente oculta (alternativa ao canvas).
 */
export function TimeSeries({
  timestamps,
  values,
  label,
  tone = "brand",
  format = (v) => (v == null ? "—" : String(v)),
  height = 200,
  showHeader = true,
  limit = null,
  limitLabel,
}: TimeSeriesProps) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const plotRef = React.useRef<uPlot | null>(null);
  const tableId = React.useId();

  const lastValue = values.length ? values[values.length - 1]! : null;
  const lastTs = timestamps.length ? timestamps[timestamps.length - 1]! : null;
  const lastTimeText =
    lastTs == null
      ? "—"
      : new Date(lastTs).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
          timeZone: "America/Sao_Paulo",
        });

  // Dados em formato uPlot: x em segundos.
  const data: uPlot.AlignedData = React.useMemo(() => {
    const xs = timestamps.map((t) => t / 1000);
    return [xs, values];
  }, [timestamps, values]);

  React.useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const stroke = readVar(wrap, TONE_VAR[tone], "#6d28d9");
    const axisColor = readVar(wrap, "--vp-text-3", "#46505f");
    const gridColor = readVar(wrap, "--vp-border-subtle", "#dde3ea");
    const limitColor = readVar(wrap, "--vp-danger", "#dc2626");

    // Com limite: o topo do eixo Y é fixado no limite (com 8% de folga) para a
    // linha caber e o usuário ver o quanto o uso está perto dela.
    const yScale: uPlot.Scale =
      limit != null && limit > 0
        ? {
            range: (_u, _min, dmax) => {
              const top = Math.max(limit, dmax ?? 0);
              return [0, top > 0 ? top * 1.08 : 1];
            },
          }
        : {};

    const opts: uPlot.Options = {
      width: wrap.clientWidth || 600,
      height,
      // Legenda crua desligada: o cabeçalho React mostra o valor atual.
      legend: { show: false },
      cursor: { drag: { x: true, y: false }, points: { size: 6 } },
      scales: { x: { time: true }, y: yScale },
      hooks:
        limit != null && limit > 0
          ? {
              draw: [
                (u) => {
                  const ctx = u.ctx;
                  const dpr = (uPlot as unknown as { pxRatio?: number }).pxRatio || window.devicePixelRatio || 1;
                  const y = u.valToPos(limit, "y", true);
                  const x0 = u.bbox.left;
                  const x1 = u.bbox.left + u.bbox.width;
                  ctx.save();
                  ctx.strokeStyle = limitColor;
                  ctx.lineWidth = 1.5 * dpr;
                  ctx.setLineDash([6 * dpr, 4 * dpr]);
                  ctx.beginPath();
                  ctx.moveTo(x0, y);
                  ctx.lineTo(x1, y);
                  ctx.stroke();
                  ctx.setLineDash([]);
                  ctx.fillStyle = limitColor;
                  ctx.font = `${11 * dpr}px ui-sans-serif, system-ui, sans-serif`;
                  ctx.textBaseline = "bottom";
                  ctx.textAlign = "left";
                  ctx.fillText(limitLabel ?? "limite", x0 + 6 * dpr, y - 3 * dpr);
                  ctx.restore();
                },
              ],
            }
          : {},
      axes: [
        {
          stroke: axisColor,
          grid: { stroke: gridColor, width: 1 },
          ticks: { stroke: gridColor },
          font: "12px ui-sans-serif, system-ui, sans-serif",
          // Horário 24h do Brasil (sem "am/pm"). splits vêm em segundos.
          values: (_u, splits) =>
            splits.map((t) =>
              new Date(t * 1000).toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
                timeZone: "America/Sao_Paulo",
              }),
            ),
        },
        {
          stroke: axisColor,
          grid: { stroke: gridColor, width: 1 },
          ticks: { stroke: gridColor },
          font: "12px ui-sans-serif, system-ui, sans-serif",
          size: 68,
          values: (_u, splits) => splits.map((v) => format(v)),
        },
      ],
      series: [
        { label: "Tempo" },
        {
          label,
          stroke,
          width: 2,
          fill: (u) => {
            const g = u.ctx.createLinearGradient(0, 0, 0, height);
            g.addColorStop(0, stroke + "22");
            g.addColorStop(1, stroke + "00");
            return g;
          },
          points: { show: false },
          value: (_u, v) => format(v),
        },
      ],
    };

    const plot = new uPlot(opts, data, wrap);
    plotRef.current = plot;

    const ro = new ResizeObserver(() => {
      plot.setSize({ width: wrap.clientWidth || 600, height });
    });
    ro.observe(wrap);

    return () => {
      ro.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
    // Recria o gráfico quando muda tom/altura/limite; dados são tratados abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tone, height, limit, limitLabel]);

  // Atualiza os dados sem recriar a instância.
  React.useEffect(() => {
    plotRef.current?.setData(data);
  }, [data]);

  return (
    <figure className="m-0">
      {showHeader ? (
        <div className="mb-3 flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums text-text">
            {format(lastValue)}
          </span>
          <span className="text-xs text-text3">
            agora · última amostra às {lastTimeText}
          </span>
        </div>
      ) : null}
      <div ref={wrapRef} className="w-full" style={{ minHeight: height }} />
      {/* Alternativa textual ao <canvas> (WCAG 1.4.9). */}
      <figcaption className="sr-only" id={tableId}>
        Série {label}: {values.length} amostras, valor atual {format(lastValue)}.
      </figcaption>
    </figure>
  );
}
