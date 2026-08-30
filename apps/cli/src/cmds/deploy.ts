import type { Config } from "../config.js";
import { type Args, flag, opt, yes } from "../lib/args.js";
import { ok, fail, needConfirm, usage, tail } from "../lib/out.js";
import { sh, rsync, shq } from "../lib/ssh.js";
import { localSh } from "../lib/local.js";
import { composeCmd, currentImageId, tagImage, pollHealth } from "../lib/docker.js";
import { parseSchema, diffColumns } from "../lib/schema.js";
import { newLogId, writeLog } from "../lib/logs.js";
import { recordDeploy, loadState } from "../lib/state.js";

interface Svc {
  image: string;
  build: (cfg: Config) => string; // comando de build no build host
  rsync: (cfg: Config) => { local: string; remote: string; excludes: string[] };
  port: number;
  schema: boolean;
}

const SRC_EXCLUDES = [".git", "node_modules", "**/node_modules", ".next", "**/.next", "dist", "**/dist", "Plan"];
const SITE_EXCLUDES = [".git", "node_modules", ".next", ".plan", "tsconfig.tsbuildinfo"];

const SVCS: Record<string, Svc> = {
  api: {
    image: "velozplanel/api:prod",
    build: (c) => `cd ${c.paths.srcRemote} && docker build -q -f apps/api/Dockerfile -t velozplanel/api:prod .`,
    rsync: (c) => ({ local: c.paths.srcLocal, remote: c.paths.srcRemote, excludes: SRC_EXCLUDES }),
    port: 4000,
    schema: true,
  },
  painel: {
    image: "velozplanel/painel:prod",
    build: (c) => `cd ${c.paths.srcRemote} && docker build -q -f apps/painel/Dockerfile --build-arg NEXT_PUBLIC_API_URL=/api/v1 -t velozplanel/painel:prod .`,
    rsync: (c) => ({ local: c.paths.srcLocal, remote: c.paths.srcRemote, excludes: SRC_EXCLUDES }),
    port: 3000,
    schema: false,
  },
  site: {
    image: "velozplanel/site:prod",
    build: (c) => `cd ${c.paths.siteRemote} && docker build -q -t velozplanel/site:prod .`,
    rsync: (c) => ({ local: c.paths.siteLocal, remote: c.paths.siteRemote, excludes: SITE_EXCLUDES }),
    port: 3000,
    schema: false,
  },
};

export async function deploy(sub: string, a: Args, cfg: Config): Promise<void> {
  if (sub === "status") return deployStatus(cfg);
  if (sub === "schema") return deploySchema(a, cfg);
  if (sub === "agent") return deployAgent(a, cfg);
  if (flag(a, "rollback")) return rollback(sub, cfg);
  const svc = SVCS[sub];
  if (!svc) usage(`serviço desconhecido: ${sub}`, { valid: ["api", "painel", "site", "agent", "schema", "status"] });

  if (!yes(a)) {
    needConfirm({ action: "deploy", service: sub, image: svc.image, schema: svc.schema && flag(a, "schema"), steps: ["rsync", "build", "drift-check", "tag :prev", "load", svc.schema && flag(a, "schema") ? "db:push" : null, "recreate", "health"].filter(Boolean) });
  }

  const logId = newLogId(`deploy-${sub}`);
  let buffer = "";
  const t0 = Date.now();
  const control = cfg.hosts.control.ssh;
  const build = cfg.hosts.build.ssh;

  // 1) rsync
  const rs = svc.rsync(cfg);
  const rsRes = await rsync(rs.local, build, rs.remote, rs.excludes);
  buffer += `# rsync\n${rsRes.out}\n${rsRes.err}\n`;
  if (rsRes.code !== 0) fail("rsync falhou", { step: "rsync", tail: tail(rsRes.err || rsRes.out), logId: writeLogId(logId, buffer) });

  // 2) build
  const tb = Date.now();
  const bRes = await sh(build, svc.build(cfg), { timeoutMs: 900_000 });
  buffer += `# build\n${bRes.out}\n${bRes.err}\n`;
  if (bRes.code !== 0) fail("build falhou", { step: "build", tail: tail(bRes.err || bRes.out), logId: writeLogId(logId, buffer) });
  const builtSec = Math.round((Date.now() - tb) / 1000);

  // 3) drift-check (SÓ api, ANTES do load — issue ALTA-2)
  let driftColumns: string[] = [];
  let schemaPushed = false;
  if (svc.schema) {
    driftColumns = await driftCheck(cfg);
    if (driftColumns.length && !flag(a, "schema")) {
      fail("schema desatualizado — deploy abortado antes de carregar a imagem", {
        step: "drift-check",
        needsSchema: true,
        driftColumns,
        recreated: false,
        hint: "rode `jamees deploy api --schema` (aplica push-and-seed) ou `jamees deploy schema`",
        logId: writeLogId(logId, buffer),
      });
    }
  }

  // 4) preserva a imagem anterior como :prev (por IMAGE ID)
  const prevImageId = await currentImageId(cfg, sub);
  if (prevImageId) await tagImage(cfg, prevImageId, `${svc.image.split(":")[0]}:prev`);

  // 5) load (pipe build -> hub, pelo Mac)
  const tl = Date.now();
  const loadRes = await localSh(`ssh -n -o BatchMode=yes -o ConnectTimeout=12 ${build} 'docker save ${svc.image}' | ssh -o BatchMode=yes -o ConnectTimeout=12 ${control} 'docker load'`);
  buffer += `# load\n${loadRes.out}\n${loadRes.err}\n`;
  if (loadRes.code !== 0) fail("transferência da imagem falhou", { step: "load", tail: tail(loadRes.err || loadRes.out), logId: writeLogId(logId, buffer) });
  const loadedSec = Math.round((Date.now() - tl) / 1000);
  const newImageId = (await sh(control, `docker image inspect -f '{{.Id}}' ${shq(svc.image)}`)).out.trim();
  recordDeploy(sub, newImageId, prevImageId, new Date().toISOString());

  // 6) recreate (ANTES do db:push, senão o push rodaria no container ANTIGO)
  const rc = await sh(control, `${composeCmd(cfg)} up -d --force-recreate ${shq(sub)}`, { timeoutMs: 120_000 });
  buffer += `# recreate\n${rc.out}\n${rc.err}\n`;
  if (rc.code !== 0) fail("recreate falhou", { step: "recreate", tail: tail(rc.err || rc.out), logId: writeLogId(logId, buffer) });

  // 7) db:push (se --schema) — no container NOVO, então roda o push-and-seed novo
  if (svc.schema && flag(a, "schema")) {
    const ps = await sh(control, `${composeCmd(cfg)} exec -T api pnpm exec tsx src/db/push-and-seed.ts`, { timeoutMs: 180_000 });
    buffer += `# db:push\n${ps.out}\n${ps.err}\n`;
    if (ps.code !== 0) fail("db:push falhou", { step: "db:push", tail: tail(ps.err || ps.out), logId: writeLogId(logId, buffer) });
    schemaPushed = true;
    driftColumns = await driftCheck(cfg); // revalida
  }

  // 8) health por poll (a não ser --no-health)
  if (flag(a, "no-health")) {
    return ok({ service: sub, imageId: newImageId, prevImageId, builtSec, loadedSec, schemaPushed, driftColumns, recreated: true, health: { skipped: true }, rolledBack: false, sec: sec(t0), logId: writeLogId(logId, buffer) });
  }
  const h = await pollHealth(cfg, sub, svc.port);
  if (h.state === "unhealthy" || h.state === "exited") {
    // AUTO-ROLLBACK: re-tag prev -> :prod e recria
    let rolledBack = false;
    if (prevImageId) {
      await tagImage(cfg, prevImageId, svc.image);
      const rb = await sh(control, `${composeCmd(cfg)} up -d --force-recreate ${shq(sub)}`, { timeoutMs: 120_000 });
      buffer += `# rollback\n${rb.out}\n${rb.err}\n`;
      rolledBack = rb.code === 0;
    }
    fail(`deploy sem saúde (${h.state}) — rollback ${rolledBack ? "aplicado" : "indisponível"}`, {
      step: "health",
      service: sub,
      health: h,
      rolledBack,
      tail: tail(buffer),
      logId: writeLogId(logId, buffer),
    });
  }
  if (h.state === "starting") {
    // ambíguo: NUNCA rollback automático
    fail("saúde inconclusiva (ainda 'starting' no deadline)", {
      step: "health",
      service: sub,
      health: h,
      rolledBack: false,
      needsManualCheck: true,
      hint: "confira `jamees containers ps` — pode só ter demorado",
      logId: writeLogId(logId, buffer),
    });
  }
  ok({ service: sub, imageId: newImageId, prevImageId, builtSec, loadedSec, schemaPushed, driftColumns, recreated: true, health: h, rolledBack: false, sec: sec(t0), logId: writeLogId(logId, buffer) });
}

async function driftCheck(cfg: Config): Promise<string[]> {
  const schema = parseSchema(cfg.paths.srcLocal);
  const q = "select table_name||'|'||column_name from information_schema.columns where table_schema='public'";
  const r = await sh(cfg.hosts.control.ssh, `${composeCmd(cfg)} exec -T ${cfg.db.postgresService} psql -U ${cfg.db.superUser} -d ${cfg.db.velozpanel} -tA -c ${shq(q)}`);
  const dbCols: Record<string, Set<string>> = {};
  for (const line of r.out.split(/\r?\n/)) {
    const [t, c] = line.trim().split("|");
    if (!t || !c) continue;
    (dbCols[t] ??= new Set()).add(c);
  }
  return diffColumns(schema, dbCols);
}

async function deploySchema(a: Args, cfg: Config): Promise<void> {
  if (flag(a, "check")) {
    const drift = await driftCheck(cfg);
    return ok({ mode: "check", driftColumns: drift, warning: drift.length ? "há colunas no schema.ts ausentes no banco" : undefined });
  }
  if (!yes(a) && !flag(a, "dry")) needConfirm({ action: "deploy schema", does: "roda push-and-seed.ts (idempotente) no hub" });
  if (flag(a, "dry")) return ok({ mode: "dry", hint: "push-and-seed é idempotente; use --check para ver drift" });
  const ps = await sh(cfg.hosts.control.ssh, `${composeCmd(cfg)} exec -T api pnpm exec tsx src/db/push-and-seed.ts`, { timeoutMs: 180_000 });
  const logId = newLogId("schema");
  writeLog(logId, ps.out + "\n" + ps.err);
  if (ps.code !== 0) fail("db:push falhou", { step: "db:push", tail: tail(ps.err || ps.out), logId });
  const drift = await driftCheck(cfg);
  ok({ applied: true, driftColumns: drift, logId });
}

async function deployStatus(cfg: Config): Promise<void> {
  const state = loadState();
  const services = [];
  for (const name of ["api", "painel", "site"]) {
    const running = await currentImageId(cfg, name);
    const st = state.deploys[name];
    services.push({
      name,
      runningImageId: short(running),
      deployedImageId: short(st?.imageId ?? null),
      prevImageId: short(st?.prevImageId ?? null),
      imageDrift: !!(st && running && st.imageId !== running),
      canRollback: !!st?.prevImageId,
      lastDeployAt: st?.lastDeployAt ?? null,
    });
  }
  const driftColumns = await driftCheck(cfg);
  ok({ services, driftColumns, warning: driftColumns.length ? "schema.ts tem colunas ausentes no banco — rode `jamees deploy schema`" : undefined });
}

async function rollback(sub: string, cfg: Config): Promise<void> {
  const svc = SVCS[sub];
  if (!svc) usage(`rollback: serviço inválido ${sub}`);
  const st = loadState().deploys[sub];
  if (!st?.prevImageId) fail("sem imagem anterior para rollback", { service: sub, canRollback: false });
  await tagImage(cfg, st!.prevImageId!, svc!.image);
  const rb = await sh(cfg.hosts.control.ssh, `${composeCmd(cfg)} up -d --force-recreate ${shq(sub)}`, { timeoutMs: 120_000 });
  if (rb.code !== 0) fail("rollback: recreate falhou", { step: "recreate", tail: tail(rb.err || rb.out) });
  const h = await pollHealth(cfg, sub, svc!.port);
  ok({ service: sub, rolledBackTo: short(st!.prevImageId), health: h });
}

async function deployAgent(a: Args, cfg: Config): Promise<void> {
  const nodeArg = opt(a, "node") ?? "all";
  const names = nodeArg === "all" ? Object.keys(cfg.nodes) : [nodeArg];
  if (!names.length) usage("nenhum nó definido no config", { hint: "rode `jamees config init`" });
  for (const n of names) if (!cfg.nodes[n]) usage(`nó desconhecido: ${n}`, { valid: Object.keys(cfg.nodes) });
  if (!yes(a)) needConfirm({ action: "deploy agent", nodes: names });

  const build = cfg.hosts.build.ssh;
  const logId = newLogId("deploy-agent");
  let buffer = "";
  // 0) rsync do código local -> host de build (senão o build usa código velho de srcRemote)
  const rsRes = await rsync(cfg.paths.srcLocal, build, cfg.paths.srcRemote, SRC_EXCLUDES);
  buffer += `# rsync\n${rsRes.out}\n${rsRes.err}\n`;
  if (rsRes.code !== 0) fail("rsync falhou", { step: "rsync", tail: tail(rsRes.err || rsRes.out), logId: writeLogId(logId, buffer) });
  // build 1x
  const bRes = await sh(build, `cd ${cfg.paths.srcRemote} && docker build -q -f apps/agent/Dockerfile -t velozplanel/agent:prod .`, { timeoutMs: 900_000 });
  buffer += `# build\n${bRes.out}\n${bRes.err}\n`;
  if (bRes.code !== 0) fail("build do agente falhou", { step: "build", tail: tail(bRes.err || bRes.out), logId: writeLogId(logId, buffer) });

  const results = [];
  const scriptPath = `${cfg.paths.srcLocal}/scripts/update-agent.sh`;
  for (const n of names) {
    const node = cfg.nodes[n]!;
    // load build -> nó
    const load = await localSh(`ssh -n -o BatchMode=yes ${build} 'docker save velozplanel/agent:prod' | ssh -o BatchMode=yes ${node.ssh} 'docker load'`);
    buffer += `# load ${n}\n${load.out}\n${load.err}\n`;
    if (load.code !== 0) {
      results.push({ node: n, ok: false, step: "load", tail: tail(load.err) });
      continue;
    }
    // update-agent.sh via stdin (rollback+health próprios)
    const up = await localSh(`ssh -o BatchMode=yes ${node.ssh} 'bash -s' < ${scriptPath}`, 180_000);
    buffer += `# update ${n}\n${up.out}\n${up.err}\n`;
    const health = await import("../lib/http.js").then((m) => m.httpJson(`${node.agent}/health`, { timeoutMs: 8000 }));
    results.push({ node: n, ok: up.code === 0 && health.ok, health: { ok: health.ok }, tail: up.code === 0 ? undefined : tail(up.err) });
  }
  const allOk = results.every((r) => r.ok);
  const payload = { ok: allOk, service: "agent", results, sec: 0, logId: writeLogId(logId, buffer) };
  if (!allOk) fail("um ou mais nós falharam", payload);
  ok(payload);
}

function writeLogId(logId: string, buffer: string): string {
  writeLog(logId, buffer);
  return logId;
}
function short(id: string | null): string | null {
  return id ? id.replace(/^sha256:/, "").slice(0, 12) : null;
}
function sec(t0: number): number {
  return Math.round((Date.now() - t0) / 1000);
}
