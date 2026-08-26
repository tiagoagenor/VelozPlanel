import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import {
  adminPanelStatus as adminPanelStatusSchema,
  setAdminPanelInput,
  apiError,
} from "@velozplanel/contracts";
import type { AdminPanelStatus } from "@velozplanel/contracts";
import { db } from "../db/client";
import { envTools, serviceCredentials, environments } from "../db/schema";
import type { EnvironmentRow, EnvToolRow } from "../db/schema";
import { ApiHttpError, requireUser } from "../auth";
import { decryptSecret } from "../crypto";
import { serviceUiPort } from "../services";
import { ensureServiceUiPublished } from "../provisioner";
import { agentUrlForEnv } from "../nodes";
import * as cpIngress from "../cp-ingress";
import { generateSubdomain } from "../subdomain";
import { loadEnvironmentForUser } from "./environments";

const idParams = z.object({ id: z.string().uuid() });

// Painel embutido do RabbitMQ (imagem `-management`). O modelo env_tools é genérico,
// então isto vale para qualquer serviço listado em SERVICE_UI_PORTS.
const TOOL_KIND = "rabbitmq_mgmt";

async function loadToolRow(envId: string): Promise<EnvToolRow | null> {
  const rows = await db
    .select()
    .from(envTools)
    .where(and(eq(envTools.envId, envId), eq(envTools.kind, TOOL_KIND)))
    .limit(1);
  return rows[0] ?? null;
}

async function upsertToolRow(
  envId: string,
  patch: { enabled?: boolean; subdomain?: string | null; targetPort?: number | null },
): Promise<void> {
  const existing = await loadToolRow(envId);
  if (existing) {
    await db.update(envTools).set(patch).where(eq(envTools.id, existing.id));
  } else {
    await db.insert(envTools).values({
      envId,
      kind: TOOL_KIND,
      enabled: patch.enabled ?? false,
      subdomain: patch.subdomain ?? null,
      targetPort: patch.targetPort ?? null,
    });
  }
}

/** Gera um subdomínio aleatório livre também no namespace de painéis (env_tools). */
async function generateToolSubdomain(): Promise<string> {
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
async function panelCreds(envId: string): Promise<{ user: string | null; password: string | null }> {
  const rows = await db.select().from(serviceCredentials).where(eq(serviceCredentials.envId, envId));
  let user: string | null = null;
  let password: string | null = null;
  for (const c of rows) {
    if (c.key === "user") user = decryptSecret(c.valueEncrypted);
    else if (c.key === "password") password = decryptSecret(c.valueEncrypted);
  }
  return { user, password };
}

function buildStatus(
  env: EnvironmentRow,
  row: EnvToolRow | null,
  creds: { user: string | null; password: string | null },
): AdminPanelStatus {
  const supported = !!serviceUiPort(env.typeId ?? "");
  const enabled = !!row?.enabled;
  const url = enabled && row?.subdomain ? `https://${row.subdomain}.${cpIngress.TOOL_ZONE}` : null;
  let message: string | null = null;
  if (!supported) {
    message = "Este ambiente não tem painel admin embutido.";
  } else if (enabled) {
    message =
      "Painel exposto. Entre com o usuário e a senha abaixo. Desligue quando não estiver usando.";
  } else {
    message = "Painel desligado. Ligue para gerar uma URL e acessar a interface de administração.";
  }
  return {
    envId: env.id,
    supported,
    enabled,
    url,
    user: enabled ? creds.user : null,
    password: enabled ? creds.password : null,
    message,
  };
}

export async function adminPanelRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // GET /environments/:id/admin-panel — estado do painel admin do serviço.
  app.get(
    "/environments/:id/admin-panel",
    {
      schema: {
        params: idParams,
        response: { 200: adminPanelStatusSchema, 401: apiError, 403: apiError, 404: apiError },
      },
    },
    async (req): Promise<AdminPanelStatus> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const row = await loadToolRow(env.id);
      return buildStatus(env, row, await panelCreds(env.id));
    },
  );

  // POST /environments/:id/admin-panel — liga/desliga a exposição do painel.
  app.post(
    "/environments/:id/admin-panel",
    {
      schema: {
        params: idParams,
        body: setAdminPanelInput,
        response: {
          200: adminPanelStatusSchema,
          400: apiError,
          401: apiError,
          403: apiError,
          404: apiError,
          409: apiError,
        },
      },
    },
    async (req): Promise<AdminPanelStatus> => {
      const user = await requireUser(req);
      let env = await loadEnvironmentForUser(req.params.id, user);
      const uiPort = serviceUiPort(env.typeId ?? "");
      if (!uiPort) {
        throw new ApiHttpError(400, "sem_painel", "este ambiente não tem painel admin embutido");
      }

      if (req.body.enabled) {
        if (!env.nodeId) {
          throw new ApiHttpError(409, "sem_no", "ambiente ainda não provisionado");
        }
        // Garante que o container publica a porta do painel (recria 1x se foi
        // provisionado antes desta funcionalidade; volume/credenciais preservados).
        if (!env.httpPort) {
          env = await ensureServiceUiPublished(env.id);
        }
        if (!env.httpPort) {
          throw new ApiHttpError(409, "sem_porta", "não foi possível publicar a porta do painel");
        }
        const agentUrl = await agentUrlForEnv({ nodeId: env.nodeId });
        const ip = cpIngress.wgIpFromAgentUrl(agentUrl);
        if (!ip) {
          throw new ApiHttpError(409, "sem_rota", "não foi possível determinar a rota até o nó");
        }
        const existing = await loadToolRow(env.id);
        const sub = existing?.subdomain ?? (await generateToolSubdomain());
        await cpIngress.putSite(sub, `${ip}:${env.httpPort}`, cpIngress.TOOL_ZONE);
        await upsertToolRow(env.id, { enabled: true, subdomain: sub, targetPort: uiPort });
      } else {
        const existing = await loadToolRow(env.id);
        if (existing?.subdomain) {
          await cpIngress.removeSite(existing.subdomain, cpIngress.TOOL_ZONE);
        }
        await upsertToolRow(env.id, { enabled: false }); // mantém o subdomínio p/ reuso estável
      }

      const [fresh] = await db.select().from(environments).where(eq(environments.id, env.id)).limit(1);
      const row = await loadToolRow(env.id);
      return buildStatus(fresh ?? env, row, await panelCreds(env.id));
    },
  );
}
