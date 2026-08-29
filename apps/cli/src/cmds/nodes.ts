import type { Config } from "../config.js";
import { type Args, opt, yes } from "../lib/args.js";
import { ok, fail, needConfirm, usage, tail } from "../lib/out.js";
import { sh, shq } from "../lib/ssh.js";
import { localSh } from "../lib/local.js";
import { composeCmd } from "../lib/docker.js";
import { httpJson } from "../lib/http.js";
import { deploy } from "./deploy.js";
import { resolveTarget } from "./env.js";

async function agentHealth(agent: string): Promise<{ ok: boolean; ms: number }> {
  const t = Date.now();
  const r = await httpJson(`${agent}/health`, { timeoutMs: 8000 });
  return { ok: r.ok, ms: Date.now() - t };
}

export async function nodes(sub: string, a: Args, cfg: Config): Promise<void> {
  if (sub === "ls") {
    const q = "select name, coalesce(region,''), coalesce(agent_url,''), coalesce(public_host,''), coalesce(http_host,''), coalesce(vcpu_total::text,''), coalesce(mem_mb_total::text,'') from nodes order by name";
    const r = await sh(cfg.hosts.control.ssh, `${composeCmd(cfg)} exec -T ${cfg.db.postgresService} psql -U ${cfg.db.superUser} -d ${cfg.db.velozpanel} -tAF'|' -c ${shq(q)}`);
    const out = [];
    for (const line of r.out.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      const [name, region, agentUrl, publicHost, httpHost, vcpu, memMb] = t.split("|");
      const agent = agentUrl || cfg.nodes[name ?? ""]?.agent || "";
      const health = agent ? await agentHealth(agent) : { ok: false, ms: 0 };
      out.push({ name, region, agentUrl: agent, publicHost, httpHost, vcpu: vcpu ? Number(vcpu) : null, memMb: memMb ? Number(memMb) : null, agent: health });
    }
    return ok({ nodes: out });
  }
  if (sub === "health") {
    const which = opt(a, "node") ?? "all";
    const names = which === "all" ? Object.keys(cfg.nodes) : [which];
    const results = [];
    for (const n of names) {
      const node = cfg.nodes[n];
      if (!node) {
        results.push({ node: n, ok: false, error: "nó desconhecido" });
        continue;
      }
      results.push({ node: n, ...(await agentHealth(node.agent)) });
    }
    return ok({ results });
  }
  if (sub === "update-agent") {
    return deploy("agent", a, cfg); // mesmo caminho de deploy agent
  }
  if (sub === "push-image") {
    const image = opt(a, "image");
    if (!image) usage("uso: jamees nodes push-image --image <nome> --node <nome|all> [--yes]");
    const which = opt(a, "node") ?? "all";
    const names = which === "all" ? Object.keys(cfg.nodes) : [which];
    if (!yes(a)) needConfirm({ action: "push-image", image, nodes: names });
    const results = [];
    for (const n of names) {
      const node = cfg.nodes[n];
      if (!node) {
        results.push({ node: n, ok: false, error: "nó desconhecido" });
        continue;
      }
      const t = Date.now();
      const r = await localSh(`ssh -n -o BatchMode=yes ${cfg.hosts.build.ssh} 'docker save ${shq(image!)}' | ssh -o BatchMode=yes ${node.ssh} 'docker load'`);
      results.push({ node: n, ok: r.code === 0, loadedSec: Math.round((Date.now() - t) / 1000), tail: r.code === 0 ? undefined : tail(r.err) });
    }
    const allOk = results.every((x) => x.ok);
    return allOk ? ok({ image, results }) : fail("push-image falhou em algum nó", { image, results });
  }
  if (sub === "stats") {
    const envId = opt(a, "env");
    if (!envId) usage("uso: jamees nodes stats --env <envId>");
    const target = await resolveTarget(cfg, envId!);
    if (!target.ok) return fail("não resolvi o ambiente", { env: envId, ...target });
    const r = await httpJson(`${target.agent}/stats/${target.containerId}`, { token: cfg.tokens.internal, timeoutMs: 10_000 });
    if (!r.ok) fail("stats falhou", { env: envId, status: r.status, degraded: target.degraded });
    const s = (r.json ?? {}) as Record<string, unknown>;
    return ok({ env: envId, cpuPct: s.cpuPct ?? s.cpu ?? null, memBytes: s.memBytes ?? s.mem ?? null, memLimitBytes: s.memLimitBytes ?? null, degraded: target.degraded });
  }
  usage(`subcomando de nodes desconhecido: ${sub}`, { valid: ["ls", "health", "update-agent", "push-image", "stats"] });
}
