import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { count, eq } from "drizzle-orm";
import { node as nodeSchema, updateNodeInput, apiError } from "@velozplanel/contracts";
import type { Node, NodeStatus } from "@velozplanel/contracts";
import { db } from "../db/client";
import { nodes, environments } from "../db/schema";
import { requireAdmin, ApiHttpError } from "../auth";

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
        publicHost: n.publicHost,
        httpHost: n.httpHost,
        alertMessage: n.alertMessage,
        agentUrl: n.agentUrl,
        lastSeenAt: n.lastSeenAt ? n.lastSeenAt.toISOString() : null,
      }));
    },
  );

  // Super admin edita o host público do nó (usado em SSH e no registro A do DNS).
  app.patch(
    "/nodes/:id",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: updateNodeInput,
        response: { 200: nodeSchema, 401: apiError, 403: apiError, 404: apiError },
      },
    },
    async (req): Promise<Node> => {
      await requireAdmin(req);
      const patch: Partial<{ publicHost: string | null; httpHost: string | null; alertMessage: string | null; agentUrl: string | null }> = {};
      if (req.body.publicHost !== undefined) patch.publicHost = req.body.publicHost;
      if (req.body.httpHost !== undefined) patch.httpHost = req.body.httpHost;
      if (req.body.alertMessage !== undefined) patch.alertMessage = req.body.alertMessage;
      if (req.body.agentUrl !== undefined) patch.agentUrl = req.body.agentUrl;
      const updated = await db
        .update(nodes)
        .set(patch)
        .where(eq(nodes.id, req.params.id))
        .returning();
      const n = updated[0];
      if (!n) throw new ApiHttpError(404, "not_found", "nó não encontrado");
      const [c] = await db
        .select({ c: count() })
        .from(environments)
        .where(eq(environments.nodeId, n.id));
      return {
        id: n.id,
        name: n.name,
        region: n.region,
        status: n.status as NodeStatus,
        vcpuTotal: n.vcpuTotal,
        memMbTotal: n.memMbTotal,
        envCount: c?.c ?? 0,
        publicHost: n.publicHost,
        httpHost: n.httpHost,
        alertMessage: n.alertMessage,
        agentUrl: n.agentUrl,
        lastSeenAt: n.lastSeenAt ? n.lastSeenAt.toISOString() : null,
      };
    },
  );
}
