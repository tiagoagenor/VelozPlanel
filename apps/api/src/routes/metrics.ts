import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, eq, gte, asc } from "drizzle-orm";
import { metricSeries, apiError } from "@velozplanel/contracts";
import type { MetricSeries } from "@velozplanel/contracts";
import { db } from "../db/client";
import { metricSamples } from "../db/schema";
import { requireUser } from "../auth";
import { loadEnvironmentForUser } from "./environments";

/** Converte "15m" / "1h" / "30s" em milissegundos. Default 15 min. */
function windowMs(w: string | undefined): number {
  const m = /^(\d+)([smh])$/.exec(w ?? "15m");
  if (!m) return 15 * 60 * 1000;
  const nStr = m[1];
  const unit = m[2];
  if (!nStr || !unit) return 15 * 60 * 1000;
  const n = Number(nStr);
  const factor = unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000;
  return n * factor;
}

export async function metricsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/environments/:id/metrics",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({ window: z.string().optional() }),
        response: { 200: metricSeries, 401: apiError, 403: apiError, 404: apiError },
      },
    },
    async (req): Promise<MetricSeries> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);

      const since = new Date(Date.now() - windowMs(req.query.window));
      const rows = await db
        .select()
        .from(metricSamples)
        .where(and(eq(metricSamples.envId, env.id), gte(metricSamples.ts, since)))
        .orderBy(asc(metricSamples.ts));

      return {
        envId: env.id,
        samples: rows.map((r) => ({
          ts: r.ts.getTime(),
          cpuPct: r.cpuPct,
          memBytes: r.memBytes,
          memLimitBytes: r.memLimitBytes,
        })),
      };
    },
  );
}
