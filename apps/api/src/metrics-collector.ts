import type { FastifyBaseLogger } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { environments, metricSamples } from "./db/schema";
import * as agent from "./agent";

const INTERVAL_MS = 5000;

/**
 * A cada 5s: para cada ambiente `running` com container, busca stats do Agente
 * e grava uma amostra. Tolerante a falhas — loga e segue (nunca derruba o loop).
 * Retorna uma função para parar o coletor.
 */
export function startMetricsCollector(log: FastifyBaseLogger): () => void {
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return; // evita sobreposição se um ciclo demorar
    running = true;
    try {
      const envs = await db
        .select()
        .from(environments)
        .where(eq(environments.state, "running"));

      for (const env of envs) {
        if (!env.containerId) continue;
        try {
          const s = await agent.stats(env.containerId);
          await db.insert(metricSamples).values({
            envId: env.id,
            cpuPct: s.cpuPct,
            memBytes: s.memBytes,
            memLimitBytes: s.memLimitBytes,
          });
        } catch (err) {
          log.warn({ err, envId: env.id }, "coletor: falha ao amostrar métricas");
        }
      }
    } catch (err) {
      log.warn({ err }, "coletor: falha no ciclo");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, INTERVAL_MS);
  timer.unref?.();

  log.info(`coletor de métricas iniciado (intervalo ${INTERVAL_MS}ms)`);
  return () => clearInterval(timer);
}
