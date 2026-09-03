import type { FastifyBaseLogger } from "fastify";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "./db/client";
import { environments, envTools, envDomains, nodes } from "./db/schema";
import * as agent from "./agent";
import * as cpIngress from "./cp-ingress";
import { refreshSubVhost, publishDomainVhost } from "./sub-ingress";

const INTERVAL_MS = Number(process.env.VP_VHOST_RECONCILE_MS ?? 30000);

function fqdnFor(zone: string, label: string): string {
  return label === "@" ? zone : `${label}.${zone}`;
}

/**
 * Reconciliador de vhost (rede de segurança self-healing).
 *
 * A porta de host publicada por um container é EFÊMERA e o Docker a REALOCA no reboot
 * do nó → o vhost (Caddy do 187 OU do nó, conforme edge) fica apontando pra porta morta
 * → 502 até reprovisionar. A porta FIXA (host-port.ts) previne em ambientes novos; este
 * loop cobre o resto (legados, crash, recreate). A cada ciclo, para cada endereço
 * roteado, pergunta ao agente a porta VIVA e reescreve o vhost no lugar certo (via
 * refreshSubVhost/publishDomainVhost, que despacham edge vs central). NÃO mexe em DNS
 * (o registro A não muda quando só a porta muda).
 *
 * Cobre: (1) subdomínio <sub>.jamees.top e painel EMBUTIDO (porta do container do app);
 * (2) domínio próprio (env_domains, mesma porta do app); (3) painel via SIDECAR
 * (phpmyadmin/adminer — porta do PRÓPRIO container do sidecar, comparada com env_tools.host_port).
 */
export function startVhostReconciler(log: FastifyBaseLogger): () => void {
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return; // evita sobreposição
    running = true;
    try {
      const envs = await db.select().from(environments).where(eq(environments.state, "running"));
      const envById = new Map(envs.map((e) => [e.id, e]));

      // Mapa nó → agentUrl (uma consulta por ciclo).
      const agentByNode = new Map<string, string>();
      for (const n of await db.select().from(nodes)) if (n.agentUrl) agentByNode.set(n.id, n.agentUrl);

      // Painéis EMBUTIDOS com subdomínio (container_id NULL = usam a porta do app).
      const embedded = await db
        .select({ envId: envTools.envId, subdomain: envTools.subdomain })
        .from(envTools)
        .where(and(eq(envTools.enabled, true), isNotNull(envTools.subdomain), isNull(envTools.containerId)));
      const embeddedByEnv = new Map<string, string>();
      for (const t of embedded) if (t.subdomain) embeddedByEnv.set(t.envId, t.subdomain);

      // Domínios próprios por ambiente (mesma porta do app).
      const domainRows = await db
        .select({ envId: envDomains.environmentId, zone: envDomains.zone, label: envDomains.label })
        .from(envDomains);
      const domainsByEnv = new Map<string, { zone: string; label: string }[]>();
      for (const d of domainRows) {
        const arr = domainsByEnv.get(d.envId) ?? [];
        arr.push({ zone: d.zone, label: d.label });
        domainsByEnv.set(d.envId, arr);
      }

      // ── Passe 1: porta do container do APP → subdomínio + painel embutido + domínios ──
      for (const env of envs) {
        if (!env.containerId || !env.nodeId) continue;
        const autoSub = env.autoSubdomain;
        const embeddedSub = embeddedByEnv.get(env.id) ?? null;
        const domains = domainsByEnv.get(env.id) ?? [];
        if (!autoSub && !embeddedSub && domains.length === 0) continue; // nada roteado

        const agentUrl = agentByNode.get(env.nodeId);
        if (!agentUrl) continue; // nó offline → tenta no próximo ciclo

        try {
          const { port } = await agent.containerPort(agentUrl, env.containerId);
          if (!port || port === env.httpPort) continue; // sem porta ou já correto
          await db.update(environments).set({ httpPort: port }).where(eq(environments.id, env.id));
          if (autoSub) await refreshSubVhost(autoSub, env.nodeId, port);
          if (embeddedSub) await refreshSubVhost(embeddedSub, env.nodeId, port, cpIngress.TOOL_ZONE);
          for (const d of domains) await publishDomainVhost(fqdnFor(d.zone, d.label), env.nodeId, port);
          log.warn(
            { envId: env.id, oldPort: env.httpPort, newPort: port, autoSub, embeddedSub, domains: domains.length },
            "reconciliador: porta do app mudou → vhosts reescritos",
          );
        } catch (err) {
          log.warn({ err, envId: env.id }, "reconciliador: falha no passe do app");
        }
      }

      // ── Passe 2: painéis via SIDECAR (porta do PRÓPRIO container do sidecar) ──
      const sidecars = await db
        .select({ id: envTools.id, envId: envTools.envId, subdomain: envTools.subdomain, containerId: envTools.containerId, hostPort: envTools.hostPort })
        .from(envTools)
        .where(and(eq(envTools.enabled, true), isNotNull(envTools.subdomain), isNotNull(envTools.containerId)));
      for (const t of sidecars) {
        const env = envById.get(t.envId);
        if (!env || !env.nodeId || !t.containerId || !t.subdomain) continue;
        const agentUrl = agentByNode.get(env.nodeId);
        if (!agentUrl) continue;
        try {
          const { port } = await agent.containerPort(agentUrl, t.containerId);
          if (!port || port === t.hostPort) continue;
          await db.update(envTools).set({ hostPort: port }).where(eq(envTools.id, t.id));
          await refreshSubVhost(t.subdomain, env.nodeId, port, cpIngress.TOOL_ZONE);
          log.warn(
            { envId: t.envId, sub: t.subdomain, oldPort: t.hostPort, newPort: port },
            "reconciliador: porta do sidecar mudou → vhost reescrito",
          );
        } catch (err) {
          log.warn({ err, envId: t.envId }, "reconciliador: falha no passe do sidecar");
        }
      }
    } catch (err) {
      log.warn({ err }, "reconciliador de vhost: falha no ciclo");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, INTERVAL_MS);
  timer.unref?.();

  log.info(`reconciliador de vhost iniciado (intervalo ${INTERVAL_MS}ms)`);
  return () => clearInterval(timer);
}
