import type { FastifyBaseLogger } from "fastify";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { db } from "./db/client";
import { deployConfigs, deployRuns, deploySteps, environments } from "./db/schema";
import type { DeployConfigRow } from "./db/schema";
import { agentUrlForEnv } from "./nodes";
import * as agent from "./agent";
import { baseImage, httpCredsFor, reconcileRun, startDeployRun } from "./routes/deploy";

/*
 * Agendador de DEPLOY AUTOMÁTICO (o "cron"): a cada tick, pega os ambientes com
 * auto-deploy ligado e vencidos (nextCheckAt <= agora), lê o último commit da
 * branch remota (git ls-remote no nó) e, se mudou, dispara um deploy. Mesmo
 * padrão de startBillingScheduler/startSpeedtestScheduler.
 */

const TICK_MS = 30_000;

export function startDeployScheduler(log: FastifyBaseLogger): () => void {
  let running = false; // single-flight: nunca dois ticks ao mesmo tempo
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const due = await db.select().from(deployConfigs).where(
        and(
          eq(deployConfigs.autoEnabled, true),
          or(isNull(deployConfigs.nextCheckAt), lte(deployConfigs.nextCheckAt, new Date())),
        ),
      );
      for (const cfg of due) {
        try { await processOne(cfg, log); }
        catch (err) { log.error({ err, envId: cfg.envId }, "auto-deploy: erro processando env"); }
      }
    } catch (err) {
      log.error({ err }, "auto-deploy scheduler tick failed");
    } finally {
      running = false;
    }
  };
  const kick = setTimeout(() => void tick(), 20_000); // 1º disparo ~20s após subir
  const handle = setInterval(() => void tick(), TICK_MS);
  return () => { clearTimeout(kick); clearInterval(handle); };
}

async function processOne(cfg: DeployConfigRow, log: FastifyBaseLogger): Promise<void> {
  const env = (await db.select().from(environments).where(eq(environments.id, cfg.envId)).limit(1))[0];
  const next = new Date(Date.now() + Math.max(1, cfg.intervalMinutes) * 60_000);
  const bump = (extra?: Record<string, unknown>) =>
    db.update(deployConfigs).set({ lastCheckAt: new Date(), nextCheckAt: next, ...(extra ?? {}) }).where(eq(deployConfigs.envId, cfg.envId));

  if (!env) { await bump(); return; }

  // Fecha um run automático anterior ainda "running" (persiste status/commit + poda).
  if (cfg.lastRunStatus === "running" && cfg.lastRunId) {
    const prev = (await db.select().from(deployRuns).where(eq(deployRuns.id, cfg.lastRunId)).limit(1))[0];
    if (prev) await reconcileRun(env, prev).catch(() => {});
  }

  // Só dispara se o ambiente está PRONTO (running + container + verificado + passos).
  const verified = !!cfg.connectionVerifiedAt || cfg.connectionMode === "public";
  const stepsCount = (await db.select({ id: deploySteps.id }).from(deploySteps).where(eq(deploySteps.envId, env.id))).length;
  const ready = !!cfg.repoUrl && env.state === "running" && !!env.containerId && verified && stepsCount > 0;
  if (!ready) { await bump(); return; }

  const agentUrl = await agentUrlForEnv(env);
  const res = await agent.deployRemoteSha(agentUrl, env.id, baseImage(env), cfg.repoUrl!, cfg.branch, httpCredsFor(cfg));
  const sha = res.ok ? res.sha : null;
  if (!sha) { await bump(); return; } // não conseguiu ler o SHA — tenta de novo no próximo ciclo

  if (sha === cfg.lastRemoteSha) { await bump(); return; } // sem commit novo

  // Novo commit: grava o SHA visto ANTES de disparar (dedup — nunca redispara o
  // mesmo commit, nem se o deploy falhar).
  await bump({ lastRemoteSha: sha });
  try {
    const run = await startDeployRun(env, cfg, "auto");
    log.info({ envId: env.id, sha: sha.slice(0, 8), runId: run.id }, "auto-deploy: novo commit → deploy disparado");
  } catch (err) {
    log.error({ err, envId: env.id }, "auto-deploy: falha ao disparar o deploy");
  }
}
