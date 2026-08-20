import * as React from "react";
import { Clock, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * Tela "Em breve" honesta (não 404, não tela vazia): ícone grande esmaecido,
 * título, um parágrafo do que virá e um badge. Passa profissionalismo e
 * mostra o roadmap sem parecer quebrado (ver UX-REFERENCIAS §2.1 e §5.9).
 */
export function ComingSoon({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <section className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center">
      <span
        aria-hidden="true"
        className="mb-6 grid h-16 w-16 place-items-center rounded-2xl bg-brand-soft text-brand-strong"
      >
        <Icon size={32} strokeWidth={1.75} />
      </span>
      <div className="mb-3">
        <Badge tone="neutral">
          <Clock size={13} aria-hidden="true" />
          <span>Em breve</span>
        </Badge>
      </div>
      <h1 className="mb-2 text-2xl font-bold text-text">{title}</h1>
      <p className="text-sm leading-relaxed text-text2">{description}</p>
    </section>
  );
}
