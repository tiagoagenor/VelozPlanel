import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { eq } from "drizzle-orm";
import {
  sslStatus as sslStatusSchema,
  forceHttpsInput,
  apiError,
} from "@velozplanel/contracts";
import type { SslStatus, SslCertStatus } from "@velozplanel/contracts";
import { db } from "../db/client";
import { sslConfigs } from "../db/schema";
import type { SslConfigRow, EnvironmentRow } from "../db/schema";
import { ApiHttpError, requireUser } from "../auth";
import { loadEnvironmentForUser } from "./environments";

const idParams = z.object({ id: z.string().uuid() });

/** Validade de um certificado de desenvolvimento "emitido" no núcleo. */
const DEV_CERT_DAYS = 90;

/**
 * Lê a linha `ssl_configs` do ambiente; se não existir, cria com os defaults
 * (force_https=false, cert_status='none'). A PK é o env_id (1:1 com o ambiente).
 */
async function loadOrCreateSslConfig(envId: string): Promise<SslConfigRow> {
  const rows = await db.select().from(sslConfigs).where(eq(sslConfigs.envId, envId)).limit(1);
  const existing = rows[0];
  if (existing) return existing;

  const inserted = await db
    .insert(sslConfigs)
    .values({ envId })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];

  // Corrida: outra requisição criou a linha entre o select e o insert.
  const again = await db.select().from(sslConfigs).where(eq(sslConfigs.envId, envId)).limit(1);
  if (again[0]) return again[0];
  throw new ApiHttpError(500, "internal_error", "falha ao carregar configuração de SSL");
}

/**
 * Monta o `sslStatus` do contrato a partir da linha de config + do ambiente,
 * escolhendo uma `message` HONESTA conforme o estado real:
 *  - sem domínio        → precisa configurar o domínio antes do HTTPS
 *  - com domínio, s/cert → emissão automática (Let's Encrypt) é fase futura
 *  - cert ativo (dev)    → certificado de desenvolvimento, não Let's Encrypt real
 * Datas viram ISO string. Se `force_https` estiver ligado sem cert ativo,
 * a mensagem alerta que o redirecionamento só valerá quando o cert existir.
 */
function toSslStatus(cfg: SslConfigRow, env: EnvironmentRow): SslStatus {
  const domain = env.domain;
  const certStatus = cfg.certStatus as SslCertStatus;
  let message: string;

  if (!domain) {
    message =
      "Configure um domínio no menu Domínio & DNS antes de ativar o HTTPS.";
  } else if (certStatus === "active") {
    message =
      "Certificado de desenvolvimento ativo. Em produção, a emissão será via Let's Encrypt quando o domínio apontar para o servidor e a borda estiver ativa.";
  } else if (certStatus === "error") {
    message =
      "Houve um erro ao preparar o certificado. Tente emitir novamente; a emissão automática (Let's Encrypt) depende do domínio apontar para o servidor e da borda ativa.";
  } else {
    // "none" ou "pending" com domínio configurado
    message =
      "Domínio configurado. A emissão automática (Let's Encrypt) acontece quando o domínio apontar para este servidor e a borda estiver ativa (próxima fase). Você pode emitir um certificado de desenvolvimento agora para testar.";
  }

  // Aviso extra: forçar HTTPS sem certificado ativo não tem efeito prático ainda.
  if (cfg.forceHttps && certStatus !== "active") {
    message +=
      " Atenção: \"Forçar HTTPS\" está ligado, mas só terá efeito quando houver um certificado ativo.";
  }

  return {
    envId: env.id,
    domain: domain ?? null,
    forceHttps: cfg.forceHttps,
    certStatus,
    issuer: cfg.issuer ?? null,
    notAfter: cfg.notAfter ? cfg.notAfter.toISOString() : null,
    message,
  };
}

export async function sslRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // GET /environments/:id/ssl — status honesto do SSL/HTTPS do ambiente.
  app.get(
    "/environments/:id/ssl",
    {
      schema: {
        params: idParams,
        response: { 200: sslStatusSchema, 401: apiError, 403: apiError, 404: apiError },
      },
    },
    async (req): Promise<SslStatus> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const cfg = await loadOrCreateSslConfig(env.id);
      return toSslStatus(cfg, env);
    },
  );

  // POST /environments/:id/ssl/force-https — liga/desliga o redirecionamento.
  // Sempre 200; se ligar sem cert ativo, o GET seguinte avisa que não tem efeito ainda.
  app.post(
    "/environments/:id/ssl/force-https",
    {
      schema: {
        params: idParams,
        body: forceHttpsInput,
        response: { 200: sslStatusSchema, 401: apiError, 403: apiError, 404: apiError },
      },
    },
    async (req): Promise<SslStatus> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      await loadOrCreateSslConfig(env.id); // garante a linha antes do update
      const updated = await db
        .update(sslConfigs)
        .set({ forceHttps: req.body.forceHttps })
        .where(eq(sslConfigs.envId, env.id))
        .returning();
      const cfg = updated[0];
      if (!cfg) throw new ApiHttpError(500, "internal_error", "falha ao salvar Forçar HTTPS");
      return toSslStatus(cfg, env);
    },
  );

  // POST /environments/:id/ssl/issue — "emite" um certificado no núcleo.
  //
  // No núcleo local NÃO há ACME real: sem domínio público apontado e sem a
  // borda (nginx + desafio HTTP-01/TLS-ALPN), não dá para emitir Let's Encrypt.
  // Aqui marcamos um certificado de DESENVOLVIMENTO (issuer "Auto (dev)"),
  // válido por 90 dias, apenas para exercitar a UI e o fluxo.
  //
  // PONTO DE INTEGRAÇÃO FUTURO: substituir este bloco por uma emissão ACME real
  // (ex.: `lego` / go-acme) disparada quando o domínio resolver para o servidor
  // e a borda estiver ativa, gravando o issuer e o not_after reais do cert.
  app.post(
    "/environments/:id/ssl/issue",
    {
      schema: {
        params: idParams,
        response: { 200: sslStatusSchema, 401: apiError, 403: apiError, 404: apiError, 409: apiError },
      },
    },
    async (req): Promise<SslStatus> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      if (!env.domain) {
        throw new ApiHttpError(
          409,
          "domain_required",
          "configure um domínio no menu Domínio & DNS antes de emitir o certificado",
        );
      }
      await loadOrCreateSslConfig(env.id);

      const notAfter = new Date(Date.now() + DEV_CERT_DAYS * 24 * 60 * 60 * 1000);
      const updated = await db
        .update(sslConfigs)
        .set({ certStatus: "active", issuer: "Auto (dev)", notAfter })
        .where(eq(sslConfigs.envId, env.id))
        .returning();
      const cfg = updated[0];
      if (!cfg) throw new ApiHttpError(500, "internal_error", "falha ao emitir o certificado");
      return toSslStatus(cfg, env);
    },
  );
}
