"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { loginInput } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

export default function LoginPage() {
  return (
    <React.Suspense fallback={null}>
      <LoginForm />
    </React.Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const next = params.get("next") || "/";

  // Preenchido com o usuário de teste para facilitar a validação local.
  const [email, setEmail] = React.useState("client@veloz.dev");
  const [password, setPassword] = React.useState("veloz123");
  const [showPw, setShowPw] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: api.login,
    onSuccess: (user) => {
      qc.setQueryData(["me"], user);
      router.replace(next);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) {
        setFormError("E-mail ou senha inválidos.");
      } else {
        setFormError(
          err instanceof Error ? err.message : "Falha ao entrar. Tente de novo.",
        );
      }
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = loginInput.safeParse({ email, password });
    if (!parsed.success) {
      setFormError("Informe um e-mail válido e a senha.");
      return;
    }
    mutation.mutate(parsed.data);
  }

  return (
    <main
      id="conteudo"
      className="flex min-h-screen items-center justify-center bg-bg px-4"
    >
      <Card className="w-full max-w-sm bg-elevated">
        <h1 className="mb-1 text-xl font-bold text-text">
          Veloz<span className="text-brand">Panel</span>
        </h1>
        <p className="mb-6 text-sm text-text2">Entre para gerenciar seus ambientes.</p>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Senha</Label>
            <div className="flex gap-2">
              <Input
                id="password"
                name="password"
                type={showPw ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <Button
                variant="outline"
                size="md"
                onClick={() => setShowPw((v) => !v)}
                aria-pressed={showPw}
                aria-label={showPw ? "Ocultar senha" : "Mostrar senha"}
              >
                {showPw ? "Ocultar" : "Mostrar"}
              </Button>
            </div>
          </div>

          {formError ? (
            <p role="alert" className="text-sm font-medium text-danger">
              ⚠ {formError}
            </p>
          ) : null}

          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Entrando…" : "Entrar"}
          </Button>
        </form>

        <p className="mt-6 text-xs text-text3">
          Teste: <code>client@veloz.dev</code> / <code>veloz123</code> ·
          admin: <code>admin@veloz.dev</code>
        </p>
      </Card>
    </main>
  );
}
