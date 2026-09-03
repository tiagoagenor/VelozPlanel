import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import net from "node:net";
import { z } from "zod";
import { count, eq } from "drizzle-orm";
import { node as nodeSchema, updateNodeInput, apiError } from "@velozplanel/contracts";
import type { Node, NodeStatus } from "@velozplanel/contracts";
import { db } from "../db/client";
import { nodes, environments, platformSettings } from "../db/schema";
import { requireAdmin, ApiHttpError } from "../auth";
import { migrateNodeSubs } from "../sub-ingress";

/** TCP connect a host:port com timeout — testa se a porta está pública/aberta. */
function tcpOpen(host: string, port: number, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
  });
}

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
        edgeMode: n.edgeMode,
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
      const before = (await db.select().from(nodes).where(eq(nodes.id, req.params.id)).limit(1))[0];
      if (!before) throw new ApiHttpError(404, "not_found", "nó não encontrado");
      const patch: Partial<{ publicHost: string | null; httpHost: string | null; alertMessage: string | null; agentUrl: string | null; region: string; edgeMode: boolean }> = {};
      if (req.body.publicHost !== undefined) patch.publicHost = req.body.publicHost;
      if (req.body.httpHost !== undefined) patch.httpHost = req.body.httpHost;
      if (req.body.alertMessage !== undefined) patch.alertMessage = req.body.alertMessage;
      if (req.body.agentUrl !== undefined) patch.agentUrl = req.body.agentUrl;
      if (req.body.edgeMode !== undefined) patch.edgeMode = req.body.edgeMode;
      // Guard de segurança: só deixa LIGAR o edge se o host público responder na 443.
      // Senão os subdomínios do nó passariam a resolver pro nó e quebrariam (sem cert,
      // sem 443) — ex.: nó atrás de NAT com público mas 80/443 fechados no roteador.
      if (req.body.edgeMode === true && before.edgeMode !== true) {
        const host = req.body.publicHost !== undefined ? req.body.publicHost : before.publicHost;
        if (!host || !/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
          throw new ApiHttpError(409, "edge_no_public_ip", "defina um IP público IPv4 no nó antes de ligar o edge por nó.");
        }
        if (!(await tcpOpen(host, 443))) {
          throw new ApiHttpError(
            409,
            "edge_unreachable",
            `o host ${host} não respondeu na porta 443. Abra 80/443 nesse IP (e use DDNS se o IP for dinâmico) antes de ligar o edge por nó.`,
          );
        }
      }
      const newRegion = req.body.region?.trim();
      if (newRegion) patch.region = newRegion;
      const updated = await db
        .update(nodes)
        .set(patch)
        .where(eq(nodes.id, req.params.id))
        .returning();
      const n = updated[0];
      if (!n) throw new ApiHttpError(404, "not_found", "nó não encontrado");
      // Ligar/desligar o edge muda o roteamento de TODOS os subdomínios do nó (A record
      // + vhost central↔nó). Re-publica em background (best-effort; o cert LE emite em
      // segundos ao ligar). Não bloqueia a resposta do PATCH.
      if (req.body.edgeMode !== undefined && req.body.edgeMode !== before.edgeMode) {
        void migrateNodeSubs(n.id).catch(() => {});
      }
      // Se renomeou a região que era a padrão do wizard, a padrão acompanha.
      if (newRegion && newRegion !== before.region) {
        await db.update(platformSettings).set({ defaultRegion: newRegion }).where(eq(platformSettings.defaultRegion, before.region));
      }
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
        edgeMode: n.edgeMode,
        lastSeenAt: n.lastSeenAt ? n.lastSeenAt.toISOString() : null,
      };
    },
  );
}
