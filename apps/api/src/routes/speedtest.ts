import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { speedtestResult, apiError } from "@velozplanel/contracts";
import type { SpeedtestResult } from "@velozplanel/contracts";
import { requireAdmin } from "../auth";
import { recentSpeedtests, runManualSpeedtest } from "../speedtest";
import type { SpeedtestRunRow } from "../db/schema";

function toDto(r: SpeedtestRunRow): SpeedtestResult {
  return {
    id: r.id,
    nodeId: r.nodeId,
    nodeName: r.nodeName,
    downloadMbps: r.downloadMbps,
    uploadMbps: r.uploadMbps,
    pingMs: r.pingMs,
    ok: r.ok,
    error: r.error,
    source: r.source === "manual" ? "manual" : "cron",
    createdAt: r.createdAt.toISOString(),
  };
}

/** Rotas do teste de velocidade — TODAS restritas ao super admin. */
export async function speedtestRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/admin/speedtests",
    {
      schema: {
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(500).optional() }),
        response: { 200: z.array(speedtestResult), 401: apiError, 403: apiError },
      },
    },
    async (req): Promise<SpeedtestResult[]> => {
      await requireAdmin(req);
      const { limit } = req.query as { limit?: number };
      const rows = await recentSpeedtests(limit ?? 100);
      return rows.map(toDto);
    },
  );

  app.post(
    "/admin/speedtests/run",
    { schema: { response: { 200: speedtestResult, 401: apiError, 403: apiError, 500: apiError } } },
    async (req): Promise<SpeedtestResult> => {
      await requireAdmin(req);
      const row = await runManualSpeedtest(req.log);
      return toDto(row);
    },
  );
}
