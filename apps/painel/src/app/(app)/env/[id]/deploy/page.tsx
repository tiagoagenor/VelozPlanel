"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Rocket, GitBranch, KeyRound, Copy, Check, Loader2, Play, ExternalLink,
  CheckCircle2, XCircle, Info, Boxes, Pencil, RefreshCw, AlertTriangle, Trash2,
  Braces, Settings, FileCode, ChevronRight,
} from "lucide-react";
import type { DeployFramework } from "@velozplanel/contracts";
import { EnvChromeContext } from "../layout";
import { FirstDeployWizard } from "./FirstDeployWizard";
import { EnvVarsModal } from "./EnvVarsModal";
import { StartFileModal } from "./StartFileModal";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

type Fw = DeployFramework;
type DeployLang = "node" | "php" | "python" | "static" | "dotnet";
function nodeUnsupported(err: unknown): boolean {
  return err instanceof ApiError && (err.code === "node_deploy_unsupported" || err.status === 502 || err.status === 503);
}
function errMsg(err: unknown, fallback: string): string {
  if (nodeUnsupported(err)) return "Este ambiente está num nó que ainda não suporta deploy.";
  return err instanceof Error ? err.message : fallback;
}

export default function DeployPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const envQ = useQuery({ queryKey: ["environment", id], queryFn: () => api.getEnvironment(id) });
  const q = useQuery({ queryKey: ["deploy", id], queryFn: () => api.getDeploy(id) });
  const runsQ = useQuery({ queryKey: ["deploy-runs", id], queryFn: () => api.getDeployRuns(id) });
  const cfg = q.data;
  const lang = (envQ.data?.runtime.kind ?? "node") as DeployLang;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["deploy", id] });

  // ---- mutations ----
  const saveConn = useMutation({
    mutationFn: (p: { connectionMode: "ssh" | "http" | "public"; repoUrl: string; branch?: string; framework?: Fw }) =>
      api.setDeployConnection(id, { connectionMode: p.connectionMode, provider: "github", repoUrl: p.repoUrl, mode: "simple", framework: p.framework, branch: p.branch }),
    onSuccess: () => invalidate(),
    onError: (e) => toast.show("error", errMsg(e, "Não consegui salvar a conexão.")),
  });
  const genKey = useMutation({
    mutationFn: () => api.generateDeployKey(id),
    onSuccess: (r) => { invalidate(); setRevealedPub(r.publicKey); toast.show("success", "Chave criada. Copie a pública agora — ela aparece só uma vez."); },
    onError: (e) => toast.show("error", errMsg(e, "Não consegui criar a chave.")),
  });
  const importKey = useMutation({
    mutationFn: (privateKey: string) => api.importDeployKey(id, { privateKey }),
    onSuccess: () => { invalidate(); setImporting(false); toast.show("success", "Chave importada. Agora teste a conexão."); },
    onError: (e) => toast.show("error", errMsg(e, "Não reconheci essa chave privada (cole completa, sem senha).")),
  });
  const testKey = useMutation({
    mutationFn: () => api.testDeployKey(id),
    onSuccess: (r) => { invalidate(); toast.show(r.ok ? "success" : "error", r.message); if (r.ok && !cfg?.steps.length) detect.mutate(); },
    onError: (e) => toast.show("error", errMsg(e, "Falha ao testar.")),
  });
  const saveHttp = useMutation({
    mutationFn: () => api.setDeployHttpCredentials(id, { username: httpUser, password: httpPass }),
    onSuccess: (r) => { invalidate(); setEditHttp(false); toast.show(r.ok ? "success" : "error", r.message); if (r.ok && !cfg?.steps.length) detect.mutate(); },
    onError: (e) => toast.show("error", errMsg(e, "Falha ao salvar credenciais.")),
  });
  const detect = useMutation({ mutationFn: () => api.detectDeploySteps(id), onSuccess: (r) => qc.setQueryData(["deploy", id], r), onError: (e) => toast.show("error", errMsg(e, "Falha ao detectar.")) });
  const deploy = useMutation({
    mutationFn: () => api.runDeploy(id),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["deploy-runs", id] }); router.push(`/env/${id}/deploy/${r.id}`); },
    onError: (e) => toast.show("error", errMsg(e, "Falha no deploy.")),
  });
  const delDeploy = useMutation({
    mutationFn: () => api.deleteDeploy(id),
    onSuccess: () => { setDelOpen(false); setDelConfirm(""); setRevealedPub(null); qc.invalidateQueries({ queryKey: ["deploy", id] }); qc.invalidateQueries({ queryKey: ["deploy-runs", id] }); toast.show("success", "Deploy excluído. Você pode começar de novo."); },
    onError: (e) => toast.show("error", errMsg(e, "Falha ao excluir.")),
  });
  const [branchEdit, setBranchEdit] = React.useState(false);
  const [pickBranch, setPickBranch] = React.useState("");
  const branchesQ = useQuery({ queryKey: ["deploy-branches", id], queryFn: () => api.getDeployBranches(id), enabled: false });
  const saveBranch = useMutation({
    mutationFn: (branch: string) => api.setDeployBranch(id, { branch }),
    onSuccess: (r) => { qc.setQueryData(["deploy", id], r); setBranchEdit(false); toast.show("success", "Branch atualizada."); },
    onError: (e) => toast.show("error", errMsg(e, "Não consegui trocar a branch.")),
  });
  const [histLimit, setHistLimit] = React.useState(10);
  const [histNever, setHistNever] = React.useState(false);
  React.useEffect(() => { if (cfg) { setHistNever((cfg.historyLimit ?? 10) === 0); setHistLimit((cfg.historyLimit ?? 10) === 0 ? 10 : (cfg.historyLimit ?? 10)); } }, [cfg?.historyLimit]);
  const saveHist = useMutation({
    mutationFn: () => api.setDeployHistory(id, { historyLimit: histNever ? 0 : histLimit }),
    onSuccess: (r) => { qc.setQueryData(["deploy", id], r); toast.show("success", "Preferência de histórico salva."); },
    onError: (e) => toast.show("error", errMsg(e, "Falha ao salvar.")),
  });

  // ---- steps editor ----
  const STEP_KINDS: { v: string; label: string }[] = [
    { v: "git_sync", label: "Baixar código (git)" },
    { v: "composer_install", label: "Instalar dependências PHP (composer)" },
    { v: "npm_ci", label: "Instalar dependências JS (npm)" },
    { v: "npm_build", label: "Build de assets" },
    { v: "pip_install", label: "Instalar dependências (pip)" },
    { v: "artisan_migrate", label: "Migrações (artisan migrate) — altera dados" },
    { v: "artisan_optimize", label: "Cache config/rotas/views (artisan)" },
    { v: "artisan_storage_link", label: "Link de storage (storage:link)" },
    { v: "node_restart", label: "Reiniciar o app" },
    { v: "python_restart", label: "Reiniciar o app" },
    { v: "static_reload", label: "Recarregar o site" },
    { v: "dotnet_publish", label: "Publicar (dotnet publish)" },
    { v: "dotnet_restart", label: "Reiniciar o app" },
    { v: "shell", label: "Comando personalizado" },
  ];
  type Row = { enabled: boolean; kind: string; command: string | null; label: string; cwd: string | null; mutatesData: boolean };
  const [stepEdit, setStepEdit] = React.useState(false);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [detectConfirm, setDetectConfirm] = React.useState(false);
  const [stepMode, setStepMode] = React.useState<"simple" | "advanced">("simple");
  const [subdir, setSubdir] = React.useState("");
  React.useEffect(() => { if (cfg) { setStepMode((cfg.mode as "simple" | "advanced") ?? "simple"); setSubdir(cfg.subdir ?? ""); } }, [cfg?.mode, cfg?.subdir]);
  const APP_KINDS = ["php_migrate", "artisan_migrate", "artisan_optimize", "artisan_storage_link", "node_restart", "python_restart", "static_reload", "dotnet_restart"];
  const isAppKind = (k: string) => APP_KINDS.includes(k);
  const buildFolder = (rowCwd: string | null) => {
    const b = subdir.trim() || "raiz";
    if (rowCwd) return (subdir.trim() ? subdir.trim() + "/" : "") + rowCwd;
    return b;
  };
  React.useEffect(() => { if (cfg) setRows(cfg.steps.map((x) => ({ enabled: x.enabled, kind: x.kind, command: x.command, label: x.label, cwd: x.cwd, mutatesData: x.mutatesData }))); }, [cfg?.steps]);
  const saveSteps = useMutation({
    mutationFn: () => api.setDeploySteps(id, { mode: stepMode, subdir: subdir.trim() || null, steps: rows.map((r) => ({ enabled: r.enabled, kind: r.kind as never, command: r.kind === "shell" ? (r.command ?? "") : null, label: r.label, cwd: isAppKind(r.kind) ? null : r.cwd, mutatesData: r.kind === "artisan_migrate" ? true : r.mutatesData })) }),
    onSuccess: (r) => { qc.setQueryData(["deploy", id], r); setStepEdit(false); toast.show("success", "Passos salvos."); },
    onError: (e) => toast.show("error", errMsg(e, "Falha ao salvar os passos.")),
  });
  function setRow(i: number, patch: Partial<Row>) { setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r))); }
  function moveRow(i: number, dir: -1 | 1) { setRows((rs) => { const a = [...rs]; const j = i + dir; if (j < 0 || j >= a.length) return rs; [a[i], a[j]] = [a[j]!, a[i]!]; return a; }); }
  function addRow() { setRows((rs) => [...rs, { enabled: true, kind: "shell", command: "", label: "Comando personalizado", cwd: null, mutatesData: false }]); }

  // ---- management local state ----
  const [pubCopied, setPubCopied] = React.useState(false);
  const [revealedPub, setRevealedPub] = React.useState<string | null>(null);
  const [delOpen, setDelOpen] = React.useState(false);
  const [delConfirm, setDelConfirm] = React.useState("");
  const [importing, setImporting] = React.useState(false);
  const [importText, setImportText] = React.useState("");
  const [regenOpen, setRegenOpen] = React.useState(false);
  const [editConn, setEditConn] = React.useState(false);
  const [eRepo, setERepo] = React.useState("");
  const [eType, setEType] = React.useState<"ssh" | "http">("ssh");
  const [editHttp, setEditHttp] = React.useState(false);
  const [httpUser, setHttpUser] = React.useState("");
  const [httpPass, setHttpPass] = React.useState("");

  React.useEffect(() => { if (cfg) { setERepo(cfg.repoUrl ?? ""); setEType(cfg.connectionMode === "http" ? "http" : "ssh"); setHttpUser(cfg.httpUsername ?? ""); } }, [cfg?.repoUrl, cfg?.connectionMode, cfg?.httpUsername]);

  // "Trava" do wizard de primeiro deploy: ao entrar sem conexão, o wizard fica
  // montado por toda a sessão — mesmo depois que o passo 2 salva a conexão (que
  // torna hasConn=true). Sem isso, salvar a conexão desmontava o wizard e jogava
  // o usuário na tela de gerência no meio do fluxo.
  const [inWizard, setInWizard] = React.useState(false);
  React.useEffect(() => { if (cfg?.connectionMode === "none") setInWizard(true); }, [cfg?.connectionMode]);

  // ---- Modelo A: modais de edição + cabeçalho mínimo ----
  const [keyOpen, setKeyOpen] = React.useState(false);
  const [startOpen, setStartOpen] = React.useState(false);
  const [varsOpen, setVarsOpen] = React.useState(false);
  const varsQ = useQuery({ queryKey: ["env-vars", id], queryFn: () => api.getEnvVars(id) });
  const envChrome = React.useContext(EnvChromeContext);
  React.useEffect(() => {
    // Enquanto a gerência do deploy está na tela, o cabeçalho do ambiente vira
    // mínimo (só nome + estado). Quando o wizard aparece, ele mesmo usa "hidden".
    const managing = !!cfg && cfg.connectionMode !== "none" && !inWizard;
    if (managing) { envChrome?.setHeaderMode("minimal"); return () => envChrome?.setHeaderMode("full"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envChrome, cfg?.connectionMode, inWizard]);

  // ---- Deploy automático ----
  const [autoOn, setAutoOn] = React.useState(false);
  const [autoInterval, setAutoInterval] = React.useState(5);
  React.useEffect(() => { if (cfg) { setAutoOn(cfg.autoEnabled); setAutoInterval(cfg.intervalMinutes || 5); } }, [cfg?.autoEnabled, cfg?.intervalMinutes]);
  const saveAuto = useMutation({
    mutationFn: (p: { autoEnabled: boolean; intervalMinutes: number }) => api.setDeployAuto(id, p),
    onSuccess: (r) => { qc.setQueryData(["deploy", id], r); toast.show("success", r.autoEnabled ? "Deploy automático ligado." : "Deploy automático desligado."); },
    onError: (e) => toast.show("error", errMsg(e, "Falha ao salvar o deploy automático.")),
  });

  if (q.isPending || envQ.isPending) return <div className="flex min-h-40 items-center justify-center"><Loader2 className="animate-spin text-brand-strong" /></div>;

  const hasConn = cfg && cfg.connectionMode !== "none";
  const isSSH = cfg?.connectionMode === "ssh";
  const isHTTP = cfg?.connectionMode === "http";
  const isPublic = cfg?.connectionMode === "public";
  const hasKey = !!cfg?.fingerprint;
  const verified = !!cfg?.connectionVerifiedAt || isPublic;
  const ready = hasConn && verified && (cfg?.steps.length ?? 0) > 0;

  // ================= PRIMEIRO DEPLOY (wizard guiado) =================
  // !hasConn cobre o primeiro acesso; inWizard mantém o wizard montado depois
  // que o passo 2 salva a conexão (senão cairia na gerência no meio do fluxo).
  if (!hasConn || inWizard) {
    return <FirstDeployWizard id={id} />;
  }

  // ================= GERÊNCIA =================
  const badge = verified ? <span className="flex items-center gap-1.5 text-sm text-success"><CheckCircle2 size={14} /> Conectado</span>
    : isSSH && hasKey ? <span className="flex items-center gap-1.5 text-sm text-warning"><AlertTriangle size={14} /> Chave criada — falta testar</span>
    : isSSH ? <span className="flex items-center gap-1.5 text-sm text-text3">● Falta criar a chave</span>
    : isHTTP ? <span className="flex items-center gap-1.5 text-sm text-warning"><AlertTriangle size={14} /> Credenciais não testadas</span>
    : null;

  const lastRun = runsQ.data?.[0];
  const accessLabel = isHTTP ? "Usuário e senha" : isSSH ? "Chave de deploy (SSH)" : "Público";
  const startFileValue = lang === "dotnet"
    ? (envQ.data?.dotnetCmd?.trim() ? "comando fixo" : "automático")
    : (cfg?.framework === "django")
      ? (envQ.data?.pythonCmd?.trim() ? "comando fixo" : "runserver :80")
      : (envQ.data?.nodeStartFile || (lang === "python" ? "app.py" : "index.js"));
  const showStartFile = lang === "node" || lang === "python" || lang === "dotnet";

  return (
    <div className="flex flex-col gap-5">
      {/* Aviso da porta — apps Node/Python/.NET precisam escutar na :80 */}
      {(lang === "node" || lang === "python" || lang === "dotnet") ? (
        <div role="note" className="flex items-start gap-2 rounded-xl border border-info/30 bg-info/10 px-4 py-3 text-sm text-text2">
          <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-info" />
          <span>
            Seu app precisa escutar na <strong className="text-text">porta 80</strong>, no host <code className="rounded bg-bg px-1 font-mono text-text">0.0.0.0</code> (não use <code className="font-mono">localhost</code>).
            {lang === "node"
              ? <> Ex.: <code className="rounded bg-bg px-1 font-mono text-text">app.listen(process.env.PORT || 80, &quot;0.0.0.0&quot;)</code>.</>
              : lang === "dotnet"
                ? <> No .NET, a variável <code className="rounded bg-bg px-1 font-mono text-text">ASPNETCORE_URLS=http://0.0.0.0:80</code> já vem configurada.</>
                : <> Ex. Flask/FastAPI: rode em <code className="rounded bg-bg px-1 font-mono text-text">0.0.0.0:80</code> (Django já sobe assim).</>}
          </span>
        </div>
      ) : null}

      {/* ===== HERO ===== */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <span aria-hidden="true" className="grid place-items-center rounded-2xl bg-brand-soft text-brand-strong" style={{ height: 52, width: 52 }}><Rocket size={26} /></span>
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-xl font-bold text-text">Deploy{cfg?.framework === "nextjs" ? " · Next.js" : ""}</h2>
                {badge}
              </div>
              {lastRun ? (
                <span className="flex flex-wrap items-center gap-1.5 text-[13px] text-text2">
                  Último:
                  {lastRun.status === "success" ? <CheckCircle2 size={13} className="text-success" /> : lastRun.status === "running" ? <Loader2 size={13} className="animate-spin text-info" /> : <XCircle size={13} className="text-danger" />}
                  <span className={lastRun.status === "success" ? "text-success" : lastRun.status === "failed" ? "text-danger" : "text-text2"}>{lastRun.status}</span>
                  {lastRun.commitSha ? <>· <code className="font-mono text-xs">{lastRun.commitSha.slice(0, 8)}</code></> : null}
                  · {new Date(lastRun.startedAt).toLocaleString("pt-BR")}
                </span>
              ) : <span className="text-[13px] text-text3">Nenhum deploy ainda — publique quando quiser.</span>}
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            {envQ.data?.accessUrl ? <a href={envQ.data.accessUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-1.5 rounded-[10px] border border-border px-3.5 text-sm text-link hover:bg-bg">Abrir site <ExternalLink size={14} /></a> : null}
            <Button onClick={() => deploy.mutate()} disabled={deploy.isPending || !ready} title={!ready ? "Conecte e teste o repositório antes de publicar." : undefined}>
              {deploy.isPending ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />} {deploy.isPending ? "Fazendo deploy…" : "Fazer deploy agora"}
            </Button>
          </div>
        </div>
      </Card>

      {/* ===== 2 COLUNAS ===== */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr] lg:items-start">
        {/* ---- ESQUERDA: Passos + Histórico ---- */}
        <div className="flex flex-col gap-5">
          {verified ? (
            <Card><div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 font-semibold text-text"><Boxes size={16} className="text-brand-strong" /> Passos do build</h3>
                <Button variant="ghost" size="sm" onClick={() => setStepEdit(true)}><Pencil size={14} /> Editar</Button>
              </div>
              {cfg && cfg.steps.length ? (
                <ul className="flex flex-col gap-1.5">{cfg.steps.map((sp) => (
                  <li key={sp.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm">
                    <span className={sp.enabled ? "text-success" : "text-text3"}>●</span>
                    <span className="font-medium text-text">{sp.label}</span>
                    {sp.mutatesData ? <span className="rounded bg-warning/10 px-1.5 text-[10px] font-semibold text-warning">altera dados</span> : null}
                    <span className="ml-auto text-xs text-text3">{isAppKind(sp.kind) ? "no site" : `pasta: ${buildFolder(sp.cwd)} · build`}</span>
                  </li>))}</ul>
              ) : <p className="text-sm text-text3">Ainda não detectamos os passos.</p>}
            </div></Card>
          ) : null}

          <Card><div className="flex flex-col gap-3">
            <h3 className="flex items-center gap-2 font-semibold text-text"><GitBranch size={16} className="text-brand-strong" /> Histórico</h3>
            <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-bg/40 p-3">
              <span className="text-xs font-medium text-text3">Quantos deploys guardar</span>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-text2">
                  Manter os últimos
                  <Input type="number" min={1} max={500} value={histLimit} disabled={histNever} onChange={(e) => setHistLimit(Math.max(1, Number(e.target.value) || 1))} className="h-8 w-20" />
                  deploys
                </label>
                <label className="flex items-center gap-1.5 text-sm text-text2"><input type="checkbox" checked={histNever} onChange={(e) => setHistNever(e.target.checked)} /> Nunca apagar</label>
                <Button size="sm" onClick={() => saveHist.mutate()} disabled={saveHist.isPending}>{saveHist.isPending ? <Loader2 size={14} className="animate-spin" /> : null} Salvar</Button>
              </div>
              <p className="text-xs text-text3">Os logs também ficam salvos <strong>no seu ambiente</strong>, em <code>/veloz/deploys</code>.</p>
            </div>
            {runsQ.data && runsQ.data.length ? (
              <ul className="flex flex-col gap-1.5">{runsQ.data.map((r) => (<li key={r.id}><Link href={`/env/${id}/deploy/${r.id}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm hover:bg-bg">{r.status === "success" ? <CheckCircle2 size={15} className="text-success" /> : r.status === "running" ? <Loader2 size={15} className="animate-spin text-info" /> : <XCircle size={15} className="text-danger" />}<span className="text-text">{r.status}</span>{r.commitSha ? <code className="font-mono text-xs text-text3">{r.commitSha.slice(0, 8)}</code> : null}<span className="ml-auto text-xs text-text3">{new Date(r.startedAt).toLocaleString("pt-BR")}</span><ChevronRight size={14} className="text-text3" /></Link></li>))}</ul>
            ) : <p className="text-sm text-text3">Nenhum deploy ainda.</p>}
          </div></Card>
        </div>

        {/* ---- DIREITA: Configuração + Variáveis + Zona de perigo ---- */}
        <div className="flex flex-col gap-5">
          <Card><div className="flex flex-col">
            <h3 className="mb-1 flex items-center gap-2 font-semibold text-text"><Settings size={16} className="text-brand-strong" /> Configuração</h3>
            <ConfigRow icon={<GitBranch size={16} className="text-brand-strong" />} label="Repositório"
              value={<code className="font-mono text-xs">{cfg?.repoUrl}</code>}
              action={<Button variant="ghost" size="sm" onClick={() => setEditConn(true)}><Pencil size={14} /> Editar</Button>} />
            {verified ? (
              <ConfigRow icon={<GitBranch size={16} className="text-brand-strong" />} label="Branch"
                value={<strong>{cfg?.branch}</strong>}
                action={<Button variant="ghost" size="sm" onClick={() => { setBranchEdit(true); setPickBranch(cfg?.branch ?? ""); branchesQ.refetch(); }}><Pencil size={14} /> Trocar</Button>} />
            ) : null}
            <ConfigRow icon={<KeyRound size={16} className="text-brand-strong" />} label="Acesso"
              value={<span>{accessLabel}{verified ? <span className="text-success"> · verificado</span> : null}</span>}
              action={isPublic ? null : <Button variant="ghost" size="sm" onClick={() => isSSH ? setKeyOpen(true) : setEditHttp(true)}><Pencil size={14} /> Gerenciar</Button>} />
            {showStartFile ? (
              <ConfigRow last icon={<FileCode size={16} className="text-brand-strong" />} label="Arquivo de início"
                value={<code className="font-mono text-xs">{startFileValue}</code>}
                action={<Button variant="ghost" size="sm" onClick={() => setStartOpen(true)}><Pencil size={14} /> Editar</Button>} />
            ) : null}
          </div></Card>

          <Card><div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="flex items-center gap-2 font-semibold text-text"><Braces size={16} className="text-brand-strong" /> Variáveis</h3>
                {varsQ.data ? <span className="grid min-w-[22px] place-items-center rounded-full bg-brand-soft px-1.5 text-xs font-semibold text-brand-strong">{varsQ.data.vars.length}</span> : null}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setVarsOpen(true)}><Settings size={14} /> Gerenciar</Button>
            </div>
            {varsQ.data && varsQ.data.vars.length ? (
              <div className="flex flex-col gap-1.5">
                {varsQ.data.vars.slice(0, 3).map((v) => (
                  <div key={v.key} className="flex items-center gap-2 text-[13px]">
                    <code className="font-mono text-xs text-text">{v.key}</code>
                    <span className="text-text3">=</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-text3">{v.hidden ? "•••••••• (escondida)" : v.valueMasked}</span>
                  </div>
                ))}
                {varsQ.data.vars.length > 3 ? <button type="button" className="w-fit text-xs text-link hover:underline" onClick={() => setVarsOpen(true)}>+{varsQ.data.vars.length - 3} mais · ver todas</button> : null}
              </div>
            ) : <p className="text-sm text-text3">Nenhuma variável — clique em Gerenciar para adicionar.</p>}
          </div></Card>

          <Card><div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-semibold text-text"><RefreshCw size={16} className="text-brand-strong" /> Deploy automático</h3>
              <button type="button" role="switch" aria-checked={autoOn} aria-label="Ligar deploy automático"
                onClick={() => { const on = !autoOn; setAutoOn(on); saveAuto.mutate({ autoEnabled: on, intervalMinutes: Math.max(1, autoInterval) }); }}
                className={`relative h-[22px] w-10 shrink-0 rounded-full transition-colors ${autoOn ? "bg-brand" : "bg-neutral/40"}`}>
                <span className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white transition-all ${autoOn ? "right-0.5" : "left-0.5"}`} />
              </button>
            </div>
            <p className="text-xs text-text3">Checa o repositório de tempos em tempos e <strong>publica sozinho</strong> quando houver commit novo na branch.</p>
            {autoOn ? (
              <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
                <label className="flex flex-wrap items-center gap-2 text-sm text-text2">
                  Checar a cada
                  <Input type="number" min={1} max={1440} value={autoInterval} onChange={(e) => setAutoInterval(Math.max(1, Number(e.target.value) || 1))} onBlur={() => saveAuto.mutate({ autoEnabled: true, intervalMinutes: Math.max(1, autoInterval) })} className="h-8 w-20" />
                  minutos
                  {saveAuto.isPending ? <Loader2 size={14} className="animate-spin text-text3" /> : null}
                </label>
                <p className="text-xs text-text3">Mínimo 1 minuto. {cfg?.lastCheckAt ? `Última checagem: ${new Date(cfg.lastCheckAt).toLocaleString("pt-BR")}.` : "Ainda não checou."}{cfg?.lastRemoteSha ? ` Commit visto: ${cfg.lastRemoteSha.slice(0, 8)}.` : ""}</p>
              </div>
            ) : null}
          </div></Card>

          <Card className="border-danger/30"><div className="flex flex-col gap-3">
            <h3 className="flex items-center gap-2 font-semibold text-danger"><AlertTriangle size={16} /> Zona de perigo</h3>
            <p className="text-sm text-text2">Excluir o deploy <strong>desconecta o repositório</strong> e apaga chave, passos e histórico. <strong>O site continua no ar</strong>.</p>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/5 p-3">
              <div>
                <p className="text-sm font-medium text-text">Excluir configuração de deploy</p>
                <p className="text-xs text-text3">Você poderá reconectar do zero depois.</p>
              </div>
              <Button variant="danger" onClick={() => { setDelConfirm(""); setDelOpen(true); }}><Trash2 size={15} /> Excluir</Button>
            </div>
          </div></Card>
        </div>
      </div>

      {/* ================= MODAIS ================= */}
      <Dialog open={editConn} onClose={() => setEditConn(false)} title="Conexão" description="Repositório e tipo de acesso.">
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">{(["ssh", "http"] as const).map((tp) => (<button key={tp} type="button" onClick={() => setEType(tp)} className={`rounded-lg border px-3 py-1.5 text-sm ${eType === tp ? "border-brand-strong bg-brand-soft text-brand-strong" : "border-border-subtle text-text2 hover:bg-bg"}`}>{tp === "ssh" ? "SSH (chave)" : "HTTPS (usuário e senha)"}</button>))}</div>
          <Input className="font-mono" value={eRepo} onChange={(e) => setERepo(e.target.value)} placeholder={eType === "ssh" ? "git@github.com:usuario/projeto.git" : "https://github.com/usuario/projeto.git"} />
          <p className="text-xs text-text3">Trocar o tipo não apaga a chave nem os passos — só troca a seleção.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditConn(false)}>Cancelar</Button>
            <Button disabled={saveConn.isPending || !eRepo.trim()} onClick={async () => { try { await saveConn.mutateAsync({ connectionMode: eType, repoUrl: eRepo, framework: cfg?.framework }); setEditConn(false); } catch { /* onError já mostra o toast */ } }}>{saveConn.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Salvar</Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={branchEdit} onClose={() => setBranchEdit(false)} title="Branch de deploy" description="A versão do seu código que vai pro ar.">
        {branchesQ.isFetching ? (
          <div className="flex items-center gap-2 text-sm text-text3"><Loader2 size={14} className="animate-spin" /> Buscando branches…</div>
        ) : branchesQ.data?.ok && branchesQ.data.branches.length ? (
          <div className="flex flex-col gap-2">
            <select value={pickBranch} onChange={(e) => setPickBranch(e.target.value)} className="rounded-lg border border-border bg-surface px-2 py-2 text-sm">
              {branchesQ.data.branches.map((b) => <option key={b} value={b}>{b}{b === cfg?.branch ? " (atual)" : ""}</option>)}
            </select>
            <p className="text-xs text-text3">Trocar a branch não altera a chave nem os passos.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => branchesQ.refetch()}><RefreshCw size={14} /> Atualizar</Button>
              <Button variant="ghost" onClick={() => setBranchEdit(false)}>Cancelar</Button>
              <Button disabled={saveBranch.isPending || !pickBranch || pickBranch === cfg?.branch} onClick={() => saveBranch.mutate(pickBranch)}>{saveBranch.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Salvar branch</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-warning">Não consegui listar as branches. Digite o nome manualmente.</p>
            <Input className="font-mono" value={pickBranch} onChange={(e) => setPickBranch(e.target.value)} placeholder="main" />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setBranchEdit(false)}>Cancelar</Button>
              <Button disabled={saveBranch.isPending || !pickBranch.trim()} onClick={() => saveBranch.mutate(pickBranch.trim())}>Salvar branch</Button>
            </div>
          </div>
        )}
      </Dialog>

      {isSSH ? (
        <Dialog open={keyOpen} onClose={() => setKeyOpen(false)} title="Chave de deploy" widthClass="w-[min(94vw,40rem)]">
          <div className="flex flex-col gap-3">
            {revealedPub ? (
              <div className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/5 p-4">
                <div className="flex items-start gap-2"><AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" />
                  <p className="text-sm text-text">Esta é a <strong>única vez</strong> que a chave pública aparece. Copie e cole no GitHub agora.</p></div>
                <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
                  <code className="min-w-0 flex-1 truncate font-mono text-xs">{revealedPub}</code>
                  <button type="button" aria-label="Copiar" onClick={async () => { await navigator.clipboard.writeText(revealedPub); setPubCopied(true); setTimeout(() => setPubCopied(false), 1500); }} className="shrink-0 rounded p-1 text-text2 hover:text-brand-strong">{pubCopied ? <Check size={16} className="text-success" /> : <Copy size={16} />}</button>
                </div>
                <p className="text-xs text-text3">Cole em: <strong>GitHub → Settings → Deploy keys → Add deploy key</strong> (deixe "Allow write access" desmarcado).</p>
                <div className="flex flex-wrap gap-2">
                  <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-link hover:bg-bg">Abrir GitHub <ExternalLink size={14} /></a>
                  <Button onClick={() => testKey.mutate()} disabled={testKey.isPending}>{testKey.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Já colei → Testar</Button>
                  <Button variant="ghost" onClick={() => setRevealedPub(null)}>Já guardei — fechar</Button>
                </div>
              </div>
            ) : !hasKey ? (
              <>
                <p className="text-sm text-text2">Você ainda não tem uma chave para este ambiente.</p>
                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={() => genKey.mutate()} disabled={genKey.isPending}>{genKey.isPending ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />} {genKey.isPending ? "Criando…" : "Criar chave SSH"}</Button>
                  <button type="button" className="text-sm text-link hover:underline" onClick={() => setImporting(true)}>Colar minha chave privada</button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-text2">Chave criada. <strong>A chave pública não é mostrada de novo</strong> — se você não guardou, clique em "Gerar outra chave".</p>
                <div className="text-xs text-text3">Fingerprint: <code className="font-mono">{cfg!.fingerprint}</code>{verified ? <span className="ml-2 text-success">· verificada</span> : null}</div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => testKey.mutate()} disabled={testKey.isPending}>{testKey.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {verified ? "Testar novamente" : "Testar conexão"}</Button>
                  <Button variant="outline" onClick={() => setRegenOpen(true)}><RefreshCw size={14} /> Gerar outra chave</Button>
                  <button type="button" className="text-sm text-link hover:underline" onClick={() => setImporting(true)}>Colar minha chave privada</button>
                </div>
              </>
            )}
            {importing ? (
              <div className="mt-1 flex flex-col gap-2 border-t border-border-subtle pt-3">
                <p className="text-sm text-text2">Cole sua chave privada (sem senha). Fica guardada só no nó, nunca é exibida de volta.</p>
                <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={5} spellCheck={false} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs" />
                <div className="flex gap-2"><Button variant="ghost" onClick={() => setImporting(false)}>Cancelar</Button><Button disabled={importKey.isPending || !importText.trim()} onClick={() => importKey.mutate(importText)}>{importKey.isPending ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />} Importar chave</Button></div>
              </div>
            ) : null}
          </div>
        </Dialog>
      ) : null}

      {isHTTP ? (
        <Dialog open={editHttp} onClose={() => setEditHttp(false)} title="Credenciais HTTPS">
          <div className="flex flex-col gap-2">
            <p className="text-xs text-text3">Use um token de acesso como senha (GitHub → Settings → Developer settings → Personal access tokens).</p>
            <Input placeholder="usuário" value={httpUser} onChange={(e) => setHttpUser(e.target.value)} />
            <Input type="password" placeholder="senha ou token" value={httpPass} onChange={(e) => setHttpPass(e.target.value)} />
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setEditHttp(false)}>Cancelar</Button><Button disabled={saveHttp.isPending || !httpUser.trim() || !httpPass.trim()} onClick={() => saveHttp.mutate()}>{saveHttp.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Salvar e testar</Button></div>
          </div>
        </Dialog>
      ) : null}

      <Dialog open={stepEdit} onClose={() => setStepEdit(false)} title="Passos do build" description="Passos de build rodam no container de build; migrações e reiniciar rodam no site." widthClass="w-[min(94vw,48rem)]">
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            {(["simple", "advanced"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setStepMode(m)} className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${stepMode === m ? "border-brand-strong bg-brand-soft text-brand-strong" : "border-border-subtle text-text2 hover:bg-bg"}`}>{m === "simple" ? "Simples" : "Avançado"}</button>
            ))}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="subdir">Pasta do projeto (opcional)</Label>
            <Input id="subdir" className="font-mono" value={subdir} onChange={(e) => setSubdir(e.target.value)} placeholder="ex.: apps/web (deixe vazio se está na raiz)" />
            <p className="text-xs text-text3">{subdir.trim() ? `Os passos de build rodam em ${subdir.trim()}/ dentro do repositório.` : "Os passos de build rodam na raiz do repositório."} É onde ficam o package.json / composer.json.</p>
          </div>
          {stepMode === "simple" ? (
            <div className="flex flex-col gap-1.5">
              {rows.filter((r) => r.kind !== "shell").map((r) => { const i = rows.indexOf(r); return (
                <label key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm">
                  <input type="checkbox" checked={r.enabled} onChange={(e) => setRow(i, { enabled: e.target.checked })} />
                  <span className="font-medium text-text">{r.label}</span>
                  {r.kind === "artisan_migrate" || r.kind === "php_migrate" ? <span className="rounded bg-warning/10 px-1.5 text-[10px] font-semibold text-warning">altera dados</span> : null}
                  <span className="ml-auto text-xs text-text3">{isAppKind(r.kind) ? "no site" : `pasta: ${buildFolder(null)} · build`}</span>
                </label>
              ); })}
              <div className="mt-1 flex flex-col gap-1">
                <Label htmlFor="extra">Comando extra (opcional)</Label>
                {(() => { const si = rows.findIndex((r) => r.kind === "shell"); const val = si >= 0 ? (rows[si]!.command ?? "") : ""; return (
                  <Input id="extra" className="font-mono" value={val} placeholder="ex.: php artisan queue:restart"
                    onChange={(e) => { const v = e.target.value; setRows((rs) => { const idx = rs.findIndex((r) => r.kind === "shell"); if (idx >= 0) { const a = [...rs]; a[idx] = { ...a[idx]!, command: v }; return a; } return v ? [...rs, { enabled: true, kind: "shell", command: v, label: "Comando personalizado", cwd: null, mutatesData: false }] : rs; }); }} />
                ); })()}
                <p className="text-xs text-text3">Rodado na pasta do projeto, no container de build, depois do build.</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {rows.map((r, i) => (
                <div key={i} className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input type="checkbox" checked={r.enabled} onChange={(e) => setRow(i, { enabled: e.target.checked })} title="Ativo" />
                    <select value={r.kind} onChange={(e) => setRow(i, { kind: e.target.value, label: STEP_KINDS.find((k) => k.v === e.target.value)?.label ?? r.label })} className="rounded-lg border border-border bg-surface px-2 py-1 text-sm">
                      {STEP_KINDS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}
                    </select>
                    <div className="ml-auto flex items-center gap-1">
                      <button type="button" onClick={() => moveRow(i, -1)} className="rounded p-1 text-text2 hover:bg-bg" aria-label="Subir">↑</button>
                      <button type="button" onClick={() => moveRow(i, 1)} className="rounded p-1 text-text2 hover:bg-bg" aria-label="Descer">↓</button>
                      <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="rounded p-1 text-text2 hover:text-danger" aria-label="Remover"><XCircle size={15} /></button>
                    </div>
                  </div>
                  {r.kind === "shell" ? (
                    <textarea value={r.command ?? ""} onChange={(e) => setRow(i, { command: e.target.value })} rows={2} spellCheck={false} placeholder="ex.: php artisan queue:restart" className="w-full rounded-lg border border-border bg-surface px-2 py-1 font-mono text-xs" />
                  ) : null}
                  {isAppKind(r.kind) ? (
                    <p className="text-xs text-text3">Roda no <strong>site</strong> (/app) — a pasta do projeto não se aplica.</p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-text3">Pasta:</span>
                      <Input className="h-8 max-w-[220px] font-mono text-xs" value={r.cwd ?? ""} onChange={(e) => setRow(i, { cwd: e.target.value || null })} placeholder={subdir.trim() ? `(herda ${subdir.trim()})` : "(raiz)"} />
                      <span className="text-xs text-text3">→ pasta: {buildFolder(r.cwd)} · build</span>
                    </div>
                  )}
                </div>
              ))}
              <Button variant="ghost" size="sm" onClick={addRow} className="self-start">+ Adicionar passo</Button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
            <Button variant="ghost" size="sm" onClick={() => setDetectConfirm(true)}><RefreshCw size={14} /> Restaurar padrão</Button>
            <span className="ml-auto flex gap-2">
              <Button variant="ghost" onClick={() => { setStepEdit(false); if (cfg) { setRows(cfg.steps.map((x) => ({ enabled: x.enabled, kind: x.kind, command: x.command, label: x.label, cwd: x.cwd, mutatesData: x.mutatesData }))); setSubdir(cfg.subdir ?? ""); setStepMode((cfg.mode as "simple" | "advanced") ?? "simple"); } }}>Cancelar</Button>
              <Button onClick={() => saveSteps.mutate()} disabled={saveSteps.isPending}>{saveSteps.isPending ? <Loader2 size={16} className="animate-spin" /> : null} Salvar passos</Button>
            </span>
          </div>
        </div>
      </Dialog>

      {showStartFile && envQ.data ? (
        <StartFileModal id={id} open={startOpen} onClose={() => setStartOpen(false)} env={envQ.data} framework={cfg?.framework ?? "none"} />
      ) : null}

      <EnvVarsModal id={id} open={varsOpen} onClose={() => setVarsOpen(false)} />

      <Dialog open={delOpen} onClose={() => { setDelOpen(false); setDelConfirm(""); }} title="Excluir a configuração de deploy?" description="Esta ação não pode ser desfeita.">
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border-subtle bg-bg/40 p-3 text-sm text-text2">
            <p className="mb-2 font-medium text-text">O que será apagado:</p>
            <ul className="flex flex-col gap-1 text-xs">
              <li className="flex items-center gap-2"><XCircle size={13} className="shrink-0 text-danger" /> Repositório Git conectado</li>
              <li className="flex items-center gap-2"><XCircle size={13} className="shrink-0 text-danger" /> Chave de deploy / credenciais</li>
              <li className="flex items-center gap-2"><XCircle size={13} className="shrink-0 text-danger" /> Passos de build e configurações</li>
              <li className="flex items-center gap-2"><XCircle size={13} className="shrink-0 text-danger" /> Histórico de deploys</li>
            </ul>
            <p className="mt-3 flex items-start gap-2 text-xs text-success"><CheckCircle2 size={13} className="mt-0.5 shrink-0" /> Os arquivos já publicados e o site continuam no ar.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="del-confirm">Para confirmar, digite o nome do ambiente: <code className="font-mono text-danger">{envQ.data?.name}</code></Label>
            <Input id="del-confirm" value={delConfirm} onChange={(e) => setDelConfirm(e.target.value)} placeholder={envQ.data?.name} autoComplete="off" spellCheck={false} className="font-mono" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setDelOpen(false); setDelConfirm(""); }}>Cancelar</Button>
            <Button variant="danger" onClick={() => delDeploy.mutate()} disabled={delDeploy.isPending || delConfirm.trim() !== envQ.data?.name}>{delDeploy.isPending ? "Excluindo…" : "Excluir deploy"}</Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={detectConfirm} onClose={() => setDetectConfirm(false)} title="Restaurar passos padrão?" description="Isto substitui os passos atuais pelos detectados automaticamente do repositório.">
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setDetectConfirm(false)}>Cancelar</Button><Button variant="danger" onClick={() => { setDetectConfirm(false); detect.mutate(); setStepEdit(false); }}>Restaurar</Button></div>
      </Dialog>

      <Dialog open={regenOpen} onClose={() => setRegenOpen(false)} title="Gerar uma nova chave?" description="A chave atual deixa de funcionar. Você vai precisar apagar a antiga no GitHub e colar a nova em Deploy keys.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRegenOpen(false)}>Cancelar</Button>
          <Button variant="danger" onClick={() => { setRegenOpen(false); genKey.mutate(); }}>Gerar nova chave</Button>
        </div>
      </Dialog>
    </div>
  );
}

/** Linha de configuração: ícone + rótulo + valor + ação (abre modal). */
function ConfigRow({ icon, label, value, action, last }: { icon: React.ReactNode; label: string; value: React.ReactNode; action?: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex items-center gap-3 py-3 ${last ? "" : "border-b border-border-subtle"}`}>
      <span className="shrink-0">{icon}</span>
      <span className="w-24 shrink-0 text-[13px] text-text3">{label}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-text">{value}</span>
      {action ?? null}
    </div>
  );
}
