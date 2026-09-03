/**
 * Painel admin de serviço. Dois modos:
 *  - EMBUTIDO (rabbitmq): a UI já está no container do serviço (porta 15672);
 *    ligar = publicar essa porta e escrever o vhost.
 *  - SIDECAR (phpmyadmin/adminer): sobe um container SEPARADO da ferramenta na
 *    bridge do dono, apontando para o banco; ligar = provisionar o sidecar +
 *    vhost; desligar = remover o sidecar + vhost.
 * Lógica compartilhada entre a rota (toggle) e o provisionamento. Sem autorização
 * aqui — quem chama já validou o dono/admin.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db/client";
import { envTools, serviceCredentials, envTypes, envAddresses } from "./db/schema";
import type { EnvironmentRow, EnvToolRow } from "./db/schema";
import { decryptSecret } from "./crypto";
import { serviceUiPort, serviceTool } from "./services";
import type { ToolSpec } from "./services";
import { generateSubdomain } from "./subdomain";
import { agentUrlForEnv } from "./nodes";
import { allocateAddress } from "./ipam";
import * as agent from "./agent";
import * as cpIngress from "./cp-ingress";
import { publishSub, unpublishSub } from "./sub-ingress";

// Kinds que representam o PAINEL ADMIN de um ambiente (1 por env). Não inclui
// "jstudio" (o console embutido do Data Studio, que é outra coisa).
const PANEL_KINDS = ["rabbitmq_mgmt", "phpmyadmin", "adminer"];
// Recursos do container sidecar da ferramenta (leve, on-demand).
const SIDECAR_LIMITS = { vcpu: 0.5, memMb: 256 };

/** Kind do painel admin do tipo de serviço (rabbitmq_mgmt | phpmyadmin | adminer | null). */
export function panelKindFor(typeId: string | null | undefined): string | null {
  if (serviceUiPort(typeId ?? "")) return "rabbitmq_mgmt";
  const t = serviceTool(typeId ?? "");
  return t ? t.kind : null;
}

/** Nome exibido da ferramenta do painel (ou null se o tipo não tem painel). */
export function panelToolLabel(typeId: string | null | undefined): string | null {
  if (serviceUiPort(typeId ?? "")) return "RabbitMQ Management";
  return serviceTool(typeId ?? "")?.label ?? null;
}

export async function loadPanelRow(envId: string): Promise<EnvToolRow | null> {
  const rows = await db
    .select()
    .from(envTools)
    .where(and(eq(envTools.envId, envId), inArray(envTools.kind, PANEL_KINDS)))
    .limit(1);
  return rows[0] ?? null;
}

async function upsertPanelRow(
  envId: string,
  kind: string,
  patch: {
    enabled?: boolean;
    subdomain?: string | null;
    targetPort?: number | null;
    hostPort?: number | null;
    containerId?: string | null;
    ip?: string | null;
    targetIp?: string | null;
  },
): Promise<void> {
  const existing = await loadPanelRow(envId);
  if (existing) {
    await db.update(envTools).set(patch).where(eq(envTools.id, existing.id));
  } else {
    await db.insert(envTools).values({
      envId,
      kind,
      enabled: patch.enabled ?? false,
      subdomain: patch.subdomain ?? null,
      targetPort: patch.targetPort ?? null,
      hostPort: patch.hostPort ?? null,
      containerId: patch.containerId ?? null,
      ip: patch.ip ?? null,
      targetIp: patch.targetIp ?? null,
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

/** Usuário/senha/banco (do serviço) para o login do painel, das credenciais cifradas. */
export async function panelCreds(
  envId: string,
): Promise<{ user: string | null; password: string | null; database: string | null }> {
  const rows = await db.select().from(serviceCredentials).where(eq(serviceCredentials.envId, envId));
  let user: string | null = null;
  let password: string | null = null;
  let database: string | null = null;
  for (const c of rows) {
    if (c.key === "user") user = decryptSecret(c.valueEncrypted);
    else if (c.key === "password") password = decryptSecret(c.valueEncrypted);
    else if (c.key === "database") database = decryptSecret(c.valueEncrypted);
  }
  return { user, password, database };
}

/** URL pública do painel (só quando ligado e com subdomínio). */
export function panelUrl(row: EnvToolRow | null): string | null {
  if (!row?.enabled || !row.subdomain) return null;
  const base = `https://${row.subdomain}.${cpIngress.TOOL_ZONE}`;
  // Adminer (postgres): pré-seleciona o driver PostgreSQL + o servidor no login,
  // senão o Adminer abre em MySQL e dá "Connection refused" (porta 3306 inexistente).
  if (row.kind === "adminer" && row.targetIp) return `${base}/?pgsql=${row.targetIp}`;
  return base;
}

/** Liga o painel do ambiente (roteia entre embutido e sidecar). Retorna o subdomínio. */
export async function enablePanel(env: EnvironmentRow): Promise<string | null> {
  if (serviceUiPort(env.typeId ?? "")) return enableEmbedded(env);
  const tool = serviceTool(env.typeId ?? "");
  if (tool) return enableSidecar(env, tool);
  return null;
}

/** EMBUTIDO (rabbitmq): publica a própria porta do serviço num vhost. */
async function enableEmbedded(env: EnvironmentRow): Promise<string | null> {
  const uiPort = serviceUiPort(env.typeId ?? "");
  if (!uiPort || !env.httpPort || !env.nodeId) return null;
  const existing = await loadPanelRow(env.id);
  const sub = existing?.subdomain ?? (await generatePanelSubdomain());
  // Despacha edge (Caddy do nó) vs central (187), igual ao subdomínio do ambiente.
  await publishSub(sub, env.nodeId, env.httpPort, cpIngress.TOOL_ZONE);
  await upsertPanelRow(env.id, "rabbitmq_mgmt", { enabled: true, subdomain: sub, targetPort: uiPort });
  return sub;
}

/** SIDECAR (phpmyadmin/adminer): sobe o container da ferramenta apontando pro banco. */
async function enableSidecar(env: EnvironmentRow, tool: ToolSpec): Promise<string | null> {
  if (!env.nodeId || !env.typeId) return null;
  const agentUrl = await agentUrlForEnv({ nodeId: env.nodeId });
  const wgIp = cpIngress.wgIpFromAgentUrl(agentUrl);
  if (!wgIp) return null;
  // Alvo: IP interno do banco (role "service") + porta interna do tipo.
  const [addr] = await db
    .select()
    .from(envAddresses)
    .where(and(eq(envAddresses.envId, env.id), eq(envAddresses.role, "service")))
    .limit(1);
  const [et] = await db.select().from(envTypes).where(eq(envTypes.id, env.typeId)).limit(1);
  if (!addr?.ip || !et?.internalPort) return null;
  // Subdomínio antes de provisionar (para assar a URL pública na ferramenta).
  const existing = await loadPanelRow(env.id);
  const sub = existing?.subdomain ?? (await generatePanelSubdomain());
  const publicUrl = `https://${sub}.${cpIngress.TOOL_ZONE}/`;
  // IP do sidecar na MESMA bridge do dono (idempotente por env+role).
  const alloc = await allocateAddress(env.nodeId, env.ownerId, env.id, `tool:${tool.kind}`);
  const res = await agent.provisionService(agentUrl, {
    envId: env.id,
    name: `${env.name}-${tool.kind}`,
    image: tool.image,
    limits: SIDECAR_LIMITS,
    network: { name: alloc.bridgeName, subnet: alloc.subnet, gateway: alloc.gateway },
    ip: alloc.ip,
    ownerId: env.ownerId,
    dataPath: null,
    env: tool.env({ ip: addr.ip, port: et.internalPort, publicUrl }),
    readiness: null,
    role: `tool:${tool.kind}`, // limpeza escopada no agente (não toca no banco)
    publishPort: tool.port,
  });
  if (!res.httpPort) return null; // sem porta publicada — não dá pra rotear
  // Despacha edge (Caddy do nó) vs central (187). O upstream é a porta publicada do
  // container SIDECAR (não a do app) — por isso passamos res.httpPort.
  await publishSub(sub, env.nodeId, res.httpPort, cpIngress.TOOL_ZONE);
  await upsertPanelRow(env.id, tool.kind, {
    enabled: true,
    subdomain: sub,
    containerId: res.containerId,
    ip: alloc.ip,
    targetIp: addr.ip,
    targetPort: tool.port,
    hostPort: res.httpPort, // porta de host publicada do sidecar (p/ reconciliar no reboot)
  });
  return sub;
}

/** Desliga o painel: remove o vhost e (se sidecar) o container da ferramenta. */
export async function disablePanel(env: EnvironmentRow): Promise<void> {
  const existing = await loadPanelRow(env.id);
  if (existing?.subdomain) await unpublishSub(existing.subdomain, env.nodeId, cpIngress.TOOL_ZONE);
  // Sidecar tem containerId próprio (o embutido do rabbitmq não). Remove o container.
  if (existing?.containerId && env.nodeId) {
    try {
      await agent.remove(await agentUrlForEnv({ nodeId: env.nodeId }), existing.containerId);
    } catch {
      /* best-effort */
    }
  }
  const kind = existing?.kind ?? panelKindFor(env.typeId) ?? "rabbitmq_mgmt";
  await upsertPanelRow(env.id, kind, { enabled: false, containerId: null }); // mantém subdomínio/ip
}
