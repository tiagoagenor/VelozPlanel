import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { count } from "drizzle-orm";
import { node as nodeSchema, apiError } from "@velozplanel/contracts";
import type { Node, NodeStatus } from "@velozplanel/contracts";
import { db } from "../db/client";
import { nodes, environments } from "../db/schema";
import { requireAdmin } from "../auth";

export async function nodeRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/nodes",
    { schema: { response: { 200: z.array(nodeSchema), 401: apiError, 403: apiError } } },
    async (req): Promise<Node[]> => {
      await requireAdmin(req);

      const [allNodes, envCounts] = await Promise.all([
        db.select().from(nodes),
        db
          .select({ nodeId: environments.nodeId, c: count() })
          .from(environments)
          .groupBy(environments.nodeId),
      ]);

      const countByNode = new Map<string, number>();
      for (const row of envCounts) {
        if (row.nodeId) countByNode.set(row.nodeId, row.c);
      }

      return allNodes.map((n) => ({
        id: n.id,
        name: n.name,
        region: n.region,
        status: n.status as NodeStatus,
        vcpuTotal: n.vcpuTotal,
        memMbTotal: n.memMbTotal,
        envCount: countByNode.get(n.id) ?? 0,
        lastSeenAt: n.lastSeenAt ? n.lastSeenAt.toISOString() : null,
      }));
    },
  );
}
