"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  ArrowRight,
  Boxes,
  Globe,
  GitBranch,
} from "lucide-react";
import { loginInput } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";

export default function LoginPage() {
  return (
    <React.Suspense fallback={null}>
      <LoginForm />
    </React.Suspense>
  );
}

type Tab = "entrar" | "criar";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const next = params.get("next") || "/";

  // Deep-link da aba: /login?tab=criar abre direto o cadastro (link do site).
  const [tab, setTab] = React.useState<Tab>(params.get("tab") === "criar" ? "criar" : "entrar");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const [keep, setKeep] = React.useState(true);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);

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
        setFormError(err instanceof Error ? err.message : "Falha ao entrar. Tente de novo.");
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
    <main id="conteudo" className="grid min-h-screen bg-bg lg:grid-cols-[1.12fr_1fr]">
      {/* ── Esquerda: formulário ── */}
      <div className="flex items-center justify-center px-6 py-10 sm:px-10">
        <div className="w-full max-w-[400px]">
          {/* Marca */}
          <div
            className="mb-8 text-[19px] font-normal tracking-[-0.02em] text-text"
            style={{ fontFamily: "var(--font-inter)" }}
          >
            jamees<span className="text-text">.</span>
            <span className="text-[0.72em] text-text3">com</span>
          </div>

          <h1 className="text-[26px] font-bold leading-tight text-text">Entrar na sua conta</h1>
          <p className="mt-1.5 text-sm text-text2">Acesse seus ambientes, domínios e faturas.</p>

          {/* Abas */}
          <div className="mt-6 grid grid-cols-2 gap-1 rounded-[10px] bg-bg p-1 ring-1 ring-border">
            <TabButton active={tab === "entrar"} onClick={() => { setTab("entrar"); setNote(null); }}>
              Entrar
            </TabButton>
            <TabButton active={tab === "criar"} onClick={() => setTab("criar")}>
              Criar conta
            </TabButton>
          </div>

          {tab === "criar" ? (
            <div className="mt-6 rounded-[12px] border border-border bg-surface p-5 text-sm text-text2">
              <p className="font-medium text-text">Cadastro por convite</p>
              <p className="mt-1.5">
                O acesso ao Jamees é liberado pelo administrador. Fale com o suporte para receber sua conta.
              </p>
              <button
                type="button"
                onClick={() => setTab("entrar")}
                className="mt-3 text-sm font-medium text-link hover:underline"
              >
                ← Já tenho conta, entrar
              </button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
              <Field label="E-mail" htmlFor="email">
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  placeholder="voce@empresa.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className={inputCls}
                />
              </Field>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="password" className="text-[13px] font-medium text-text2">Senha</label>
                  <button
                    type="button"
                    onClick={() => setNote("Recuperação de senha em breve — fale com o administrador.")}
                    className="text-[12.5px] font-medium text-link hover:underline"
                  >
                    Esqueci minha senha
                  </button>
                </div>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPw ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className={cn(inputCls, "pr-11")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? "Ocultar senha" : "Mostrar senha"}
                    className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-text3 hover:text-text2"
                  >
                    {showPw ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                  </button>
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2.5 text-[13.5px] text-text2">
                <input
                  type="checkbox"
                  checked={keep}
                  onChange={(e) => setKeep(e.target.checked)}
                  className="h-4 w-4 rounded border-border text-brand accent-brand"
                />
                Manter conectado neste computador
              </label>

              {formError ? (
                <p role="alert" className="flex items-center gap-2 text-sm font-medium text-danger">
                  <AlertTriangle size={16} aria-hidden="true" />
                  {formError}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={mutation.isPending}
                className="inline-flex items-center justify-center gap-2 rounded-[8px] bg-brand px-4 py-3 text-[15px] font-medium text-on-solid transition-colors hover:bg-brand-strong disabled:opacity-60"
              >
                {mutation.isPending ? "Entrando…" : "Entrar"}
                {!mutation.isPending ? <ArrowRight size={17} aria-hidden="true" /> : null}
              </button>

              {/* Divisor "ou" */}
              <div className="my-1 flex items-center gap-3 text-xs text-text3">
                <span className="h-px flex-1 bg-border" />
                ou
                <span className="h-px flex-1 bg-border" />
              </div>

              <SocialButton icon={<GoogleG />} onClick={() => setNote("Login com Google em breve.")}>
                Continuar com o Google
              </SocialButton>
              <SocialButton icon={<GithubMark />} onClick={() => setNote("Login com GitHub em breve.")}>
                Continuar com o GitHub
              </SocialButton>

              {note ? <p className="text-center text-[12.5px] text-text3">{note}</p> : null}

              <p className="mt-1 text-center text-[13px] text-text2">
                Ainda não tem conta?{" "}
                <button type="button" onClick={() => setTab("criar")} className="font-medium text-link hover:underline">
                  Criar agora
                </button>
              </p>
            </form>
          )}
        </div>
      </div>

      {/* ── Direita: painel de marketing ── */}
      <aside className="relative hidden flex-col justify-center overflow-hidden bg-[#2f2354] px-12 text-white lg:flex">
        <div className="max-w-[440px]">
          <h2 className="text-[28px] font-bold leading-[1.2]">
            Hospedagem em contêiner,<br />do jeito que você monta
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/70">
            Crie ambientes PHP, Node, bancos e serviços em minutos. Pague por hora, pause quando quiser.
          </p>

          <ul className="mt-9 flex flex-col gap-6">
            <Feature icon={Boxes} title="Criação em 2 passos" desc="Escolha o tipo, a região e o plano. O ambiente sobe provisionando na sua frente." />
            <Feature icon={Globe} title="Domínio apontado sem dor" desc="Cole os nameservers e acompanhe a escada até publicar com HTTPS." />
            <Feature icon={GitBranch} title="Deploy a cada push" desc="Conecte o repositório e veja o log de cada deploy." />
          </ul>
        </div>
      </aside>
    </main>
  );
}

/* ─────────────── UI ─────────────── */

const inputCls =
  "w-full rounded-[10px] border border-border bg-surface px-3.5 py-2.5 text-[14px] text-text outline-none transition-colors placeholder:text-text3 focus:border-brand-strong focus:ring-2 focus:ring-brand/20";

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-text2">{label}</label>
      {children}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-[6px] py-2 text-[13.5px] font-medium transition-colors",
        active ? "bg-brand text-on-solid" : "text-text2 hover:text-text",
      )}
    >
      {children}
    </button>
  );
}

function SocialButton({ icon, onClick, children }: { icon: React.ReactNode; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center gap-2.5 rounded-[10px] border border-border bg-surface py-2.5 text-[13.5px] font-medium text-text2 transition-colors hover:border-brand-strong hover:bg-brand-soft/40 hover:text-text"
    >
      {icon}
      {children}
    </button>
  );
}

function Feature({ icon: Icon, title, desc }: { icon: typeof Boxes; title: string; desc: string }) {
  return (
    <li className="flex gap-3.5">
      <span aria-hidden="true" className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-white/10 text-white">
        <Icon size={18} />
      </span>
      <div>
        <p className="text-[15px] font-semibold text-white">{title}</p>
        <p className="mt-0.5 text-[13.5px] leading-relaxed text-white/65">{desc}</p>
      </div>
    </li>
  );
}

/** Marca do GitHub. */
function GithubMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.33-1.76-1.33-1.76-1.09-.75.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.39 1.24-3.23-.12-.31-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.18.77.84 1.24 1.91 1.24 3.23 0 4.63-2.81 5.65-5.49 5.95.43.37.81 1.1.81 2.22 0 1.6-.01 2.9-.01 3.29 0 .32.22.7.83.58A12 12 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
    </svg>
  );
}

/** "G" do Google (marca oficial simplificada). */
function GoogleG() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
