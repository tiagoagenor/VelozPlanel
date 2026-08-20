"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api";
import { Button } from "@/components/ui/button";

export function AppHeader() {
  const router = useRouter();
  const qc = useQueryClient();

  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
  });

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      qc.clear();
      router.replace("/login");
    },
  });

  return (
    <header className="border-b border-border-subtle bg-surface">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-base font-bold text-text">
            Veloz<span className="text-brand">Panel</span>
          </Link>
          <nav aria-label="Navegação principal" className="flex items-center gap-1">
            <Link
              href="/"
              className="rounded-md px-3 py-1.5 text-sm text-text2 hover:bg-elevated"
            >
              Ambientes
            </Link>
            {user?.role === "admin" ? (
              <Link
                href="/admin/nodes"
                className="rounded-md px-3 py-1.5 text-sm text-text2 hover:bg-elevated"
              >
                Nós
              </Link>
            ) : null}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {user ? (
            <span className="text-sm text-text2">
              {user.name}
              <span className="text-text3"> · {user.email}</span>
            </span>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            Sair
          </Button>
        </div>
      </div>
    </header>
  );
}
