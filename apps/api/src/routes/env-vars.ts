import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { eq } from "drizzle-orm";
import {
  envVarsConfig as envVarsConfigSchema,
  setEnvVarsInput,
  apiError,
} from "@velozplanel/contracts";
import type { EnvVarsConfig } from "@velozplanel/contracts";
import { db } from "../db/client";
import { envVars } from "../db/schema";
import { ApiHttpError, requireUser } from "../auth";
import { loadEnvironmentForUser } from "./environments";
import { encryptSecret, decryptSecret } from "../crypto";
import * as agent from "../agent";
import { agentUrlForEnv } from "../nodes";

const idParams = z.object({ id: z.string().uuid() });

function mask(): string {
  return "••••••••";
}

export async function envVarsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // GET — lista com valores MASCARADOS.
  app.get(
    "/environments/:id/env-vars",
    { schema: { params: idParams, response: { 200: envVarsConfigSchema, 401: apiError, 403: apiError, 404: apiError } } },
    async (req): Promise<EnvVarsConfig> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const rows = await db.select().from(envVars).where(eq(envVars.envId, env.id));
      return {
        vars: rows.map((r) => ({ key: r.key, buildTime: r.buildTime, hasValue: true, valueMasked: mask() })),
        applied: true,
        message: null,
      };
    },
  );

  // PUT — substitui o conjunto inteiro (cifra) e aplica AO VIVO se estiver rodando.
  app.put(
    "/environments/:id/env-vars",
    { schema: { params: idParams, body: setEnvVarsInput, response: { 200: envVarsConfigSchema, 400: apiError, 401: apiError, 403: apiError, 404: apiError } } },
    async (req): Promise<EnvVarsConfig> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const vars = req.body.vars;

      await db.delete(envVars).where(eq(envVars.envId, env.id));
      if (vars.length) {
        await db.insert(envVars).values(
          vars.map((v) => ({
            envId: env.id,
            key: v.key,
            valueEncrypted: encryptSecret(v.value),
            buildTime: v.buildTime ?? false,
          })),
        );
      }

      let applied = false;
      let message: string | null = "Salvo.";
      if (env.containerId && env.state === "running") {
        try {
          const agentUrl = await agentUrlForEnv(env);
          const r = await agent.applyEnvVars(
            agentUrl,
            env.containerId,
            vars.map((v) => ({ key: v.key, value: v.value })),
          );
          applied = r.applied;
          message = r.applied
            ? "Aplicado — o app foi reiniciado com as variáveis."
            : "Salvo. Recrie o ambiente (trocar versão) para aplicar as variáveis.";
        } catch (err) {
          req.log.warn({ err, envId: env.id }, "falha ao aplicar env vars ao vivo");
          message = "Salvo, mas não foi possível aplicar agora.";
        }
      }
      const rows = await db.select().from(envVars).where(eq(envVars.envId, env.id));
      return {
        vars: rows.map((r) => ({ key: r.key, buildTime: r.buildTime, hasValue: true, valueMasked: mask() })),
        applied,
        message,
      };
    },
  );

  // POST /reveal — devolve os valores em texto UMA vez (no-store, sem cache).
  app.post(
    "/environments/:id/env-vars/reveal",
    { schema: { params: idParams, response: { 200: z.object({ vars: z.array(z.object({ key: z.string(), value: z.string(), buildTime: z.boolean() })) }), 401: apiError, 403: apiError, 404: apiError } } },
    async (req, reply) => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      reply.header("cache-control", "no-store");
      reply.header("pragma", "no-cache");
      const rows = await db.select().from(envVars).where(eq(envVars.envId, env.id));
      return { vars: rows.map((r) => ({ key: r.key, value: decryptSecret(r.valueEncrypted), buildTime: r.buildTime })) };
    },
  );
}
