"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import * as api from "@/lib/api";
import { useToast } from "@/components/ui/toast";

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
        <span className="text-sm">Verificando permissões…</span>
      </div>
    </div>
  );
}

/**
 * Guardião da área de super admin.
 *
 * Confirma a sessão com `me()` E exige papel `admin` ANTES de renderizar:
 *  - sessão não confirmável (401 / rede / API fora do ar) → volta a /login;
 *  - logado mas SEM papel admin → manda ao painel do cliente ("/") com aviso;
 *  - admin confirmado → renderiza a casca do admin.
 */
export function AdminAuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const notified = React.useRef(false);

  const q = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    retry: false,
    staleTime: 30_000,
  });

  React.useEffect(() => {
    if (q.isError) {
      redirectToLogin();
      return;
    }
    if (q.isSuccess && q.data.role !== "admin" && !notified.current) {
      notified.current = true;
      toast.show(
        "error",
        "Área restrita a administradores. Você foi redirecionado ao seu painel.",
      );
      router.replace("/");
    }
  }, [q.isError, q.isSuccess, q.data, router, toast]);

  if (q.isSuccess && q.data.role === "admin") return <>{children}</>;

  // Pendente, em erro ou sem permissão (redirecionando): mantém o carregamento.
  return <Loading />;
}
