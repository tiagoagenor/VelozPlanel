/**
 * Agente VelozPlanel — driver Docker (Fastify 5 + dockerode).
 *
 * COMO RODAR:
 *   pnpm dev:agent            # na raiz do monorepo (tsx watch)
 *   # ou dentro de apps/agent: pnpm dev
 *   AGENT_PORT=4100 (default). Ex.: AGENT_PORT=4200 pnpm dev:agent
 *
 * SUPOSIÇÕES:
 *   - Docker Desktop rodando no Mac, socket em /var/run/docker.sock.
 *   - As imagens `php:<v>-cli` / `node:<v>-alpine` são puxadas sob demanda no
 *     primeiro provision (pode demorar na 1ª vez).
 *   - A porta 80 de cada container é publicada em 0.0.0.0 numa porta EFÊMERA do
 *     host, escolhida pelo Docker; o valor volta em `httpPort` e o container fica
 *     acessível em http://localhost:<httpPort>.
 *   - Este processo confia na API (rede local); sem auth própria.
 *
 * ROTAS (porta 4100):
 *   POST   /provision        {envId,name,runtime,limits} -> {containerId,httpPort}
 *   POST   /start            {containerId}               -> 204
 *   POST   /stop             {containerId}               -> 204
 *   DELETE /container/:id                                -> 204
 *   GET    /stats/:id                                    -> {cpuPct,memBytes,memLimitBytes}
 *   GET    /health                                       -> {ok:true}
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { runtimeSpec } from "@velozplanel/contracts";
import * as dockerDriver from "./docker.js";
import * as files from "./files.js";

const AGENT_PORT = Number(process.env.AGENT_PORT ?? 4100);

const app = Fastify({
  logger: {
    transport: {
      target: "pino-pretty",
      options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" },
    },
  },
});

await app.register(cors, { origin: true, credentials: true });

/* ─────────────── Schemas de entrada ─────────────── */

const provisionBody = z.object({
  envId: z.string().min(1),
  name: z.string().min(1),
  runtime: runtimeSpec,
  limits: z.object({
    vcpu: z.number().positive(),
    memMb: z.number().positive(),
  }),
});

const containerIdBody = z.object({
  containerId: z.string().min(1),
});

const containerIdParams = z.object({
  id: z.string().min(1),
});

/** Erro do Docker sem container/imagem => 404; senão 500. */
function dockerErrorStatus(err: unknown): number {
  const status = (err as { statusCode?: number })?.statusCode;
  if (status === 404) return 404;
  return 500;
}

function errorPayload(err: unknown): { error: string; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  return { error: "docker_error", message };
}

/** Erro de operação de arquivo -> usa o status embutido; senão cai no Docker. */
function fileErrorStatus(err: unknown): number {
  if (err instanceof files.FileError) return err.statusCode;
  return dockerErrorStatus(err);
}

/* Schemas das rotas de arquivos. */
const filesCidParams = z.object({ cid: z.string().min(1) });
const filesPathQuery = z.object({ path: z.string().min(1) });
const writeBody = z.object({ path: z.string().min(1), content: z.string() });
const mkPathBody = z.object({ path: z.string().min(1) });
const renameBody = z.object({
  path: z.string().min(1),
  newName: z.string().min(1),
});
const chmodBody = z.object({
  path: z.string().min(1),
  mode: z.string().regex(/^[0-7]{3,4}$/),
});

/* ─────────────── Rotas ─────────────── */

app.get("/health", async () => ({ ok: true }));

app.post("/provision", async (req, reply) => {
  const parsed = provisionBody.safeParse(req.body);
  if (!parsed.success) {
    return reply
      .code(400)
      .send({ error: "bad_request", message: parsed.error.message });
  }
  try {
    const result = await dockerDriver.provision(parsed.data);
    req.log.info({ envId: parsed.data.envId, ...result }, "provisioned");
    return reply.code(201).send(result);
  } catch (err) {
    req.log.error({ err }, "provision failed");
    return reply.code(dockerErrorStatus(err)).send(errorPayload(err));
  }
});

app.post("/start", async (req, reply) => {
  const parsed = containerIdBody.safeParse(req.body);
  if (!parsed.success) {
    return reply
      .code(400)
      .send({ error: "bad_request", message: parsed.error.message });
  }
  try {
    const httpPort = await dockerDriver.start(parsed.data.containerId);
    return reply.code(200).send({ httpPort });
  } catch (err) {
    req.log.error({ err }, "start failed");
    return reply.code(dockerErrorStatus(err)).send(errorPayload(err));
  }
});

app.post("/stop", async (req, reply) => {
  const parsed = containerIdBody.safeParse(req.body);
  if (!parsed.success) {
    return reply
      .code(400)
      .send({ error: "bad_request", message: parsed.error.message });
  }
  try {
    await dockerDriver.stop(parsed.data.containerId);
    return reply.code(204).send();
  } catch (err) {
    req.log.error({ err }, "stop failed");
    return reply.code(dockerErrorStatus(err)).send(errorPayload(err));
  }
});

app.delete("/container/:id", async (req, reply) => {
  const parsed = containerIdParams.safeParse(req.params);
  if (!parsed.success) {
    return reply
      .code(400)
      .send({ error: "bad_request", message: parsed.error.message });
  }
  try {
    await dockerDriver.remove(parsed.data.id);
    return reply.code(204).send();
  } catch (err) {
    req.log.error({ err }, "remove failed");
    return reply.code(dockerErrorStatus(err)).send(errorPayload(err));
  }
});

app.get("/stats/:id", async (req, reply) => {
  const parsed = containerIdParams.safeParse(req.params);
  if (!parsed.success) {
    return reply
      .code(400)
      .send({ error: "bad_request", message: parsed.error.message });
  }
  try {
    const result = await dockerDriver.stats(parsed.data.id);
    return reply.send(result);
  } catch (err) {
    req.log.error({ err }, "stats failed");
    return reply.code(dockerErrorStatus(err)).send(errorPayload(err));
  }
});

/* ─────────────── Rotas de arquivos ─────────────── */

// GET /files/:cid?path= — lista o diretório
app.get("/files/:cid", async (req, reply) => {
  const p = filesCidParams.safeParse(req.params);
  const q = filesPathQuery.safeParse(req.query);
  if (!p.success || !q.success) {
    return reply.code(400).send({ error: "bad_request", message: "parâmetros inválidos" });
  }
  try {
    const entries = await files.list(p.data.cid, q.data.path);
    return reply.send({ entries });
  } catch (err) {
    req.log.error({ err }, "files.list failed");
    return reply.code(fileErrorStatus(err)).send(errorPayload(err));
  }
});

// GET /files/:cid/read?path= — lê um arquivo
app.get("/files/:cid/read", async (req, reply) => {
  const p = filesCidParams.safeParse(req.params);
  const q = filesPathQuery.safeParse(req.query);
  if (!p.success || !q.success) {
    return reply.code(400).send({ error: "bad_request", message: "parâmetros inválidos" });
  }
  try {
    const result = await files.read(p.data.cid, q.data.path);
    return reply.send(result);
  } catch (err) {
    req.log.error({ err }, "files.read failed");
    return reply.code(fileErrorStatus(err)).send(errorPayload(err));
  }
});

// POST /files/:cid/write {path,content} — grava um arquivo
app.post("/files/:cid/write", async (req, reply) => {
  const p = filesCidParams.safeParse(req.params);
  const b = writeBody.safeParse(req.body);
  if (!p.success || !b.success) {
    return reply.code(400).send({ error: "bad_request", message: "parâmetros inválidos" });
  }
  try {
    await files.write(p.data.cid, b.data.path, b.data.content);
    return reply.code(200).send({ ok: true });
  } catch (err) {
    req.log.error({ err }, "files.write failed");
    return reply.code(fileErrorStatus(err)).send(errorPayload(err));
  }
});

// POST /files/:cid/mkdir {path} — cria uma pasta
app.post("/files/:cid/mkdir", async (req, reply) => {
  const p = filesCidParams.safeParse(req.params);
  const b = mkPathBody.safeParse(req.body);
  if (!p.success || !b.success) {
    return reply.code(400).send({ error: "bad_request", message: "parâmetros inválidos" });
  }
  try {
    await files.mkdir(p.data.cid, b.data.path);
    return reply.code(200).send({ ok: true });
  } catch (err) {
    req.log.error({ err }, "files.mkdir failed");
    return reply.code(fileErrorStatus(err)).send(errorPayload(err));
  }
});

// POST /files/:cid/rename {path,newName} — renomeia arquivo ou pasta
app.post("/files/:cid/rename", async (req, reply) => {
  const p = filesCidParams.safeParse(req.params);
  const b = renameBody.safeParse(req.body);
  if (!p.success || !b.success) {
    return reply.code(400).send({ error: "bad_request", message: "parâmetros inválidos" });
  }
  try {
    await files.rename(p.data.cid, b.data.path, b.data.newName);
    return reply.code(200).send({ ok: true });
  } catch (err) {
    req.log.error({ err }, "files.rename failed");
    return reply.code(fileErrorStatus(err)).send(errorPayload(err));
  }
});

// POST /files/:cid/chmod {path,mode} — altera permissões
app.post("/files/:cid/chmod", async (req, reply) => {
  const p = filesCidParams.safeParse(req.params);
  const b = chmodBody.safeParse(req.body);
  if (!p.success || !b.success) {
    return reply.code(400).send({ error: "bad_request", message: "parâmetros inválidos" });
  }
  try {
    await files.chmod(p.data.cid, b.data.path, b.data.mode);
    return reply.code(200).send({ ok: true });
  } catch (err) {
    req.log.error({ err }, "files.chmod failed");
    return reply.code(fileErrorStatus(err)).send(errorPayload(err));
  }
});

// GET /files/:cid/download?path= — baixa um arquivo (base64)
app.get("/files/:cid/download", async (req, reply) => {
  const p = filesCidParams.safeParse(req.params);
  const q = filesPathQuery.safeParse(req.query);
  if (!p.success || !q.success) {
    return reply.code(400).send({ error: "bad_request", message: "parâmetros inválidos" });
  }
  try {
    const result = await files.download(p.data.cid, q.data.path);
    return reply.send(result);
  } catch (err) {
    req.log.error({ err }, "files.download failed");
    return reply.code(fileErrorStatus(err)).send(errorPayload(err));
  }
});

// DELETE /files/:cid?path= — remove arquivo ou pasta
app.delete("/files/:cid", async (req, reply) => {
  const p = filesCidParams.safeParse(req.params);
  const q = filesPathQuery.safeParse(req.query);
  if (!p.success || !q.success) {
    return reply.code(400).send({ error: "bad_request", message: "parâmetros inválidos" });
  }
  try {
    await files.remove(p.data.cid, q.data.path);
    return reply.code(204).send();
  } catch (err) {
    req.log.error({ err }, "files.remove failed");
    return reply.code(fileErrorStatus(err)).send(errorPayload(err));
  }
});

/* ─────────────── Boot ─────────────── */

try {
  await app.listen({ port: AGENT_PORT, host: "0.0.0.0" });
  app.log.info(`Agente VelozPlanel escutando em :${AGENT_PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
