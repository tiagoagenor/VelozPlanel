import * as React from "react";
import { Cpu, MemoryStick, HardDrive, type LucideIcon } from "lucide-react";
import type { PlanSpec } from "@velozplanel/contracts";
import { cn } from "@/lib/cn";

type Tone = "cpu" | "ram" | "disk";

const FILL: Record<Tone, string> = {
  cpu: "bg-brand",
  ram: "bg-info",
  disk: "bg-warning",
};

/**
 * Barra horizontal de uso com rótulo (ícone + nome) à esquerda e valor à
 * direita. Cor + ícone + texto (nunca só cor). pct clampado em 0..100.
 */
export function MeterBar({
  icon: Icon,
  label,
  pct,
  valueText,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  pct: number | null;
  valueText: string;
  tone: Tone;
}) {
  const clamped = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 font-medium text-text2">
          <Icon size={14} aria-hidden="true" className="text-text3" />
          {label}
        </span>
        <span className="tabular-nums text-text2">{valueText}</span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-border-subtle"
        role="img"
        aria-label={`${label}: ${valueText}`}
      >
        {pct == null ? null : (
          <div
            className={cn("h-full rounded-full", FILL[tone])}
            style={{ width: `${clamped}%` }}
          />
        )}
      </div>
    </div>
  );
}

/** Chips com os recursos do plano (vCPU · RAM · Disco). */
export function PlanChips({ plan }: { plan: PlanSpec }) {
  const chips: { icon: LucideIcon; text: string }[] = [
    { icon: Cpu, text: `${plan.vcpu} vCPU` },
    { icon: MemoryStick, text: `${plan.memMb} MB` },
    { icon: HardDrive, text: `${plan.diskGb} GB` },
  ];
  return (
    <ul className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <li
          key={c.text}
          className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-bg px-2 py-1 text-xs font-medium text-text2"
        >
          <c.icon size={13} aria-hidden="true" className="text-text3" />
          {c.text}
        </li>
      ))}
    </ul>
  );
}
