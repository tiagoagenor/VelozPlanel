import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { eq, desc, and, notInArray } from "drizzle-orm";
import {
  deployConfig as deployConfigSchema,
  setDeployConnectionInput,
  deployProbeInput,
  deployProbeResult,
  generatedDeployKey,
  setDeployStepsInput,
  setDeployAutoInput,
  importDeployKeyInput,
  setDeployHttpCredentialsInput,
  setDeployHistoryInput,
  deployBranchesResult,
  setDeployBranchInput,
  deployRun as deployRunSchema,
  apiError,
} from "@velozplanel/contracts";
import type { DeployConfig, DeployStep, DeployRun } from "@velozplanel/contracts";
import { db } from "../db/client";
import { deployConfigs, deploySteps, deployRuns, envVars, environments } from "../db/schema";
import type { DeployConfigRow, DeployStepRow, DeployRunRow, EnvironmentRow } from "../db/schema";
import { ApiHttpError, requireUser } from "../auth";
import { loadEnvironmentForUser } from "./environments";
import * as agent from "../agent";
import { agentUrlForEnv } from "../nodes";
import { decryptSecret, encryptSecret } from "../crypto";

const idParams = z.object({ id: z.string().uuid() });
const runParams = z.object({ id: z.string().uuid(), runId: z.string().uuid() });

/** Imagem do container EFÊMERO de build (precisa de git + toolchain do stack).
 *  NÃO é a imagem do app (que já roda). Estático builda SPA em Node (o app é
 *  caddy, sem node); Python builda na base própria (python-slim não tem git). */
const STATIC_BUILD_NODE = "22"; // Node LTS fixo para buildar SPA de estáticos
export function baseImage(env: EnvironmentRow): string {
  switch (env.runtimeKind) {
    case "php":
      return `velozplanel/php:${env.runtimeVersion}`;
    case "node":
      return `velozplanel/node:${env.runtimeVersion}`;
    case "python":
      return `velozplanel/python:${env.runtimeVersion}`;
    case "static":
      return `velozplanel/node:${STATIC_BUILD_NODE}`;
    case "dotnet": {
      // A imagem oficial do SDK já traz git + toolchain → builda direto (sem base própria).
      const major = parseInt(env.runtimeVersion.split(".")[0] ?? "0", 10);
      const repo = major > 0 && major < 5 ? "mcr.microsoft.com/dotnet/core/sdk" : "mcr.microsoft.com/dotnet/sdk";
      return `${repo}:${env.runtimeVersion}`;
    }
    default:
      return `velozplanel/node:${STATIC_BUILD_NODE}`;
  }
}
/** Pasta do app onde os arquivos são colocados (document root). */
function appWorkdir(env: EnvironmentRow): string {
  switch (env.runtimeKind) {
    case "node":
    case "python":
    case "dotnet":
    case "static":
      return "/app";
    default:
      return "/app/www"; // php: docroot público (o código/framework fica em /app)
  }
}

/** Credenciais HTTPS decifradas, se o modo for http. */
export function httpCredsFor(cfg: DeployConfigRow): { username: string; password: string } | undefined {
  if (cfg.connectionMode === "http" && cfg.httpUsername && cfg.httpPasswordEnc) {
    return { username: cfg.httpUsername, password: decryptSecret(cfg.httpPasswordEnc) };
  }
  return undefined;
}

async function loadOrCreateConfig(env: EnvironmentRow): Promise<DeployConfigRow> {
  const rows = await db.select().from(deployConfigs).where(eq(deployConfigs.envId, env.id)).limit(1);
  if (rows[0]) return rows[0];
  const ins = await db.insert(deployConfigs).values({ envId: env.id }).onConflictDoNothing().returning();
  if (ins[0]) return ins[0];
  const again = await db.select().from(deployConfigs).where(eq(deployConfigs.envId, env.id)).limit(1);
  if (again[0]) return again[0];
  throw new ApiHttpError(500, "internal_error", "falha ao carregar deploy");
}

function toStep(r: DeployStepRow): DeployStep {
  return {
    id: r.id, ord: r.ord, enabled: r.enabled, kind: r.kind as DeployStep["kind"],
    command: r.command, label: r.label, cwd: r.cwd, mutatesData: r.mutatesData,
  };
}

async function toConfig(cfg: DeployConfigRow): Promise<DeployConfig> {
  const steps = await db.select().from(deploySteps).where(eq(deploySteps.envId, cfg.envId)).orderBy(deploySteps.ord);
  const notes: string[] = [];
  if (cfg.connectionMode === "none") notes.push("Conecte um repositório para começar.");
  else if (!cfg.connectionVerifiedAt && cfg.connectionMode === "ssh") notes.push("Cole a deploy key no repositório e teste a conexão.");
  return {
    envId: cfg.envId,
    connectionMode: cfg.connectionMode as DeployConfig["connectionMode"],
    provider: cfg.provider as DeployConfig["provider"],
    repoUrl: cfg.repoUrl, branch: cfg.branch, isPrivate: cfg.isPrivate,
    mode: cfg.mode as DeployConfig["mode"],
    subdir: cfg.subdir,
    historyLimit: cfg.historyLimit,
    publicKey: cfg.publicKey, fingerprint: cfg.fingerprint,
    httpUsername: cfg.httpUsername, hasHttpCredentials: !!cfg.httpPasswordEnc,
    connectionVerifiedAt: cfg.connectionVerifiedAt ? cfg.connectionVerifiedAt.toISOString() : null,
    needsReconnect: cfg.needsReconnect,
    autoEnabled: cfg.autoEnabled, intervalMinutes: cfg.intervalMinutes,
    lastCheckAt: cfg.lastCheckAt ? cfg.lastCheckAt.toISOString() : null,
    lastRemoteSha: cfg.lastRemoteSha,
    deployStrategy: cfg.deployStrategy as DeployConfig["deployStrategy"],
    framework: cfg.framework as DeployConfig["framework"],
    runModel: cfg.runModel as DeployConfig["runModel"],
    lastRunStatus: (cfg.lastRunStatus as DeployConfig["lastRunStatus"]) ?? null,
    lastRunAt: cfg.lastRunAt ? cfg.lastRunAt.toISOString() : null,
    steps: steps.map(toStep),
    gatewayActive: true,
    message: notes.join(" ") || null,
  };
}

/** Dispara um deploy_run (build no nó) SEM depender de um `user` — usado pelo
 *  handler manual (wrapper com requireUser) e pelo agendador de auto-deploy. Os
 *  guards (repo conectado, ambiente running) ficam no chamador. */
export async function startDeployRun(env: EnvironmentRow, cfg: DeployConfigRow, trigger: "manual" | "auto"): Promise<DeployRunRow> {
  const steps = await db.select().from(deploySteps).where(eq(deploySteps.envId, env.id)).orderBy(deploySteps.ord);
  const evRows = await db.select().from(envVars).where(eq(envVars.envId, env.id));
  const buildEnv = evRows.filter((r) => r.buildTime).map((r) => ({ key: r.key, value: decryptSecret(r.valueEncrypted) }));
  const runIns = await db.insert(deployRuns).values({ envId: env.id, trigger, status: "running" }).returning();
  const run = runIns[0]!;
  const agentUrl = await agentUrlForEnv(env);
  try {
    await agent.startDeploy(agentUrl, {
      envId: env.id, image: baseImage(env), appContainerId: env.containerId!, workdir: appWorkdir(env),
      repoUrl: cfg.repoUrl!, branch: cfg.branch,
      steps: steps.map((s) => ({ kind: s.kind, command: s.command, cwd: s.cwd, enabled: s.enabled })),
      buildEnv, framework: cfg.framework, runModel: cfg.runModel, http: httpCredsFor(cfg), subdir: cfg.subdir,
      runId: run.id, nodeStartFile: env.nodeStartFile, historyLimit: cfg.historyLimit,
      runtimeKind: env.runtimeKind, pythonCmd: env.pythonCmd, dotnetCmd: env.dotnetCmd,
    });
  } catch (err) {
    await db.update(deployRuns).set({ status: "failed", log: String(err), finishedAt: new Date() }).where(eq(deployRuns.id, run.id));
    throw err;
  }
  await db.update(deployConfigs).set({ lastRunId: run.id, lastRunStatus: "running", lastRunAt: new Date() }).where(eq(deployConfigs.envId, env.id));
  return run;
}

/** Fecha um run "running" consultando o log do agente: persiste status/commit,
 *  atualiza lastGoodSha no sucesso e poda o histórico. Usado pelo GET log e pelo
 *  agendador de auto-deploy. */
export async function reconcileRun(env: EnvironmentRow, run: DeployRunRow): Promise<{ log: string | null; status: string }> {
  if (run.status !== "running") return { log: run.log, status: run.status };
  try {
    const agentUrl = await agentUrlForEnv(env);
    const live = await agent.deployLog(agentUrl, run.id);
    if (!live.done) return { log: live.log, status: "running" };
    await db.update(deployRuns).set({ status: live.status, log: live.log, commitSha: live.commitSha, exitCode: live.exitCode, finishedAt: new Date() }).where(eq(deployRuns.id, run.id));
    const patch: Record<string, unknown> = { lastRunStatus: live.status };
    if (live.status === "success" && live.commitSha) patch.lastGoodSha = live.commitSha;
    await db.update(deployConfigs).set(patch).where(eq(deployConfigs.envId, env.id));
    const cfgH = (await db.select().from(deployConfigs).where(eq(deployConfigs.envId, env.id)).limit(1))[0];
    const lim = cfgH?.historyLimit ?? 10;
    if (lim > 0) {
      const keep = await db.select({ id: deployRuns.id }).from(deployRuns).where(eq(deployRuns.envId, env.id)).orderBy(desc(deployRuns.startedAt)).limit(lim);
      const keepIds = keep.map((k) => k.id);
      if (keepIds.length) await db.delete(deployRuns).where(and(eq(deployRuns.envId, env.id), notInArray(deployRuns.id, keepIds)));
    }
    return { log: live.log, status: live.status };
  } catch {
    return { log: run.log, status: run.status };
  }
}

/** Passos padrão a partir da detecção do stack. */
type StepSeed = { kind: string; label: string; command: string | null; enabled: boolean; mutatesData?: boolean };
function defaultSteps(det: { framework: string; hasComposer: boolean; hasPackageJson: boolean; hasRequirements?: boolean }, kind: string): StepSeed[] {
  const s: StepSeed[] = [];
  s.push({ kind: "git_sync", label: "Baixar código (git)", command: null, enabled: true });
  if (det.framework === "laravel") {
    s.push({ kind: "composer_install", label: "Instalar dependências PHP (composer)", command: null, enabled: true });
    if (det.hasPackageJson) {
      s.push({ kind: "npm_ci", label: "Instalar dependências JS (npm)", command: null, enabled: true });
      s.push({ kind: "npm_build", label: "Build de assets (npm run build)", command: null, enabled: true });
    }
    s.push({ kind: "artisan_storage_link", label: "Link de storage (storage:link)", command: null, enabled: true });
    s.push({ kind: "artisan_clear", label: "Limpar caches (optimize:clear)", command: null, enabled: true });
    s.push({ kind: "artisan_optimize", label: "Cache de config/rotas/views", command: null, enabled: true });
    s.push({ kind: "artisan_migrate", label: "Migrações do banco (migrate) — altera dados", command: null, enabled: false, mutatesData: true });
    return s;
  }
  if (kind === "python") {
    if (det.hasRequirements) s.push({ kind: "pip_install", label: "Instalar dependências (pip)", command: null, enabled: true });
    s.push({ kind: "python_restart", label: "Reiniciar o app", command: null, enabled: true });
    return s;
  }
  if (kind === "static") {
    if (det.framework === "spa") {
      s.push({ kind: "npm_ci", label: "Instalar dependências (npm)", command: null, enabled: true });
      s.push({ kind: "npm_build", label: "Build do site (npm run build)", command: null, enabled: true });
    }
    // "site pronto": só baixar o código; o place copia direto para /app.
    return s;
  }
  if (kind === "dotnet") {
    s.push({ kind: "dotnet_publish", label: "Publicar (dotnet publish -c Release)", command: null, enabled: true });
    s.push({ kind: "dotnet_restart", label: "Reiniciar o app", command: null, enabled: true });
    return s;
  }
  if (det.hasComposer) s.push({ kind: "composer_install", label: "Instalar dependências (composer)", command: null, enabled: true });
  if (det.hasPackageJson) {
    s.push({ kind: "npm_ci", label: "Instalar dependências (npm)", command: null, enabled: true });
    s.push({ kind: "npm_build", label: det.framework === "nextjs" ? "Build (next build)" : "Build (npm run build)", command: null, enabled: true });
  }
  if (kind === "node") s.push({ kind: "node_restart", label: "Reiniciar o app", command: null, enabled: true });
  return s;
}

export async function deployRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/environments/:id/deploy",
    { schema: { params: idParams, response: { 200: deployConfigSchema, 401: apiError, 403: apiError, 404: apiError } } },
    async (req): Promise<DeployConfig> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      return toConfig(await loadOrCreateConfig(env));
    });

  app.put("/environments/:id/deploy/connection",
    { schema: { params: idParams, body: setDeployConnectionInput, response: { 200: deployConfigSchema, 400: apiError, 401: apiError, 403: apiError, 404: apiError } } },
    async (req): Promise<DeployConfig> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      await loadOrCreateConfig(env);
      const b = req.body;
      // Branch: o usuário NÃO digita — resolve a padrão do repo (fallback main).
      let branch = b.branch;
      if (!branch && b.repoUrl && b.connectionMode !== "ssh") {
        try {
          const agentUrl = await agentUrlForEnv(env);
          const pr = await agent.deployProbe(agentUrl, env.id, baseImage(env), b.repoUrl);
          branch = pr.defaultBranch ?? undefined;
        } catch { /* ignora — cai no fallback */ }
      }
      const set: Record<string, unknown> = {
        connectionMode: b.connectionMode, provider: b.provider, repoUrl: b.repoUrl, branch: branch || "main", mode: b.mode,
      };
      if (b.framework) set.framework = b.framework;
      const upd = await db.update(deployConfigs).set(set).where(eq(deployConfigs.envId, env.id)).returning();
      // Preset Laravel: docroot public/ (aplicado ao vivo só após o 1º deploy).
      if (b.framework === "laravel" && env.runtimeKind === "php") {
        await db.update(environments).set({ phpWebRoot: "/app/www" }).where(eq(environments.id, env.id));
      }
      // Preset Next.js escolhido no wizard: arquivo de start + env vars básicas.
      if (b.framework === "nextjs" && env.runtimeKind === "node") {
        await db.update(deployConfigs).set({ runModel: "standalone" }).where(eq(deployConfigs.envId, env.id));
        if (!env.nodeStartFile) await db.update(environments).set({ nodeStartFile: "server.js" }).where(eq(environments.id, env.id));
        for (const [k, v] of [["PORT", "80"], ["HOSTNAME", "0.0.0.0"], ["NODE_ENV", "production"]] as const) {
          const ex = await db.select().from(envVars).where(eq(envVars.envId, env.id));
          if (!ex.some((r) => r.key === k)) await db.insert(envVars).values({ envId: env.id, key: k, valueEncrypted: encryptSecret(v), buildTime: false }).onConflictDoNothing();
        }
      }
      const fresh = (await db.select().from(deployConfigs).where(eq(deployConfigs.envId, env.id)).limit(1))[0]!;
      return toConfig(fresh);
    });

  app.post("/environments/:id/deploy/probe",
    { schema: { params: idParams, body: deployProbeInput, response: { 200: deployProbeResult, 401: apiError, 403: apiError, 404: apiError, 502: apiError } } },
    async (req) => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const agentUrl = await agentUrlForEnv(env);
      const r = await agent.deployProbe(agentUrl, env.id, baseImage(env), req.body.repoUrl);
      return { reachable: r.reachable, isPrivate: r.isPrivate, provider: "github" as const, message: r.message, defaultBranch: r.defaultBranch };
    });

  app.post("/environments/:id/deploy/key/generate",
    { schema: { params: idParams, response: { 200: generatedDeployKey, 401: apiError, 403: apiError, 404: apiError, 502: apiError } } },
    async (req) => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      await loadOrCreateConfig(env);
      const agentUrl = await agentUrlForEnv(env);
      const r = await agent.deployKey(agentUrl, env.id, baseImage(env));
      // NÃO guardamos a chave pública — só a fingerprint. A pública aparece 1x (no retorno).
      await db.update(deployConfigs).set({ connectionMode: "ssh", publicKey: null, fingerprint: r.fingerprint, connectionVerifiedAt: null }).where(eq(deployConfigs.envId, env.id));
      return r;
    });

  app.post("/environments/:id/deploy/key/test",
    { schema: { params: idParams, response: { 200: z.object({ ok: z.boolean(), message: z.string() }), 401: apiError, 403: apiError, 404: apiError, 502: apiError } } },
    async (req) => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const cfg = await loadOrCreateConfig(env);
      if (!cfg.repoUrl) throw new ApiHttpError(400, "no_repo", "defina a URL do repositório antes de testar");
      const agentUrl = await agentUrlForEnv(env);
      const r = await agent.deployTest(agentUrl, env.id, baseImage(env), cfg.repoUrl);
      if (r.ok) await db.update(deployConfigs).set({ connectionVerifiedAt: new Date(), needsReconnect: false, ...(r.defaultBranch ? { branch: r.defaultBranch } : {}) }).where(eq(deployConfigs.envId, env.id));
      return { ok: r.ok, message: r.message };
    });

  // POST /deploy/key/import — o usuário cola a PRÓPRIA chave privada.
  app.post("/environments/:id/deploy/key/import",
    { schema: { params: idParams, body: importDeployKeyInput, response: { 200: generatedDeployKey, 400: apiError, 401: apiError, 403: apiError, 404: apiError, 502: apiError } } },
    async (req) => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      await loadOrCreateConfig(env);
      const agentUrl = await agentUrlForEnv(env);
      const r = await agent.deployImportKey(agentUrl, env.id, baseImage(env), req.body.privateKey);
      await db.update(deployConfigs).set({ connectionMode: "ssh", publicKey: null, fingerprint: r.fingerprint, connectionVerifiedAt: null }).where(eq(deployConfigs.envId, env.id));
      return r;
    });

  // PUT /deploy/http-credentials — usuário + senha/token (HTTPS); testa e guarda.
  app.put("/environments/:id/deploy/http-credentials",
    { schema: { params: idParams, body: setDeployHttpCredentialsInput, response: { 200: z.object({ ok: z.boolean(), message: z.string() }), 400: apiError, 401: apiError, 403: apiError, 404: apiError, 502: apiError } } },
    async (req) => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const cfg = await loadOrCreateConfig(env);
      if (!cfg.repoUrl) throw new ApiHttpError(400, "no_repo", "defina a URL do repositório antes");
      await db.update(deployConfigs).set({ connectionMode: "http", httpUsername: req.body.username, httpPasswordEnc: encryptSecret(req.body.password) }).where(eq(deployConfigs.envId, env.id));
      const agentUrl = await agentUrlForEnv(env);
      const r = await agent.deployTest(agentUrl, env.id, baseImage(env), cfg.repoUrl, { username: req.body.username, password: req.body.password });
      if (r.ok) await db.update(deployConfigs).set({ connectionVerifiedAt: new Date(), needsReconnect: false, ...(r.defaultBranch ? { branch: r.defaultBranch } : {}) }).where(eq(deployConfigs.envId, env.id));
      return { ok: r.ok, message: r.ok ? "Conectado ✓" : "Usuário/senha não autenticaram no repositório." };
    });

  app.put("/environments/:id/deploy/history",
    { schema: { params: idParams, body: setDeployHistoryInput, response: { 200: deployConfigSchema, 400: apiError, 401: apiError, 403: apiError, 404: apiError } } },
    async (req): Promise<DeployConfig> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      await loadOrCreateConfig(env);
      const upd = await db.update(deployConfigs).set({ historyLimit: req.body.historyLimit }).where(eq(deployConfigs.envId, env.id)).returning();
      return toConfig(upd[0]!);
    });

  app.get("/environments/:id/deploy/branches",
    { schema: { params: idParams, response: { 200: deployBranchesResult, 400: apiError, 401: apiError, 403: apiError, 404: apiError, 409: apiError, 502: apiError } } },
    async (req) => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const cfg = await loadOrCreateConfig(env);
      if (!cfg.repoUrl) throw new ApiHttpError(400, "no_repo", "conecte um repositório antes");
      const verified = !!cfg.connectionVerifiedAt || cfg.connectionMode === "public";
      if (!verified) throw new ApiHttpError(409, "not_verified", "teste a conexão antes de listar as branches");
      const agentUrl = await agentUrlForEnv(env);
      const r = await agent.deployBranches(agentUrl, env.id, baseImage(env), cfg.repoUrl, httpCredsFor(cfg));
      return { ok: r.ok, branches: r.branches, current: cfg.branch, message: r.message };
    });

  app.put("/environments/:id/deploy/branch",
    { schema: { params: idParams, body: setDeployBranchInput, response: { 200: deployConfigSchema, 400: apiError, 401: apiError, 403: apiError, 404: apiError, 409: apiError, 502: apiError } } },
    async (req): Promise<DeployConfig> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const cfg = await loadOrCreateConfig(env);
      if (!cfg.repoUrl) throw new ApiHttpError(400, "no_repo", "conecte um repositório antes");
      const verified = !!cfg.connectionVerifiedAt || cfg.connectionMode === "public";
      if (!verified) throw new ApiHttpError(409, "not_verified", "teste a conexão antes de trocar a branch");
      const agentUrl = await agentUrlForEnv(env);
      try {
        const r = await agent.deployBranches(agentUrl, env.id, baseImage(env), cfg.repoUrl, httpCredsFor(cfg));
        if (r.ok && r.branches.length && !r.branches.includes(req.body.branch)) {
          throw new ApiHttpError(400, "unknown_branch", "essa branch não existe mais no repositório");
        }
      } catch (err) {
        if (err instanceof ApiHttpError) throw err; // propaga unknown_branch; ignora falha de listagem
      }
      await db.update(deployConfigs).set({ branch: req.body.branch }).where(eq(deployConfigs.envId, env.id));
      const fresh = (await db.select().from(deployConfigs).where(eq(deployConfigs.envId, env.id)).limit(1))[0]!;
      return toConfig(fresh);
    });

  app.post("/environments/:id/deploy/steps/detect",
    { schema: { params: idParams, response: { 200: deployConfigSchema, 401: apiError, 403: apiError, 404: apiError, 502: apiError } } },
    async (req): Promise<DeployConfig> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const cfg = await loadOrCreateConfig(env);
      if (!cfg.repoUrl) throw new ApiHttpError(400, "no_repo", "conecte um repositório antes de detectar");
      const agentUrl = await agentUrlForEnv(env);
      const det = await agent.deployDetect(agentUrl, env.id, baseImage(env), cfg.repoUrl, cfg.branch, env.runtimeKind, httpCredsFor(cfg));
      const steps = defaultSteps(det, env.runtimeKind);
      await db.delete(deploySteps).where(eq(deploySteps.envId, env.id));
      if (steps.length) await db.insert(deploySteps).values(steps.map((s, i) => ({ envId: env.id, ord: i, kind: s.kind, command: s.command, label: s.label, enabled: s.enabled, mutatesData: s.mutatesData ?? false })));
      await db.update(deployConfigs).set({ framework: det.framework, runModel: det.runModel }).where(eq(deployConfigs.envId, env.id));
      if (det.framework === "laravel" && env.runtimeKind === "php") {
        await db.update(environments).set({ phpWebRoot: "/app/www" }).where(eq(environments.id, env.id));
      }
      // Next.js: pré-configura PORT/HOSTNAME/NODE_ENV + arquivo de start (muito simples).
      if (det.framework === "nextjs" && env.runtimeKind === "node") {
        for (const [k, v] of [["PORT", "80"], ["HOSTNAME", "0.0.0.0"], ["NODE_ENV", "production"]] as const) {
          const ex = await db.select().from(envVars).where(eq(envVars.envId, env.id));
          if (!ex.some((r) => r.key === k)) {
            await db.insert(envVars).values({ envId: env.id, key: k, valueEncrypted: encryptSecret(v), buildTime: false }).onConflictDoNothing();
          }
        }
      }
      // Python/Django: define arquivo de start (ou comando avançado) + PYTHONPATH
      // do diretório vendorizado (deps do pip sobrevivem ao recreate no volume).
      if (env.runtimeKind === "python") {
        const patch: Partial<{ nodeStartFile: string | null; pythonCmd: string | null }> = {};
        if (det.framework === "django" && det.suggestedPythonCmd) patch.pythonCmd = det.suggestedPythonCmd;
        else patch.nodeStartFile = det.suggestedStartFile || "app.py";
        if (Object.keys(patch).length) await db.update(environments).set(patch).where(eq(environments.id, env.id));
        for (const [k, v] of [["PYTHONPATH", "/app/.vp-vendor"], ["PYTHONUNBUFFERED", "1"]] as const) {
          const ex = await db.select().from(envVars).where(eq(envVars.envId, env.id));
          if (!ex.some((r) => r.key === k)) {
            await db.insert(envVars).values({ envId: env.id, key: k, valueEncrypted: encryptSecret(v), buildTime: false }).onConflictDoNothing();
          }
        }
      }
      // .NET: pré-configura ASPNETCORE_URLS/HTTP_PORTS (o app escuta na :80) + opt-out de telemetria.
      if (env.runtimeKind === "dotnet") {
        for (const [k, v] of [
          ["ASPNETCORE_URLS", "http://0.0.0.0:80"],
          ["ASPNETCORE_HTTP_PORTS", "80"],
          ["DOTNET_CLI_TELEMETRY_OPTOUT", "1"],
          ["DOTNET_NOLOGO", "1"],
        ] as const) {
          const ex = await db.select().from(envVars).where(eq(envVars.envId, env.id));
          if (!ex.some((r) => r.key === k)) {
            await db.insert(envVars).values({ envId: env.id, key: k, valueEncrypted: encryptSecret(v), buildTime: false }).onConflictDoNothing();
          }
        }
      }
      const fresh = (await db.select().from(deployConfigs).where(eq(deployConfigs.envId, env.id)).limit(1))[0]!;
      return toConfig(fresh);
    });

  app.put("/environments/:id/deploy/steps",
    { schema: { params: idParams, body: setDeployStepsInput, response: { 200: deployConfigSchema, 400: apiError, 401: apiError, 403: apiError, 404: apiError } } },
    async (req): Promise<DeployConfig> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      await loadOrCreateConfig(env);
      await db.delete(deploySteps).where(eq(deploySteps.envId, env.id));
      const steps = req.body.steps;
      if (steps.length) await db.insert(deploySteps).values(steps.map((s, i) => ({ envId: env.id, ord: i, kind: s.kind, command: s.command ?? null, label: s.label, cwd: s.cwd ?? null, enabled: s.enabled, mutatesData: s.mutatesData ?? false })));
      await db.update(deployConfigs).set({ mode: req.body.mode, subdir: req.body.subdir ?? null }).where(eq(deployConfigs.envId, env.id));
      const fresh = (await db.select().from(deployConfigs).where(eq(deployConfigs.envId, env.id)).limit(1))[0]!;
      return toConfig(fresh);
    });

  app.put("/environments/:id/deploy/auto",
    { schema: { params: idParams, body: setDeployAutoInput, response: { 200: deployConfigSchema, 400: apiError, 401: apiError, 403: apiError, 404: apiError } } },
    async (req): Promise<DeployConfig> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      await loadOrCreateConfig(env);
      const upd = await db.update(deployConfigs).set({ autoEnabled: req.body.autoEnabled, intervalMinutes: req.body.intervalMinutes, nextCheckAt: req.body.autoEnabled ? new Date() : null }).where(eq(deployConfigs.envId, env.id)).returning();
      return toConfig(upd[0]!);
    });

  // POST /run — executa o deploy (build no irmão + place). Cria um deploy_run.
  app.post("/environments/:id/deploy/run",
    { schema: { params: idParams, response: { 200: deployRunSchema, 400: apiError, 401: apiError, 403: apiError, 404: apiError, 409: apiError, 502: apiError } } },
    async (req): Promise<DeployRun> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const cfg = await loadOrCreateConfig(env);
      if (!cfg.repoUrl) throw new ApiHttpError(400, "no_repo", "conecte um repositório antes de fazer deploy");
      if (!env.containerId || env.state !== "running") throw new ApiHttpError(400, "not_running", "o ambiente precisa estar rodando");

      let run: DeployRunRow;
      try {
        run = await startDeployRun(env, cfg, "manual");
      } catch {
        throw new ApiHttpError(502, "deploy_failed", "falha ao iniciar o deploy no nó");
      }
      return { id: run.id, trigger: "manual", status: "running", exitCode: null, failedStepKind: null, commitSha: null, commitMessage: null, startedAt: run.startedAt.toISOString(), finishedAt: null };
    });

  app.get("/environments/:id/deploy/runs",
    { schema: { params: idParams, response: { 200: z.array(deployRunSchema), 401: apiError, 403: apiError, 404: apiError } } },
    async (req): Promise<DeployRun[]> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const rows = await db.select().from(deployRuns).where(eq(deployRuns.envId, env.id)).orderBy(desc(deployRuns.startedAt)).limit(30);
      return rows.map((r) => ({ id: r.id, trigger: r.trigger as DeployRun["trigger"], status: r.status as DeployRun["status"], exitCode: r.exitCode, failedStepKind: (r.failedStepKind as DeployRun["failedStepKind"]) ?? null, commitSha: r.commitSha, commitMessage: r.commitMessage, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null }));
    });

  app.get("/environments/:id/deploy/runs/:runId/log",
    { schema: { params: runParams, response: { 200: z.object({ log: z.string().nullable(), status: z.string() }), 401: apiError, 403: apiError, 404: apiError } } },
    async (req) => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const rows = await db.select().from(deployRuns).where(eq(deployRuns.id, req.params.runId)).limit(1);
      const r = rows[0];
      if (!r || r.envId !== env.id) throw new ApiHttpError(404, "not_found", "execução não encontrada");
      return reconcileRun(env, r);
    });

  // DELETE /environments/:id/deploy — apaga TODA a configuração de deploy do
  // ambiente (config, passos, histórico) e limpa o volume/chave no nó. Recomeça do zero.
  app.delete("/environments/:id/deploy",
    { schema: { params: idParams, response: { 204: z.null(), 401: apiError, 403: apiError, 404: apiError } } },
    async (req, reply) => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      try {
        const agentUrl = await agentUrlForEnv(env);
        await agent.deployReset(agentUrl, env.id, baseImage(env));
      } catch (err) {
        req.log.warn({ err, envId: env.id }, "falha ao limpar o volume de deploy no nó (segue apagando do DB)");
      }
      await db.delete(deployRuns).where(eq(deployRuns.envId, env.id));
      await db.delete(deploySteps).where(eq(deploySteps.envId, env.id));
      await db.delete(deployConfigs).where(eq(deployConfigs.envId, env.id));
      return reply.status(204).send(null);
    });
}
