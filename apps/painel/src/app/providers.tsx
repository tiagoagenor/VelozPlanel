"use client";

import * as React from "react";
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { ApiError } from "@/lib/api";

/** Sessão expirada / não autenticado → volta ao login sem perder a rota atual. */
function redirectToLogin() {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/login") return;
  const next = encodeURIComponent(
    window.location.pathname + window.location.search,
  );
  window.location.assign(`/login?next=${next}`);
}

/**
 * Falhas que impedem confirmar a sessão: 401 limpo OU rede/CORS/API fora do ar
 * (ApiError status 0). Nesses casos a rota protegida não pode ficar "solta" —
 * volta ao login. Foi o bug visto ao abrir o painel pelo IP da rede.
 */
function isAuthBlockingError(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 0);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (err) => {
            if (isAuthBlockingError(err)) {
              redirectToLogin();
            }
          },
        }),
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: (count, err) => {
              // Não reintenta erros que impedem confirmar a sessão.
              if (isAuthBlockingError(err)) return false;
              return count < 1;
            },
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
