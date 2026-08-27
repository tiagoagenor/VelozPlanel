import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  fileList,
  fileContent,
  writeFileInput,
  uploadFileInput,
  mkPathInput,
  renameFileInput,
  chmodInput,
  apiError,
} from "@velozplanel/contracts";
import type { FileList, FileContent, RuntimeKind } from "@velozplanel/contracts";
import { ApiHttpError, requireUser } from "../auth";
import * as agent from "../agent";
import { loadEnvironmentForUser } from "./environments";
import { agentUrlForEnv } from "../nodes";
import type { EnvironmentRow } from "../db/schema";

/**
 * Gerenciador de arquivos do ambiente. Todas as operações são confinadas à
 * RAIZ do ambiente (sempre /app; php público em /app/www); qualquer caminho que
 * tente escapar (via `..` ou raiz diferente) é rejeitado com 400.
 *
 * As operações reais rodam dentro do container (via Agente/dockerode). Por isso
 * exigimos o ambiente `running` com `containerId` — senão 409.
 */

const idParams = z.object({ id: z.string().uuid() });
const pathQuery = z.object({ path: z.string().optional() });

/**
 * Modelo de confinamento por runtime (tudo padronizado em /app):
 *  - `confineRoot`: limite que o cliente NÃO pode ultrapassar. É sempre `/app`
 *    — em PHP o código/framework mora em `/app` e o público em `/app/www` (o
 *    cliente navega os dois sem escapar do volume).
 *  - `defaultPath`: onde a tela abre por padrão quando não vem `path`.
 *    PHP → `/app/www` (a pasta pública servida); demais → `/app`.
 */
function confineRootFor(_kind: RuntimeKind): string {
  return "/app";
}

function defaultPathFor(kind: RuntimeKind): string {
  return kind === "php" ? "/app/www" : "/app";
}

/**
 * Resolve o caminho pedido DENTRO do limite de confinamento (`confineRoot`).
 * - vazio/ausente => `fallback` (default: o próprio `confineRoot`).
 * - relativo => resolvido a partir do `confineRoot`.
 * - absoluto => tratado como caminho no container.
 * Normaliza (colapsa `..`) e rejeita qualquer coisa fora do `confineRoot`
 * (nada de `..` acima de `/var`).
 */
function resolveWithinRoot(
  confineRoot: string,
  requested?: string,
  fallback?: string,
): string {
  const base = fallback ?? confineRoot;
  const req = requested && requested.length > 0 ? requested : base;
  const joined = req.startsWith("/") ? req : path.posix.join(confineRoot, req);
  let resolved = path.posix.normalize(joined);
  // remove barra final (exceto para "/")
  if (resolved.length > 1 && resolved.endsWith("/")) {
    resolved = resolved.slice(0, -1);
  }
  if (resolved !== confineRoot && !resolved.startsWith(confineRoot + "/")) {
    throw new ApiHttpError(
      400,
      "path_out_of_root",
      "caminho fora do limite do ambiente",
    );
  }
  return resolved;
}

/** Garante ambiente ligado com container; senão 409 com mensagem amigável. */
function requireRunningContainer(env: EnvironmentRow): string {
  if (env.state !== "running" || !env.containerId) {
    throw new ApiHttpError(
      409,
      "environment_not_running",
      "inicie o ambiente para ver os arquivos",
    );
  }
  return env.containerId;
}

/** Sanitiza um nome de arquivo para uso em Content-Disposition. */
function sanitizeFilename(name: string): string {
  const base = name.split("/").pop() ?? name;
  // troca controle, aspas, barras e espaços por "_"; fallback "download".
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f"\\/\s]+/g, "_").trim();
  return clean.length > 0 ? clean : "download";
}

export async function filesRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // GET /environments/:id/files?path= — lista um diretório
  app.get(
    "/environments/:id/files",
    {
      schema: {
        params: idParams,
        querystring: pathQuery,
        response: {
          200: fileList,
          401: apiError,
          403: apiError,
          404: apiError,
          409: apiError,
          502: apiError,
        },
      },
    },
    async (req): Promise<FileList> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const containerId = requireRunningContainer(env);
      const agentUrl = await agentUrlForEnv(env);
      const kind = env.runtimeKind as RuntimeKind;
      const confineRoot = confineRootFor(kind);
      // Sem `path`, abre na pasta web servida (defaultPath, ex.: /app/www).
      const target = resolveWithinRoot(
        confineRoot,
        req.query.path,
        defaultPathFor(kind),
      );
      const { entries } = await agent.listFiles(agentUrl, containerId, target);
      // `root` é o limite de confinamento — o breadcrumb/árvore sobem até ele.
      return { path: target, root: confineRoot, entries };
    },
  );

  // GET /environments/:id/files/read?path= — lê um arquivo
  app.get(
    "/environments/:id/files/read",
    {
      schema: {
        params: idParams,
        querystring: pathQuery,
        response: {
          200: fileContent,
          400: apiError,
          401: apiError,
          403: apiError,
          404: apiError,
          409: apiError,
          502: apiError,
        },
      },
    },
    async (req): Promise<FileContent> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const containerId = requireRunningContainer(env);
      const agentUrl = await agentUrlForEnv(env);
      const root = confineRootFor(env.runtimeKind as RuntimeKind);
      const target = resolveWithinRoot(root, req.query.path);
      if (target === root) {
        throw new ApiHttpError(400, "is_directory", "o caminho é um diretório");
      }
      const result = await agent.readFile(agentUrl, containerId, target);
      return { path: target, content: result.content, truncated: result.truncated };
    },
  );

  // POST /environments/:id/files/write — grava um arquivo
  app.post(
    "/environments/:id/files/write",
    {
      schema: {
        params: idParams,
        body: writeFileInput,
        response: {
          200: z.object({ ok: z.boolean() }),
          400: apiError,
          401: apiError,
          403: apiError,
          404: apiError,
          409: apiError,
          502: apiError,
        },
      },
    },
    async (req): Promise<{ ok: boolean }> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const containerId = requireRunningContainer(env);
      const agentUrl = await agentUrlForEnv(env);
      const root = confineRootFor(env.runtimeKind as RuntimeKind);
      const target = resolveWithinRoot(root, req.body.path);
      if (target === root) {
        throw new ApiHttpError(400, "is_directory", "não é possível gravar sobre a raiz");
      }
      await agent.writeFile(agentUrl, containerId, target, req.body.content);
      return { ok: true };
    },
  );

  // POST /environments/:id/files/upload — envia um arquivo (binário via base64)
  app.post(
    "/environments/:id/files/upload",
    {
      schema: {
        params: idParams,
        body: uploadFileInput,
        response: {
          200: z.object({ ok: z.boolean() }),
          400: apiError,
          401: apiError,
          403: apiError,
          404: apiError,
          409: apiError,
          413: apiError,
          502: apiError,
        },
      },
    },
    async (req): Promise<{ ok: boolean }> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const containerId = requireRunningContainer(env);
      const agentUrl = await agentUrlForEnv(env);
      const root = confineRootFor(env.runtimeKind as RuntimeKind);
      // Confina a pasta de destino à raiz…
      const destDir = resolveWithinRoot(root, req.body.dir);
      // …e o `filename` (já validado pelo contract: sem barras) forma o caminho
      // final, que confinamos de novo por segurança em profundidade.
      const target = resolveWithinRoot(root, `${destDir}/${req.body.filename}`);
      if (target === root) {
        throw new ApiHttpError(400, "invalid_path", "caminho de destino inválido");
      }
      await agent.uploadFile(agentUrl, containerId, target, req.body.contentBase64);
      return { ok: true };
    },
  );

  // POST /environments/:id/files/mkdir — cria uma pasta
  app.post(
    "/environments/:id/files/mkdir",
    {
      schema: {
        params: idParams,
        body: mkPathInput,
        response: {
          200: z.object({ ok: z.boolean() }),
          400: apiError,
          401: apiError,
          403: apiError,
          404: apiError,
          409: apiError,
          502: apiError,
        },
      },
    },
    async (req): Promise<{ ok: boolean }> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const containerId = requireRunningContainer(env);
      const agentUrl = await agentUrlForEnv(env);
      const root = confineRootFor(env.runtimeKind as RuntimeKind);
      const target = resolveWithinRoot(root, req.body.path);
      if (target === root) {
        throw new ApiHttpError(400, "invalid_path", "caminho inválido");
      }
      await agent.mkdir(agentUrl, containerId, target);
      return { ok: true };
    },
  );

  // POST /environments/:id/files/rename — renomeia arquivo ou pasta
  app.post(
    "/environments/:id/files/rename",
    {
      schema: {
        params: idParams,
        body: renameFileInput,
        response: {
          200: z.object({ ok: z.boolean() }),
          400: apiError,
          401: apiError,
          403: apiError,
          404: apiError,
          409: apiError,
          502: apiError,
        },
      },
    },
    async (req): Promise<{ ok: boolean }> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const containerId = requireRunningContainer(env);
      const agentUrl = await agentUrlForEnv(env);
      const root = confineRootFor(env.runtimeKind as RuntimeKind);
      const target = resolveWithinRoot(root, req.body.path);
      if (target === root) {
        throw new ApiHttpError(400, "cannot_rename_root", "não é possível renomear a raiz");
      }
      await agent.renameFile(agentUrl, containerId, target, req.body.newName);
      return { ok: true };
    },
  );

  // POST /environments/:id/files/chmod — altera permissões
  app.post(
    "/environments/:id/files/chmod",
    {
      schema: {
        params: idParams,
        body: chmodInput,
        response: {
          200: z.object({ ok: z.boolean() }),
          400: apiError,
          401: apiError,
          403: apiError,
          404: apiError,
          409: apiError,
          502: apiError,
        },
      },
    },
    async (req): Promise<{ ok: boolean }> => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const containerId = requireRunningContainer(env);
      const agentUrl = await agentUrlForEnv(env);
      const root = confineRootFor(env.runtimeKind as RuntimeKind);
      const target = resolveWithinRoot(root, req.body.path);
      if (target === root) {
        throw new ApiHttpError(400, "cannot_chmod_root", "não é possível alterar a raiz");
      }
      await agent.chmodFile(agentUrl, containerId, target, req.body.mode);
      return { ok: true };
    },
  );

  // GET /environments/:id/files/download?path= — baixa os bytes crus do arquivo
  app.get(
    "/environments/:id/files/download",
    {
      schema: {
        params: idParams,
        querystring: pathQuery,
        response: {
          400: apiError,
          401: apiError,
          403: apiError,
          404: apiError,
          409: apiError,
          413: apiError,
          502: apiError,
        },
      },
    },
    async (req, reply) => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const containerId = requireRunningContainer(env);
      const agentUrl = await agentUrlForEnv(env);
      const root = confineRootFor(env.runtimeKind as RuntimeKind);
      const target = resolveWithinRoot(root, req.query.path);
      if (target === root) {
        throw new ApiHttpError(400, "is_directory", "o caminho é um diretório");
      }
      const result = await agent.downloadFile(agentUrl, containerId, target);
      const bytes = Buffer.from(result.base64, "base64");
      const filename = sanitizeFilename(result.name);
      reply
        .header("Content-Type", "application/octet-stream")
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .header("Content-Length", String(bytes.length));
      // Envia os bytes crus; sem schema de resposta 200 para o serializer zod
      // não transformar o Buffer em JSON. `never` satisfaz o tipo inferido.
      return reply.send(bytes as unknown as never);
    },
  );

  // DELETE /environments/:id/files?path= — apaga arquivo ou pasta
  app.delete(
    "/environments/:id/files",
    {
      schema: {
        params: idParams,
        querystring: pathQuery,
        response: {
          204: z.null(),
          400: apiError,
          401: apiError,
          403: apiError,
          404: apiError,
          409: apiError,
          502: apiError,
        },
      },
    },
    async (req, reply) => {
      const user = await requireUser(req);
      const env = await loadEnvironmentForUser(req.params.id, user);
      const containerId = requireRunningContainer(env);
      const agentUrl = await agentUrlForEnv(env);
      const root = confineRootFor(env.runtimeKind as RuntimeKind);
      const target = resolveWithinRoot(root, req.query.path);
      if (target === root) {
        throw new ApiHttpError(
          400,
          "cannot_delete_root",
          "não é possível excluir a raiz do ambiente",
        );
      }
      await agent.removeFile(agentUrl, containerId, target);
      return reply.status(204).send(null);
    },
  );
}
