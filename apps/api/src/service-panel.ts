/**
 * Painel admin de serviço (RabbitMQ management). Lógica compartilhada entre a rota
 * (toggle manual) e o provisionamento (exposto por padrão ao criar o ambiente).
 * Sem autorização aqui — quem chama já validou o dono/admin.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db/client";
import { envTools, serviceCredentials } from "./db/schema";
import type { EnvironmentRow, EnvToolRow } from "./db/schema";
import { decryptSecret } from "./crypto";
import { serviceUiPort } from "./services";
import { generateSubdomain } from "./subdomain";
import { agentUrlForEnv } from "./nodes";
import * as cpIngress from "./cp-ingress";

export const PANEL_KIND = "rabbitmq_mgmt";

export async function loadPanelRow(envId: string): Promise<EnvToolRow | null> {
  const rows = await db
    .select()
    .from(envTools)
    .where(and(eq(envTools.envId, envId), eq(envTools.kind, PANEL_KIND)))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertPanelRow(
  envId: string,
  patch: { enabled?: boolean; subdomain?: string | null; targetPort?: number | null },
): Promise<void> {
  const existing = await loadPanelRow(envId);
  if (existing) {
    await db.update(envTools).set(patch).where(eq(envTools.id, existing.id));
  } else {
    await db.insert(envTools).values({
      envId,
      kind: PANEL_KIND,
      enabled: patch.enabled ?? false,
      subdomain: patch.subdomain ?? null,
      targetPort: patch.targetPort ?? null,
    });
  }
}

/** Subdomínio aleatório livre também no namespace de painéis (env_tools). */
export async function generatePanelSubdomain(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const sub = await generateSubdomain();
    const taken = await db
      .select({ id: envTools.id })
      .from(envTools)
      .where(sql`lower(subdomain) = ${sub.toLowerCase()}`);
    if (taken.length === 0) return sub;
  }
  return generateSubdomain();
}

/** Usuário/senha de login do painel, das credenciais cifradas do serviço. */
export async function panelCreds(envId: string): Promise<{ user: string | null; password: string | null }> {
  const rows = await db.select().from(serviceCredentials).where(eq(serviceCredentials.envId, envId));
  let user: string | null = null;
  let password: string | null = null;
  for (const c of rows) {
    if (c.key === "user") user = decryptSecret(c.valueEncrypted);
    else if (c.key === "password") password = decryptSecret(c.valueEncrypted);
  }
  return { user, password };
}

/** URL pública do painel (só quando ligado e com subdomínio). */
export function panelUrl(row: EnvToolRow | null): string | null {
  return row?.enabled && row.subdomain ? `https://${row.subdomain}.${cpIngress.TOOL_ZONE}` : null;
}

/**
 * Liga o painel: escreve o vhost do Caddy do CP para <sub>.jamees.com → nó:httpPort
 * e marca env_tools(enabled=true). Requer o ambiente já com httpPort publicado
 * (a porta do painel). Best-effort: retorna sem erro se faltar rota/porta.
 * Retorna o subdomínio usado (ou null se não deu para ligar).
 */
export async function enablePanel(env: EnvironmentRow): Promise<string | null> {
  const uiPort = serviceUiPort(env.typeId ?? "");
  if (!uiPort || !env.httpPort || !env.nodeId) return null;
  const agentUrl = await agentUrlForEnv({ nodeId: env.nodeId });
  const ip = cpIngress.wgIpFromAgentUrl(agentUrl);
  if (!ip) return null;
  const existing = await loadPanelRow(env.id);
  const sub = existing?.subdomain ?? (await generatePanelSubdomain());
  await cpIngress.putSite(sub, `${ip}:${env.httpPort}`, cpIngress.TOOL_ZONE);
  await upsertPanelRow(env.id, { enabled: true, subdomain: sub, targetPort: uiPort });
  return sub;
}

/** Desliga o painel: remove o vhost e marca enabled=false (mantém o subdomínio). */
export async function disablePanel(env: EnvironmentRow): Promise<void> {
  const existing = await loadPanelRow(env.id);
  if (existing?.subdomain) await cpIngress.removeSite(existing.subdomain, cpIngress.TOOL_ZONE);
  await upsertPanelRow(env.id, { enabled: false });
}
