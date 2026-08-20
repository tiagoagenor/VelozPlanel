"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-brand-soft text-brand-strong"
          : "text-text2 hover:bg-bg hover:text-text",
      )}
    >
      {children}
    </Link>
  );
}

export function AppHeader() {
  const router = useRouter();
  const qc = useQueryClient();
  const pathname = usePathname();

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
    <header className="sticky top-0 z-30 border-b border-border-subtle bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-text"
          >
            <span
              aria-hidden="true"
              className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-on-solid text-sm font-black"
            >
              V
            </span>
            <span>
              Veloz<span className="text-brand-strong">Panel</span>
            </span>
          </Link>
          <nav
            aria-label="Navegação principal"
            className="flex items-center gap-1"
          >
            <NavLink href="/" active={pathname === "/"}>
              Ambientes
            </NavLink>
            {user?.role === "admin" ? (
              <NavLink
                href="/admin/nodes"
                active={pathname?.startsWith("/admin") ?? false}
              >
                Nós
              </NavLink>
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
