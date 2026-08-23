import type { FastifyBaseLogger } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { dnsZonesMeta } from "./db/schema";
import { verifyZone } from "./dns-resolver";

/**
 * Reverifica a delegação das zonas em segundo plano (mesmo molde do
 * metrics-collector: guard de reentrância + nunca lança + timer.unref).
 *
 *  - zonas `pending`/`unknown`: reverifica a cada ciclo (~5 min) — saem sozinhas
 *    quando a delegação propaga (ou quando o timeout foi transitório).
 *  - zonas já `active`/`active_no_redundancy`/`error`: reverifica só se a última
 *    checagem tem mais de ~30 min (mantém o serial fresco sem martelar).
 */
const INTERVAL_MS = 5 * 60_000;
const STALE_MS = 30 * 60_000;

export function startDnsVerifier(log: FastifyBaseLogger): () => void {
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const rows = await db.select().from(dnsZonesMeta);
      const now = Date.now();
      for (const z of rows) {
        const fresh = z.checkedAt ? now - z.checkedAt.getTime() < STALE_MS : false;
        const active = z.status === "active" || z.status === "active_no_redundancy" || z.status === "error";
        if (active && fresh) continue; // não precisa reverificar ainda

        try {
          const r = await verifyZone(z.zone);
          if (r.status !== z.status) {
            log.info({ zone: z.zone, from: z.status, to: r.status }, "dns: status da zona mudou");
          }
          await db
            .update(dnsZonesMeta)
            .set({ status: r.status, serial: r.serial, checkedAt: new Date(r.checkedAt), checkMsg: r.error })
            .where(eq(dnsZonesMeta.zone, z.zone));
        } catch (err) {
          log.warn({ err, zone: z.zone }, "dns: falha ao verificar zona");
        }
      }
    } catch (err) {
      log.warn({ err }, "dns: falha no ciclo do verificador");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), INTERVAL_MS);
  timer.unref?.();
  log.info(`verificador de DNS iniciado (intervalo ${INTERVAL_MS}ms)`);
  return () => clearInterval(timer);
}
