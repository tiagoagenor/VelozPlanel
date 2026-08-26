import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { eq } from "drizzle-orm";
import {
  adminPanelStatus as adminPanelStatusSchema,
  setAdminPanelInput,
  apiError,
} from "@velozplanel/contracts";
import type { AdminPanelStatus } from "@velozplanel/contracts";
import { db } from "../db/client";
import { environments } from "../db/schema";
import type { EnvironmentRow, EnvToolRow } from "../db/schema";
import { ApiHttpError, requireUser } from "../auth";
import { serviceUiPort } from "../services";
import { ensureServiceUiPublished } from "../provisioner";
import { loadPanelRow, panelCreds, panelUrl, enablePanel, disablePanel, panelToolLabel } from "../service-panel";
import { loadEnvironmentForUser } from "./environments";

const idParams = z.object({ id: z.string().uuid() });

function buildStatus(
  env: EnvironmentRow,
  row: EnvToolRow | null,
  creds: { user: string | null; password: string | null },
): AdminPanelStatus {
  const tool = panelToolLabel(env.typeId);
  const supported = !!tool;
  const enabled = !!row?.enabled;
  const url = panelUrl(row);
  let message: string | null = null;
  if (!supported) {
    message = "Este ambiente não tem painel.";
  } else if (enabled) {
    message = `${tool} exposto. Entre com o usuário e a senha abaixo. Desligue quando não estiver usando.`;
  } else {
    message = `Painel desligado. Ligue para subir o ${tool} numa URL própria.`;
  }
  return {
    envId: env.id,
    supported,
    enabled,
    tool,
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
      const row = await loadPanelRow(env.id);
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
      if (!panelToolLabel(env.typeId)) {
        throw new ApiHttpError(400, "sem_painel", "este ambiente não tem painel");
      }

      if (req.body.enabled) {
        if (!env.nodeId) throw new ApiHttpError(409, "sem_no", "ambiente ainda não provisionado");
        // Painel EMBUTIDO (rabbitmq): garante a porta publicada antes de ligar
        // (recria 1x quem foi criado antes da feature). Sidecar (phpmyadmin/adminer)
        // não usa httpPort do próprio serviço — sobe um container à parte.
        if (serviceUiPort(env.typeId ?? "") && !env.httpPort) {
          env = await ensureServiceUiPublished(env.id);
        }
        const sub = await enablePanel(env);
        if (!sub) throw new ApiHttpError(409, "falha_painel", "não foi possível ligar o painel (nó/porta indisponível)");
      } else {
        await disablePanel(env);
      }

      const [fresh] = await db.select().from(environments).where(eq(environments.id, env.id)).limit(1);
      const row = await loadPanelRow(env.id);
      return buildStatus(fresh ?? env, row, await panelCreds(env.id));
    },
  );
}
