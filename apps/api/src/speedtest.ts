/**
 * Teste de velocidade de internet do NÓ LOCAL (sp-local).
 *
 * A API chama o endpoint `/speedtest` do agente daquele nó (via WireGuard),
 * guarda o resultado em `speedtest_runs` e expõe o histórico só para o super
 * admin (ver routes/speedtest.ts). Um agendador roda o teste 1x por hora.
 *
 * O "último cron" é derivado da própria tabela (não de uma coluna de settings),
 * então reiniciar a API não dispara execuções extras: só roda se a última do
 * tipo "cron" tiver mais de 1h.
 */
import type { FastifyBaseLogger } from "fastify";
import { desc, eq, lt } from "drizzle-orm";
import { db } from "./db/client";
import { nodes, speedtestRuns } from "./db/schema";
import type { SpeedtestRunRow } from "./db/schema";
import * as agent from "./agent";

const HOUR_MS = 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000; // após uma falha, tenta de novo já no próximo tick
const RETENTION_DAYS = 30;

/** Nó alvo: prefere o chamado `sp-local`, senão o primeiro com "local" no nome. */
async function findLocalNode() {
  const rows = await db.select().from(nodes);
  return (
    rows.find((n) => n.name === "sp-local") ??
    rows.find((n) => /local/i.test(n.name)) ??
    null
  );
}

/** Roda o teste no nó local e persiste o resultado (sucesso ou falha). */
export async function runSpeedtestOnLocal(
  source: "cron" | "manual",
  log: FastifyBaseLogger,
): Promise<SpeedtestRunRow> {
  const node = await findLocalNode();
  if (!node) throw new Error("nenhum nó local encontrado");
  const agentUrl = node.agentUrl;
  if (!agentUrl) throw new Error(`nó ${node.name} sem agentUrl configurado`);

  let values: typeof speedtestRuns.$inferInsert;
  try {
    const r = await agent.speedtest(agentUrl);
    values = {
      nodeId: node.id,
      nodeName: node.name,
      downloadMbps: r.downloadMbps,
      uploadMbps: r.uploadMbps,
      pingMs: r.pingMs,
      ok: true,
      error: null,
      source,
    };
  } catch (err) {
    values = {
      nodeId: node.id,
      nodeName: node.name,
      downloadMbps: 0,
      uploadMbps: 0,
      pingMs: null,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      source,
    };
  }

  const [row] = await db.insert(speedtestRuns).values(values).returning();
  if (!row) throw new Error("falha ao gravar o resultado do teste");
  // Retenção: mantém 30 dias de histórico.
  await db
    .delete(speedtestRuns)
    .where(lt(speedtestRuns.createdAt, new Date(Date.now() - RETENTION_DAYS * 24 * HOUR_MS)));

  log.info(
    { ok: row.ok, download: row.downloadMbps, upload: row.uploadMbps, ping: row.pingMs, source },
    "speedtest run",
  );
  return row;
}

/** Histórico (mais recente primeiro). */
export async function recentSpeedtests(limit = 100): Promise<SpeedtestRunRow[]> {
  return db.select().from(speedtestRuns).orderBy(desc(speedtestRuns.createdAt)).limit(limit);
}

/**
 * Agendador: roda o teste 1x por hora no nó local. Verifica de 5 em 5 min
 * (+ um disparo ~30s após subir) e só executa se a última rodada "cron" tiver
 * completado há mais de 1h.
 */
export function startSpeedtestScheduler(log: FastifyBaseLogger): () => void {
  const tick = async (): Promise<void> => {
    try {
      const [last] = await db
        .select({ createdAt: speedtestRuns.createdAt, ok: speedtestRuns.ok })
        .from(speedtestRuns)
        .where(eq(speedtestRuns.source, "cron"))
        .orderBy(desc(speedtestRuns.createdAt))
        .limit(1);
      const lastMs = last?.createdAt ? last.createdAt.getTime() : 0;
      // Após um sucesso: espera 1h. Após uma falha: tenta de novo em ~5 min
      // (não deixa um erro transitório travar o teste por uma hora inteira).
      const dueMs = last && !last.ok ? RETRY_MS : HOUR_MS;
      if (Date.now() - lastMs < dueMs) return;
      await runSpeedtestOnLocal("cron", log);
    } catch (err) {
      log.error({ err }, "speedtest scheduler tick failed");
    }
  };
  const kick = setTimeout(() => void tick(), 30_000);
  const handle = setInterval(() => void tick(), 5 * 60_000);
  log.info("agendador de teste de velocidade iniciado (1x/hora no nó local)");
  return () => {
    clearTimeout(kick);
    clearInterval(handle);
  };
}
