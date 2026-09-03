/**
 * Roteamento de ENDEREÇOS (subdomínio, painel de serviço e domínio próprio): decide
 * entre EDGE POR NÓ e PROXY CENTRAL, de forma unificada.
 *
 * - Nó EDGE (edge_mode + publicHost IPv4): o endereço resolve DIRETO pro IP do nó
 *   (registro A → publicHost do nó) e o Caddy DO NÓ termina o TLS (Let's Encrypt
 *   automático) + reverse_proxy pro container local (127.0.0.1:porta). Sem 187 no meio.
 * - Nó CENTRAL (fallback, ex.: atrás de NAT sem 80/443): o endereço aponta pro
 *   control-plane 187 (registro A → CP_IP, ou wildcard quando a zona tem um) e o Caddy
 *   do 187 faz reverse_proxy pelo WireGuard (comportamento legado).
 *
 * O alvo público correto vem SEMPRE de `publicTargetForNode` (publicHost do nó, ou o
 * 187) — nunca do httpHost (que num nó NAT é o IP de LAN e não resolve na internet).
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "./db/client";
import { environments, envTools, nodes } from "./db/schema";
import * as cpIngress from "./cp-ingress";
import * as agent from "./agent";
import * as pdns from "./dns-pdns";
import { agentUrlForNode } from "./nodes";

const SUB_ZONE = "jamees.top";
/** Zona dos painéis de serviço (mesma zona/wildcard dos subdomínios). */
const TOOL_ZONE = "jamees.top";
/** IP público do control-plane (187) — destino do fallback central. */
const CP_IP = process.env.CP_PUBLIC_IP ?? "187.127.49.205";

function isIPv4(h: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h.trim());
  if (!m) return false;
  return m.slice(1).every((o) => Number(o) <= 255);
}

/**
 * Se o nó está em modo EDGE e tem IP público IPv4, devolve esse IP; senão null
 * (→ usar o proxy central). Usa publicHost (internet-facing), NÃO httpHost (LAN em NAT).
 */
export async function edgeHostForNode(nodeId: string | null | undefined): Promise<string | null> {
  if (!nodeId) return null;
  const [n] = await db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1);
  if (!n || !n.edgeMode) return null;
  return n.publicHost && isIPv4(n.publicHost) ? n.publicHost : null;
}

/**
 * IP público para onde um endereço do ambiente deve APONTAR no DNS: nó edge → IP
 * público do nó (direto); senão → o control-plane 187 (que faz o proxy). Nunca o IP
 * de LAN. É o valor certo pro conteúdo de um registro A.
 */
export async function publicTargetForNode(nodeId: string | null | undefined): Promise<string> {
  return (await edgeHostForNode(nodeId)) ?? CP_IP;
}

/**
 * (Re)escreve o vhost de um HOST completo (fqdn) no lugar certo, SEM tocar em DNS:
 * Caddy do nó (edge, upstream 127.0.0.1:porta) ou Caddy central 187 (fallback, via WG).
 */
export async function publishVhostHost(host: string, nodeId: string | null, port: number | null): Promise<void> {
  if (!host || !nodeId || !port) return;
  const edgeHost = await edgeHostForNode(nodeId);
  if (edgeHost) {
    const url = await agentUrlForNode(nodeId);
    await agent.publishSite(url, host, `127.0.0.1:${port}`);
  } else {
    const [n] = await db.select({ agentUrl: nodes.agentUrl }).from(nodes).where(eq(nodes.id, nodeId)).limit(1);
    const ip = cpIngress.wgIpFromAgentUrl(n?.agentUrl);
    if (ip) await cpIngress.putSiteHost(host, `${ip}:${port}`);
  }
}

/** Remove o vhost de um HOST completo dos DOIS lugares (Caddy central + Caddy do nó). */
export async function unpublishVhostHost(host: string, nodeId: string | null): Promise<void> {
  await cpIngress.removeSiteHost(host).catch(() => {});
  if (nodeId) {
    try {
      const url = await agentUrlForNode(nodeId);
      await agent.unpublishSite(url, host);
    } catch {
      /* nó sem Caddy gerenciável / agente fora — ignora */
    }
  }
}

/* ─────────────── Subdomínio / painel (zona jamees.top, que tem wildcard→187) ─────────────── */

/**
 * Só o vhost (sem DNS) de `<name>.<zone>`, despachado edge vs central. É o que o
 * reconciliador chama quando a porta do container muda (o A não muda nesse caso).
 */
export async function refreshSubVhost(
  name: string | null,
  nodeId: string | null,
  httpPort: number | null,
  zone: string = SUB_ZONE,
): Promise<void> {
  if (!name || !nodeId || !httpPort) return;
  await publishVhostHost(`${name}.${zone}`, nodeId, httpPort);
}

/**
 * Publica `<name>.<zone>` (DNS + vhost), despachando edge vs central. Best-effort.
 * Como a zona tem wildcard→187, o central dispensa A específico (apaga se existir).
 * Ao alternar de lado, limpa o vhost órfão do outro lado (#7).
 */
export async function publishSub(
  name: string | null,
  nodeId: string | null,
  httpPort: number | null,
  zone: string = SUB_ZONE,
): Promise<void> {
  if (!name || !nodeId || !httpPort) return;
  const host = `${name}.${zone}`;
  try {
    const edgeHost = await edgeHostForNode(nodeId);
    if (edgeHost) {
      await pdns
        .replaceRRsets(zone, [{ name: pdns.fqdnOf(zone, name), type: "A", ttl: 300, records: [{ content: edgeHost, disabled: false }] }])
        .catch(() => {});
      await cpIngress.removeSiteHost(host).catch(() => {}); // tira vhost central órfão
    } else {
      await pdns.deleteRRset(zone, name, "A").catch(() => {}); // volta ao wildcard→187
      // tira vhost do nó órfão (caso o sub tenha sido edge antes)
      try {
        const url = await agentUrlForNode(nodeId);
        await agent.unpublishSite(url, host);
      } catch {
        /* ignora */
      }
    }
    await publishVhostHost(host, nodeId, httpPort);
  } catch {
    /* best-effort — endereço auxiliar não bloqueia a operação principal */
  }
}

/** Remove `<name>.<zone>`: vhost (nó + central) + A específico (volta ao wildcard). */
export async function unpublishSub(name: string | null, nodeId: string | null, zone: string = SUB_ZONE): Promise<void> {
  if (!name) return;
  await unpublishVhostHost(`${name}.${zone}`, nodeId);
  await pdns.deleteRRset(zone, name, "A").catch(() => {});
}

/* ─────────────── Domínio próprio (zona SEM wildcard) ─────────────── */

/**
 * Publica o vhost de um domínio próprio (host completo) no lugar certo. O registro A
 * do domínio é criado por quem chama (dns-service), sempre com `publicTargetForNode`.
 */
export async function publishDomainVhost(host: string, nodeId: string | null, httpPort: number | null): Promise<void> {
  await publishVhostHost(host, nodeId, httpPort);
}

/* ─────────────── Migração em lote ao ligar/desligar edge do nó ─────────────── */

/**
 * Re-publica TODOS os endereços dos ambientes running de um nó conforme o edge_mode
 * atual (subdomínio + painel embutido). Chamado ao alternar o edge do nó no painel.
 * Best-effort e sequencial; publishSub nunca lança. Painéis via sidecar e domínios
 * próprios são re-publicados nos seus próprios fluxos/reconciliador.
 */
export async function migrateNodeSubs(nodeId: string): Promise<void> {
  const rows = await db
    .select()
    .from(environments)
    .where(and(eq(environments.nodeId, nodeId), eq(environments.state, "running")));
  const envIds = rows.map((r) => r.id);
  // Painéis do nó (embutido usa a porta do app; sidecar usa a própria host_port).
  const tools = envIds.length
    ? await db.select().from(envTools).where(and(inArray(envTools.envId, envIds), eq(envTools.enabled, true), isNotNull(envTools.subdomain)))
    : [];
  const toolsByEnv = new Map<string, typeof tools>();
  for (const t of tools) {
    const arr = toolsByEnv.get(t.envId) ?? [];
    arr.push(t);
    toolsByEnv.set(t.envId, arr);
  }
  for (const e of rows) {
    if (e.autoSubdomain && e.httpPort) await publishSub(e.autoSubdomain, nodeId, e.httpPort);
    for (const t of toolsByEnv.get(e.id) ?? []) {
      const port = t.containerId ? t.hostPort : e.httpPort; // sidecar → host_port; embutido → porta do app
      if (t.subdomain && port) await publishSub(t.subdomain, nodeId, port, TOOL_ZONE);
    }
  }
}
