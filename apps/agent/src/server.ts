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
import { runtimeSpec, studioEngine, dbRunSqlInput, dbRunMongoInput, dbRunRedisInput, phpIniConfig } from "@velozplanel/contracts";
import * as dockerDriver from "./docker.js";
import * as kvm from "./kvm.js";
import * as ingress from "./ingress.js";
import * as files from "./files.js";
import { startSshGateway } from "./ssh.js";
import { startSftpGateway } from "./sftp.js";
import * as deploy from "./deploy.js";
import { runSpeedtest } from "./speedtest.js";

const AGENT_PORT = Number(process.env.AGENT_PORT ?? 4100);

const app = Fastify({
  // ~40 MiB: acomoda o base64 (~33 MiB) de um arquivo de até ~25 MiB no upload.
  bodyLimit: 40 * 1024 * 1024,
  logger: {
    transport: {
      target: "pino-pretty",
      options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" },
    },
  },
});

await app.register(cors, { origin: true, credentials: true });

// Autenticação da API HTTP do agente (defesa em profundidade). Só o plano de
// controle tem o token (VP_INTERNAL_TOKEN) — mesmo que um container de cliente
// alcance a porta 4100, é rejeitado. `/health` fica aberto (healthcheck).
const AGENT_TOKEN = process.env.VP_INTERNAL_TOKEN ?? "";
app.addHook("onRequest", async (req, reply) => {
  if (req.url === "/health") return;
  if (!AGENT_TOKEN) return; // dev sem token configurado: sem checagem
  if (req.headers["x-agent-token"] !== AGENT_TOKEN) {
    return reply.code(401).send({ error: "unauthorized" });
  }
});

/* ─────────────── Schemas de entrada ─────────────── */

const provisionBody = z.object({
  envId: z.string().min(1),
  name: z.string().min(1),
  runtime: runtimeSpec,
  limits: z.object({
    vcpu: z.number().positive(),
    memMb: z.number().positive(),
  }),
  startupScript: z.string().nullable().optional(),
  startFile: z.string().nullable().optional(),
  pythonCmd: z.string().nullable().optional(),
  dotnetCmd: z.string().nullable().optional(),
  phpNodeVersion: z.string().nullable().optional(),
  phpRoot: z.string().nullable().optional(),
  envVars: z.array(z.object({ key: z.string(), value: z.string(), buildTime: z.boolean().optional() })).optional(),
  network: z.object({
    name: z.string().min(1),
    subnet: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/),
    gateway: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/),
  }).nullable().optional(),
  ip: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/).nullable().optional(),
  ownerId: z.string().min(1).nullable().optional(),
});

// aplica novo arquivo de start no container Node (grava marcador + reinicia o node)
const nodeStartBody = z.object({
  containerId: z.string().min(1),
  startFile: z.string().min(1),
});

// troca a versão de Node (via nvm) num container PHP. Versão só dígitos e pontos
// (2ª borda de validação contra injeção; a API já valida contra a lista).
const nodeVersionBody = z.object({
  containerId: z.string().min(1),
  version: z.string().regex(/^[0-9]+(\.[0-9]+){0,2}$/),
});
const containerIdOnly = z.object({ containerId: z.string().min(1) });
const phpRootBody = z.object({
  containerId: z.string().min(1),
  root: z.string().regex(/^\/var\/www(\/[A-Za-z0-9._-]+)*$/),
  useRouter: z.boolean(),
});

// php.ini gerenciado: leitura só pelo envId (arquivo do host); escrita/reset
// precisam do container para aplicar ao vivo (docker exec + kill do php -S).
const phpIniReadBody = z.object({ envId: z.string().min(1) });
const phpIniWriteBody = z.object({
  containerId: z.string().min(1),
  envId: z.string().min(1),
  config: phpIniConfig,
});
const phpIniResetBody = z.object({ containerId: z.string().min(1), envId: z.string().min(1) });

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
const uploadBody = z.object({
  path: z.string().min(1),
  contentBase64: z.string().min(1),
});
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

// Teste de velocidade de internet DESTE nó (download/upload/ping). Chamado pela
// API (agendador de hora em hora + botão do super admin). Leva alguns segundos.
app.post("/speedtest", async () => runSpeedtest());

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

// Provisiona um ambiente de SERVIÇO (redis/mysql/… ou uma ferramenta de UI):
// container stock na bridge do dono, IP fixo, volume, SEM porta publicada.
const provisionServiceBody = z.object({
  envId: z.string().min(1),
  name: z.string().min(1),
  image: z.string().min(1),
  limits: z.object({ vcpu: z.number().positive(), memMb: z.number().positive() }),
  network: z.object({
    name: z.string().min(1),
    subnet: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/),
    gateway: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/),
  }),
  ip: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/),
  ownerId: z.string().min(1),
  dataPath: z.string().nullable().optional(),
  env: z.array(z.object({ key: z.string().min(1), value: z.string() })).optional(),
  readiness: z.string().nullable().optional(),
  role: z.string().optional(),
  publishPort: z.number().int().min(1).max(65535).nullable().optional(),
});

app.post("/provision-service", async (req, reply) => {
  const parsed = provisionServiceBody.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  }
  try {
    const result = await dockerDriver.provisionService(parsed.data);
    req.log.info({ envId: parsed.data.envId, containerId: result.containerId, ready: result.ready }, "service provisioned");
    return reply.code(201).send(result);
  } catch (err) {
    req.log.error({ err }, "provision-service failed");
    return reply.code(dockerErrorStatus(err)).send(errorPayload(err));
  }
});

const envVarsBody = z.object({
  containerId: z.string().min(1),
  vars: z.array(z.object({ key: z.string().min(1), value: z.string() })),
});
const deployKeyBody = z.object({ envId: z.string().min(1), image: z.string().min(1) });
const httpCredsSchema = z.object({ username: z.string(), password: z.string() }).optional();
const deployProbeBody = z.object({
  envId: z.string().min(1), image: z.string().min(1), repoUrl: z.string().min(1), http: httpCredsSchema,
});
const deployImportBody = z.object({ envId: z.string().min(1), image: z.string().min(1), privateKey: z.string().min(1) });
const deployDetectBody = z.object({ envId: z.string().min(1), image: z.string().min(1), repoUrl: z.string().min(1), branch: z.string().min(1), kind: z.string().optional(), http: httpCredsSchema });
const deployRunBody = z.object({
  envId: z.string().min(1), image: z.string().min(1),
  appContainerId: z.string().min(1), workdir: z.string().min(1),
  repoUrl: z.string().min(1), branch: z.string().min(1),
  steps: z.array(z.object({ kind: z.string(), command: z.string().nullable().optional(), cwd: z.string().nullable().optional(), enabled: z.boolean() })),
  buildEnv: z.array(z.object({ key: z.string(), value: z.string() })),
  framework: z.string(), runModel: z.string(), http: httpCredsSchema, subdir: z.string().nullable().optional(),
  runId: z.string().min(1), nodeStartFile: z.string().nullable().optional(), historyLimit: z.number().int().optional(),
  runtimeKind: z.string().optional(), pythonCmd: z.string().nullable().optional(), dotnetCmd: z.string().nullable().optional(),
});

app.post("/env-vars", async (req, reply) => {
  const parsed = envVarsBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  try {
    const r = await dockerDriver.writeEnvFileAndRestart(parsed.data.containerId, parsed.data.vars);
    return reply.code(200).send(r);
  } catch (err) {
    req.log.error({ err }, "env-vars failed");
    return reply.code(dockerErrorStatus(err)).send(errorPayload(err));
  }
});

// Jamees Studio: executa uma consulta/comando de banco via docker exec no container.
// A API já validou posse (dono/admin), estado running e o gate de senha antes de chamar.
const dbExecBody = z.object({
  containerId: z.string().min(1),
  envId: z.string().min(1),
  engine: studioEngine,
  sql: dbRunSqlInput.optional(),
  mongo: dbRunMongoInput.optional(),
  redis: dbRunRedisInput.optional(),
});
const DB_BAD_REQUEST = new Set([
  "bad_request",
  "sql_vazio",
  "multi_statement_nao_suportado",
  "escrita_requer_modo_escrita",
  "estagio_proibido",
  "pipeline_invalido",
  "op_nao_permitida",
  "comando_bloqueado",
  "comando_bloqueante",
  "comando_vazio",
]);
app.post("/db/exec", async (req, reply) => {
  const parsed = dbExecBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  try {
    const result = await dockerDriver.runDbConsole(parsed.data);
    return reply.code(200).send(result);
  } catch (err) {
    const code = (err as { code?: string })?.code ?? "engine_error";
    const message = (err as Error)?.message ?? "erro ao executar";
    const status = code === "db_busy" ? 429 : DB_BAD_REQUEST.has(code) ? 400 : 422;
    req.log.warn({ code }, "db exec failed");
    return reply.code(status).send({ error: code, message });
  }
});

app.post("/deploy/key", async (req, reply) => {
  const parsed = deployKeyBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  try { return reply.code(200).send(await deploy.generateDeployKey(parsed.data.envId, parsed.data.image)); }
  catch (err) { req.log.error({ err }, "deploy/key failed"); return reply.code(dockerErrorStatus(err)).send(errorPayload(err)); }
});

app.post("/deploy/key/import", async (req, reply) => {
  const parsed = deployImportBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  try { return reply.code(200).send(await deploy.importDeployKey(parsed.data.envId, parsed.data.image, parsed.data.privateKey)); }
  catch (err) { req.log.error({ err }, "deploy/key/import failed"); return reply.code(dockerErrorStatus(err)).send(errorPayload(err)); }
});

app.post("/deploy/reset", async (req, reply) => {
  const parsed = deployKeyBody.safeParse(req.body); // { envId, image } — usa só envId
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  try { await deploy.resetDeploy(parsed.data.envId); return reply.code(200).send({ ok: true }); }
  catch (err) { req.log.error({ err }, "deploy/reset failed"); return reply.code(dockerErrorStatus(err)).send(errorPayload(err)); }
});

app.post("/deploy/probe", async (req, reply) => {
  const parsed = deployProbeBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  const d = parsed.data;
  try { return reply.code(200).send(await deploy.probeRepo(d.envId, d.image, d.repoUrl, d.http)); }
  catch (err) { req.log.error({ err }, "deploy/probe failed"); return reply.code(dockerErrorStatus(err)).send(errorPayload(err)); }
});

app.post("/deploy/branches", async (req, reply) => {
  const parsed = deployProbeBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  const d = parsed.data;
  try { return reply.code(200).send(await deploy.listBranches(d.envId, d.image, d.repoUrl, d.http)); }
  catch (err) { req.log.error({ err }, "deploy/branches failed"); return reply.code(dockerErrorStatus(err)).send(errorPayload(err)); }
});

app.post("/deploy/test", async (req, reply) => {
  const parsed = deployProbeBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  const d = parsed.data;
  try { return reply.code(200).send(await deploy.testGit(d.envId, d.image, d.repoUrl, d.http)); }
  catch (err) { req.log.error({ err }, "deploy/test failed"); return reply.code(dockerErrorStatus(err)).send(errorPayload(err)); }
});

app.post("/deploy/detect", async (req, reply) => {
  const parsed = deployDetectBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  try { return reply.code(200).send(await deploy.detectStack(parsed.data.envId, parsed.data.image, parsed.data.repoUrl, parsed.data.branch, parsed.data.kind ?? "", parsed.data.http)); }
  catch (err) { req.log.error({ err }, "deploy/detect failed"); return reply.code(dockerErrorStatus(err)).send(errorPayload(err)); }
});

app.post("/deploy/remote-sha", async (req, reply) => {
  const parsed = deployDetectBody.safeParse(req.body); // { envId, image, repoUrl, branch, http? } — ignora kind
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  const d = parsed.data;
  try { return reply.code(200).send(await deploy.remoteSha(d.envId, d.image, d.repoUrl, d.branch, d.http)); }
  catch (err) { req.log.error({ err }, "deploy/remote-sha failed"); return reply.code(dockerErrorStatus(err)).send(errorPayload(err)); }
});

app.post("/deploy/run", async (req, reply) => {
  const parsed = deployRunBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  try { deploy.startDeploy(parsed.data); return reply.code(202).send({ started: true }); }
  catch (err) { req.log.error({ err }, "deploy/run failed"); return reply.code(dockerErrorStatus(err)).send(errorPayload(err)); }
});

app.get("/deploy/log/:runId", async (req, reply) => {
  const { runId } = req.params as { runId: string };
  return reply.code(200).send(deploy.getDeployLog(runId));
});

app.post("/node-version", async (req, reply) => {
  const parsed = nodeVersionBody.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  }
  try {
    const versionFull = await dockerDriver.applyNodeVersion(parsed.data.containerId, parsed.data.version);
    return reply.code(200).send({ versionFull });
  } catch (err) {
    req.log.error({ err }, "node-version failed");
    return reply.code(dockerErrorStatus(err)).send(errorPayload(err));
  }
});

app.post("/node-current", async (req, reply) => {
  const parsed = containerIdOnly.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  }
  try {
    const current = await dockerDriver.readNodeCurrent(parsed.data.containerId);
    return reply.code(200).send({ current });
  } catch (err) {
    req.log.error({ err }, "node-current failed");
    return reply.code(dockerErrorStatus(err)).send(errorPayload(err));
  }
});

app.post("/php-root", async (req, reply) => {
  const parsed = phpRootBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  try {
    await dockerDriver.applyPhpRoot(parsed.data.containerId, parsed.data.root, parsed.data.useRouter);
    return reply.code(200).send({ ok: true });
  } catch (err) {
    req.log.error({ err }, "php-root failed");
    return reply.code(dockerErrorStatus(err)).send(errorPayload(err));
  }
});

app.post("/php-ini/read", async (req, reply) => {
  const parsed = phpIniReadBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  try {
    const config = await dockerDriver.readPhpConfig(parsed.data.envId);
    return reply.code(200).send({ config });
  } catch (err) {
    req.log.error({ err }, "php-ini read failed");
    return reply.code(dockerErrorStatus(err)).send(errorPayload(err));
  }
});

app.post("/php-ini/write", async (req, reply) => {
  const parsed = phpIniWriteBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  try {
    const config = await dockerDriver.writePhpConfig(parsed.data.containerId, parsed.data.envId, parsed.data.config);
    return reply.code(200).send({ config });
  } catch (err) {
    req.log.error({ err }, "php-ini write failed");
    return reply.code(dockerErrorStatus(err)).send(errorPayload(err));
  }
});

app.post("/php-ini/reset", async (req, reply) => {
  const parsed = phpIniResetBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  try {
    const config = await dockerDriver.resetPhpConfig(parsed.data.containerId, parsed.data.envId);
    return reply.code(200).send({ config });
  } catch (err) {
    req.log.error({ err }, "php-ini reset failed");
    return reply.code(dockerErrorStatus(err)).send(errorPayload(err));
  }
});

app.post("/node-start", async (req, reply) => {
  const parsed = nodeStartBody.safeParse(req.body);
  if (!parsed.success) {
    return reply
      .code(400)
      .send({ error: "bad_request", message: parsed.error.message });
  }
  try {
    await dockerDriver.applyNodeStart(parsed.data.containerId, parsed.data.startFile);
    return reply.code(200).send({ ok: true });
  } catch (err) {
    req.log.error({ err }, "node-start failed");
    return reply.code(dockerErrorStatus(err)).send(errorPayload(err));
  }
});

app.post("/python-start", async (req, reply) => {
  const parsed = nodeStartBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  try {
    await dockerDriver.applyPythonStart(parsed.data.containerId, parsed.data.startFile);
    return reply.code(200).send({ ok: true });
  } catch (err) {
    req.log.error({ err }, "python-start failed");
    return reply.code(dockerErrorStatus(err)).send(errorPayload(err));
  }
});

const pythonCmdBody = z.object({
  containerId: z.string().min(1),
  cmd: z.string().nullable(), // null/"" limpa e volta ao default python3 app.py
});
app.post("/python-cmd", async (req, reply) => {
  const parsed = pythonCmdBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  try {
    await dockerDriver.applyPythonCmd(parsed.data.containerId, parsed.data.cmd);
    return reply.code(200).send({ ok: true });
  } catch (err) {
    req.log.error({ err }, "python-cmd failed");
    return reply.code(dockerErrorStatus(err)).send(errorPayload(err));
  }
});

// define/limpa o comando avançado de start do .NET (ex.: dotnet App.dll)
const dotnetCmdBody = z.object({
  containerId: z.string().min(1),
  cmd: z.string().nullable(), // null/"" limpa e volta ao auto (dotnet App.dll da publicação)
});
app.post("/dotnet-cmd", async (req, reply) => {
  const parsed = dotnetCmdBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  try {
    await dockerDriver.applyDotnetCmd(parsed.data.containerId, parsed.data.cmd);
    return reply.code(200).send({ ok: true });
  } catch (err) {
    req.log.error({ err }, "dotnet-cmd failed");
    return reply.code(dockerErrorStatus(err)).send(errorPayload(err));
  }
});

// comando .NET efetivamente rodando agora (para exibir no painel "como funciona hoje")
app.post("/dotnet-effective-cmd", async (req, reply) => {
  const parsed = containerIdOnly.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  try {
    const cmd = await dockerDriver.dotnetEffectiveCmd(parsed.data.containerId);
    return reply.code(200).send({ cmd });
  } catch (err) {
    req.log.error({ err }, "dotnet-effective-cmd failed");
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

app.post("/resources/:id", async (req, reply) => {
  const p = containerIdParams.safeParse(req.params);
  const b = z.object({ memMb: z.number().positive(), vcpu: z.number().positive() }).safeParse(req.body);
  if (!p.success || !b.success) {
    return reply.code(400).send({ error: "bad_request", message: "parâmetros inválidos" });
  }
  try {
    await dockerDriver.updateResources(p.data.id, b.data.memMb, b.data.vcpu);
    return reply.code(200).send({ ok: true });
  } catch (err) {
    req.log.error({ err }, "updateResources failed");
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

// Reinicia o processo do app (aplica edições de arquivo sem recriar o container).
app.post("/container/:id/restart-app", async (req, reply) => {
  const parsed = containerIdParams.safeParse(req.params);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  try {
    await dockerDriver.restartApp(parsed.data.id);
    return reply.send({ ok: true });
  } catch (err) {
    req.log.error({ err }, "restart-app failed");
    return reply.code(dockerErrorStatus(err)).send(errorPayload(err));
  }
});

// Logs do container. Snapshot (JSON) + stream ao vivo (SSE).
function clampTail(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 200;
  return Math.min(2000, Math.max(1, Math.floor(n)));
}

app.get("/container/:id/logs", async (req, reply) => {
  const parsed = containerIdParams.safeParse(req.params);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  const tail = clampTail((req.query as { tail?: unknown })?.tail);
  try {
    return reply.send({ log: await dockerDriver.logSnapshot(parsed.data.id, tail) });
  } catch (err) {
    req.log.error({ err }, "logs snapshot failed");
    return reply.code(dockerErrorStatus(err)).send(errorPayload(err));
  }
});

app.get("/container/:id/logs/stream", async (req, reply) => {
  const parsed = containerIdParams.safeParse(req.params);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  const tail = clampTail((req.query as { tail?: unknown })?.tail);
  let stream: NodeJS.ReadableStream;
  try {
    stream = await dockerDriver.logStream(parsed.data.id, tail);
  } catch (err) {
    req.log.error({ err }, "logs stream failed");
    return reply.code(dockerErrorStatus(err)).send(errorPayload(err));
  }
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  raw.write("retry: 3000\n\n");
  let buf = "";
  const onData = (chunk: Buffer): void => {
    buf += dockerDriver.cleanLog(chunk.toString("utf8"));
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const line of parts) raw.write(`data: ${line}\n\n`);
  };
  stream.on("data", onData);
  stream.on("end", () => { if (buf) raw.write(`data: ${buf}\n\n`); raw.end(); });
  stream.on("error", () => raw.end());
  const hb = setInterval(() => raw.write(": ping\n\n"), 25_000);
  const cleanup = (): void => {
    clearInterval(hb);
    try { (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.(); } catch { /* noop */ }
  };
  req.raw.on("close", cleanup);
});

// Jamees Studio — Pub/Sub do Redis (stream SSE). A API valida posse/running/senha.
app.get("/db/redis/subscribe/:id", async (req, reply) => {
  const p = containerIdParams.safeParse(req.params);
  if (!p.success) return reply.code(400).send({ error: "bad_request" });
  const q = z
    .object({
      mode: z.enum(["channel", "pattern"]).optional().default("channel"),
      target: z.string().min(1).max(512),
      db: z.coerce.number().int().min(0).max(15).optional().default(0),
    })
    .safeParse(req.query);
  if (!q.success) return reply.code(400).send({ error: "bad_request", message: q.error.message });
  let sub: dockerDriver.RedisSubStream;
  try {
    sub = await dockerDriver.redisSubscribeStream(p.data.id, q.data.mode, q.data.target, q.data.db);
  } catch (err) {
    req.log.error({ err }, "redis subscribe failed");
    return reply.code(dockerErrorStatus(err)).send(errorPayload(err));
  }
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  raw.write("retry: 3000\n\n");
  let buf = "";
  sub.stream.on("data", (chunk: Buffer) => {
    buf += chunk.toString("utf8");
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const line of parts) {
      const msg = dockerDriver.redisPubSubMessage(line);
      if (msg) raw.write(`data: ${JSON.stringify(msg)}\n\n`);
    }
  });
  sub.stream.on("end", () => raw.end());
  sub.stream.on("error", () => raw.end());
  const hb = setInterval(() => raw.write(": ping\n\n"), 25_000);
  req.raw.on("close", () => {
    clearInterval(hb);
    sub.kill();
  });
});

const attachNetworkBody = z.object({
  containerId: z.string().min(1),
  network: z.object({
    name: z.string().min(1),
    subnet: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/),
    gateway: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/),
  }),
  ip: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/),
  ownerId: z.string().min(1),
});

app.post("/network/attach", async (req, reply) => {
  const parsed = attachNetworkBody.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  }
  try {
    const r = await dockerDriver.attachNetwork(
      parsed.data.containerId,
      { ...parsed.data.network, ip: parsed.data.ip },
      parsed.data.ownerId,
    );
    return reply.code(200).send(r);
  } catch (err) {
    req.log.error({ err }, "network/attach failed");
    return reply.code(dockerErrorStatus(err)).send(errorPayload(err));
  }
});

/* ── Ingress por domínio (Caddy do nó) ── */
app.get("/ingress/available", async () => ({ available: await ingress.available() }));

app.put("/ingress/site", async (req, reply) => {
  const parsed = z.object({ domain: z.string().min(3), upstream: z.string().min(3) }).safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  try {
    await ingress.putSite(parsed.data.domain, parsed.data.upstream);
    return reply.code(200).send({ ok: true });
  } catch (err) {
    req.log.error({ err }, "ingress/site put failed");
    return reply.code(500).send(errorPayload(err));
  }
});

app.delete("/ingress/site", async (req, reply) => {
  const parsed = z.object({ domain: z.string().min(3) }).safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  try {
    await ingress.removeSite(parsed.data.domain);
    return reply.code(200).send({ ok: true });
  } catch (err) {
    req.log.error({ err }, "ingress/site delete failed");
    return reply.code(500).send(errorPayload(err));
  }
});

app.post("/volume/remove", async (req, reply) => {
  const parsed = z.object({ name: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  }
  try {
    await dockerDriver.removeVolume(parsed.data.name);
    return reply.code(204).send(null);
  } catch (err) {
    return reply.code(dockerErrorStatus(err)).send(errorPayload(err));
  }
});

app.get("/container/:id/ip", async (req, reply) => {
  const parsed = containerIdParams.safeParse(req.params);
  if (!parsed.success) {
    return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  }
  try {
    const ip = await dockerDriver.containerIp(parsed.data.id);
    return reply.send({ ip });
  } catch (err) {
    return reply.code(dockerErrorStatus(err)).send(errorPayload(err));
  }
});

app.get("/disk/:id", async (req, reply) => {
  const parsed = containerIdParams.safeParse(req.params);
  if (!parsed.success) {
    return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  }
  try {
    const result = await dockerDriver.diskUsage(parsed.data.id);
    return reply.send(result);
  } catch (err) {
    req.log.error({ err }, "disk failed");
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

// POST /files/:cid/upload {path,contentBase64} — envia um arquivo (binário via base64)
app.post("/files/:cid/upload", async (req, reply) => {
  const p = filesCidParams.safeParse(req.params);
  const b = uploadBody.safeParse(req.body);
  if (!p.success || !b.success) {
    return reply.code(400).send({ error: "bad_request", message: "parâmetros inválidos" });
  }
  try {
    await files.uploadBase64(p.data.cid, b.data.path, b.data.contentBase64);
    return reply.code(200).send({ ok: true });
  } catch (err) {
    req.log.error({ err }, "files.upload failed");
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

/* ─────────────── Rotas VPS (KVM) — caminho separado do Docker ─────────────── */

const vpsProvisionBody = z.object({
  envId: z.string().min(1),
  name: z.string().min(1),
  image: z.string().min(1),
  limits: z.object({
    vcpu: z.number().positive(),
    memMb: z.number().positive(),
    diskGb: z.number().positive(),
  }),
  network: z.object({
    name: z.string().min(1),
    subnet: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/),
    gateway: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/),
  }),
  ip: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/),
  ownerId: z.string().min(1),
  sshPublicKeys: z.array(z.string().min(1)).min(1),
  sshUser: z.string().regex(/^[a-z_][a-z0-9_-]*$/).optional(),
  ports: z.object({ start: z.number().int().min(1).max(65535), count: z.number().int().min(1).max(1000) }).nullable().optional(),
});
// Nome do domínio libvirt: só o alfabeto que geramos (vps-<hex>) — 2ª borda anti-injeção.
const vpsNameBody = z.object({ vmName: z.string().regex(/^vps-[a-z0-9]+$/) });

app.get("/vps/available", async () => ({ available: await kvm.available() }));

app.post("/vps/provision", async (req, reply) => {
  const parsed = vpsProvisionBody.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  }
  try {
    const result = await kvm.provision(parsed.data);
    req.log.info({ envId: parsed.data.envId, vmName: result.vmName, ip: result.ip }, "vps provisioned");
    return reply.send(result);
  } catch (err) {
    req.log.error({ err }, "vps provision failed");
    return reply.code(500).send(errorPayload(err));
  }
});

// Ações de ciclo de vida por nome do domínio. suspend/resume servem ao takedown de abuso.
for (const [route, fn] of [
  ["start", kvm.start],
  ["stop", kvm.stop],
  ["reboot", kvm.reboot],
  ["suspend", kvm.suspend],
  ["resume", kvm.resume],
  ["destroy", kvm.destroy],
] as const) {
  app.post(`/vps/${route}`, async (req, reply) => {
    const parsed = vpsNameBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
    }
    try {
      await fn(parsed.data.vmName);
      return reply.code(204).send(null);
    } catch (err) {
      req.log.error({ err, route }, "vps action failed");
      return reply.code(500).send(errorPayload(err));
    }
  });
}

app.post("/vps/status", async (req, reply) => {
  const parsed = vpsNameBody.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  }
  try {
    return reply.send({ state: await kvm.status(parsed.data.vmName) });
  } catch (err) {
    return reply.code(500).send(errorPayload(err));
  }
});

// Publica o domínio do VPS no Caddy do nó -> vmIp:porta (upstream travado no IP da VM).
const vpsPublishBody = z.object({
  domain: z.string().min(3),
  vmIp: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/),
  port: z.number().int().min(1).max(65535),
});
app.post("/vps/publish", async (req, reply) => {
  const parsed = vpsPublishBody.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  }
  try {
    await ingress.putSite(parsed.data.domain, `${parsed.data.vmIp}:${parsed.data.port}`, {
      vps: true,
      expectUpstreamHost: parsed.data.vmIp,
    });
    return reply.send({ ok: true });
  } catch (err) {
    return reply.code(500).send(errorPayload(err));
  }
});
app.post("/vps/unpublish", async (req, reply) => {
  const parsed = z.object({ domain: z.string().min(3) }).safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
  }
  try {
    await ingress.removeSite(parsed.data.domain);
    return reply.send({ ok: true });
  } catch (err) {
    return reply.code(500).send(errorPayload(err));
  }
});

/* ─────────────── Boot ─────────────── */

try {
  await app.listen({ port: AGENT_PORT, host: "0.0.0.0" });
  app.log.info(`Agente VelozPlanel escutando em :${AGENT_PORT}`);
  startSshGateway(app.log);
  startSftpGateway(app.log);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
