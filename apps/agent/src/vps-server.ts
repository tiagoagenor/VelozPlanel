/**
 * Agente VPS (KVM) — NATIVO no host (não em container).
 *
 * Por que separado do `server.ts`: o agente Docker roda num container sem acesso ao
 * libvirt/tools; o KVM é operado por ESTE processo, direto no host (tem virsh/qemu/
 * cloud-localds, rede do host e o socket do libvirt). Expõe SÓ as rotas /vps/* numa
 * porta própria (default 4101), autenticadas por x-agent-token (mesmo do agente Docker).
 *
 * Deploy: bundle único via esbuild (`pnpm --filter @velozplanel/agent build:vps`), copiado
 * pro host e rodado por systemd. Ver deploy/vps/veloz-vps-agent.service.
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import * as kvm from "./kvm.js";
import * as ingress from "./ingress.js";

const PORT = Number(process.env.VPS_AGENT_PORT ?? 4101);
const HOST = process.env.VPS_AGENT_HOST ?? "0.0.0.0";
const TOKEN = process.env.VP_INTERNAL_TOKEN ?? "";

const app = Fastify({ logger: { transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } } } });
await app.register(cors, { origin: true, credentials: true });

app.addHook("onRequest", async (req, reply) => {
  if (req.url === "/health") return;
  if (!TOKEN) return; // dev sem token: sem checagem
  if (req.headers["x-agent-token"] !== TOKEN) return reply.code(401).send({ error: "unauthorized" });
});

function errorPayload(err: unknown): { error: string; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  return { error: "vps_error", message };
}

const provisionBody = z.object({
  envId: z.string().min(1),
  name: z.string().min(1),
  image: z.string().min(1),
  limits: z.object({ vcpu: z.number().positive(), memMb: z.number().positive(), diskGb: z.number().positive() }),
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
const nameBody = z.object({ vmName: z.string().regex(/^vps-[a-z0-9]+$/) });
const publishBody = z.object({
  domain: z.string().min(3),
  vmIp: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/),
  port: z.number().int().min(1).max(65535),
});

app.get("/health", async () => ({ ok: true, vps: true }));
app.get("/vps/available", async () => ({ available: await kvm.available() }));

app.post("/vps/provision", async (req, reply) => {
  const p = provisionBody.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: "bad_request", message: p.error.message });
  try {
    const result = await kvm.provision(p.data);
    req.log.info({ envId: p.data.envId, vmName: result.vmName, ip: result.ip }, "vps provisioned");
    return reply.send(result);
  } catch (err) {
    req.log.error({ err }, "vps provision failed");
    return reply.code(500).send(errorPayload(err));
  }
});

for (const [route, fn] of [
  ["start", kvm.start],
  ["stop", kvm.stop],
  ["reboot", kvm.reboot],
  ["suspend", kvm.suspend],
  ["resume", kvm.resume],
  ["destroy", kvm.destroy],
] as const) {
  app.post(`/vps/${route}`, async (req, reply) => {
    const p = nameBody.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "bad_request", message: p.error.message });
    try {
      await fn(p.data.vmName);
      return reply.code(204).send(null);
    } catch (err) {
      req.log.error({ err, route }, "vps action failed");
      return reply.code(500).send(errorPayload(err));
    }
  });
}

app.post("/vps/status", async (req, reply) => {
  const p = nameBody.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: "bad_request", message: p.error.message });
  try {
    return reply.send({ state: await kvm.status(p.data.vmName) });
  } catch (err) {
    return reply.code(500).send(errorPayload(err));
  }
});

app.post("/vps/publish", async (req, reply) => {
  const p = publishBody.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: "bad_request", message: p.error.message });
  try {
    await ingress.putSite(p.data.domain, `${p.data.vmIp}:${p.data.port}`, { vps: true, expectUpstreamHost: p.data.vmIp });
    return reply.send({ ok: true });
  } catch (err) {
    return reply.code(500).send(errorPayload(err));
  }
});
app.post("/vps/unpublish", async (req, reply) => {
  const p = z.object({ domain: z.string().min(3) }).safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: "bad_request", message: p.error.message });
  try {
    await ingress.removeSite(p.data.domain);
    return reply.send({ ok: true });
  } catch (err) {
    return reply.code(500).send(errorPayload(err));
  }
});

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`Agente VPS (KVM) nativo escutando em :${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
