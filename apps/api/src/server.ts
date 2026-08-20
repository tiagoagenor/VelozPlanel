/**
 * VelozPlanel — API do núcleo (Fastify 5, ESM, rodado com tsx).
 *
 * COMO RODAR (a partir da raiz do monorepo):
 *   1. pnpm install                # instalação central (NÃO feita por este build)
 *   2. pnpm dev:db                 # sobe o Postgres (infra/docker-compose.yml, porta 5433)
 *   3. pnpm db:push                # cria o schema + seed (idempotente)
 *   4. pnpm dev:agent              # Agente Docker na porta 4100 (necessário p/ provisionar/stats)
 *   5. pnpm dev:api                # esta API na porta 4000
 *      (ou, dentro de apps/api:  pnpm dev / pnpm db:push / pnpm typecheck)
 *
 * VARIÁVEIS DE AMBIENTE (todas com default de dev):
 *   DATABASE_URL   default postgres://veloz:veloz_dev@localhost:5433/velozpanel
 *   VP_JWT_SECRET  default "dev-secret"
 *   AGENT_URL      default http://localhost:4100
 *   PORT           default 4000
 *
 * SUPOSIÇÕES:
 *   - Hash de senha com bcryptjs (puro JS, sem build nativo).
 *   - JWT via jsonwebtoken, guardado no cookie httpOnly `vp_session`.
 *   - Schema criado por CREATE TABLE IF NOT EXISTS (sem migrations no núcleo).
 *   - Ao criar ambiente, o nó é o primeiro `nodes` do DB (o `node-local` do seed).
 *   - Sem o Agente no ar, criar/pausar/iniciar/excluir retornam 502 (a API sobe normalmente).
 *   - Datas trafegam como ISO string; métricas `ts` como epoch ms (contracts).
 */
import Fastify from "fastify";
import type { FastifyError } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import {
  serializerCompiler,
  validatorCompiler,
  hasZodFastifySchemaValidationErrors,
} from "fastify-type-provider-zod";
import type { ApiError } from "@velozplanel/contracts";
import { ApiHttpError } from "./auth";
import { authRoutes } from "./routes/auth";
import { nodeRoutes } from "./routes/nodes";
import { environmentRoutes } from "./routes/environments";
import { metricsRoutes } from "./routes/metrics";
import { filesRoutes } from "./routes/files";
import { databasesRoutes } from "./routes/databases";
import { sslRoutes } from "./routes/ssl";
import { sshRoutes } from "./routes/ssh";
import { startMetricsCollector } from "./metrics-collector";

const PORT = Number(process.env.PORT ?? 4000);
// Origens do painel autorizadas no CORS. Configurável por env `VP_PANEL_ORIGINS`
// (CSV) para acesso pela rede — ex.:
//   VP_PANEL_ORIGINS="http://localhost:3000,http://192.168.2.105:3000"
// Default inclui localhost e o IP da LAN usado nos testes do dono.
const PANEL_ORIGINS = (
  process.env.VP_PANEL_ORIGINS ??
  "http://localhost:3000,http://192.168.2.105:3000"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

async function main(): Promise<void> {
  const app = Fastify({
    // ~40 MiB: acomoda o base64 (~33 MiB) de um upload de arquivo de até ~25 MiB.
    bodyLimit: 40 * 1024 * 1024,
    logger: {
      transport: {
        target: "pino-pretty",
        options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" },
      },
    },
  });

  // Zod como validador/serializador de todas as rotas.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, {
    origin: PANEL_ORIGINS,
    credentials: true,
  });
  await app.register(cookie);

  // Erros no formato `apiError`.
  app.setErrorHandler((error: FastifyError, req, reply) => {
    if (error instanceof ApiHttpError) {
      const body: ApiError = { error: error.errorCode, message: error.message };
      return reply.status(error.statusCode).send(body);
    }
    if (hasZodFastifySchemaValidationErrors(error) || error.statusCode === 400) {
      const body: ApiError = { error: "bad_request", message: error.message };
      return reply.status(400).send(body);
    }
    const status = typeof error.statusCode === "number" ? error.statusCode : 500;
    if (status >= 500) {
      req.log.error(error);
      const body: ApiError = { error: "internal_error", message: "erro interno" };
      return reply.status(500).send(body);
    }
    const body: ApiError = { error: error.code ?? "error", message: error.message };
    return reply.status(status).send(body);
  });

  app.setNotFoundHandler((_req, reply) => {
    const body: ApiError = { error: "not_found", message: "rota não encontrada" };
    return reply.status(404).send(body);
  });

  // Todas as rotas sob /api/v1.
  await app.register(
    async (v1) => {
      await v1.register(authRoutes);
      await v1.register(nodeRoutes);
      await v1.register(environmentRoutes);
      await v1.register(metricsRoutes);
      await v1.register(filesRoutes);
      await v1.register(databasesRoutes);
      await v1.register(sslRoutes);
      await v1.register(sshRoutes);
    },
    { prefix: "/api/v1" },
  );

  const stopCollector = startMetricsCollector(app.log);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`recebido ${signal}, encerrando…`);
    stopCollector();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error("falha ao iniciar a API:", err);
  process.exit(1);
});
