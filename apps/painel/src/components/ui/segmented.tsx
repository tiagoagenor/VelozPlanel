"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Micro-rótulo sob a opção (ex.: "LTS", "recomendada"). */
  hint?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  /** Rótulo acessível do grupo (obrigatório — vira aria-label). */
  label: string;
  /** Ou aponte para um título visível já existente. */
  labelledBy?: string;
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  /** Ocupa toda a largura, dividindo em colunas iguais. */
  fluid?: boolean;
  className?: string;
}

/**
 * Grupo de botões segmentados — substituto acessível do <select> (ADENDO 10).
 *
 * Padrão WAI-ARIA radiogroup:
 *  - wrapper role="radiogroup"; cada opção role="radio" + aria-checked;
 *  - UM único tab-stop (roving tabindex): só a opção marcada é focável por Tab;
 *  - setas ←/→ e ↑/↓ movem o foco E selecionam, com wrap (última→primeira);
 *  - Home/End vão à primeira/última opção habilitada;
 *  - opções desabilitadas são puladas pela navegação por setas;
 *  - selecionada = fundo roxo preenchido + texto branco (cor + estado + aria).
 */
export function SegmentedControl<T extends string>({
  label,
  labelledBy,
  value,
  onChange,
  options,
  fluid = false,
  className,
}: SegmentedControlProps<T>) {
  const enabled = options.filter((o) => !o.disabled);

  const focusAndSelect = (val: T) => {
    onChange(val);
    // Foca o botão recém-selecionado no próximo frame (após rerender do tabIndex).
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLButtonElement>(
        `[data-seg="${groupId}"][data-val="${val}"]`,
      );
      el?.focus();
    });
  };

  const groupId = React.useId();

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (enabled.length === 0) return;
    const idx = enabled.findIndex((o) => o.value === value);
    let next = idx;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = idx < 0 ? 0 : (idx + 1) % enabled.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = idx < 0 ? 0 : (idx - 1 + enabled.length) % enabled.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = enabled.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    const target = enabled[next];
    if (target) focusAndSelect(target.value);
  };

  // Foco entra na opção selecionada; se nenhuma, na primeira habilitada.
  const rovingValue =
    enabled.some((o) => o.value === value) ? value : enabled[0]?.value;

  return (
    <div
      role="radiogroup"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex gap-1 rounded-lg border border-border bg-surface p-1",
        fluid && "flex w-full",
        className,
      )}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={o.disabled || undefined}
            disabled={o.disabled}
            data-seg={groupId}
            data-val={o.value}
            tabIndex={o.value === rovingValue ? 0 : -1}
            onClick={() => !o.disabled && onChange(o.value)}
            className={cn(
              "flex flex-col items-center justify-center rounded-md px-4 py-2",
              "text-sm font-medium leading-tight transition-colors duration-150",
              fluid && "flex-1",
              o.disabled
                ? "cursor-not-allowed text-text3 opacity-50"
                : selected
                  ? "bg-brand text-on-solid shadow-sm"
                  : "text-link hover:bg-brand-soft",
            )}
          >
            <span>{o.label}</span>
            {o.hint ? (
              <span
                className={cn(
                  "mt-0.5 text-[11px] font-normal",
                  selected ? "text-on-solid/80" : "text-text3",
                )}
              >
                {o.hint}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
