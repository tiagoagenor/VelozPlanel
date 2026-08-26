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
import { loadPanelRow, panelCreds, panelUrl, enablePanel, disablePanel } from "../service-panel";
import { loadEnvironmentForUser } from "./environments";

const idParams = z.object({ id: z.string().uuid() });

function buildStatus(
  env: EnvironmentRow,
  row: EnvToolRow | null,
  creds: { user: string | null; password: string | null },
): AdminPanelStatus {
  const supported = !!serviceUiPort(env.typeId ?? "");
  const enabled = !!row?.enabled;
  const url = panelUrl(row);
  let message: string | null = null;
  if (!supported) {
    message = "Este ambiente não tem painel admin embutido.";
  } else if (enabled) {
    message = "Painel exposto. Entre com o usuário e a senha abaixo. Desligue quando não estiver usando.";
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
      if (!serviceUiPort(env.typeId ?? "")) {
        throw new ApiHttpError(400, "sem_painel", "este ambiente não tem painel admin embutido");
      }

      if (req.body.enabled) {
        if (!env.nodeId) throw new ApiHttpError(409, "sem_no", "ambiente ainda não provisionado");
        // Garante a porta do painel publicada (recria 1x quem foi criado antes da feature).
        if (!env.httpPort) env = await ensureServiceUiPublished(env.id);
        if (!env.httpPort) throw new ApiHttpError(409, "sem_porta", "não foi possível publicar a porta do painel");
        const sub = await enablePanel(env);
        if (!sub) throw new ApiHttpError(409, "sem_rota", "não foi possível determinar a rota até o nó");
      } else {
        await disablePanel(env);
      }

      const [fresh] = await db.select().from(environments).where(eq(environments.id, env.id)).limit(1);
      const row = await loadPanelRow(env.id);
      return buildStatus(fresh ?? env, row, await panelCreds(env.id));
    },
  );
}
