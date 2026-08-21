import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { eq, count } from "drizzle-orm";
import {
  environment as environmentSchema,
  createEnvironmentInput,
  setDomainInput,
  changeRuntimeInput,
  apiError,
  PLANS,
} from "@velozplanel/contracts";
import type {
  Environment,
  SessionUser,
  PlanId,
  RuntimeKind,
  EnvState,
} from "@velozplanel/contracts";
import { db } from "../db/client";
import { environments, nodes } from "../db/schema";
import type { EnvironmentRow } from "../db/schema";
import { ApiHttpError, requireUser } from "../auth";
import { getPlan } from "../plans";
import * as agent from "../agent";

const idParams = z.object({ id: z.string().uuid() });

/** Converte uma linha do DB para o formato do contrato. */
export function toEnvironment(r: EnvironmentRow): Environment {
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
    createdAt: r.createdAt.toISOString(),
  };
}

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
      const rows =
        user.role === "admin"
          ? await db.select().from(environments)
          : await db.select().from(environments).where(eq(environments.ownerId, user.id));
      return rows.map(toEnvironment);
    },
  );

  // POST /environments — cria, provisiona no Agente, liga.
  app.post(
    "/environments",
    {
      schema: {
        body: createEnvironmentInput,
        response: { 200: environmentSchema, 401: apiError, 502: apiError },
      },
    },
    async (req): Promise<Environment> => {
      const user = await requireUser(req);
      const { name, plan, runtime } = req.body;
      const planSpec = await getPlan(plan);
      if (!planSpec) throw new ApiHttpError(400, "invalid_plan", "plano inválido");

      // Limite de máquinas por cliente definido no plano (admin não é limitado).
      if (user.role !== "admin") {
        const [c] = await db
          .select({ c: count() })
          .from(environments)
          .where(eq(environments.ownerId, user.id));
        const current = c?.c ?? 0;
        if (current >= planSpec.maxEnvironments) {
          throw new ApiHttpError(
            409,
            "env_limit_reached",
            `limite de ${planSpec.maxEnvironments} ambiente(s) do plano ${planSpec.label} atingido`,
          );
        }
      }

      // Nó local (representa o Agente). Pode ser null se ainda não houver seed.
      const nodeRows = await db.select().from(nodes).limit(1);
      const nodeId = nodeRows[0]?.id ?? null;

      // 1) cria em estado provisioning
      const inserted = await db
        .insert(environments)
        .values({
          name,
          ownerId: user.id,
          nodeId,
          plan,
          runtimeKind: runtime.kind,
          runtimeVersion: runtime.version,
          state: "provisioning",
        })
        .returning();
      const env = inserted[0];
      if (!env) throw new ApiHttpError(500, "internal_error", "falha ao criar ambiente");

      // 2) provisiona no Agente
      try {
        const result = await agent.provision({
          envId: env.id,
          name: env.name,
          runtime: { kind: runtime.kind, version: runtime.version },
          limits: { vcpu: planSpec.vcpu, memMb: planSpec.memMb },
        });

        const updated = await db
          .update(environments)
          .set({
            containerId: result.containerId,
            httpPort: result.httpPort,
            state: "running",
          })
          .where(eq(environments.id, env.id))
          .returning();
        const finalRow = updated[0] ?? env;
        return toEnvironment(finalRow);
      } catch (err) {
        // marca erro e propaga
        await db
          .update(environments)
          .set({ state: "error" })
          .where(eq(environments.id, env.id));
        throw err;
      }
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
      return toEnvironment(env);
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
      if (env.containerId) await agent.stop(env.containerId);
      const updated = await db
        .update(environments)
        .set({ state: "paused" })
        .where(eq(environments.id, env.id))
        .returning();
      return toEnvironment(updated[0] ?? env);
    },
  );

  // POST /environments/:id/start
  app.post(
    "/environments/:id/start",
    {
      schema: {
        params: idParams,
        response: { 200: environmentSchema, 401: apiError, 403: apiError, 404: apiError, 502: apiError },
      },
    },
    async (req): Promise<Environment> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      let httpPort = env.httpPort;
      if (env.containerId) {
        const res = await agent.start(env.containerId);
        httpPort = res.httpPort; // a porta efêmera muda a cada start
      }
      const updated = await db
        .update(environments)
        .set({ state: "running", httpPort })
        .where(eq(environments.id, env.id))
        .returning();
      return toEnvironment(updated[0] ?? env);
    },
  );

  // DELETE /environments/:id
  app.delete(
    "/environments/:id",
    {
      schema: {
        params: idParams,
        response: { 204: z.null(), 401: apiError, 403: apiError, 404: apiError, 502: apiError },
      },
    },
    async (req, reply) => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);

      if (env.containerId) {
        try {
          await agent.remove(env.containerId);
        } catch (err) {
          req.log.warn({ err, envId: env.id }, "falha ao remover container no Agente; removendo do DB mesmo assim");
        }
      }
      // metric_samples caem por ON DELETE CASCADE
      await db.delete(environments).where(eq(environments.id, env.id));
      return reply.status(204).send(null);
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
      return toEnvironment(updated[0] ?? env);
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
      if (env.containerId) {
        try {
          await agent.remove(env.containerId);
        } catch (err) {
          req.log.warn({ err, envId: env.id }, "falha ao remover container antigo na troca de runtime");
        }
      }
      const result = await agent.provision({
        envId: env.id,
        name: env.name,
        runtime: { kind: newRuntime.kind, version: newRuntime.version },
        limits: { vcpu: planSpec.vcpu, memMb: planSpec.memMb },
      });
      const updated = await db
        .update(environments)
        .set({
          runtimeKind: newRuntime.kind,
          runtimeVersion: newRuntime.version,
          containerId: result.containerId,
          httpPort: result.httpPort,
          state: "running",
        })
        .where(eq(environments.id, env.id))
        .returning();
      return toEnvironment(updated[0] ?? env);
    },
  );
}
