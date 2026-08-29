import type { Config } from "../config.js";
import { type Args, opt, optList, yes } from "../lib/args.js";
import { ok, fail, needConfirm, usage, tail } from "../lib/out.js";
import { sh, shq } from "../lib/ssh.js";
import { composeCmd, composePs, pollHealth } from "../lib/docker.js";
import { newLogId, writeLog } from "../lib/logs.js";

const DATA = new Set(["postgres", "mariadb", "pdns"]);
const PORTS: Record<string, number> = { api: 4000, painel: 3000, site: 3000 };

export async function containers(sub: string, a: Args, cfg: Config): Promise<void> {
  const control = cfg.hosts.control.ssh;
  if (sub === "ps") {
    const rows = await composePs(cfg);
    return ok({ containers: rows.map((r) => ({ name: r.name, service: r.service, state: r.state, status: r.status, health: r.health || null, image: r.image })) });
  }
  if (sub === "logs") {
    const svc = a._[0];
    if (!svc) usage("uso: jamees containers logs <svc> [--tail N] [--since t]");
    const n = Number(opt(a, "tail") ?? 200);
    const since = opt(a, "since");
    const r = await sh(control, `${composeCmd(cfg)} logs --no-color --tail ${n} ${since ? `--since ${shq(since)} ` : ""}${shq(svc!)}`);
    const text = r.out + (r.err ? "\n" + r.err : "");
    const logId = newLogId(`logs-${svc}`);
    writeLog(logId, text);
    const lines = text.split(/\r?\n/);
    const errors = lines.filter((l) => /error|fatal|exception/i.test(l)).length;
    const warns = lines.filter((l) => /warn/i.test(l)).length;
    return ok({ svc, lines: lines.length, summary: { errors, warns }, logId, more: lines.length >= n });
  }
  if (sub === "restart" || sub === "recreate") {
    const svc = a._[0];
    if (!svc) usage(`uso: jamees containers ${sub} <svc> [--yes]`);
    if (DATA.has(svc!)) fail(`recusado: '${svc}' é serviço de dados (postgres/mariadb/pdns)`, { refused: true });
    if (!yes(a)) needConfirm({ action: sub, svc });
    const cmd = sub === "restart" ? `restart ${shq(svc!)}` : `up -d --force-recreate ${shq(svc!)}`;
    const r = await sh(control, `${composeCmd(cfg)} ${cmd}`, { timeoutMs: 120_000 });
    if (r.code !== 0) fail(`${sub} falhou`, { step: sub, tail: tail(r.err || r.out) });
    const h = PORTS[svc!] ? await pollHealth(cfg, svc!, PORTS[svc!]) : undefined;
    return ok({ svc, [sub === "restart" ? "restarted" : "recreated"]: true, health: h });
  }
  if (sub === "env-set") {
    const kvs = a._.filter((x) => x.includes("="));
    if (!kvs.length) usage("uso: jamees containers env-set <svc> KEY=VAL [KEY=VAL…] [--yes]");
    const svc = a._.find((x) => !x.includes("="));
    if (!svc) usage("informe o serviço (ex.: api, painel, caddy)");
    if (DATA.has(svc!)) fail(`recusado: '${svc}' é serviço de dados`, { refused: true });
    const keys = kvs.map((kv) => kv.slice(0, kv.indexOf("=")));
    if (!yes(a)) needConfirm({ action: "env-set", svc, keys });
    // upsert de cada KEY no .env do hub (backup antes), depois recria o serviço.
    const envPath = `${cfg.paths.controlCompose}/.env`;
    const seds = kvs
      .map((kv) => {
        const k = kv.slice(0, kv.indexOf("="));
        return `grep -q '^${k}=' ${envPath} && sed -i -E ${shq(`s#^${escSed(k)}=.*#${escSed(kv)}#`)} ${envPath} || echo ${shq(kv)} >> ${envPath}`;
      })
      .join("; ");
    const r = await sh(control, `cp ${envPath} ${envPath}.bak-jamees && { ${seds}; } && cd ${cfg.paths.controlCompose} && docker compose -f ${cfg.paths.composeFile} --env-file .env up -d ${shq(svc!)}`, { timeoutMs: 120_000 });
    if (r.code !== 0) fail("env-set falhou", { step: "apply", tail: tail(r.err || r.out) });
    return ok({ svc, changed: keys, recreated: true });
  }
  usage(`subcomando de containers desconhecido: ${sub}`, { valid: ["ps", "logs", "restart", "recreate", "env-set"] });
}

function escSed(s: string): string {
  return s.replace(/[#&]/g, "\\$&");
}
