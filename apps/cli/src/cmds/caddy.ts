import { readFileSync } from "node:fs";
import type { Config } from "../config.js";
import { type Args, opt, yes } from "../lib/args.js";
import { ok, fail, needConfirm, usage, tail } from "../lib/out.js";
import { sh, shq } from "../lib/ssh.js";
import { newLogId, writeLog } from "../lib/logs.js";
import { splitBlocks, findByHost, upsertBlock } from "../lib/caddyfile.js";

function caddyfilePath(cfg: Config): string {
  return `${cfg.paths.controlCompose}/Caddyfile`;
}
const CADDY_CONTAINER = "caddy"; // serviço no compose

/** Lê o Caddyfile atual do hub. */
async function readCaddyfile(cfg: Config): Promise<string> {
  const r = await sh(cfg.hosts.control.ssh, `cat ${caddyfilePath(cfg)}`);
  if (r.code !== 0) fail("não consegui ler o Caddyfile", { tail: tail(r.err) });
  return r.out;
}

/** Valida um candidato, faz backup, aplica preservando inode e recarrega. Restaura em falha. */
export async function applyCaddyfile(cfg: Config, candidate: string): Promise<{ validated: boolean; reloaded: boolean; restored?: boolean; err?: string }> {
  const control = cfg.hosts.control.ssh;
  const path = caddyfilePath(cfg);
  // 1) grava candidato em /tmp e valida DENTRO do container (config completo)
  const tmp = "/tmp/Caddyfile.jamees";
  const wr = await sh(control, `cat > ${tmp}`, { input: candidate });
  if (wr.code !== 0) return { validated: false, reloaded: false, err: wr.err };
  const val = await sh(control, `docker compose -f ${cfg.paths.composeFile} -p ${cfg.project} cp ${tmp} ${CADDY_CONTAINER}:/tmp/Caddyfile.jamees 2>/dev/null; cd ${cfg.paths.controlCompose} && docker compose -f ${cfg.paths.composeFile} exec -T ${CADDY_CONTAINER} caddy validate --adapter caddyfile --config /tmp/Caddyfile.jamees`);
  if (val.code !== 0) return { validated: false, reloaded: false, err: val.err || val.out };
  // 2) backup + aplica preservando inode (mount :ro de arquivo único) + reload
  const apply = await sh(control, `cp ${path} ${path}.bak-jamees && cat ${tmp} > ${path} && cd ${cfg.paths.controlCompose} && docker compose -f ${cfg.paths.composeFile} exec -T ${CADDY_CONTAINER} caddy reload --adapter caddyfile --config /etc/caddy/Caddyfile`);
  if (apply.code !== 0) {
    // restaura backup e recarrega
    await sh(control, `cat ${path}.bak-jamees > ${path} && cd ${cfg.paths.controlCompose} && docker compose -f ${cfg.paths.composeFile} exec -T ${CADDY_CONTAINER} caddy reload --adapter caddyfile --config /etc/caddy/Caddyfile`);
    return { validated: true, reloaded: false, restored: true, err: apply.err || apply.out };
  }
  return { validated: true, reloaded: true };
}

export async function caddy(sub: string, a: Args, cfg: Config): Promise<void> {
  if (sub === "get") {
    const src = await readCaddyfile(cfg);
    const site = opt(a, "site");
    if (site) {
      const b = findByHost(splitBlocks(src), site);
      if (!b) return fail("bloco não encontrado", { site });
      return ok({ site, block: b.text });
    }
    if (src.length > 4000) {
      const logId = newLogId("caddy");
      writeLog(logId, src);
      return ok({ bytes: src.length, logId, hint: "use --site <host> para um bloco, ou `jamees logs pull --id <logId>`" });
    }
    return ok({ bytes: src.length, caddyfile: src });
  }

  if (sub === "set") {
    const site = opt(a, "site");
    const blockArg = opt(a, "block");
    if (!site || !blockArg) usage("uso: jamees caddy set --site <host> --block <arquivo|-> [--yes]");
    const blockText = blockArg === "-" ? readFileSync(0, "utf8") : readFileSync(blockArg!, "utf8");
    const src = await readCaddyfile(cfg);
    const target = findByHost(splitBlocks(src), site!);
    const candidate = upsertBlock(src, target, blockText);
    if (!yes(a)) needConfirm({ action: "caddy set", site, mode: target ? "replace" : "append", newBlockBytes: blockText.length });
    const res = await applyCaddyfile(cfg, candidate);
    if (!res.reloaded) return fail("caddy set falhou", { site, ...res });
    return ok({ site, validated: res.validated, reloaded: res.reloaded, backedUp: true });
  }

  if (sub === "reload") {
    if (!yes(a)) needConfirm({ action: "caddy reload" });
    const r = await sh(cfg.hosts.control.ssh, `cd ${cfg.paths.controlCompose} && docker compose -f ${cfg.paths.composeFile} exec -T ${CADDY_CONTAINER} sh -lc 'caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile && caddy reload --adapter caddyfile --config /etc/caddy/Caddyfile'`);
    if (r.code !== 0) return fail("reload falhou", { tail: tail(r.err || r.out) });
    return ok({ validated: true, reloaded: true });
  }

  usage(`subcomando de caddy desconhecido: ${sub}`, { valid: ["get", "set", "reload"] });
}
