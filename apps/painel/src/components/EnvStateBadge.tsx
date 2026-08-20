import type { EnvState } from "@velozplanel/contracts";
import { Badge } from "@/components/ui/badge";

type Tone = "success" | "warning" | "brand" | "danger" | "neutral";

interface StateMeta {
  tone: Tone;
  icon: string;
  label: string;
}

/** Estado sempre com cor + ícone + texto (nunca só cor). */
const STATE_META: Record<EnvState, StateMeta> = {
  running: { tone: "success", icon: "✓", label: "Ativo" },
  paused: { tone: "warning", icon: "⏸", label: "Pausado" },
  provisioning: { tone: "brand", icon: "⏳", label: "Provisionando" },
  error: { tone: "danger", icon: "⚠", label: "Erro" },
  deleting: { tone: "neutral", icon: "🗑", label: "Excluindo" },
};

export function EnvStateBadge({ state }: { state: EnvState }) {
  const meta = STATE_META[state];
  return (
    <Badge tone={meta.tone} aria-label={`Estado: ${meta.label}`}>
      <span aria-hidden="true">{meta.icon}</span>
      <span>{meta.label}</span>
    </Badge>
  );
}

export function envStateLabel(state: EnvState): string {
  return STATE_META[state].label;
}
