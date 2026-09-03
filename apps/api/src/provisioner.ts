import { and, eq } from "drizzle-orm";
import type { RuntimeKind } from "@velozplanel/contracts";
import { db } from "./db/client";
import { environments, envAddresses, serviceCredentials, envTypes, envVars, envTools, sshKeys, sshConfigs } from "./db/schema";
import type { EnvironmentRow, JobRow } from "./db/schema";
import { encryptSecret, decryptSecret } from "./crypto";
import { getPlan } from "./plans";
import * as agent from "./agent";
import { agentUrlForEnv, vpsAgentUrlForEnv, pickNodeForNewEnv } from "./nodes";
import { allocateAddress, allocateVpsAddress, vpsPortRange, releaseAddresses } from "./ipam";
import { allocateHostPort } from "./host-port";
import { serviceRuntime, makeCreds, stackAppEnv, serviceUiPort } from "./services";
import * as cpIngress from "./cp-ingress";
import { publishSub, unpublishSub } from "./sub-ingress";
import { subdomainFromName } from "./subdomain";
import { enablePanel } from "./service-panel";

/**
 * Handlers dos jobs da fila (provisionar/remover ambiente). São RECONCILIADORES:
 * podem rodar de novo (retry) sem duplicar — allocateAddress é idempotente e o
 * agente limpa containers por label vp.env antes de criar.
 */

/** Erro que NÃO deve ser re-tentado (ex.: plano/tipo inválido). */
export class PermanentJobError extends Error {}

async function setError(envId: string, msg: string): Promise<void> {
  await db.update(environments).set({ state: "error", errorMessage: msg.slice(0, 500) }).where(eq(environments.id, envId));
}

/** Provisiona um app de código (php/node) num env já existente. */
async function provisionApp(env: EnvironmentRow, nodeId: string, agentUrl: string): Promise<void> {
  const planSpec = await getPlan(env.plan);
  if (!planSpec) throw new PermanentJobError("plano inválido");
  const alloc = await allocateAddress(nodeId, env.ownerId, env.id, "app");
  // Porta de host ESTÁVEL: reusa a já atribuída (idempotente em retry/recreate) ou
  // aloca uma nova da faixa fixa. Fixa => sobrevive a reboot (o vhost não fica stale).
  const hostPort = await allocateHostPort(nodeId, env.id, env.httpPort);
  const result = await agent.provision(agentUrl, {
    envId: env.id,
    name: env.name,
    runtime: { kind: env.runtimeKind as RuntimeKind, version: env.runtimeVersion },
    limits: { vcpu: planSpec.vcpu, memMb: planSpec.memMb },
    startupScript: env.startupScript,
    startFile: env.nodeStartFile,
    pythonCmd: env.pythonCmd,
    dotnetCmd: env.dotnetCmd,
    phpNodeVersion: env.phpNodeVersion,
    phpRoot: env.phpWebRoot,
    hostPort,
    envVars: await envVarsFor(env.id),
    network: { name: alloc.bridgeName, subnet: alloc.subnet, gateway: alloc.gateway },
    ip: alloc.ip,
    ownerId: env.ownerId,
  });
  await db.update(envAddresses).set({ containerId: result.containerId }).where(and(eq(envAddresses.envId, env.id), eq(envAddresses.role, "app")));
  await db.update(environments).set({
    containerId: result.containerId,
    httpPort: result.httpPort,
    runtimeVersionFull: result.versionFull,
    phpNodeVersionFull: result.phpNodeVersionFull ?? null,
    state: "running",
    errorMessage: null,
  }).where(eq(environments.id, env.id));
}

/** Provisiona um ambiente de serviço (redis/mysql/…) já existente. */
async function provisionServiceEnv(env: EnvironmentRow, et: typeof envTypes.$inferSelect, nodeId: string, agentUrl: string): Promise<void> {
  const planSpec = await getPlan(env.plan);
  if (!planSpec) throw new PermanentJobError("plano inválido");
  if (!et.image) throw new PermanentJobError("tipo de serviço sem imagem");
  const alloc = await allocateAddress(nodeId, env.ownerId, env.id, "service");
  const creds = makeCreds();
  const rt = serviceRuntime(et.id, creds);
  // Só grava credenciais se ainda não houver (idempotente).
  const hasCreds = (await db.select().from(serviceCredentials).where(eq(serviceCredentials.envId, env.id))).length > 0;
  if (!hasCreds && Object.keys(rt.store).length) {
    await db.insert(serviceCredentials).values(
      Object.entries(rt.store).map(([key, value]) => ({ envId: env.id, key, valueEncrypted: encryptSecret(value) })),
    );
  }
  // Reusa credenciais já gravadas para o env do docker (para o container casar com o painel).
  const envForContainer = hasCreds ? await rebuildServiceEnv(env.id, et.id) : rt.env;
  // Serviços com painel web embutido (ex.: rabbitmq → 15672) publicam essa porta no
  // host, para o painel poder ser exposto num subdomínio. Demais serviços: sem publicação.
  const uiPort = serviceUiPort(et.id);
  const result = await agent.provisionService(agentUrl, {
    envId: env.id, name: env.name, image: et.image,
    limits: { vcpu: planSpec.vcpu, memMb: planSpec.memMb },
    network: { name: alloc.bridgeName, subnet: alloc.subnet, gateway: alloc.gateway },
    ip: alloc.ip, ownerId: env.ownerId, dataPath: et.dataPath,
    env: envForContainer, readiness: rt.readiness, role: "service",
    publishPort: uiPort,
  });
  await db.update(envAddresses).set({ containerId: result.containerId }).where(and(eq(envAddresses.envId, env.id), eq(envAddresses.role, "service")));
  await db.update(environments).set({ containerId: result.containerId, httpPort: result.httpPort ?? null, state: "running", errorMessage: null }).where(eq(environments.id, env.id));
}

/**
 * Garante que o container de um serviço com painel embutido está publicando a porta
 * do painel (recria o container reusando volume/credenciais se preciso). Usado quando
 * o dono LIGA o painel num serviço que foi provisionado antes desta funcionalidade.
 * Retorna o env já com o httpPort preenchido.
 */
export async function ensureServiceUiPublished(envId: string): Promise<EnvironmentRow> {
  const [env] = await db.select().from(environments).where(eq(environments.id, envId)).limit(1);
  if (!env) throw new PermanentJobError("ambiente não encontrado");
  if (env.httpPort) return env; // já publica a porta
  if (!env.typeId) throw new PermanentJobError("ambiente sem tipo");
  if (!serviceUiPort(env.typeId)) throw new PermanentJobError("este serviço não tem painel embutido");
  if (!env.nodeId) throw new PermanentJobError("ambiente sem nó");
  const [et] = await db.select().from(envTypes).where(eq(envTypes.id, env.typeId)).limit(1);
  if (!et || et.category !== "service") throw new PermanentJobError("tipo de serviço inválido");
  const agentUrl = await agentUrlForEnv({ nodeId: env.nodeId });
  await provisionServiceEnv(env, et, env.nodeId, agentUrl); // recria publicando a porta (volume/creds preservados)
  const [fresh] = await db.select().from(environments).where(eq(environments.id, envId)).limit(1);
  if (!fresh) throw new PermanentJobError("ambiente sumiu após republicar a porta");
  return fresh;
}

/** Provisiona uma stack (n8n/wordpress): banco-filho + app, ambos já com linha no DB. */
async function provisionStackEnv(root: EnvironmentRow, et: typeof envTypes.$inferSelect, nodeId: string, agentUrl: string): Promise<void> {
  const planSpec = await getPlan(root.plan);
  if (!planSpec) throw new PermanentJobError("plano inválido");
  if (!et.image || !et.internalPort || !et.childType) throw new PermanentJobError("stack mal configurada");
  const [child] = await db.select().from(envTypes).where(eq(envTypes.id, et.childType)).limit(1);
  if (!child || !child.image) throw new PermanentJobError("banco-filho inválido");

  const childEnv = (await db.select().from(environments).where(eq(environments.parentEnvId, root.id)))[0];
  if (!childEnv) throw new PermanentJobError("linha do banco-filho ausente");
  await db.update(environments).set({ nodeId }).where(eq(environments.id, childEnv.id));

  // Banco-filho (interno) primeiro.
  const childAlloc = await allocateAddress(nodeId, root.ownerId, childEnv.id, "service");
  const childHasCreds = (await db.select().from(serviceCredentials).where(eq(serviceCredentials.envId, childEnv.id))).length > 0;
  const childCreds = makeCreds();
  const childRt = serviceRuntime(child.id, childCreds);
  if (!childHasCreds && Object.keys(childRt.store).length) {
    await db.insert(serviceCredentials).values(
      Object.entries(childRt.store).map(([key, value]) => ({ envId: childEnv.id, key, valueEncrypted: encryptSecret(value) })),
    );
  }
  const childEnvForContainer = childHasCreds ? await rebuildServiceEnv(childEnv.id, child.id) : childRt.env;
  const childRes = await agent.provisionService(agentUrl, {
    envId: childEnv.id, name: childEnv.name, image: child.image,
    limits: { vcpu: planSpec.vcpu, memMb: planSpec.memMb },
    network: { name: childAlloc.bridgeName, subnet: childAlloc.subnet, gateway: childAlloc.gateway },
    ip: childAlloc.ip, ownerId: root.ownerId, dataPath: child.dataPath,
    env: childEnvForContainer, readiness: childRt.readiness, role: "service",
  });
  await db.update(envAddresses).set({ containerId: childRes.containerId }).where(and(eq(envAddresses.envId, childEnv.id), eq(envAddresses.role, "service")));
  await db.update(environments).set({ containerId: childRes.containerId, state: "running", errorMessage: null }).where(eq(environments.id, childEnv.id));

  // App da stack (web).
  const appAlloc = await allocateAddress(nodeId, root.ownerId, root.id, "app");
  // credenciais do filho (reais) para injetar no app.
  const realChildCreds = await rebuildCreds(childEnv.id, childCreds);
  const appEnv = stackAppEnv(et.id, child.id, realChildCreds, childAlloc.ip);
  const appRes = await agent.provisionService(agentUrl, {
    envId: root.id, name: root.name, image: et.image,
    limits: { vcpu: planSpec.vcpu, memMb: planSpec.memMb },
    network: { name: appAlloc.bridgeName, subnet: appAlloc.subnet, gateway: appAlloc.gateway },
    ip: appAlloc.ip, ownerId: root.ownerId, dataPath: et.dataPath,
    env: appEnv, readiness: null, role: "app", publishPort: et.internalPort,
  });
  await db.update(envAddresses).set({ containerId: appRes.containerId }).where(and(eq(envAddresses.envId, root.id), eq(envAddresses.role, "app")));
  await db.update(environments).set({ containerId: appRes.containerId, httpPort: appRes.httpPort ?? null, state: "running", errorMessage: null }).where(eq(environments.id, root.id));
}

/**
 * Provisiona um VPS (KVM): aloca a rede /29 + IP do dono, sobe a VM via agente com as
 * chaves SSH do cliente, registra vmName/host key, liga o SSH (username = vmName) e
 * publica o domínio (se houver) no Caddy do nó -> vmIp:portaWeb.
 */
async function provisionVps(env: EnvironmentRow, et: typeof envTypes.$inferSelect, nodeId: string, _agentUrl: string): Promise<void> {
  const planSpec = await getPlan(env.plan);
  if (!planSpec) throw new PermanentJobError("plano inválido");
  const image = env.vmImage ?? et.image ?? "ubuntu-24.04"; // imagem escolhida pelo cliente
  const sshUser = env.vmSshUser ?? "vps"; // usuário de login aleatório por VPS
  const upstreamPort = et.internalPort ?? 80;
  // VPS fala com o agente KVM NATIVO do host (não o container Docker).
  const agentUrl = await vpsAgentUrlForEnv(env);

  // A VM autentica por chave; sem chave do cliente não dá pra entrar. Exigimos ao menos uma.
  const keys = await db.select().from(sshKeys).where(eq(sshKeys.envId, env.id));
  const clientKeys = keys.map((k) => k.publicKey);
  if (clientKeys.length === 0) {
    throw new PermanentJobError("adicione uma chave SSH pública ao ambiente antes de criar o VPS");
  }

  const alloc = await allocateVpsAddress(nodeId, env.ownerId, env.id);
  const range = vpsPortRange(alloc.slot); // bloco: 1 SSH + N livres (DNAT 1:1)
  const result = await agent.vpsProvision(agentUrl, {
    envId: env.id,
    name: env.name,
    image,
    limits: { vcpu: planSpec.vcpu, memMb: planSpec.memMb, diskGb: planSpec.diskGb },
    network: { name: alloc.netName, subnet: alloc.subnet, gateway: alloc.gateway },
    ip: alloc.ip,
    ownerId: env.ownerId,
    sshPublicKeys: clientKeys,
    sshUser,
    ports: { start: range.blockStart, count: range.blockCount },
    sshPort: range.sshPort,
  });

  await db.update(envAddresses).set({ containerId: result.vmName }).where(and(eq(envAddresses.envId, env.id), eq(envAddresses.role, "vps")));
  // SSH do env: usuário aleatório da VM, porta pública do SSH (DNAT direto pra VM), ligado.
  await db
    .insert(sshConfigs)
    .values({ envId: env.id, username: sshUser, enabled: true, port: range.sshPort })
    .onConflictDoUpdate({ target: sshConfigs.envId, set: { username: sshUser, enabled: true, port: range.sshPort } });

  await db.update(environments).set({
    vmName: result.vmName,
    vmHostKey: result.guestHostKey,
    vmUpstreamPort: upstreamPort,
    state: "running",
    errorMessage: null,
  }).where(eq(environments.id, env.id));

  // Domínio próprio (se configurado): publica no Caddy do nó apontando p/ a VM. Best-effort.
  if (env.domain) {
    try {
      await agent.vpsPublish(agentUrl, env.domain, alloc.ip, upstreamPort);
    } catch {
      /* borda é auxiliar — não bloqueia o provisionamento */
    }
  }
}

/** Job de provisionamento: reconcilia o env (raiz + filhos) até running. */
export async function runProvisionJob(job: JobRow): Promise<void> {
  const rows = await db.select().from(environments).where(eq(environments.id, job.envId)).limit(1);
  const env = rows[0];
  if (!env) return; // env sumiu (deletado) — nada a fazer
  if (env.state === "running") return; // já pronto

  try {
    // Escolhe o nó (região do payload) se ainda não tem.
    let nodeId = env.nodeId;
    if (!nodeId) {
      const region = (job.payload as { region?: string } | null)?.region ?? undefined;
      const picked = await pickNodeForNewEnv({ region });
      nodeId = picked.node.id;
      await db.update(environments).set({ nodeId }).where(eq(environments.id, env.id));
    }
    const agentUrl = await agentUrlForEnv({ nodeId });

    if (env.typeId) {
      const [et] = await db.select().from(envTypes).where(eq(envTypes.id, env.typeId)).limit(1);
      if (!et || !et.active) throw new PermanentJobError("tipo de ambiente inválido");
      if (et.category === "service") await provisionServiceEnv(env, et, nodeId, agentUrl);
      else if (et.category === "stack") await provisionStackEnv(env, et, nodeId, agentUrl);
      else if (et.category === "vps") await provisionVps({ ...env, nodeId }, et, nodeId, agentUrl);
      else await provisionApp({ ...env, nodeId }, nodeId, agentUrl);
    } else {
      await provisionApp({ ...env, nodeId }, nodeId, agentUrl);
    }

    // Endereço temporário <sub>.jamees.top — só para ambientes WEB (têm httpPort).
    // Serviços puros (sem porta web) ficam de fora. Serviços com painel embutido
    // (rabbitmq) têm o próprio endereço em jamees.com (bloco abaixo). Best-effort.
    try {
      const [fresh] = await db.select().from(environments).where(eq(environments.id, env.id)).limit(1);
      if (fresh?.httpPort && !serviceUiPort(fresh.typeId ?? "")) {
        let sub = fresh.autoSubdomain;
        if (!sub) {
          sub = await subdomainFromName(fresh.name);
          await db.update(environments).set({ autoSubdomain: sub }).where(eq(environments.id, env.id));
        }
        await publishSub(sub, nodeId, fresh.httpPort);
      }
    } catch {
      /* subdomínio é auxiliar — não bloqueia o provisionamento */
    }

    // Serviços com painel embutido (rabbitmq): o painel admin já nasce EXPOSTO num
    // subdomínio aleatório em jamees.com — o dono pode desligar depois. Best-effort.
    try {
      const [fresh] = await db.select().from(environments).where(eq(environments.id, env.id)).limit(1);
      if (fresh?.httpPort && serviceUiPort(fresh.typeId ?? "")) {
        await enablePanel(fresh);
      }
    } catch {
      /* painel é auxiliar — não bloqueia o provisionamento */
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof PermanentJobError) {
      await setError(env.id, msg);
      throw err; // marca falha no job (sem retry)
    }
    // transitório: mantém "provisioning", deixa o job re-tentar; grava a última mensagem
    await db.update(environments).set({ errorMessage: msg.slice(0, 500) }).where(eq(environments.id, env.id));
    throw err;
  }
}

/** Job de remoção: remove containers/volumes/IPs e apaga as linhas (raiz + filhos). */
export async function runDeleteJob(job: JobRow): Promise<void> {
  const rows = await db.select().from(environments).where(eq(environments.id, job.envId)).limit(1);
  const env = rows[0];
  if (!env) return; // já removido
  const children = await db.select().from(environments).where(eq(environments.parentEnvId, env.id));
  const agentUrl = env.nodeId ? await agentUrlForEnv({ nodeId: env.nodeId }) : null;

  for (const target of [...children, env]) {
    // VPS (KVM): destrói a VM por completo (overlay+NVRAM+seed+AppArmor+sshpiper) e
    // despublica o domínio. Usa o agente KVM NATIVO do host. Antes da limpeza genérica.
    if (target.vmName) {
      const vpsUrl = await vpsAgentUrlForEnv(target);
      if (target.domain) await agent.vpsUnpublish(vpsUrl, target.domain).catch(() => {});
      await agent.vpsAction(vpsUrl, "destroy", target.vmName); // confirma antes de apagar; falha → retry
    }
    if (target.autoSubdomain) await unpublishSub(target.autoSubdomain, target.nodeId).catch(() => {});
    // Painéis de serviço (env_tools): remove o vhost do painel e, se for sidecar
    // (phpmyadmin/adminer), o container da ferramenta. O rabbitmq embutido não tem
    // containerId próprio; o jstudio não tem subdomínio/container.
    const tools = await db.select().from(envTools).where(eq(envTools.envId, target.id));
    for (const t of tools) {
      if (t.subdomain) await cpIngress.removeSite(t.subdomain, cpIngress.TOOL_ZONE).catch(() => {});
      if (t.containerId && agentUrl) await agent.remove(agentUrl, t.containerId).catch(() => {});
    }
    if (target.containerId) {
      if (!agentUrl) throw new Error("agente indisponível para remover o container");
      await agent.remove(agentUrl, target.containerId); // confirma antes de apagar; falha → retry
    }
    if (agentUrl) {
      await agent.removeVolume(agentUrl, `veloz-data-${target.id}`).catch(() => {});
      await agent.removeVolume(agentUrl, `veloz-deploy-${target.id}`).catch(() => {});
      await agent.removeVolume(agentUrl, `veloz-code-${target.id}`).catch(() => {}); // código do app em /app (todos os runtimes)
    }
    await releaseAddresses(target.id).catch(() => {});
  }
  await db.delete(environments).where(eq(environments.parentEnvId, env.id));
  await db.delete(environments).where(eq(environments.id, env.id));
}

/* ── helpers ── */

async function envVarsFor(envId: string): Promise<{ key: string; value: string; buildTime: boolean }[]> {
  const evs = await db.select().from(envVars).where(eq(envVars.envId, envId));
  return evs.map((r) => ({ key: r.key, value: decryptSecret(r.valueEncrypted), buildTime: r.buildTime }));
}

/** Reconstrói o array de env do container a partir das credenciais já gravadas. */
async function rebuildServiceEnv(envId: string, engine: string): Promise<{ key: string; value: string }[]> {
  const creds = await rebuildCreds(envId, makeCreds());
  return serviceRuntime(engine, creds).env;
}

/** Credenciais reais (decifradas) do serviço; cai no fallback se faltar alguma. */
async function rebuildCreds(envId: string, fallback: { rootPassword: string; user: string; password: string; database: string }) {
  const rows = await db.select().from(serviceCredentials).where(eq(serviceCredentials.envId, envId));
  const out = { ...fallback };
  for (const c of rows) {
    const v = decryptSecret(c.valueEncrypted);
    if (c.key === "root_password") out.rootPassword = v;
    else if (c.key === "user") out.user = v;
    else if (c.key === "password") out.password = v;
    else if (c.key === "database") out.database = v;
  }
  return out;
}
