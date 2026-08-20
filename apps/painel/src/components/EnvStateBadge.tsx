import type { EnvState } from "@velozplanel/contracts";
import {
  CheckCircle2,
  PauseCircle,
  Loader2,
  AlertTriangle,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

type Tone = "success" | "warning" | "brand" | "danger" | "neutral";

interface StateMeta {
  tone: Tone;
  icon: LucideIcon;
  label: string;
  spin?: boolean;
}

/** Estado sempre com cor + ícone (Lucide SVG) + texto (nunca só cor). */
const STATE_META: Record<EnvState, StateMeta> = {
  running: { tone: "success", icon: CheckCircle2, label: "Ativo" },
  paused: { tone: "warning", icon: PauseCircle, label: "Pausado" },
  provisioning: { tone: "brand", icon: Loader2, label: "Provisionando", spin: true },
  error: { tone: "danger", icon: AlertTriangle, label: "Erro" },
  deleting: { tone: "neutral", icon: Trash2, label: "Excluindo" },
};

export function EnvStateBadge({ state }: { state: EnvState }) {
  const meta = STATE_META[state];
  const Icon = meta.icon;
  return (
    <Badge tone={meta.tone} aria-label={`Estado: ${meta.label}`}>
      <Icon
        size={13}
        aria-hidden="true"
        className={meta.spin ? "animate-spin" : undefined}
      />
      <span>{meta.label}</span>
    </Badge>
  );
}

export function envStateLabel(state: EnvState): string {
  return STATE_META[state].label;
}
