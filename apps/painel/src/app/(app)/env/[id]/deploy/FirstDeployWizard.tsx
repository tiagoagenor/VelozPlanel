"use client";

/*
 * ─────────────────────────────────────────────────────────────────────────
 *  FirstDeployWizard — primeiro deploy guiado (design Jamees "Primeiro deploy").
 *
 *  Fluxo em passos, linguagem de leigo, sobre as MESMAS mutations da tela de
 *  gerência (nenhuma API nova). Renderizado por deploy/page.tsx enquanto
 *  `connectionMode === "none"`. O passo final dispara runDeploy e navega para
 *  o log ao vivo; ao voltar em /deploy, cai na gerência normal.
 *
 *  Ordem: Tipo (galeria) → Repositório → Conectar → Versão (branch) →
 *         Variáveis (opcional) → Arquivo de início (adaptativo) →
 *         Passos (Fácil/Personalizado) → Revisar & publicar.
 * ─────────────────────────────────────────────────────────────────────── */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Rocket, Sparkles, Boxes, Globe, KeyRound, GitBranch, Braces, FileCode,
  Copy, Check, CheckCircle2, Loader2, ArrowRight, ArrowLeft, Info, Lock, Unlock, Eye, EyeOff, Plus, ExternalLink,
} from "lucide-react";
import { RUNTIME_LABEL, ENV_KEY_RE, RESERVED_ENV_KEYS } from "@velozplanel/contracts";
import type { DeployConfig, DeployFramework, DeployStepKind, Environment, RuntimeKind } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";

/* ───────────── constantes / helpers ───────────── */

type DeployLang = "node" | "php" | "python" | "static" | "dotnet";
type Fw = DeployFramework;

const FRAMEWORKS: Record<DeployLang, { id: Fw; label: string; hint: string }[]> = {
  node: [
    { id: "nextjs", label: "Next.js", hint: "Sites e apps modernos em React." },
    { id: "none", label: "App Node", hint: "Express, Fastify ou qualquer app Node." },
  ],
  php: [
    { id: "laravel", label: "Laravel", hint: "Serve public/, roda artisan e migrações." },
    { id: "none", label: "PHP padrão", hint: "WordPress, PHP puro, qualquer app." },
  ],
  python: [
    { id: "django", label: "Django", hint: "Detecta manage.py e sobe o runserver." },
    { id: "python", label: "Python", hint: "Flask, FastAPI ou script próprio (app.py)." },
  ],
  static: [
    { id: "spa", label: "Site com build", hint: "React, Vue, Angular (roda npm build)." },
    { id: "static", label: "Site pronto", hint: "HTML/CSS/JS publicados como estão." },
  ],
  dotnet: [{ id: "dotnet", label: ".NET / ASP.NET Core", hint: "Detecta o .csproj e publica a DLL." }],
};

function frameworkTags(lang: DeployLang, fwId: Fw): string[] {
  if (fwId === "nextjs") return ["build automático", "porta 80", "standalone"];
  if (fwId === "laravel") return ["composer", "migrações", "porta 80"];
  if (fwId === "django") return ["requirements", "runserver :80"];
  if (fwId === "spa") return ["npm build", "publica dist/"];
  if (fwId === "static") return ["sem build", "publica arquivos"];
  if (fwId === "dotnet") return ["dotnet publish", "porta 80"];
  if (lang === "node") return ["build", "porta 80", "seu arquivo de start"];
  if (lang === "php") return ["composer", "porta 80"];
  if (lang === "python") return ["requirements", "seu arquivo de start"];
  return ["porta 80"];
}

/** Modo do passo "Arquivo de início" por runtime/framework (null = não se aplica). */
function startFileMode(runtime: RuntimeKind, fw: Fw): "node" | "python" | "django" | "dotnet" | null {
  if (runtime === "node") return fw === "nextjs" ? null : "node";
  if (runtime === "python") return fw === "django" ? "django" : "python";
  if (runtime === "dotnet") return "dotnet";
  return null; // static, php: start automático
}

/** Passo de restart automático por runtime (modo Personalizado). */
function restartKindFor(runtime: RuntimeKind): DeployStepKind | null {
  switch (runtime) {
    case "node": return "node_restart";
    case "python": return "python_restart";
    case "static": return "static_reload";
    case "dotnet": return "dotnet_restart";
    default: return null; // php: restart tratado pelo agente
  }
}

const APP_KINDS: DeployStepKind[] = [
  "php_migrate", "artisan_migrate", "artisan_optimize", "artisan_storage_link",
  "artisan_clear", "laravel_fix_index", "node_restart", "python_restart", "static_reload", "dotnet_restart",
];
const isAppKind = (k: DeployStepKind) => APP_KINDS.includes(k);

/** Comando EXIBIDO para cada passo no modo Fácil. É uma aproximação do que o
 *  agente roda (buildScript) — serve para o usuário entender, não é o literal. */
function stepCommandPreview(
  kind: DeployStepKind,
  ctx: { branch: string; repoUrl: string | null; framework: Fw; startFile: string; command: string | null },
): string {
  switch (kind) {
    case "git_sync": return `git clone --depth 1 --branch ${ctx.branch || "main"} ${ctx.repoUrl ?? "<repo>"}`;
    case "composer_install": return "composer install --no-dev --optimize-autoloader";
    case "npm_ci": return "npm ci";
    case "npm_build": return ctx.framework === "nextjs" ? "NEXT_PRIVATE_STANDALONE=true npm run build" : "npm run build";
    case "pip_install": return "pip install -r requirements.txt";
    case "dotnet_publish": return "dotnet publish -c Release -o /workspace/publish";
    case "php_migrate":
    case "artisan_migrate": return "php artisan migrate --force";
    case "artisan_optimize": return "php artisan optimize";
    case "artisan_clear": return "php artisan optimize:clear";
    case "artisan_storage_link": return "php artisan storage:link";
    case "laravel_fix_index": return "# ajusta o index.php do Laravel";
    case "node_restart": return `node ${ctx.startFile || "index.js"}`;
    case "python_restart": return `python3 ${ctx.startFile || "app.py"}`;
    case "static_reload": return "# recarrega o site (Caddy)";
    case "dotnet_restart": return "dotnet App.dll";
    case "shell": return ctx.command ?? "";
    default: return "";
  }
}

function nodeUnsupported(err: unknown): boolean {
  return err instanceof ApiError && (err.code === "node_deploy_unsupported" || err.status === 502 || err.status === 503);
}
function errMsg(err: unknown, fallback: string): string {
  if (nodeUnsupported(err)) return "Este ambiente está num nó que ainda não suporta deploy.";
  return err instanceof Error ? err.message : fallback;
}

const BRANCH_PAGE = 8;

type VarRow = { key: string; value: string; hidden: boolean; dirty: boolean };
type StepRow = { enabled: boolean; kind: DeployStepKind; command: string | null; label: string; cwd: string | null; mutatesData: boolean };

/* ───────────── stepper ───────────── */

function Stepper({ labels, current }: { labels: string[]; current: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`Passo ${current + 1} de ${labels.length}`}>
      {labels.map((_, i) => (
        <React.Fragment key={i}>
          <span
            className={cn(
              "shrink-0 rounded-full",
              i === current ? "h-3 w-3 bg-brand ring-4 ring-brand-soft"
                : i < current ? "h-2.5 w-2.5 bg-brand"
                  : "h-2.5 w-2.5 border-[1.5px] border-border-subtle bg-surface",
            )}
          />
          {i < labels.length - 1 ? (
            <span className={cn("h-0.5 flex-1 rounded", i < current ? "bg-brand" : "bg-border")} />
          ) : null}
        </React.Fragment>
      ))}
    </div>
  );
}

/* ───────────── UI atoms ───────────── */

function OptionCard({
  icon, title, desc, on, onClick, badge,
}: { icon: React.ReactNode; title: string; desc: string; on: boolean; onClick: () => void; badge?: React.ReactNode }) {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={on}
      className={cn(
        "flex items-center gap-3.5 rounded-2xl border p-4 text-left transition-colors",
        on ? "border-brand bg-brand-soft" : "border-border bg-surface hover:bg-bg",
      )}
    >
      <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", on ? "bg-surface text-brand-strong" : "bg-bg text-brand-strong")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2"><span className="text-[15px] font-semibold text-text">{title}</span>{badge}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-text2">{desc}</span>
      </span>
      <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full border-2", on ? "border-brand" : "border-text3")}>
        {on ? <span className="h-2.5 w-2.5 rounded-full bg-brand" /> : null}
      </span>
    </button>
  );
}

function Note({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" | "ok" }) {
  const map = {
    info: ["border-info/30 bg-info/10 text-text2", <Info key="i" size={16} className="mt-0.5 shrink-0 text-info" />],
    warn: ["border-warning/40 bg-warning/10 text-text2", <Info key="w" size={16} className="mt-0.5 shrink-0 text-warning" />],
    ok: ["border-success/30 bg-success/10 text-text2", <CheckCircle2 key="o" size={16} className="mt-0.5 shrink-0 text-success" />],
  } as const;
  const [cls, ic] = map[tone];
  return <div className={cn("flex items-start gap-2 rounded-xl border px-4 py-3 text-sm leading-relaxed", cls)}>{ic}<span>{children}</span></div>;
}

const badgeSuccess = <span className="inline-flex items-center rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">Recomendado</span>;
const badgeDetect = <span className="inline-flex items-center rounded-full border border-brand-soft bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-strong">detectado</span>;

/* ───────────── componente ───────────── */

export function FirstDeployWizard({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();

  const envQ = useQuery({ queryKey: ["environment", id], queryFn: () => api.getEnvironment(id) });
  const q = useQuery({ queryKey: ["deploy", id], queryFn: () => api.getDeploy(id) });
  const env = envQ.data;
  const cfg = q.data;
  const runtime = (env?.runtime.kind ?? "node") as RuntimeKind;
  const lang = runtime as DeployLang;

  // ── estado local do wizard ──
  const [stepIdx, setStepIdx] = React.useState(0);
  const [framework, setFramework] = React.useState<Fw>(FRAMEWORKS[lang]?.[0]?.id ?? "none");
  const [repoUrl, setRepoUrl] = React.useState("");
  const [privacy, setPrivacy] = React.useState<"public" | "private">("private");
  const [authType, setAuthType] = React.useState<"ssh" | "http">("ssh");
  const [httpUser, setHttpUser] = React.useState("");
  const [httpPass, setHttpPass] = React.useState("");
  const [revealedPub, setRevealedPub] = React.useState<string | null>(null);
  const [pubCopied, setPubCopied] = React.useState(false);
  const [branchSearch, setBranchSearch] = React.useState("");
  const [branchPage, setBranchPage] = React.useState(0);
  const [pickBranch, setPickBranch] = React.useState("");
  const [manualBranch, setManualBranch] = React.useState("");
  const [varRows, setVarRows] = React.useState<VarRow[]>([]);
  const [startFile, setStartFile] = React.useState("");
  const [startCmd, setStartCmd] = React.useState("");
  const [stepMode, setStepMode] = React.useState<"facil" | "custom">("facil");
  const [customText, setCustomText] = React.useState("");
  const [rows, setRows] = React.useState<StepRow[]>([]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["deploy", id] });
  const setCfg = (c: DeployConfig) => qc.setQueryData(["deploy", id], c);
  const setEnv = (e: Environment) => qc.setQueryData(["environment", id], e);

  // ── derivados ──
  const fw: Fw = cfg && cfg.framework !== "none" ? cfg.framework : framework;
  const isPublic = cfg?.connectionMode === "public";
  const isSSH = cfg?.connectionMode === "ssh";
  const isHTTP = cfg?.connectionMode === "http";
  const hasKey = !!cfg?.fingerprint;
  const verified = !!cfg?.connectionVerifiedAt || isPublic;
  const sfMode = startFileMode(runtime, fw);

  const stepList: { key: string; label: string }[] = [
    { key: "tipo", label: "Tipo" },
    { key: "repo", label: "Código" },
    { key: "conectar", label: "Conectar" },
    { key: "versao", label: "Versão" },
    { key: "variaveis", label: "Variáveis" },
    ...(sfMode ? [{ key: "inicio", label: "Início" }] : []),
    { key: "passos", label: "Passos" },
    { key: "revisar", label: "Revisar" },
  ];
  const clampedIdx = Math.min(stepIdx, stepList.length - 1);
  const cur = stepList[clampedIdx]!;
  const next = () => setStepIdx((i) => Math.min(i + 1, stepList.length - 1));
  const back = () => setStepIdx((i) => Math.max(i - 1, 0));

  // ── mutations (mesmos padrões da gerência) ──
  const saveConn = useMutation({
    mutationFn: (p: { connectionMode: "ssh" | "http" | "public"; repoUrl: string; framework?: Fw }) =>
      api.setDeployConnection(id, { connectionMode: p.connectionMode, provider: "github", repoUrl: p.repoUrl, mode: "simple", framework: p.framework }),
    onSuccess: setCfg,
    onError: (e) => toast.show("error", errMsg(e, "Não consegui salvar a conexão.")),
  });
  const probe = useMutation({ mutationFn: (url: string) => api.deployProbe(id, { repoUrl: url }) });
  const saveHttp = useMutation({
    mutationFn: (p: { username: string; password: string }) => api.setDeployHttpCredentials(id, p),
    onSuccess: (r) => { invalidate(); toast.show(r.ok ? "success" : "error", r.message); },
    onError: (e) => toast.show("error", errMsg(e, "Falha ao salvar credenciais.")),
  });
  const genKey = useMutation({
    mutationFn: () => api.generateDeployKey(id),
    onSuccess: (r) => { invalidate(); setRevealedPub(r.publicKey); toast.show("success", "Chave criada. Copie e cole no GitHub — ela aparece só uma vez."); },
    onError: (e) => toast.show("error", errMsg(e, "Não consegui criar a chave.")),
  });
  const detect = useMutation({ mutationFn: () => api.detectDeploySteps(id), onSuccess: setCfg, onError: (e) => toast.show("error", errMsg(e, "Falha ao detectar.")) });
  const testKey = useMutation({
    mutationFn: () => api.testDeployKey(id),
    onSuccess: (r) => { invalidate(); toast.show(r.ok ? "success" : "error", r.message); },
    onError: (e) => toast.show("error", errMsg(e, "Falha ao testar.")),
  });
  const branchesQ = useQuery({ queryKey: ["deploy-branches", id], queryFn: () => api.getDeployBranches(id), enabled: false });
  const saveBranch = useMutation({
    mutationFn: (branch: string) => api.setDeployBranch(id, { branch }),
    onSuccess: (r) => { setCfg(r); toast.show("success", "Versão (branch) escolhida."); },
    onError: (e) => toast.show("error", errMsg(e, "Não consegui trocar a branch.")),
  });
  const saveVars = useMutation({
    mutationFn: (vars: { key: string; value?: string; buildTime: boolean; hidden: boolean }[]) => api.setEnvVars(id, { vars }),
    onError: (e) => toast.show("error", errMsg(e, "Falha ao salvar as variáveis.")),
  });
  const saveStartFile = useMutation({ mutationFn: (v: string | null) => api.setNodeStartFile(id, v), onSuccess: setEnv, onError: (e) => toast.show("error", errMsg(e, "Falha ao salvar o arquivo de início.")) });
  const savePyCmd = useMutation({ mutationFn: (v: string | null) => api.setPythonCmd(id, v, false), onSuccess: setEnv, onError: (e) => toast.show("error", errMsg(e, "Falha ao salvar.")) });
  const saveDotnetCmd = useMutation({ mutationFn: (v: string | null) => api.setDotnetCmd(id, v, false), onSuccess: setEnv, onError: (e) => toast.show("error", errMsg(e, "Falha ao salvar.")) });
  const saveSteps = useMutation({
    mutationFn: (input: Parameters<typeof api.setDeploySteps>[1]) => api.setDeploySteps(id, input),
    onSuccess: (r) => { setCfg(r); toast.show("success", "Passos salvos."); },
    onError: (e) => toast.show("error", errMsg(e, "Falha ao salvar os passos.")),
  });
  const runDeploy = useMutation({
    mutationFn: () => api.runDeploy(id),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["deploy-runs", id] }); router.push(`/env/${id}/deploy/${r.id}`); },
    onError: (e) => toast.show("error", errMsg(e, "Falha ao iniciar o deploy.")),
  });

  // ── efeitos de sincronização ──
  // detecção automática ao confirmar o acesso (público, HTTPS ou SSH testada)
  React.useEffect(() => {
    if (cur.key === "conectar" && verified && (cfg?.steps.length ?? 0) === 0 && !detect.isPending) detect.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur.key, verified, cfg?.steps.length]);
  // ao entrar em "versao": busca as branches (query é enabled:false → refetch manual)
  React.useEffect(() => {
    if (cur.key === "versao" && !branchesQ.isFetching && !branchesQ.data) branchesQ.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur.key]);
  // pré-preenche a branch escolhida
  React.useEffect(() => { if (cfg?.branch && !pickBranch) setPickBranch(cfg.branch); }, [cfg?.branch, pickBranch]);
  // arquivo de início a partir do ambiente
  React.useEffect(() => {
    if (!env) return;
    setStartFile(env.nodeStartFile ?? (runtime === "python" ? "app.py" : "index.js"));
    if (sfMode === "django") setStartCmd(env.pythonCmd ?? "");
    if (sfMode === "dotnet") setStartCmd(env.dotnetCmd ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env?.nodeStartFile, env?.pythonCmd, env?.dotnetCmd, sfMode]);
  // copia os passos detectados para edição local (modo Fácil) + prefill do custom
  React.useEffect(() => {
    if (!cfg) return;
    setRows(cfg.steps.map((s) => ({ enabled: s.enabled, kind: s.kind, command: s.command, label: s.label, cwd: s.cwd, mutatesData: s.mutatesData })));
    if (!customText) {
      const buildCmds = cfg.steps.filter((s) => !isAppKind(s.kind) && s.kind !== "git_sync")
        .map((s) => stepCommandPreview(s.kind, { branch: cfg.branch, repoUrl: cfg.repoUrl, framework: cfg.framework, startFile, command: s.command }));
      if (buildCmds.length) setCustomText(buildCmds.join("\n"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.steps]);

  if (q.isPending || envQ.isPending || !cfg || !env) {
    return <div className="flex min-h-40 items-center justify-center"><Loader2 className="animate-spin text-brand-strong" /></div>;
  }

  /* ─── ações de "Continuar" por passo ─── */
  async function repoContinue() {
    const url = repoUrl.trim();
    if (!url) return;
    let mode: "ssh" | "http" | "public" = privacy === "public" ? "public" : authType;
    if (privacy === "private" && authType === "http" && !httpUser.trim() && !httpPass.trim()) {
      try { const r = await probe.mutateAsync(url); if (r.isPrivate === false) mode = "public"; } catch { /* segue http */ }
    }
    await saveConn.mutateAsync({ connectionMode: mode, repoUrl: url, framework });
    if (mode === "http" && httpUser.trim() && httpPass.trim()) {
      try { await saveHttp.mutateAsync({ username: httpUser.trim(), password: httpPass.trim() }); } catch { /* mostra erro via toast */ }
    }
    next();
  }
  async function varsContinue(skip: boolean) {
    if (!skip) {
      const clean = varRows.filter((r) => r.key.trim());
      const bad = clean.find((r) => !ENV_KEY_RE.test(r.key.trim()) || RESERVED_ENV_KEYS.includes(r.key.trim()) || r.key.trim().startsWith("VP_"));
      if (bad) { toast.show("error", `Nome de variável inválido: ${bad.key}`); return; }
      if (clean.length) {
        try {
          await saveVars.mutateAsync(clean.map((r) => ({ key: r.key.trim(), ...(r.dirty ? { value: r.value } : {}), buildTime: true, hidden: r.hidden })));
          toast.show("success", "Variáveis salvas.");
        } catch { return; }
      }
    }
    next();
  }
  async function startContinue() {
    try {
      if (sfMode === "node" || sfMode === "python") await saveStartFile.mutateAsync(startFile.trim() || null);
      else if (sfMode === "django") await savePyCmd.mutateAsync(startCmd.trim() || null);
      else if (sfMode === "dotnet") await saveDotnetCmd.mutateAsync(startCmd.trim() || null);
      next();
    } catch { /* toast já mostrou */ }
  }
  async function stepsContinue() {
    try {
      if (stepMode === "facil") {
        await saveSteps.mutateAsync({
          mode: "simple",
          subdir: cfg!.subdir,
          steps: rows.map((r) => ({ enabled: r.enabled, kind: r.kind, command: r.kind === "shell" ? (r.command ?? "") : null, label: r.label, cwd: isAppKind(r.kind) ? null : r.cwd, mutatesData: r.kind === "artisan_migrate" ? true : r.mutatesData })),
        });
      } else {
        const lines = customText.split("\n").map((l) => l.trim()).filter(Boolean);
        const restart = restartKindFor(runtime);
        const steps: StepRow[] = [
          { enabled: true, kind: "git_sync", command: null, label: "Baixar código (git)", cwd: null, mutatesData: false },
          ...lines.map((l) => ({ enabled: true, kind: "shell" as DeployStepKind, command: l, label: "Comando personalizado", cwd: null, mutatesData: false })),
          ...(restart ? [{ enabled: true, kind: restart, command: null, label: "Ligar o app", cwd: null, mutatesData: false }] : []),
        ];
        await saveSteps.mutateAsync({ mode: "advanced", subdir: cfg!.subdir, steps });
      }
      next();
    } catch { /* toast já mostrou */ }
  }

  /* ─── render por passo ─── */
  function renderStep() {
    if (!cfg || !env) return null;
    switch (cur.key) {
      case "tipo": {
        const opts = FRAMEWORKS[lang] ?? [];
        return (
          <StepShell icon={<Boxes size={26} />} title="O que você vai publicar?" subtitle="Escolha um modelo. A gente configura build, porta e inicialização automaticamente.">
            <div className="flex flex-col gap-4">
              <span className="inline-flex w-fit items-center rounded-full border border-brand-soft bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-strong">Ambiente {RUNTIME_LABEL[runtime]}</span>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {opts.map((o) => (
                  <button key={o.id} type="button" onClick={() => setFramework(o.id)}
                    className={cn("relative flex flex-col gap-3 rounded-2xl border p-5 text-left transition-colors", framework === o.id ? "border-brand bg-brand-soft" : "border-border bg-surface hover:bg-bg")}>
                    {framework === o.id ? <CheckCircle2 size={20} className="absolute right-3.5 top-3.5 text-brand" /> : null}
                    <span className={cn("grid h-12 w-12 place-items-center rounded-xl", framework === o.id ? "bg-surface" : "bg-bg", "text-brand-strong")}>
                      {o.id === "nextjs" ? <Sparkles size={24} /> : <Boxes size={24} />}
                    </span>
                    <span>
                      <span className="text-[15px] font-semibold text-text">{o.label}</span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-text2">{o.hint}</span>
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      {frameworkTags(lang, o.id).map((t) => (
                        <span key={t} className={cn("rounded-full border border-border-subtle px-2 py-0.5 text-[11px] text-text2", framework === o.id ? "bg-surface" : "bg-bg")}>{t}</span>
                      ))}
                    </span>
                  </button>
                ))}
              </div>
              <Note>Não tem certeza? Pode seguir — no próximo passo a gente detecta pelo seu código.</Note>
            </div>
          </StepShell>
        );
      }
      case "repo":
        return (
          <StepShell icon={<Globe size={26} />} title="Onde está o seu código?" subtitle="Cole o endereço do seu repositório Git. É de lá que buscamos seu app a cada deploy.">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="repo">Endereço do repositório</Label>
                <Input id="repo" className="font-mono" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder={authType === "ssh" ? "git@github.com:voce/meu-app.git" : "https://github.com/voce/meu-app.git"} />
                <span className="text-xs text-text3">Não precisa informar a versão (branch) — a gente detecta.</span>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-text">Seu repositório é…</span>
                <OptionCard icon={<Unlock size={22} />} title="Público" desc="Qualquer um vê o código. Não precisa de senha." on={privacy === "public"} onClick={() => setPrivacy("public")} />
                <OptionCard icon={<Lock size={22} />} title="Privado" desc="Só você acessa. Vamos precisar de uma forma de entrar." on={privacy === "private"} onClick={() => setPrivacy("private")} />
              </div>
              {privacy === "private" ? (
                <div className="flex flex-col gap-2 border-t border-dashed border-border pt-4">
                  <span className="text-sm font-medium text-text">Como quer dar acesso?</span>
                  <OptionCard icon={<KeyRound size={22} />} title="Chave de deploy (SSH)" desc="A gente cria uma chave; você cola no GitHub uma vez. Mais seguro." on={authType === "ssh"} onClick={() => setAuthType("ssh")} badge={badgeSuccess} />
                  <OptionCard icon={<Eye size={22} />} title="Usuário e senha (HTTPS)" desc="Use um token de acesso do GitHub como senha." on={authType === "http"} onClick={() => setAuthType("http")} />
                  {authType === "http" ? (
                    <div className="mt-1 flex flex-col gap-2 rounded-xl border border-border-subtle bg-bg/60 p-3">
                      <Input placeholder="usuário" autoComplete="off" value={httpUser} onChange={(e) => setHttpUser(e.target.value)} />
                      <Input type="password" placeholder="senha ou token de acesso" autoComplete="off" value={httpPass} onChange={(e) => setHttpPass(e.target.value)} />
                      <span className="text-xs text-text3">No GitHub, use um <strong>token</strong> como senha. Repositório público? Pode deixar em branco.</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <Note>Não sabe qual escolher? Deixe em <strong>Chave de deploy</strong> — a gente te guia no próximo passo.</Note>
            </div>
          </StepShell>
        );
      case "conectar":
        return (
          <StepShell icon={<KeyRound size={26} />} title="Vamos confirmar o acesso" subtitle={isPublic ? "Repositório público — não precisa de chave nem senha." : "Criamos uma chave de deploy. Cole no GitHub e a gente testa — leva 1 minuto."}>
            {isPublic ? (
              <div className="flex flex-col gap-3">
                {detect.isPending ? (
                  <div className="flex items-center gap-2 text-sm text-text2"><Loader2 size={15} className="animate-spin" /> Confirmando o acesso e detectando seu projeto…</div>
                ) : (
                  <Note tone="ok">Acesso liberado — repositório alcançado. Detectamos: <strong>{RUNTIME_LABEL[runtime]}{cfg.framework !== "none" ? ` · ${cfg.framework}` : ""}</strong>.</Note>
                )}
              </div>
            ) : isHTTP ? (
              <div className="flex flex-col gap-3">
                {verified ? <Note tone="ok">Credenciais válidas — acesso confirmado.</Note>
                  : <Note tone="warn">Salvamos suas credenciais no passo anterior. Se o acesso não confirmar, volte e revise usuário/token.</Note>}
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {!hasKey ? (
                  <Button onClick={() => genKey.mutate()} disabled={genKey.isPending}>
                    {genKey.isPending ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />} Criar chave de deploy
                  </Button>
                ) : null}
                {revealedPub ? (
                  <div className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/5 p-4">
                    <p className="text-sm text-text">Esta é a <strong>única vez</strong> que a chave aparece. Copie e cole no GitHub agora.</p>
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
                      <code className="min-w-0 flex-1 truncate font-mono text-xs">{revealedPub}</code>
                      <button type="button" aria-label="Copiar" onClick={async () => { await navigator.clipboard.writeText(revealedPub); setPubCopied(true); setTimeout(() => setPubCopied(false), 1500); }} className="shrink-0 rounded p-1 text-text2 hover:text-brand-strong">
                        {pubCopied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
                      </button>
                    </div>
                    <p className="text-xs text-text3">Cole em: <strong>GitHub → Settings → Deploy keys → Add deploy key</strong> (não precisa marcar “write access”).</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-link hover:bg-bg">Abrir GitHub <ExternalLink size={14} /></a>
                      <Button onClick={() => testKey.mutate()} disabled={testKey.isPending}>{testKey.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Já colei → Testar</Button>
                    </div>
                  </div>
                ) : hasKey && !verified ? (
                  <Button onClick={() => testKey.mutate()} disabled={testKey.isPending}>{testKey.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Testar conexão</Button>
                ) : null}
                {verified ? <Note tone="ok">Conectado — tudo certo! Detectamos: <strong>{RUNTIME_LABEL[runtime]}{cfg.framework !== "none" ? ` · ${cfg.framework}` : ""}</strong>.</Note> : null}
              </div>
            )}
          </StepShell>
        );
      case "versao": {
        const all = branchesQ.data?.ok ? branchesQ.data.branches : [];
        const filtered = all.filter((b) => b.toLowerCase().includes(branchSearch.trim().toLowerCase()));
        const pages = Math.max(1, Math.ceil(filtered.length / BRANCH_PAGE));
        const page = Math.min(branchPage, pages - 1);
        const slice = filtered.slice(page * BRANCH_PAGE, page * BRANCH_PAGE + BRANCH_PAGE);
        return (
          <StepShell icon={<GitBranch size={26} />} title="Qual versão você quer publicar?" subtitle="A “branch” é a versão do seu código. Busque pelo nome e escolha qual vai pro ar.">
            <div className="flex flex-col gap-3">
              {branchesQ.isFetching ? (
                <div className="flex items-center gap-2 text-sm text-text3"><Loader2 size={14} className="animate-spin" /> Buscando branches…</div>
              ) : all.length ? (
                <>
                  <Input placeholder="Buscar branch pelo nome…" value={branchSearch} onChange={(e) => { setBranchSearch(e.target.value); setBranchPage(0); }} />
                  <div className="flex flex-col gap-2">
                    {slice.map((b) => (
                      <button key={b} type="button" onClick={() => setPickBranch(b)}
                        className={cn("flex items-center gap-3 rounded-xl border px-4 py-3 text-left", pickBranch === b ? "border-brand bg-brand-soft" : "border-border bg-surface hover:bg-bg")}>
                        <GitBranch size={18} className={pickBranch === b ? "text-brand-strong" : "text-text3"} />
                        <span className="font-mono text-sm font-semibold text-text">{b}</span>
                        {b === (branchesQ.data?.current ?? cfg.branch) ? badgeDetect : null}
                        <span className={cn("ml-auto grid h-5 w-5 place-items-center rounded-full border-2", pickBranch === b ? "border-brand" : "border-text3")}>{pickBranch === b ? <span className="h-2.5 w-2.5 rounded-full bg-brand" /> : null}</span>
                      </button>
                    ))}
                    {slice.length === 0 ? <span className="text-sm text-text3">Nenhuma branch com esse nome.</span> : null}
                  </div>
                  {pages > 1 ? (
                    <div className="flex items-center justify-between text-xs text-text3">
                      <span>Mostrando {page * BRANCH_PAGE + 1}–{page * BRANCH_PAGE + slice.length} de {filtered.length}</span>
                      <span className="flex items-center gap-1">
                        <button type="button" disabled={page === 0} onClick={() => setBranchPage(page - 1)} className="rounded-md border border-border px-2 py-1 disabled:opacity-40">‹</button>
                        <span className="px-1">{page + 1}/{pages}</span>
                        <button type="button" disabled={page >= pages - 1} onClick={() => setBranchPage(page + 1)} className="rounded-md border border-border px-2 py-1 disabled:opacity-40">›</button>
                      </span>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-warning">Não consegui listar as branches. Digite o nome manualmente.</p>
                  <Input className="font-mono" value={manualBranch} onChange={(e) => setManualBranch(e.target.value)} placeholder="main" />
                </div>
              )}
              <Note>Digite pra filtrar entre todas as branches. Na dúvida, use <strong>main</strong>.</Note>
            </div>
          </StepShell>
        );
      }
      case "variaveis":
        return (
          <StepShell icon={<Braces size={26} />} title="Seu app precisa de senhas ou configurações?" subtitle="São as variáveis de ambiente — chave de API, dados do banco. É opcional; você pode pular.">
            <div className="flex flex-col gap-3">
              {varRows.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input className="font-mono" placeholder="NOME" value={r.key} onChange={(e) => setVarRows((rs) => rs.map((x, j) => j === i ? { ...x, key: e.target.value } : x))} />
                  <span className="text-text3">=</span>
                  <Input className="flex-1 font-mono" placeholder="valor" type={r.hidden ? "password" : "text"} value={r.value} onChange={(e) => setVarRows((rs) => rs.map((x, j) => j === i ? { ...x, value: e.target.value, dirty: true } : x))} />
                  <button type="button" title="Esconder valor (segredo)" onClick={() => setVarRows((rs) => rs.map((x, j) => j === i ? { ...x, hidden: !x.hidden } : x))}
                    className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-lg border", r.hidden ? "border-brand bg-brand-soft text-brand-strong" : "border-border text-text3")}>
                    {r.hidden ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => setVarRows((rs) => [...rs, { key: "", value: "", hidden: false, dirty: true }])} className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-brand hover:underline">
                <Plus size={16} /> Adicionar variável
              </button>
              <Note>Já configuramos as de porta pra você: <code>PORT</code>, <code>HOSTNAME</code>, <code>NODE_ENV</code>. O 🔒 esconde o valor (fica visível só dentro do app).</Note>
            </div>
          </StepShell>
        );
      case "inicio":
        return (
          <StepShell icon={<FileCode size={26} />} title="Como seu app começa a rodar?" subtitle="Detectamos um jeito pra você — troque só se precisar.">
            <div className="flex flex-col gap-4">
              {sfMode === "node" || sfMode === "python" ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="sf">Arquivo de início</Label>
                  <Input id="sf" className="font-mono" value={startFile} onChange={(e) => setStartFile(e.target.value)} placeholder={runtime === "python" ? "app.py" : "index.js"} />
                  <span className="text-xs text-text3">É o arquivo que sobe o servidor. Ex.: index.js, server.js, src/main.js.</span>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="sc">Comando de start (avançado)</Label>
                  <Input id="sc" className="font-mono" value={startCmd} onChange={(e) => setStartCmd(e.target.value)} placeholder={sfMode === "django" ? "python manage.py runserver 0.0.0.0:80" : "dotnet App.dll"} />
                  <span className="text-xs text-text3">Deixe vazio para o padrão automático. Vale a partir deste deploy.</span>
                </div>
              )}
              <Note>Seu app precisa escutar na <strong>porta 80</strong> (host <code>0.0.0.0</code>). Se você usa <code>process.env.PORT</code>, já está resolvido.</Note>
            </div>
          </StepShell>
        );
      case "passos": {
        const ctx = { branch: cfg.branch, repoUrl: cfg.repoUrl, framework: cfg.framework, startFile };
        return (
          <StepShell icon={<Boxes size={26} />} title="Isto é o que vamos fazer no deploy" subtitle="Detectamos tudo. Fique no Fácil, ou troque pro Personalizado e escreva os comandos — um por linha.">
            <div className="flex flex-col gap-4">
              <div className="self-center">
                <SegmentedControl<"facil" | "custom"> label="Modo dos passos" value={stepMode} onChange={setStepMode}
                  options={[{ value: "facil", label: "Fácil" }, { value: "custom", label: "Personalizado" }]} />
              </div>
              {stepMode === "facil" ? (
                <>
                  <div className="flex flex-col gap-2.5">
                    {rows.map((r, i) => (
                      <div key={i} className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface px-3.5 py-3">
                        <div className="flex items-center gap-3">
                          <button type="button" role="switch" aria-checked={r.enabled} onClick={() => setRows((rs) => rs.map((x, j) => j === i ? { ...x, enabled: !x.enabled } : x))}
                            className={cn("relative h-[22px] w-10 shrink-0 rounded-full transition-colors", r.enabled ? "bg-brand" : "bg-neutral/40")}>
                            <span className={cn("absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white transition-all", r.enabled ? "right-0.5" : "left-0.5")} />
                          </button>
                          <span className="flex-1 text-sm font-medium text-text">{r.label}</span>
                          {r.kind === "artisan_migrate" || r.kind === "php_migrate" ? <span className="rounded bg-warning/10 px-1.5 text-[10px] font-semibold text-warning">altera dados</span> : null}
                          <span className="text-[11px] text-text3">{isAppKind(r.kind) ? "no site" : "no build"}</span>
                        </div>
                        <div className="ml-[52px] flex items-center gap-2 rounded-lg border border-border-subtle bg-bg px-3 py-1.5">
                          <span className="font-mono text-xs text-text3">$</span>
                          <span className="truncate font-mono text-xs text-text2">{stepCommandPreview(r.kind, { ...ctx, command: r.command })}</span>
                        </div>
                      </div>
                    ))}
                    {rows.length === 0 ? <p className="text-sm text-text3">Ainda não detectamos os passos — conecte o repositório antes.</p> : null}
                  </div>
                  <Note>Cada passo mostra o comando que vai rodar. Projetos com banco (Laravel, Django) ganham um passo de migração, desligado por segurança.</Note>
                </>
              ) : (
                <>
                  <textarea value={customText} onChange={(e) => setCustomText(e.target.value)} rows={6} spellCheck={false}
                    placeholder={"npm ci\nnpm run build"}
                    className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 font-mono text-[13px] leading-relaxed text-text" />
                  <Note>Cada linha vira um comando no <strong>build</strong>, na ordem. Baixar o código e ligar o app continuam automáticos.</Note>
                </>
              )}
            </div>
          </StepShell>
        );
      }
      case "revisar":
        return (
          <StepShell icon={<Rocket size={26} />} title="Tudo pronto para o primeiro deploy" subtitle="Confira o resumo. Ao publicar, você acompanha cada passo ao vivo.">
            <div className="flex flex-col gap-5">
              <dl className="rounded-2xl border border-border px-4">
                <SumRow label="Projeto" value={`${RUNTIME_LABEL[runtime]}${cfg.framework !== "none" ? ` · ${cfg.framework}` : ""}`} />
                <SumRow label="Repositório" value={<span className="font-mono text-[13px]">{cfg.repoUrl}</span>} />
                <SumRow label="Acesso" value={isPublic ? "Público" : isSSH ? `Chave de deploy${verified ? " · ✓ testada" : ""}` : `Usuário e senha${verified ? " · ✓" : ""}`} />
                <SumRow label="Versão" value={<span className="font-mono">{cfg.branch}</span>} />
                <SumRow label="Passos" value={`${cfg.steps.filter((s) => s.enabled).length} passos`} last />
              </dl>
              {env.accessUrl ? (
                <div className="flex items-center gap-2.5 rounded-xl border border-success/30 bg-success/10 px-4 py-3.5 text-sm text-text">
                  <CheckCircle2 size={18} className="text-success" /> Seu site vai ficar em <a href={env.accessUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-link">{env.accessUrl}</a>
                </div>
              ) : null}
              <Button size="md" className="h-[52px] w-full text-base" onClick={() => runDeploy.mutate()} disabled={runDeploy.isPending || cfg.steps.length === 0}>
                {runDeploy.isPending ? <Loader2 size={18} className="animate-spin" /> : <Rocket size={18} />} Fazer meu primeiro deploy
              </Button>
            </div>
          </StepShell>
        );
      default:
        return null;
    }
  }

  /* ─── rodapé (Voltar / Pular / Continuar) por passo ─── */
  function renderFooter() {
    if (!cfg) return null;
    if (cur.key === "revisar") {
      return <div className="flex"><Button variant="ghost" onClick={back}><ArrowLeft size={16} /> Voltar</Button></div>;
    }
    const canBack = clampedIdx > 0;
    let onNext = next;
    let nextDisabled = false;
    let nextLabel = "Continuar";
    let nextBusy = false;
    if (cur.key === "repo") { onNext = repoContinue; nextDisabled = !repoUrl.trim(); nextBusy = saveConn.isPending || probe.isPending; }
    if (cur.key === "conectar") { nextDisabled = !verified; }
    if (cur.key === "versao") { onNext = () => { const usingList = !!(branchesQ.data?.ok && branchesQ.data.branches.length); const b = (usingList ? pickBranch : manualBranch).trim(); if (b && b !== cfg!.branch) saveBranch.mutate(b, { onSuccess: () => next() }); else next(); }; nextBusy = saveBranch.isPending; }
    if (cur.key === "variaveis") { onNext = () => varsContinue(false); nextBusy = saveVars.isPending; }
    if (cur.key === "inicio") { onNext = startContinue; nextBusy = saveStartFile.isPending || savePyCmd.isPending || saveDotnetCmd.isPending; }
    if (cur.key === "passos") { onNext = stepsContinue; nextBusy = saveSteps.isPending; nextDisabled = cfg!.steps.length === 0; }
    return (
      <div className="flex items-center justify-between gap-3">
        <div>{canBack ? <Button variant="ghost" onClick={back}><ArrowLeft size={16} /> Voltar</Button> : null}</div>
        <div className="flex items-center gap-2.5">
          {cur.key === "variaveis" ? <Button variant="ghost" onClick={() => varsContinue(true)}>Pular esta etapa</Button> : null}
          <Button onClick={onNext} disabled={nextDisabled || nextBusy}>{nextBusy ? <Loader2 size={16} className="animate-spin" /> : null} {nextLabel} <ArrowRight size={16} /></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[880px] flex-col gap-5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold text-brand-strong"><Rocket size={18} className="text-brand" /> Primeiro deploy</span>
        <span className="text-[13px] text-text3">Passo {clampedIdx + 1} de {stepList.length} · {cur.label}</span>
      </div>
      <Stepper labels={stepList.map((s) => s.label)} current={clampedIdx} />
      {renderStep()}
      {renderFooter()}
    </div>
  );
}

/* ─── casca do cartão focado ─── */
function StepShell({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <Card className="p-8">
      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        <span className="grid place-items-center rounded-2xl bg-brand-soft text-brand-strong" style={{ height: 52, width: 52 }}>{icon}</span>
        <div>
          <h2 className="text-[22px] font-bold tracking-tight text-text">{title}</h2>
          <p className="mx-auto mt-1.5 max-w-[520px] text-[14.5px] leading-relaxed text-text2">{subtitle}</p>
        </div>
      </div>
      {children}
    </Card>
  );
}

function SumRow({ label, value, last }: { label: string; value: React.ReactNode; last?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3 py-3", !last && "border-b border-border-subtle")}>
      <span className="w-36 shrink-0 text-[13px] text-text3">{label}</span>
      <span className="flex-1 text-sm font-medium text-text">{value}</span>
    </div>
  );
}
