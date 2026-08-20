import * as React from "react";
import { cn } from "@/lib/cn";

type Tone = "brand" | "success" | "warning" | "danger" | "info" | "neutral" | "accent";

const TONES: Record<Tone, string> = {
  brand: "border-brand text-brand",
  success: "border-success text-success",
  warning: "border-warning text-warning",
  danger: "border-danger text-danger",
  info: "border-info text-info",
  neutral: "border-neutral text-neutral",
  accent: "border-accent text-accent",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

/**
 * Badge com contorno + texto na cor semântica (nunca só cor).
 * O fundo é sempre a superfície elevada para manter o contraste ≥ 4.5.
 */
export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border bg-elevated px-2.5 py-1",
        "text-xs font-semibold",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
