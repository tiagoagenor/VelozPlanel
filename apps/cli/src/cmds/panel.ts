import { execFile } from "node:child_process";
import type { Config } from "../config.js";
import { type Args, yes } from "../lib/args.js";
import { ok, fail, needConfirm, usage, tail } from "../lib/out.js";
import { sh, shq } from "../lib/ssh.js";
import { splitBlocks, findByBody, upsertBlock } from "../lib/caddyfile.js";
import { applyCaddyfile } from "./caddy.js";

/** Bloco do painel para um host (mesma forma do atual: internal 403, /api, painel). */
function panelBlock(host: string): string {
  return `${host} {
	encode gzip zstd
	handle /api/v1/internal/* {
		respond 403
	}
	handle /api/* {
		reverse_proxy api:4000
	}
	handle {
		reverse_proxy painel:3000
	}
}`;
}

function curlCode(url: string): Promise<number> {
  return new Promise((resolve) => {
    execFile("curl", ["-sk", "-o", "/dev/null", "-w", "%{http_code}", "-m", "12", url], { timeout: 15_000 }, (_e, out) => resolve(Number((out ?? "").trim()) || 0));
  });
}

export async function panel(sub: string, a: Args, cfg: Config): Promise<void> {
  if (sub !== "set-domain") usage(`subcomando de panel desconhecido: ${sub}`, { valid: ["set-domain"] });
  const host = a._[0];
  if (!host) usage("uso: jamees panel set-domain <host> [--yes]");

  // 1) plano: qual bloco do painel será trocado
  const control = cfg.hosts.control.ssh;
  const src = (await sh(control, `cat ${cfg.paths.controlCompose}/Caddyfile`)).out;
  const cur = findByBody(splitBlocks(src), "painel:3000");
  if (!yes(a)) {
    needConfirm({
      action: "panel set-domain",
      host,
      caddy: cur ? { replaceHeader: cur.header } : "append",
      origins: `VP_PANEL_ORIGINS=https://${host}`,
      note: "o DNS do domínio do painel costuma estar no Cloudflare (não no PowerDNS) — aponte o A → IP do hub por lá se necessário",
    });
  }

  // 2) Caddy: troca o bloco do painel pelo novo host
  const candidate = upsertBlock(src, cur, panelBlock(host!));
  const cad = await applyCaddyfile(cfg, candidate);
  if (!cad.reloaded) return fail("panel set-domain: Caddy falhou", { host, step: "caddy", ...cad });

  // 3) VP_PANEL_ORIGINS + recria o painel
  const envPath = `${cfg.paths.controlCompose}/.env`;
  const line = `VP_PANEL_ORIGINS=https://${host}`;
  const e = await sh(
    control,
    `cp ${envPath} ${envPath}.bak-jamees && (grep -q '^VP_PANEL_ORIGINS=' ${envPath} && sed -i -E ${shq(`s#^VP_PANEL_ORIGINS=.*#${line}#`)} ${envPath} || echo ${shq(line)} >> ${envPath}) && cd ${cfg.paths.controlCompose} && docker compose -f ${cfg.paths.composeFile} --env-file .env up -d painel`,
    { timeoutMs: 120_000 },
  );
  if (e.code !== 0) return fail("panel set-domain: origins/recreate falhou", { host, step: "origins", tail: tail(e.err || e.out), caddy: { reloaded: true } });

  // 4) confirma TLS (cert ACME pode demorar)
  let tlsCode = 0;
  for (let i = 0; i < 4; i++) {
    tlsCode = await curlCode(`https://${host}/login`);
    if (tlsCode >= 200 && tlsCode < 500) break;
    await new Promise((r) => setTimeout(r, 4000));
  }
  const tlsOk = tlsCode >= 200 && tlsCode < 500;
  return ok({
    host,
    caddy: { reloaded: true },
    origins: { ok: true },
    tls: tlsOk ? { ok: true, code: tlsCode } : { pending: true, code: tlsCode },
    tlsPending: !tlsOk,
    hint: tlsOk ? undefined : "cert ACME ainda não emitido; confira o A no DNS e tente `curl https://" + host + "/login`",
  });
}
