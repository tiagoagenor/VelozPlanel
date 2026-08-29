import type { Config } from "../config.js";
import { type Args, opt, yes } from "../lib/args.js";
import { ok, fail, needConfirm, usage } from "../lib/out.js";
import { sh, shq } from "../lib/ssh.js";
import { composeCmd } from "../lib/docker.js";
import { httpJson } from "../lib/http.js";
import { newLogId, writeLog } from "../lib/logs.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Target {
  ok: boolean;
  agent: string;
  containerId: string;
  nodeName: string;
  publicHost?: string;
  httpHost?: string;
  sshEnabled?: boolean;
  state?: string;
  degraded?: boolean;
  error?: string;
  status?: number;
}

/** Resolve o alvo operacional de um ambiente (join environments->nodes). HTTP com fallback SSH. */
export async function resolveTarget(cfg: Config, envId: string): Promise<Target> {
  if (!UUID.test(envId)) return { ok: false, agent: "", containerId: "", nodeName: "", error: "envId inválido (uuid)" };
  const url = `${cfg.apiInternal}/api/v1/internal/env/${envId}/target`;
  const r = await httpJson(url, { token: cfg.tokens.internal, timeoutMs: 10_000 });
  if (r.ok && r.json && typeof r.json === "object") {
    const j = r.json as Record<string, unknown>;
    return {
      ok: !!j.agentUrl && !!j.containerId,
      agent: String(j.agentUrl ?? ""),
      containerId: String(j.containerId ?? ""),
      nodeName: String(j.nodeName ?? ""),
      publicHost: j.publicHost ? String(j.publicHost) : undefined,
      httpHost: j.httpHost ? String(j.httpHost) : undefined,
      sshEnabled: !!j.sshEnabled,
      state: j.state ? String(j.state) : undefined,
      degraded: false,
      error: j.agentUrl && j.containerId ? undefined : "ambiente sem nó/container",
    };
  }
  if (r.status === 404) return { ok: false, agent: "", containerId: "", nodeName: "", error: "ambiente não encontrado", status: 404 };
  // Fallback SSH (rota ausente / rede): psql join (super), marca degraded.
  const q = `select coalesce(e.container_id,''), coalesce(n.name,''), coalesce(n.agent_url,''), coalesce(n.public_host,''), coalesce(n.http_host,''), coalesce(e.state,''), coalesce(sc.enabled::text,'false') from environments e left join nodes n on n.id=e.node_id left join ssh_configs sc on sc.env_id=e.id where e.id='${envId}'`;
  const pr = await sh(cfg.hosts.control.ssh, `${composeCmd(cfg)} exec -T ${cfg.db.postgresService} psql -U ${cfg.db.superUser} -d ${cfg.db.velozpanel} -tAF'|' -c ${shq(q)}`);
  const line = pr.out.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (!line) return { ok: false, agent: "", containerId: "", nodeName: "", error: "ambiente não encontrado", degraded: true };
  const [containerId, nodeName, agentUrl, publicHost, httpHost, state, sshEnabled] = line.split("|");
  return {
    ok: !!agentUrl && !!containerId,
    agent: agentUrl ?? "",
    containerId: containerId ?? "",
    nodeName: nodeName ?? "",
    publicHost: publicHost || undefined,
    httpHost: httpHost || undefined,
    sshEnabled: sshEnabled === "true" || sshEnabled === "t",
    state: state || undefined,
    degraded: true,
    error: agentUrl && containerId ? undefined : "ambiente sem nó/container",
  };
}

export async function env(sub: string, a: Args, cfg: Config): Promise<void> {
  const envId = a._[0];

  if (sub === "resolve") {
    if (!envId) usage("uso: jamees env resolve <envId>");
    const t = await resolveTarget(cfg, envId!);
    if (!t.ok && t.error) return fail(t.error, { env: envId, degraded: t.degraded, status: t.status });
    return ok({ env: envId, containerId: t.containerId, nodeName: t.nodeName, agentUrl: t.agent, publicHost: t.publicHost, httpHost: t.httpHost, state: t.state, sshEnabled: t.sshEnabled, gatewayActive: false, degraded: t.degraded });
  }

  if (sub === "logs") {
    if (!envId) usage("uso: jamees env logs <envId> [--tail N]");
    const t = await resolveTarget(cfg, envId!);
    if (!t.ok) return fail(t.error ?? "não resolvi o ambiente", { env: envId, degraded: t.degraded });
    const n = Number(opt(a, "tail") ?? 200);
    const r = await httpJson(`${t.agent}/container/${t.containerId}/logs?tail=${n}`, { token: cfg.tokens.internal, timeoutMs: 15_000 });
    if (!r.ok) return fail("logs falhou", { env: envId, status: r.status });
    const log = String((r.json as { log?: string })?.log ?? r.text ?? "");
    const logId = newLogId(`env-${envId!.slice(0, 8)}`);
    writeLog(logId, log);
    const lines = log.split(/\r?\n/);
    return ok({ env: envId, lines: lines.length, logId, more: lines.length >= n });
  }

  if (sub === "ssh-enable" || sub === "ssh-disable") {
    if (!envId) usage(`uso: jamees env ${sub} <envId> [--yes]`);
    const enabled = sub === "ssh-enable";
    if (!yes(a)) needConfirm({ action: sub, env: envId });
    const r = await httpJson(`${cfg.apiInternal}/api/v1/internal/env/${envId}/ssh`, { method: "POST", token: cfg.tokens.internal, body: { enabled } });
    if (!r.ok) {
      if (r.status === 404) return fail("requer a rota /internal/env/:id/ssh (deploy da api desta versão)", { env: envId, needsRoute: true });
      return fail("falha ao alternar SSH", { env: envId, status: r.status });
    }
    const j = (r.json ?? {}) as Record<string, unknown>;
    return ok({ env: envId, sshEnabled: j.sshEnabled ?? enabled, gatewayActive: false, warning: j.warning ?? "gateway SSH não provisionado — a sessão não funcionará ainda" });
  }

  if (sub === "vars-set") {
    // O agente /env-vars SUBSTITUI todo o conjunto e não persiste no banco de
    // controle — aplicar só as novas chaves apagaria as demais. Persistir com
    // segurança exige a rota da API (merge+cifra). Honesto: encaminha ao painel.
    return fail("env vars-set ainda não implementado com segurança no CLI", {
      env: envId,
      needsRoute: true,
      hint: "use a aba Variáveis do ambiente no painel (merge + persistência cifrada). Um /internal/env/:id/env-vars pode ser adicionado depois.",
    });
  }

  if (sub === "service") {
    const action = a._[0];
    const id = a._[1];
    if (action === "ls") {
      if (!id) usage("uso: jamees env service ls <envId>");
      const q = `select coalesce(name,''), coalesce(type_id,''), coalesce(state,''), coalesce(container_id,'') from environments where parent_env_id='${id}' order by name`;
      if (!UUID.test(id!)) return fail("envId inválido", { env: id });
      const r = await sh(cfg.hosts.control.ssh, `${composeCmd(cfg)} exec -T ${cfg.db.postgresService} psql -U ${cfg.db.superUser} -d ${cfg.db.velozpanel} -tAF'|' -c ${shq(q)}`);
      const services = r.out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
        const [name, type, state, containerId] = l.split("|");
        return { name, type, state, containerId };
      });
      return ok({ env: id, services });
    }
    if (action === "add") {
      return fail("env service add não é feito pelo CLI", {
        needsRoute: true,
        hint: "provisionar serviço envolve IPAM/rede/preço (fluxo do painel). Use o painel do ambiente.",
      });
    }
    usage("uso: jamees env service <ls|add> <envId>");
  }

  if (sub === "move-domain") {
    if (!envId) usage("uso: jamees env move-domain <envId> --domain <host> [--yes]");
    const t = await resolveTarget(cfg, envId!);
    if (!t.ok) return fail(t.error ?? "não resolvi o ambiente", { env: envId });
    const ip = t.httpHost || t.publicHost || null;
    // Apontar+publicar com HTTPS envolve o vhost (porta efêmera do container) e
    // a escada de propagação — o painel já faz isso corretamente. O CLI reporta
    // o alvo e encaminha, para não deixar um estado parcial.
    return ok({
      env: envId,
      manual: true,
      nodeIp: ip,
      hint: "aponte pelo painel (aba Domínio) — ele cria o A, publica o vhost e acompanha o TLS. Para só o registro DNS use `jamees dns upsert`.",
    });
  }

  usage(`subcomando de env desconhecido: ${sub}`, { valid: ["resolve", "logs", "ssh-enable", "ssh-disable", "vars-set", "service", "move-domain"] });
}
