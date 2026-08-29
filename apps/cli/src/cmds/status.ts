import type { Config } from "../config.js";
import type { Args } from "../lib/args.js";
import { ok, fail, usage } from "../lib/out.js";
import { sh, shq } from "../lib/ssh.js";
import { composeCmd, composePs } from "../lib/docker.js";
import { httpJson } from "../lib/http.js";

export async function status(sub: string, _a: Args, cfg: Config): Promise<void> {
  if (sub === "billing") return billing(cfg);

  // health dos nós
  const nodesOut = [];
  for (const [name, node] of Object.entries(cfg.nodes)) {
    const t = Date.now();
    const r = await httpJson(`${node.agent}/health`, { timeoutMs: 8000 });
    nodesOut.push({ name, agent: { ok: r.ok, ms: Date.now() - t } });
  }

  // containers do controle
  const rows = await composePs(cfg);
  const total = rows.length;
  const running = rows.filter((r) => /up|running/i.test(r.status + r.state)).length;
  const unhealthy = rows.filter((r) => (r.health || "").toLowerCase() === "unhealthy").map((r) => r.service || r.name);

  // serial da zona principal (best-effort)
  let soaSerial: number | null = null;
  const dr = await httpJson(`${cfg.apiInternal}/api/v1/internal/dns/rrsets?zone=jamees.top`, { token: cfg.tokens.internal, timeoutMs: 8000 });
  if (dr.ok) {
    const rr = (((dr.json as { rrsets?: Record<string, unknown>[] })?.rrsets ?? [])).find((x) => String(x.type) === "SOA");
    if (rr) soaSerial = Number(String((rr.records as string[])?.[0] ?? "").split(/\s+/)[2] ?? "0") || null;
  }

  // drift de schema (best-effort)
  const q = "select count(*) from information_schema.columns where table_schema='public'";
  const dbReach = (await sh(cfg.hosts.control.ssh, `${composeCmd(cfg)} exec -T ${cfg.db.postgresService} psql -U ${cfg.db.superUser} -d ${cfg.db.velozpanel} -tAc ${shq(q)}`)).code === 0;

  const warnings: string[] = [];
  if (unhealthy.length) warnings.push(`containers unhealthy: ${unhealthy.join(", ")}`);
  if (!dbReach) warnings.push("banco de controle inalcançável");
  nodesOut.filter((n) => !n.agent.ok).forEach((n) => warnings.push(`agente do nó ${n.name} fora`));

  return ok({
    nodes: nodesOut,
    control: { containers: { running, total }, unhealthy },
    dns: { soaSerial },
    dbReachable: dbReach,
    warnings,
  });
}

async function billing(cfg: Config): Promise<void> {
  const q =
    "select coalesce(billing_last_run_finished_at::text,''), coalesce(billing_last_instances::text,''), coalesce(billing_last_charged_cents::text,''), coalesce(billing_last_ok::text,'') from platform_settings where id=1";
  const r = await sh(cfg.hosts.control.ssh, `${composeCmd(cfg)} exec -T ${cfg.db.postgresService} psql -U ${cfg.db.superUser} -d ${cfg.db.velozpanel} -tAF'|' -c ${shq(q)}`);
  const line = r.out.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (!line) return fail("sem dados de billing");
  const [lastRunAt, instances, chargedCents, okFlag] = line.split("|");
  return ok({
    lastRunAt: lastRunAt || null,
    envsBilled: instances ? Number(instances) : null,
    totalCents: chargedCents ? Number(chargedCents) : null,
    lastOk: okFlag === "t" || okFlag === "true",
  });
}
