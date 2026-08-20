import * as React from "react";
import { cn } from "@/lib/cn";

type Tone = "brand" | "success" | "warning" | "danger" | "info" | "neutral" | "accent";

const TONES: Record<Tone, string> = {
  brand: "vp-pill vp-pill-brand",
  success: "vp-pill vp-pill-success",
  warning: "vp-pill vp-pill-warning",
  danger: "vp-pill vp-pill-danger",
  info: "vp-pill vp-pill-info",
  neutral: "vp-pill vp-pill-neutral",
  accent: "vp-pill vp-pill-accent",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

/**
 * Pílula de estado: fundo suave + texto escuro na cor semântica + borda
 * (nunca só cor). Todo par texto/fundo passa AA (≥ 4,5:1) — ver globals.css.
 */
export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
        "text-xs font-semibold",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
