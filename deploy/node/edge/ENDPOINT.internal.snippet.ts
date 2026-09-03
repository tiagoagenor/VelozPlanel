// ─────────────────────────────────────────────────────────────────────────────
// PROPOSTA de handler para o DDNS do nó de casa. COLAR dentro de
// `internalRoutes(fastify)` em apps/api/src/routes/internal.ts (ex.: logo após o
// bloco de DNS, por volta da linha 239). NÃO aplicado — aguarda aprovação do dono.
//
// Requer imports já presentes em internal.ts: `db`, `nodes`, `eq`. Precisa somar:
//   import { migrateNodeSubs } from "../sub-ingress";
//   import { publicTargetForNode } from "../sub-ingress"; // (opcional, ver nota)
// e um util para o IP WG de origem (reuso do padrão de cp-ingress):
//   import { wgIpFromAgentUrl } from "../cp-ingress";
// ─────────────────────────────────────────────────────────────────────────────

// POST /internal/nodes/self/public-ip  { ip: "189.51.28.85" }
// Identifica o nó pelo IP WG de ORIGEM da conexão (o nó fala por WireGuard direto
// com 10.100.0.1:4000, sem proxy no meio → req.socket.remoteAddress é o IP WG).
// Casa esse IP com wgIpFromAgentUrl(nodes.agent_url). Se o novo IP != public_host:
// atualiza public_host e re-aponta os A dos subs edge (migrateNodeSubs).
fastify.post("/internal/nodes/self/public-ip", async (req, reply) => {
  if (!tokenOk(req.headers["x-internal-token"])) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  const ip = (req.body as { ip?: unknown } | undefined)?.ip;
  if (typeof ip !== "string" || !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip.trim())) {
    return reply.code(400).send({ error: "bad_ip" });
  }
  const newIp = ip.trim();

  // IP WG de origem (sem trustProxy na API → socket peer é o real). Normaliza
  // ::ffff:10.100.0.3 → 10.100.0.3.
  const raw = req.socket.remoteAddress ?? "";
  const srcWg = raw.replace(/^::ffff:/, "");

  // Acha o nó cujo agent_url tem esse IP WG. (Alternativa explícita: aceitar
  // nodeId no corpo; mas o agente não conhece o próprio nodeId, então preferimos
  // a identificação por proveniência.)
  const all = await db.select().from(nodes);
  const node = all.find((n) => wgIpFromAgentUrl(n.agentUrl) === srcWg);
  if (!node) return reply.code(404).send({ error: "node_not_found_for_wg", srcWg });

  if (node.publicHost === newIp) {
    return { nodeId: node.id, publicHost: newIp, changed: false };
  }

  await db.update(nodes).set({ publicHost: newIp }).where(eq(nodes.id, node.id));

  // Só re-aponta DNS se o nó está em edge (senão os subs vão pro wildcard→187 e
  // public_host não entra em nenhum registro A — evita trabalho e churn de LE).
  if (node.edgeMode) {
    void migrateNodeSubs(node.id).catch(() => {});
  }

  return { nodeId: node.id, publicHost: newIp, changed: true, edgeReapplied: node.edgeMode };
});
