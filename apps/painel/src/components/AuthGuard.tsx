"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import * as api from "@/lib/api";

/** Volta ao login preservando a rota atual em ?next=. */
function redirectToLogin() {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/login") return;
  const next = encodeURIComponent(
    window.location.pathname + window.location.search,
  );
  window.location.assign(`/login?next=${next}`);
}

function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="grid min-h-screen place-items-center bg-bg px-4"
    >
      <div className="flex flex-col items-center gap-3 text-text2">
        <span
          aria-hidden="true"
          className="h-8 w-8 animate-spin rounded-full border-[3px] border-border-subtle border-t-brand"
        />
        <span className="text-sm">Verificando sua sessão…</span>
      </div>
    </div>
  );
}

/**
 * Guardião de rota protegida.
 *
 * Confirma a sessão chamando `me()` ANTES de renderizar o conteúdo:
 *  - enquanto não confirma → tela de carregamento;
 *  - se `me()` falhar (401 OU rede/CORS/API fora do ar) → redireciona a /login.
 *
 * Isso impede que uma rota protegida renderize sem sessão válida — o bug visto
 * ao abrir o painel pelo IP da rede, em que a API em localhost ficava
 * inacessível e a tela carregava "solta".
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const q = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    retry: false,
    staleTime: 30_000,
  });

  React.useEffect(() => {
    if (q.isError) redirectToLogin();
  }, [q.isError]);

  // Só renderiza o conteúdo protegido com sessão confirmada.
  if (q.isSuccess) return <>{children}</>;

  // Pendente ou em erro (redirecionando): mantém a tela de carregamento.
  return <Loading />;
}
