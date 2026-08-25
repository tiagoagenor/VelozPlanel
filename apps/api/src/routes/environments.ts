import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { eq, count, and, isNull } from "drizzle-orm";
import {
  environment as environmentSchema,
  createEnvironmentInput,
  setDomainInput,
  setStartupScriptInput,
  setNodeStartFileInput,
  setPythonCmdInput,
  setDotnetCmdInput,
  setPhpNodeVersionInput,
  phpNodeCurrent as phpNodeCurrentSchema,
  changeRuntimeInput,
  apiError,
  diskUsage as diskUsageSchema,
  containerLogs as containerLogsSchema,
  PLANS,
} from "@velozplanel/contracts";
import type {
  Environment,
  SessionUser,
  PlanId,
  RuntimeKind,
  EnvState,
  EnvCategory,
} from "@velozplanel/contracts";
import { db } from "../db/client";
import { environments, envVars, deployConfigs, deploySteps, envTypes, envAddresses, serviceCredentials, nodes, jobs } from "../db/schema";
import type { EnvironmentRow } from "../db/schema";
import { encryptSecret, decryptSecret } from "../crypto";
import { ApiHttpError, requireUser } from "../auth";
import { getPlan } from "../plans";
import * as agent from "../agent";
import { agentUrlForEnv, pickNodeForNewEnv, httpHostForNode } from "../nodes";
import { allocateAddress, ownerNetworkFor } from "../ipam";
import { connectionInfo } from "../services";
import * as cpIngress from "../cp-ingress";
import { isSubReserved, isSubTaken } from "../subdomain";
import { setSubdomainInput } from "@velozplanel/contracts";
import { balanceCents } from "../credits";
import { settleEnvironment } from "../billing";

const idParams = z.object({ id: z.string().uuid() });

/** Formata centavos como R$ (pt-BR) para mensagens ao cliente. */
function brl(cents: number): string {
  return `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Converte uma linha do DB para o formato do contrato. */
/** Busca e decifra as variáveis de ambiente para passar ao provision (Env real). */
async function envVarsForProvision(envId: string): Promise<{ key: string; value: string; buildTime: boolean }[]> {
  const rows = await db.select().from(envVars).where(eq(envVars.envId, envId));
  return rows.map((r) => ({ key: r.key, value: decryptSecret(r.valueEncrypted), buildTime: r.buildTime }));
}

/** Reescreve o vhost do Caddy do CP do subdomínio com a porta atual (best-effort). */
async function syncSubVhost(sub: string | null, nodeId: string | null, httpPort: number | null): Promise<void> {
  if (!sub || !nodeId || !httpPort) return;
  try {
    const [n] = await db.select({ agentUrl: nodes.agentUrl }).from(nodes).where(eq(nodes.id, nodeId)).limit(1);
    const ip = cpIngress.wgIpFromAgentUrl(n?.agentUrl);
    if (ip) await cpIngress.putSite(sub, `${ip}:${httpPort}`);
  } catch {
    /* best-effort — não bloqueia a operação */
  }
}

export async function toEnvironment(r: EnvironmentRow): Promise<Environment> {
  // URL pública para "Abrir site": domínio (https) tem prioridade; senão o
  // IP público do nó + a porta publicada. NAT sem domínio → sem URL direta.
  // Prioridade: domínio próprio (https) > subdomínio temporário jamees.top > IP:porta.
  let accessUrl: string | null = null;
  if (r.domain) {
    accessUrl = `https://${r.domain}`;
  } else if (r.autoSubdomain) {
    accessUrl = `https://${r.autoSubdomain}.jamees.top`;
  } else if (r.httpPort && r.nodeId) {
    const host = await httpHostForNode(r.nodeId);
    if (host) accessUrl = `http://${host}:${r.httpPort}`;
  }
  const { category, connection } = await serviceView(r);
  // Região do nó + IP interno na rede do dono (serviços/stacks).
  let region: string | null = null;
  if (r.nodeId) {
    const nrow = await db.select({ region: nodes.region }).from(nodes).where(eq(nodes.id, r.nodeId)).limit(1);
    region = nrow[0]?.region ?? null;
  }
  const addrRows = await db.select().from(envAddresses).where(eq(envAddresses.envId, r.id));
  let internalIp: string | null =
    addrRows.find((a) => a.role === "service")?.ip ?? addrRows.find((a) => a.role === "app")?.ip ?? addrRows[0]?.ip ?? null;
  // App legado (sem livro-razão): pega o IP real do container no nó (docker inspect via agente).
  if (!internalIp && r.containerId && r.nodeId && (r.state === "running" || r.state === "paused")) {
    try {
      const agentUrl = await agentUrlForEnv(r);
      internalIp = (await agent.containerIp(agentUrl, r.containerId)).ip;
    } catch {
      /* agente indisponível → deixa null */
    }
  }
  return {
    id: r.id,
    name: r.name,
    ownerId: r.ownerId,
    nodeId: r.nodeId,
    plan: r.plan as PlanId,
    runtime: { kind: r.runtimeKind as RuntimeKind, version: r.runtimeVersion },
    state: r.state as EnvState,
    containerId: r.containerId,
    httpPort: r.httpPort,
    domain: r.domain,
    autoSubdomain: r.autoSubdomain,
    runtimeVersionFull: r.runtimeVersionFull,
    startupScript: r.startupScript,
    nodeStartFile: r.nodeStartFile,
    pythonCmd: r.pythonCmd,
    dotnetCmd: r.dotnetCmd,
    phpNodeVersion: r.phpNodeVersion,
    phpNodeVersionFull: r.phpNodeVersionFull,
    accessUrl,
    type: r.typeId ?? null,
    category,
    connection,
    region,
    internalIp,
    errorMessage: r.errorMessage ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Categoria + dados de conexão de um ambiente-serviço (host interno + credenciais). */
async function serviceView(r: EnvironmentRow): Promise<{ category: EnvCategory | null; connection: Record<string, string> | null }> {
  if (!r.typeId) return { category: null, connection: null };
  const [et] = await db.select().from(envTypes).where(eq(envTypes.id, r.typeId)).limit(1);
  if (!et) return { category: null, connection: null };
  const category = et.category as EnvCategory;
  if (category !== "service" || !et.internalPort) return { category, connection: null };
  const addr = await db.select().from(envAddresses).where(eq(envAddresses.envId, r.id));
  const ip = addr.find((a) => a.role === "service")?.ip ?? addr[0]?.ip;
  if (!ip) return { category, connection: null };
  const credRows = await db.select().from(serviceCredentials).where(eq(serviceCredentials.envId, r.id));
  const creds = { user: "", password: "", database: "" };
  for (const c of credRows) {
    const v = decryptSecret(c.valueEncrypted);
    if (c.key === "user") creds.user = v;
    else if (c.key === "password") creds.password = v;
    else if (c.key === "database") creds.database = v;
  }
  return { category, connection: connectionInfo(et.id, ip, et.internalPort, creds) };
}

type EnvTypeRowLite = typeof envTypes.$inferSelect;

/** Carrega o ambiente e garante que o usuário pode acessá-lo (dono ou admin). */
export async function loadEnvironmentForUser(
  id: string,
  user: SessionUser,
): Promise<EnvironmentRow> {
  const rows = await db.select().from(environments).where(eq(environments.id, id)).limit(1);
  const env = rows[0];
  if (!env) throw new ApiHttpError(404, "not_found", "ambiente não encontrado");
  if (user.role !== "admin" && env.ownerId !== user.id) {
    throw new ApiHttpError(403, "forbidden", "sem acesso a este ambiente");
  }
  return env;
}

export async function environmentRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // GET /environments — cliente vê os próprios; admin vê todos.
  app.get(
    "/environments",
    { schema: { response: { 200: z.array(environmentSchema), 401: apiError } } },
    async (req): Promise<Environment[]> => {
      const user = await requireUser(req);
      // Bancos-filho de stacks (parentEnvId != null) ficam ocultos da lista principal.
      const rows =
        user.role === "admin"
          ? await db.select().from(environments).where(isNull(environments.parentEnvId))
          : await db.select().from(environments).where(and(eq(environments.ownerId, user.id), isNull(environments.parentEnvId)));
      return Promise.all(rows.map(toEnvironment));
    },
  );

  // POST /environments — cria, provisiona no Agente, liga.
  app.post(
    "/environments",
    {
      schema: {
        body: createEnvironmentInput,
        response: { 200: environmentSchema, 401: apiError, 402: apiError, 409: apiError, 422: apiError, 502: apiError },
      },
    },
    async (req): Promise<Environment> => {
      const user = await requireUser(req);
      const { name, plan, runtime } = req.body;
      const planSpec = await getPlan(plan);
      if (!planSpec) throw new ApiHttpError(400, "invalid_plan", "plano inválido");
      // Plano inativo não pode ser contratado (a UI já não o mostra; isto fecha
      // o furo de uma chamada direta à API). Admin também respeita.
      if (!planSpec.active) throw new ApiHttpError(400, "plan_inactive", "este plano não está disponível");

      // Limite de máquinas por cliente definido no plano (admin não é limitado).
      if (user.role !== "admin") {
        const [c] = await db
          .select({ c: count() })
          .from(environments)
          .where(and(eq(environments.ownerId, user.id), isNull(environments.parentEnvId)));
        const current = c?.c ?? 0;
        if (current >= planSpec.maxEnvironments) {
          throw new ApiHttpError(
            409,
            "env_limit_reached",
            `limite de ${planSpec.maxEnvironments} ambiente(s) do plano ${planSpec.label} atingido`,
          );
        }
      }

      // Resolve o tipo (se houver) e a categoria.
      let et: EnvTypeRowLite | null = null;
      let category: "app" | "service" | "stack" = "app";
      if (req.body.type) {
        const [row] = await db.select().from(envTypes).where(eq(envTypes.id, req.body.type)).limit(1);
        if (!row || !row.active) throw new ApiHttpError(400, "invalid_type", "tipo de ambiente inválido");
        et = row;
        category = row.category as "app" | "service" | "stack";
      }

      // Requisito mínimo de recursos do tipo (e do banco-filho, em stacks): o
      // plano precisa ter vCPU/RAM suficientes. Fonte da verdade (a UI só ajuda).
      if (et) {
        let minVcpu = et.minVcpu ?? 0;
        let minMemMb = et.minMemMb ?? 0;
        if (et.childType) {
          const [child] = await db.select().from(envTypes).where(eq(envTypes.id, et.childType)).limit(1);
          if (child) { minVcpu = Math.max(minVcpu, child.minVcpu ?? 0); minMemMb = Math.max(minMemMb, child.minMemMb ?? 0); }
        }
        if (planSpec.vcpu < minVcpu || planSpec.memMb < minMemMb) {
          throw new ApiHttpError(
            422,
            "invalid_plan_for_type",
            `${et.label} exige pelo menos ${minVcpu} vCPU e ${minMemMb} MB de RAM. Escolha um plano maior.`,
          );
        }
      }

      if (category === "app" && !runtime) throw new ApiHttpError(400, "invalid_runtime", "informe o runtime do ambiente");

      // Trava de saldo: (dinheiro + bônus) precisa cobrir ao menos 1 HORA do
      // container. Stack (ex.: WordPress) conta 1× — o banco-filho vai junto,
      // não dobra. Admin é isento (cria ambientes de teste/infra).
      if (user.role !== "admin") {
        const adderMonthCents = et?.priceMonthCents ?? 0;
        const hourlyCents = Math.ceil((planSpec.priceMonthCents + adderMonthCents) / 720);
        const bal = await balanceCents(user.id);
        if (bal < hourlyCents) {
          throw new ApiHttpError(
            402,
            "insufficient_balance",
            `Saldo insuficiente: você tem ${brl(bal)} e este ambiente custa ${brl(hourlyCents)}/hora. Adicione saldo para continuar.`,
          );
        }
      }

      // Cria a(s) linha(s) em "provisioning" e enfileira o job. O provisionamento
      // (escolher nó, alocar IP, subir container) roda no WORKER, assíncrono.
      let root: EnvironmentRow;
      if (category === "app") {
        const ins = await db.insert(environments).values({
          name, ownerId: user.id, nodeId: null, plan,
          runtimeKind: runtime!.kind, runtimeVersion: runtime!.version, state: "provisioning",
        }).returning();
        root = ins[0]!;
        if (req.body.template === "nextjs") {
          await db.update(environments).set({ nodeStartFile: "server.js" }).where(eq(environments.id, root.id));
          await db.insert(deployConfigs).values({ envId: root.id, framework: "nextjs", runModel: "standalone" }).onConflictDoNothing();
          await db.insert(envVars).values([
            { envId: root.id, key: "PORT", valueEncrypted: encryptSecret("80"), buildTime: false },
            { envId: root.id, key: "HOSTNAME", valueEncrypted: encryptSecret("0.0.0.0"), buildTime: false },
            { envId: root.id, key: "NODE_ENV", valueEncrypted: encryptSecret("production"), buildTime: false },
          ]).onConflictDoNothing();
        }
      } else if (category === "service") {
        const ins = await db.insert(environments).values({
          name, ownerId: user.id, nodeId: null, plan, typeId: et!.id,
          runtimeKind: "node", runtimeVersion: et!.image?.split(":")[1] ?? "latest", state: "provisioning",
        }).returning();
        root = ins[0]!;
      } else {
        if (!et!.childType) throw new ApiHttpError(400, "invalid_type", "stack sem banco-filho configurado");
        const [child] = await db.select().from(envTypes).where(eq(envTypes.id, et!.childType)).limit(1);
        if (!child) throw new ApiHttpError(400, "invalid_type", "tipo do banco-filho inválido");
        const ins = await db.insert(environments).values({
          name, ownerId: user.id, nodeId: null, plan, typeId: et!.id,
          runtimeKind: "node", runtimeVersion: et!.image?.split(":")[1] ?? "latest", state: "provisioning",
        }).returning();
        root = ins[0]!;
        await db.insert(environments).values({
          name: `${name}-db`, ownerId: user.id, nodeId: null, plan, typeId: child.id, parentEnvId: root.id,
          runtimeKind: "node", runtimeVersion: child.image?.split(":")[1] ?? "latest", state: "provisioning",
        });
      }
      await db.insert(jobs).values({ kind: "provision_env", envId: root.id, payload: { region: req.body.region ?? null, template: req.body.template ?? null } });
      return await toEnvironment(root);
    },
  );

  // GET /environments/:id
  app.get(
    "/environments/:id",
    {
      schema: {
        params: idParams,
        response: { 200: environmentSchema, 401: apiError, 403: apiError, 404: apiError },
      },
    },
    async (req): Promise<Environment> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      return await toEnvironment(env);
    },
  );

  // GET /environments/:id/disk — uso de disco atual (medido sob demanda no nó).
  app.get(
    "/environments/:id/disk",
    {
      schema: {
        params: idParams,
        response: { 200: diskUsageSchema, 401: apiError, 403: apiError, 404: apiError },
      },
    },
    async (req): Promise<{ diskBytes: number }> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      if (env.state !== "running" || !env.containerId) return { diskBytes: 0 };
      try {
        return await agent.diskUsage(await agentUrlForEnv(env), env.containerId);
      } catch {
        return { diskBytes: 0 };
      }
    },
  );

  // GET /environments/:id/logs — snapshot das últimas linhas (dono ou admin).
  const logsQuery = z.object({ tail: z.coerce.number().int().min(1).max(2000).optional() });
  app.get(
    "/environments/:id/logs",
    {
      schema: {
        params: idParams,
        querystring: logsQuery,
        response: { 200: containerLogsSchema, 401: apiError, 403: apiError, 404: apiError, 502: apiError },
      },
    },
    async (req): Promise<{ log: string }> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user); // dono ou admin
      if (!env.containerId) return { log: "" };
      return agent.containerLogs(await agentUrlForEnv(env), env.containerId, req.query.tail ?? 200);
    },
  );

  // GET /environments/:id/logs/stream — stream ao vivo (SSE). A API repassa o
  // corpo do stream do Agente para o navegador (EventSource, mesmo domínio).
  app.get(
    "/environments/:id/logs/stream",
    { schema: { params: idParams, querystring: logsQuery } },
    async (req, reply) => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user); // dono ou admin
      if (!env.containerId) {
        return reply.code(409).send({ error: "no_container", message: "ambiente ainda não tem container" });
      }
      const tail = req.query.tail ?? 200;
      const { url, headers } = agent.containerLogsStream(await agentUrlForEnv(env), env.containerId, tail);
      let upstream: Response;
      try {
        upstream = await fetch(url, { headers });
      } catch {
        return reply.code(502).send({ error: "agent_unreachable", message: "não foi possível falar com o Agente" });
      }
      if (!upstream.ok || !upstream.body) {
        return reply.code(502).send({ error: "agent_error", message: `Agente respondeu ${upstream.status}` });
      }
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const reader = upstream.body.getReader();
      const pump = async (): Promise<void> => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) raw.write(Buffer.from(value));
          }
        } catch {
          /* conexão encerrada */
        } finally {
          raw.end();
        }
      };
      void pump();
      req.raw.on("close", () => { void reader.cancel().catch(() => {}); });
    },
  );

  // POST /environments/:id/pause
  app.post(
    "/environments/:id/pause",
    {
      schema: {
        params: idParams,
        response: { 200: environmentSchema, 401: apiError, 403: apiError, 404: apiError, 502: apiError },
      },
    },
    async (req): Promise<Environment> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      if (env.containerId) await agent.stop(await agentUrlForEnv(env), env.containerId);
      const updated = await db
        .update(environments)
        .set({ state: "paused" })
        .where(eq(environments.id, env.id))
        .returning();
      return await toEnvironment(updated[0] ?? env);
    },
  );

  // POST /environments/:id/start
  app.post(
    "/environments/:id/start",
    {
      schema: {
        params: idParams,
        response: { 200: environmentSchema, 401: apiError, 402: apiError, 403: apiError, 404: apiError, 502: apiError },
      },
    },
    async (req): Promise<Environment> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);

      // Trava de saldo (mesma da criação): cliente sem saldo NÃO pode ligar o
      // ambiente — senão burla a suspensão por inadimplência. Admin é isento;
      // banco-filho de stack não é cobrado à parte (custo 0).
      if (user.role !== "admin" && !env.parentEnvId) {
        const plan = await getPlan(env.plan);
        let adderMonthCents = 0;
        if (env.typeId) {
          const [t] = await db.select().from(envTypes).where(eq(envTypes.id, env.typeId)).limit(1);
          adderMonthCents = t?.priceMonthCents ?? 0;
        }
        const hourlyCents = plan ? Math.ceil((plan.priceMonthCents + adderMonthCents) / 720) : 0;
        const bal = await balanceCents(user.id);
        if (bal < hourlyCents) {
          throw new ApiHttpError(
            402,
            "insufficient_balance",
            `Saldo insuficiente: você tem ${brl(bal)} e este ambiente custa ${brl(hourlyCents)}/hora. Adicione saldo para iniciar.`,
          );
        }
      }

      let httpPort = env.httpPort;
      if (env.containerId) {
        const res = await agent.start(await agentUrlForEnv(env), env.containerId);
        httpPort = res.httpPort; // a porta efêmera muda a cada start
      }
      const updated = await db
        .update(environments)
        .set({ state: "running", httpPort })
        .where(eq(environments.id, env.id))
        .returning();
      // Nova porta efêmera → atualiza o vhost do subdomínio no Caddy do CP.
      await syncSubVhost(updated[0]?.autoSubdomain ?? null, env.nodeId, httpPort);
      return await toEnvironment(updated[0] ?? env);
    },
  );

  // POST /environments/:id/restart — reinicia o processo do app (aplica edições
  // de arquivo sem recriar o container; mesma porta, /app preservado).
  app.post(
    "/environments/:id/restart",
    {
      schema: {
        params: idParams,
        response: { 200: environmentSchema, 401: apiError, 403: apiError, 404: apiError, 409: apiError, 502: apiError },
      },
    },
    async (req): Promise<Environment> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      if (env.state !== "running" || !env.containerId) {
        throw new ApiHttpError(409, "not_running", "inicie o ambiente antes de reiniciar");
      }
      await agent.restartApp(await agentUrlForEnv(env), env.containerId);
      return await toEnvironment(env);
    },
  );

  // DELETE /environments/:id
  app.delete(
    "/environments/:id",
    {
      schema: {
        params: idParams,
        response: { 202: environmentSchema, 401: apiError, 403: apiError, 404: apiError },
      },
    },
    async (req, reply) => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);

      // Acerto de cobrança ANTES de mudar o estado: debita o tempo usado ainda não
      // faturado (respeita a cortesia de billing_free_minutes). Nunca falha o delete.
      await settleEnvironment(env.id, req.log);

      // Marca "deleting" (raiz + filhos), cancela um provision ainda na fila e enfileira o delete.
      await db.update(environments).set({ state: "deleting" }).where(eq(environments.id, env.id));
      await db.update(environments).set({ state: "deleting" }).where(eq(environments.parentEnvId, env.id));
      await db.update(jobs).set({ status: "canceled", finishedAt: new Date() }).where(and(eq(jobs.envId, env.id), eq(jobs.kind, "provision_env"), eq(jobs.status, "queued")));
      await db.insert(jobs).values({ kind: "delete_env", envId: env.id, maxAttempts: 20 });
      const [updated] = await db.select().from(environments).where(eq(environments.id, env.id)).limit(1);
      return reply.status(202).send(await toEnvironment(updated ?? env));
    },
  );

  // POST /environments/:id/retry — re-enfileira o último job (provisionar/remover) se falhou.
  app.post(
    "/environments/:id/retry",
    { schema: { params: idParams, response: { 200: environmentSchema, 401: apiError, 403: apiError, 404: apiError, 409: apiError } } },
    async (req): Promise<Environment> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const active = await db.select().from(jobs).where(and(eq(jobs.envId, env.id))).limit(50);
      if (active.some((j) => j.status === "queued" || j.status === "running")) {
        throw new ApiHttpError(409, "job_in_progress", "já há uma operação em andamento para este ambiente");
      }
      const last = active.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      const kind = last?.kind ?? "provision_env";
      const newState = kind === "delete_env" ? "deleting" : "provisioning";
      await db.update(environments).set({ state: newState, errorMessage: null }).where(eq(environments.id, env.id));
      await db.update(environments).set({ state: newState }).where(eq(environments.parentEnvId, env.id));
      await db.insert(jobs).values({ kind, envId: env.id, maxAttempts: kind === "delete_env" ? 20 : 8 });
      const [updated] = await db.select().from(environments).where(eq(environments.id, env.id)).limit(1);
      return await toEnvironment(updated ?? env);
    },
  );

  // POST /environments/:id/domain — define/limpa o domínio do ambiente
  app.post(
    "/environments/:id/domain",
    {
      schema: {
        params: idParams,
        body: setDomainInput,
        response: { 200: environmentSchema, 401: apiError, 403: apiError, 404: apiError },
      },
    },
    async (req): Promise<Environment> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const updated = await db
        .update(environments)
        .set({ domain: req.body.domain })
        .where(eq(environments.id, env.id))
        .returning();
      return await toEnvironment(updated[0] ?? env);
    },
  );

  // PATCH /environments/:id/subdomain — cliente personaliza o subdomínio jamees.top.
  app.patch(
    "/environments/:id/subdomain",
    {
      schema: {
        params: idParams,
        body: setSubdomainInput,
        response: { 200: environmentSchema, 401: apiError, 403: apiError, 404: apiError, 409: apiError, 422: apiError },
      },
    },
    async (req): Promise<Environment> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const sub = req.body.subdomain; // já normalizado/validado (formato) pelo zod
      if (await isSubReserved(sub)) throw new ApiHttpError(409, "subdomain_reserved", `“${sub}” é reservado; escolha outro.`);
      if (await isSubTaken(sub, env.id)) throw new ApiHttpError(409, "subdomain_taken", `“${sub}” já está em uso; escolha outro.`);
      const old = env.autoSubdomain;
      let updated;
      try {
        updated = await db.update(environments).set({ autoSubdomain: sub }).where(eq(environments.id, env.id)).returning();
      } catch {
        throw new ApiHttpError(409, "subdomain_taken", "esse subdomínio acabou de ser tomado; tente outro.");
      }
      if (old && old.toLowerCase() !== sub) await cpIngress.removeSite(old);
      await syncSubVhost(sub, env.nodeId, env.httpPort);
      return await toEnvironment(updated[0] ?? env);
    },
  );

  // POST /environments/:id/startup — define/limpa os comandos de inicialização.
  // Aplica na PRÓXIMA criação/recriação do container (rodam 1x).
  app.post(
    "/environments/:id/startup",
    {
      schema: {
        params: idParams,
        body: setStartupScriptInput,
        response: { 200: environmentSchema, 401: apiError, 403: apiError, 404: apiError },
      },
    },
    async (req): Promise<Environment> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const updated = await db
        .update(environments)
        .set({ startupScript: req.body.startupScript })
        .where(eq(environments.id, env.id))
        .returning();
      return await toEnvironment(updated[0] ?? env);
    },
  );

  // POST /environments/:id/node-start — define o arquivo que inicia o app Node
  // (ex.: server.js) e REINICIA o app para aplicar (sem recriar o container, então
  // os arquivos do cliente são preservados). Só faz sentido em ambiente Node.
  app.post(
    "/environments/:id/node-start",
    {
      schema: {
        params: idParams,
        body: setNodeStartFileInput,
        response: { 200: environmentSchema, 400: apiError, 401: apiError, 403: apiError, 404: apiError, 502: apiError },
      },
    },
    async (req): Promise<Environment> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const isPython = env.runtimeKind === "python";
      if (env.runtimeKind !== "node" && !isPython) {
        throw new ApiHttpError(
          400,
          "not_node",
          "o arquivo de inicialização só se aplica a ambientes Node ou Python",
        );
      }
      const startFile = req.body.nodeStartFile?.trim() || null;
      const updated = await db
        .update(environments)
        .set({ nodeStartFile: startFile })
        .where(eq(environments.id, env.id))
        .returning();
      const row = updated[0] ?? env;

      // aplica ao vivo: reinicia o processo com o novo arquivo (mantém arquivos/porta).
      if (row.containerId && row.state === "running") {
        const agentUrl = await agentUrlForEnv(row);
        try {
          if (isPython) await agent.applyPythonStart(agentUrl, row.containerId, startFile || "app.py");
          else await agent.applyNodeStart(agentUrl, row.containerId, startFile || "index.js");
        } catch (err) {
          req.log.warn({ err, envId: env.id }, "falha ao aplicar arquivo de start");
        }
      }
      return await toEnvironment(row);
    },
  );

  // POST /environments/:id/python-cmd — define/limpa o comando avançado do Python
  // (Django/gunicorn) e reinicia o app. "" ou null volta ao default python3 app.py.
  app.post(
    "/environments/:id/python-cmd",
    {
      schema: {
        params: idParams,
        body: setPythonCmdInput,
        response: { 200: environmentSchema, 400: apiError, 401: apiError, 403: apiError, 404: apiError, 502: apiError },
      },
    },
    async (req): Promise<Environment> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      if (env.runtimeKind !== "python") {
        throw new ApiHttpError(400, "not_python", "o comando de start avançado só se aplica a ambientes Python");
      }
      const cmd = req.body.cmd?.trim() || null;
      const updated = await db
        .update(environments)
        .set({ pythonCmd: cmd })
        .where(eq(environments.id, env.id))
        .returning();
      const row = updated[0] ?? env;
      if (row.containerId && row.state === "running") {
        const agentUrl = await agentUrlForEnv(row);
        try {
          await agent.applyPythonCmd(agentUrl, row.containerId, cmd);
        } catch (err) {
          req.log.warn({ err, envId: env.id }, "falha ao aplicar comando de start do Python");
        }
      }
      return await toEnvironment(row);
    },
  );

  // POST /environments/:id/dotnet-cmd — define/limpa o comando de start avançado do
  // .NET (ex.: dotnet App.dll) e reinicia o app. "" ou null volta ao auto (detecta a DLL).
  app.post(
    "/environments/:id/dotnet-cmd",
    {
      schema: {
        params: idParams,
        body: setDotnetCmdInput,
        response: { 200: environmentSchema, 400: apiError, 401: apiError, 403: apiError, 404: apiError, 502: apiError },
      },
    },
    async (req): Promise<Environment> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      if (env.runtimeKind !== "dotnet") {
        throw new ApiHttpError(400, "not_dotnet", "o comando de start avançado só se aplica a ambientes .NET");
      }
      const cmd = req.body.cmd?.trim() || null;
      const updated = await db
        .update(environments)
        .set({ dotnetCmd: cmd })
        .where(eq(environments.id, env.id))
        .returning();
      const row = updated[0] ?? env;
      if (row.containerId && row.state === "running") {
        const agentUrl = await agentUrlForEnv(row);
        try {
          await agent.applyDotnetCmd(agentUrl, row.containerId, cmd);
        } catch (err) {
          req.log.warn({ err, envId: env.id }, "falha ao aplicar comando de start do .NET");
        }
      }
      return await toEnvironment(row);
    },
  );

  // POST /environments/:id/node-version — troca a versão de Node (via nvm) de um
  // ambiente PHP. Aplica AO VIVO (docker exec, sem recriar) e guarda a versão.
  app.post(
    "/environments/:id/node-version",
    {
      schema: {
        params: idParams,
        body: setPhpNodeVersionInput,
        response: { 200: environmentSchema, 400: apiError, 401: apiError, 403: apiError, 404: apiError, 502: apiError },
      },
    },
    async (req): Promise<Environment> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      if (env.runtimeKind !== "php") {
        throw new ApiHttpError(400, "not_php", "a versão do Node (nvm) só se aplica a ambientes PHP");
      }
      const version = req.body.phpNodeVersion;
      let versionFull: string | null = null;
      if (env.containerId && env.state === "running") {
        const agentUrl = await agentUrlForEnv(env);
        try {
          const r = await agent.applyNodeVersion(agentUrl, env.containerId, version);
          versionFull = r.versionFull;
        } catch (err) {
          req.log.warn({ err, envId: env.id }, "falha ao aplicar versão de Node (nvm)");
        }
      }
      const updated = await db
        .update(environments)
        .set({ phpNodeVersion: version, phpNodeVersionFull: versionFull })
        .where(eq(environments.id, env.id))
        .returning();
      return await toEnvironment(updated[0] ?? env);
    },
  );

  // GET /environments/:id/node-version — versão de Node ATUAL no container (lê ao
  // vivo do nvm; reflete troca feita no terminal). null se a imagem não tem nvm.
  app.get(
    "/environments/:id/node-version",
    {
      schema: {
        params: idParams,
        response: { 200: phpNodeCurrentSchema, 401: apiError, 403: apiError, 404: apiError },
      },
    },
    async (req): Promise<{ current: string | null }> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      if (env.runtimeKind !== "php" || !env.containerId || env.state !== "running") {
        return { current: null };
      }
      try {
        const agentUrl = await agentUrlForEnv(env);
        return await agent.readNodeCurrent(agentUrl, env.containerId);
      } catch {
        return { current: null };
      }
    },
  );

  // POST /environments/:id/runtime — troca a versão/linguagem (recria o container)
  app.post(
    "/environments/:id/runtime",
    {
      schema: {
        params: idParams,
        body: changeRuntimeInput,
        response: { 200: environmentSchema, 401: apiError, 403: apiError, 404: apiError, 502: apiError },
      },
    },
    async (req): Promise<Environment> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const planSpec = (await getPlan(env.plan)) ?? { vcpu: 1, memMb: 512 };
      const newRuntime = req.body;

      // A LINGUAGEM é fixada na criação — só a versão pode mudar depois.
      if (newRuntime.kind !== env.runtimeKind) {
        throw new ApiHttpError(
          400,
          "language_locked",
          "não é possível trocar a linguagem após a criação do ambiente; só a versão",
        );
      }

      // remove o container antigo (se houver) e provisiona um novo com a nova versão
      const agentUrl = await agentUrlForEnv(env);
      if (env.containerId) {
        try {
          await agent.remove(agentUrl, env.containerId);
        } catch (err) {
          req.log.warn({ err, envId: env.id }, "falha ao remover container antigo na troca de runtime");
        }
      }
      // Mantém o app na rede por-dono: reusa o endereço "app" (ou aloca se legado).
      let netInfo: { name: string; subnet: string; gateway: string } | null = null;
      let appIp: string | null = null;
      if (env.nodeId) {
        const existing = (await db.select().from(envAddresses).where(and(eq(envAddresses.envId, env.id), eq(envAddresses.role, "app"))))[0];
        const onet = await ownerNetworkFor(env.nodeId, env.ownerId);
        if (existing && onet) {
          appIp = existing.ip;
          netInfo = { name: onet.bridgeName, subnet: onet.subnet, gateway: onet.gateway };
        } else {
          const a = await allocateAddress(env.nodeId, env.ownerId, env.id, "app");
          appIp = a.ip;
          netInfo = { name: a.bridgeName, subnet: a.subnet, gateway: a.gateway };
        }
      }
      const result = await agent.provision(agentUrl, {
        envId: env.id,
        name: env.name,
        runtime: { kind: newRuntime.kind, version: newRuntime.version },
        limits: { vcpu: planSpec.vcpu, memMb: planSpec.memMb },
        startupScript: env.startupScript,
        startFile: env.nodeStartFile,
        pythonCmd: env.pythonCmd,
        dotnetCmd: env.dotnetCmd,
        phpNodeVersion: env.phpNodeVersion,
        phpRoot: env.phpWebRoot,
        envVars: await envVarsForProvision(env.id),
        network: netInfo,
        ip: appIp,
        ownerId: env.ownerId,
      });
      if (appIp) {
        await db.update(envAddresses).set({ containerId: result.containerId }).where(and(eq(envAddresses.envId, env.id), eq(envAddresses.role, "app")));
      }
      const updated = await db
        .update(environments)
        .set({
          runtimeKind: newRuntime.kind,
          runtimeVersion: newRuntime.version,
          runtimeVersionFull: result.versionFull,
          phpNodeVersionFull: result.phpNodeVersionFull ?? null,
          containerId: result.containerId,
          httpPort: result.httpPort,
          state: "running",
        })
        .where(eq(environments.id, env.id))
        .returning();
      await syncSubVhost(updated[0]?.autoSubdomain ?? null, env.nodeId, result.httpPort);
      return await toEnvironment(updated[0] ?? env);
    },
  );
}
