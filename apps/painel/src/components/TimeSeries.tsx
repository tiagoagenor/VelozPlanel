"use client";

import * as React from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

export interface TimeSeriesProps {
  /** Timestamps em epoch ms. */
  timestamps: number[];
  /** Valores da série, mesmo comprimento de timestamps. */
  values: number[];
  /** Rótulo da série (usado na legenda/tooltip). */
  label: string;
  /** Papel de cor semântica → lê o token CSS correspondente. */
  tone?: "brand" | "info" | "success" | "warning" | "danger";
  /** Formata o valor do eixo Y e da legenda. */
  format?: (v: number | null) => string;
  height?: number;
}

const TONE_VAR: Record<NonNullable<TimeSeriesProps["tone"]>, string> = {
  brand: "--vp-brand",
  info: "--vp-info",
  success: "--vp-success",
  warning: "--vp-warning",
  danger: "--vp-danger",
};

function readVar(el: HTMLElement, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Envoltório reutilizável de uPlot.
 * - Redesenha no resize (ResizeObserver) e limpa a instância no unmount.
 * - Lê as cores do tema a partir dos tokens CSS, então funciona claro/escuro.
 * - Acompanha uma tabela textual visualmente oculta (alternativa ao canvas).
 */
export function TimeSeries({
  timestamps,
  values,
  label,
  tone = "brand",
  format = (v) => (v == null ? "—" : String(v)),
  height = 220,
}: TimeSeriesProps) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const plotRef = React.useRef<uPlot | null>(null);
  const tableId = React.useId();

  // Dados em formato uPlot: x em segundos.
  const data: uPlot.AlignedData = React.useMemo(() => {
    const xs = timestamps.map((t) => t / 1000);
    return [xs, values];
  }, [timestamps, values]);

  React.useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const stroke = readVar(wrap, TONE_VAR[tone], "#0a46b8");
    const axisColor = readVar(wrap, "--vp-text-3", "#46505f");
    const gridColor = readVar(wrap, "--vp-border-subtle", "#dde3ea");

    const opts: uPlot.Options = {
      width: wrap.clientWidth || 600,
      height,
      // Sem título desenhado no canvas; o <h3> em volta cumpre esse papel.
      legend: { show: true },
      cursor: { drag: { x: true, y: false } },
      scales: { x: { time: true } },
      axes: [
        {
          stroke: axisColor,
          grid: { stroke: gridColor, width: 1 },
          ticks: { stroke: gridColor },
          font: "12px ui-sans-serif, system-ui, sans-serif",
        },
        {
          stroke: axisColor,
          grid: { stroke: gridColor, width: 1 },
          ticks: { stroke: gridColor },
          font: "12px ui-sans-serif, system-ui, sans-serif",
          values: (_u, splits) => splits.map((v) => format(v)),
        },
      ],
      series: [
        {
          label: "Tempo",
          value: (_u, ts) =>
            ts == null
              ? "—"
              : new Date(ts * 1000).toLocaleTimeString("pt-BR"),
        },
        {
          label,
          stroke,
          width: 2,
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
    // Recria o gráfico quando muda tom/altura; dados são tratados abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tone, height]);

  // Atualiza os dados sem recriar a instância.
  React.useEffect(() => {
    plotRef.current?.setData(data);
  }, [data]);

  return (
    <figure className="m-0">
      <div ref={wrapRef} className="w-full" style={{ minHeight: height }} />
      {/* Alternativa textual ao <canvas> (WCAG 1.4.9): tabela oculta. */}
      <figcaption className="sr-only" id={tableId}>
        Série {label} com {values.length} amostras.
      </figcaption>
    </figure>
  );
}
