import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

type Tone = "brand" | "success" | "warning" | "info" | "neutral";

const ICON_TONE: Record<Tone, string> = {
  brand: "bg-brand-soft text-brand-strong",
  success: "vp-pill-success",
  warning: "vp-pill-warning",
  info: "vp-pill-info",
  neutral: "vp-pill-neutral",
};

/**
 * Cartão de KPI: rótulo mudo, número grande e ícone com cor semântica.
 * Cores/ícones distintos por card (nunca clones — checklist anti-IA).
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "brand",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon: LucideIcon;
  tone?: Tone;
}) {
  return (
    <div className="vp-card-shadow flex items-start gap-4 rounded-xl border border-border-subtle bg-surface p-5">
      <span
        aria-hidden="true"
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-lg",
          tone === "brand" ? ICON_TONE.brand : cn("vp-pill", ICON_TONE[tone]),
        )}
      >
        <Icon size={20} />
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-text3">{label}</p>
        <p className="mt-0.5 text-2xl font-bold leading-tight text-text">
          {value}
        </p>
        {hint ? <p className="mt-0.5 text-xs text-text3">{hint}</p> : null}
      </div>
    </div>
  );
}
