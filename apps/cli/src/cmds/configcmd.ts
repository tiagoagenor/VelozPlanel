import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { Config } from "../config.js";
import { configExists, loadConfig, saveConfig, masked, initConfig } from "../config.js";
import { type Args, opt } from "../lib/args.js";
import { ok, fail, usage } from "../lib/out.js";
import { CONFIG_PATH } from "../lib/paths.js";
import { sh, shq } from "../lib/ssh.js";
import { httpJson } from "../lib/http.js";
import { composeCmd } from "../lib/docker.js";

/** Sobe de cwd procurando o pnpm-workspace.yaml (raiz do monorepo). */
function detectRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml")) && existsSync(join(dir, "apps/api"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return "/Users/tiago.agenor/www/velozPanel";
}

export async function configCmd(sub: string, a: Args): Promise<void> {
  if (sub === "init") {
    const src = opt(a, "src") ?? detectRepoRoot();
    const { cfg, warnings } = await initConfig(src);
    saveConfig(cfg);
    return ok({ path: CONFIG_PATH, nodes: Object.keys(cfg.nodes), tokenSet: !!cfg.tokens.internal, srcLocal: cfg.paths.srcLocal, warnings });
  }

  if (sub === "show") {
    if (!configExists()) return fail("config ausente", { hint: "rode `jamees config init`" });
    return ok({ path: CONFIG_PATH, config: masked(loadConfig()) });
  }

  if (sub === "set") {
    const key = a._[0];
    const value = a._.slice(1).join(" ");
    if (!key) usage("uso: jamees config set <chave.pontilhada> <valor>");
    const cfg = loadConfig();
    setPath(cfg as unknown as Record<string, unknown>, key!, value);
    saveConfig(cfg);
    return ok({ set: key, path: CONFIG_PATH });
  }

  if (sub === "doctor") {
    const cfg = loadConfig();
    const checks: Record<string, unknown> = {};
    checks.tokenSet = !!cfg.tokens.internal;
    // ssh control/build
    checks.sshControl = (await sh(cfg.hosts.control.ssh, "echo ok")).out.trim() === "ok";
    checks.sshBuild = (await sh(cfg.hosts.build.ssh, "echo ok")).out.trim() === "ok";
    // nós: ssh + agente
    const nodes: Record<string, unknown> = {};
    for (const [name, node] of Object.entries(cfg.nodes)) {
      const sshOk = (await sh(node.ssh, "echo ok", { timeoutMs: 12_000 })).out.trim() === "ok";
      const health = node.agent ? (await httpJson(`${node.agent}/health`, { timeoutMs: 8000 })).ok : false;
      nodes[name] = { ssh: sshOk, agent: health };
    }
    checks.nodes = nodes;
    // role somente-leitura
    const roleQ = "select coalesce((select rolsuper from pg_roles where rolname='jamees_ro')::text,'missing')";
    const rr = await sh(cfg.hosts.control.ssh, `${composeCmd(cfg)} exec -T ${cfg.db.postgresService} psql -U ${cfg.db.superUser} -d ${cfg.db.velozpanel} -tAc ${shq(roleQ)}`);
    const roleState = rr.out.trim();
    checks.roRole = roleState === "false" ? "ok" : roleState === "true" ? "INSEGURO (é superuser)" : "ausente (rode `jamees deploy schema`)";
    // rotas internas
    const dnsRoute = await httpJson(`${cfg.apiInternal}/api/v1/internal/dns/zones`, { token: cfg.tokens.internal, timeoutMs: 8000 });
    const targetRoute = await httpJson(`${cfg.apiInternal}/api/v1/internal/env/00000000-0000-0000-0000-000000000000/target`, { token: cfg.tokens.internal, timeoutMs: 8000 });
    checks.routes = {
      dns: dnsRoute.ok ? "ok" : dnsRoute.status === 404 ? "ausente" : `erro ${dnsRoute.status}`,
      envTarget: targetRoute.status === 404 || targetRoute.ok ? "ok" : targetRoute.status === 401 ? "token?" : `erro ${targetRoute.status}`,
    };
    const problems: string[] = [];
    if (!checks.sshControl) problems.push("ssh control inalcançável");
    if (!checks.sshBuild) problems.push("ssh build inalcançável");
    if (checks.roRole !== "ok") problems.push(`role somente-leitura: ${checks.roRole}`);
    return ok({ checks, problems, healthy: problems.length === 0 });
  }

  usage(`subcomando de config desconhecido: ${sub}`, { valid: ["init", "show", "set", "doctor"] });
}

function setPath(obj: Record<string, unknown>, path: string, value: string): void {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}
