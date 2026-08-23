import { eq, inArray, count, and } from "drizzle-orm";
import { db } from "./db/client";
import { nodes, environments } from "./db/schema";
import type { EnvironmentRow, NodeRow } from "./db/schema";
import { DEFAULT_AGENT_URL } from "./agent";
import { ApiHttpError } from "./auth";

/**
 * Roteamento multi-nó: cada ambiente vive num nó, e cada nó tem seu Agente
 * (`agent_url`, ex.: http://10.77.0.2:4100 via WireGuard). Estas funções
 * resolvem o endpoint certo para as chamadas de Agente.
 */

/** URL do Agente de um nó (por id). Fallback para o Agente default (dev/single-node). */
export async function agentUrlForNode(nodeId: string | null | undefined): Promise<string> {
  if (!nodeId) return DEFAULT_AGENT_URL;
  const rows = await db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1);
  return rows[0]?.agentUrl ?? DEFAULT_AGENT_URL;
}

/** URL do Agente do nó onde o ambiente está hospedado. */
export function agentUrlForEnv(env: Pick<EnvironmentRow, "nodeId">): Promise<string> {
  return agentUrlForNode(env.nodeId);
}

/**
 * Escolhe um nó para um novo ambiente: entre os nós ONLINE que têm Agente
 * configurado (`agent_url`), pega o menos carregado (menos ambientes). Assim o
 * provisionamento se espalha pelos servidores de hospedagem.
 */
export async function pickNodeForNewEnv(
  opts?: { region?: string | null },
): Promise<{ node: NodeRow; agentUrl: string }> {
  const online = await db
    .select()
    .from(nodes)
    .where(eq(nodes.status, "online"));
  let candidates = online.filter((n) => n.agentUrl && n.agentUrl.trim().length > 0);
  const region = opts?.region?.trim();
  if (region) {
    const inRegion = candidates.filter((n) => n.region === region);
    if (inRegion.length === 0) {
      throw new ApiHttpError(
        503,
        "no_region_capacity",
        `nenhum servidor disponível na região "${region}" no momento`,
      );
    }
    candidates = inRegion;
  }
  if (candidates.length === 0) {
    throw new ApiHttpError(
      503,
      "no_node_available",
      "nenhum nó de hospedagem online com Agente configurado",
    );
  }

  // Conta ambientes ativos por nó (ignora os já removidos/erro).
  const ids = candidates.map((n) => n.id);
  const loads = await db
    .select({ nodeId: environments.nodeId, c: count() })
    .from(environments)
    .where(
      and(
        inArray(environments.nodeId, ids),
        inArray(environments.state, ["running", "paused", "provisioning"]),
      ),
    )
    .groupBy(environments.nodeId);
  const loadByNode = new Map<string, number>();
  for (const l of loads) if (l.nodeId) loadByNode.set(l.nodeId, l.c);

  candidates.sort((a, b) => (loadByNode.get(a.id) ?? 0) - (loadByNode.get(b.id) ?? 0));
  const node = candidates[0]!;
  return { node, agentUrl: node.agentUrl! };
}

/** Host público do nó (para montar a URL de acesso do site). null se não definido. */
export async function publicHostForNode(nodeId: string | null | undefined): Promise<string | null> {
  if (!nodeId) return null;
  const rows = await db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1);
  return rows[0]?.publicHost ?? null;
}

/**
 * Host onde as portas HTTP publicadas do nó são alcançáveis ("Abrir site").
 * Usa httpHost (ex.: IP da LAN de um nó local NAT); cai para publicHost.
 * publicHost costuma servir só para SSH/SFTP (encaminhados), não para HTTP.
 */
export async function httpHostForNode(nodeId: string | null | undefined): Promise<string | null> {
  if (!nodeId) return null;
  const rows = await db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1);
  return rows[0]?.httpHost ?? rows[0]?.publicHost ?? null;
}
