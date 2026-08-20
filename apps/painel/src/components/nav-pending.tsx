"use client";

import * as React from "react";
import { useLinkStatus } from "next/link";
import { Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Ícone do item de navegação com feedback de "pending" imediato.
 *
 * Deve ser renderizado DENTRO de um <Link> (next/link). O hook useLinkStatus()
 * do Next 15 reporta `pending` no instante do clique, enquanto a próxima rota
 * ainda carrega/compila — aí trocamos o ícone por um spinner (loader-2 girando).
 * Assim o clique dá retorno visual na hora, sem esperar a nova tela.
 */
export function NavIcon({
  icon: Icon,
  size = 20,
  active,
}: {
  icon: LucideIcon;
  size?: number;
  active: boolean;
}) {
  const { pending } = useLinkStatus();
  if (pending) {
    return (
      <Loader2
        size={size}
        aria-hidden="true"
        className="shrink-0 animate-spin text-brand-strong"
      />
    );
  }
  return (
    <Icon
      size={size}
      aria-hidden="true"
      className={cn("shrink-0", active ? "text-brand-strong" : "text-text3")}
    />
  );
}

/**
 * Marca o item como pendente enquanto a navegação está em curso, para aplicar
 * o estilo "ativo" de imediato no item clicado. Renderiza via render-prop.
 */
export function LinkPending({
  children,
}: {
  children: (pending: boolean) => React.ReactNode;
}) {
  const { pending } = useLinkStatus();
  return <>{children(pending)}</>;
}
