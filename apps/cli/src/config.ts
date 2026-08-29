import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { CONFIG_PATH, ensureHome } from "./lib/paths.js";
import { sh } from "./lib/ssh.js";
import { fail } from "./lib/out.js";

export interface NodeCfg {
  ssh: string; // alvo ssh (ex.: root@184..., server-local@10.100.0.3)
  agent: string; // agentUrl (ex.: http://10.100.0.4:4100)
  publicHost?: string;
  httpHost?: string;
  region?: string;
}

export interface Config {
  project: string; // nome do projeto compose (velozplanel-control)
  hosts: {
    control: { ssh: string; wg: string }; // hub (187 / 10.100.0.1)
    build: { ssh: string; wg: string }; // build host (184 / 10.100.0.4)
  };
  nodes: Record<string, NodeCfg>;
  apiInternal: string; // http://10.100.0.1:4000
  paths: {
    srcLocal: string;
    siteLocal: string;
    srcRemote: string;
    siteRemote: string;
    controlCompose: string;
    composeFile: string;
  };
  tokens: { internal: string }; // VP_INTERNAL_TOKEN (serve x-internal-token e x-agent-token)
  dbRole: { velozpanel: string; pdns: string }; // role Postgres somente-leitura dedicado
  db: { superUser: string; velozpanel: string; pdns: string; postgresService: string };
}

/** Defaults de bootstrap (fatos estáveis; o resto vem do prod no `config init`). */
const DEFAULTS = {
  project: "velozplanel-control",
  controlSsh: "root@187.127.49.205",
  buildSsh: "root@184.107.115.183",
  controlWg: "10.100.0.1",
  buildWg: "10.100.0.4",
  apiInternal: "http://10.100.0.1:4000",
  controlCompose: "/opt/velozplanel/control-plane",
  composeFile: "docker-compose.prod.yml",
  srcRemote: "/opt/velozplanel-src",
  siteRemote: "/opt/jamees-site-src",
  siteLocal: "/Users/tiago.agenor/www/jamees-site",
  roRole: "jamees_ro",
  postgresService: "postgres",
};

/** Alvo ssh de cada nó, por nome (fatos da infra; sobrescrevível no config). */
function nodeSshFor(name: string, wgHost: string): string {
  if (name === "sp-local") return "server-local@10.100.0.3";
  if (name === "ca-remoto") return "root@184.107.115.183";
  // fallback: root@<host do agentUrl> (nó público) — ajuste no config se preciso.
  return `root@${wgHost}`;
}

export function configExists(): boolean {
  return existsSync(CONFIG_PATH);
}

/** Carrega e valida permissão (recusa se legível por grupo/outros). */
export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    fail("config ausente", { hint: "rode `jamees config init`", needsConfig: true });
  }
  const st = statSync(CONFIG_PATH);
  if (st.mode & 0o077) {
    fail("permissão do config insegura", { hint: `chmod 600 ${CONFIG_PATH}` });
  }
  let cfg: Config;
  try {
    cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Config;
  } catch (e) {
    return fail("config inválido (JSON)", { detail: e instanceof Error ? e.message : String(e) });
  }
  // Fallback do token por variável de ambiente de mesmo nome.
  if (!cfg.tokens?.internal && process.env.VP_INTERNAL_TOKEN) {
    cfg.tokens = { internal: process.env.VP_INTERNAL_TOKEN };
  }
  return cfg;
}

export function saveConfig(cfg: Config): void {
  ensureHome();
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

/** Mascara tokens para `config show`. */
export function masked(cfg: Config): Config {
  const c = JSON.parse(JSON.stringify(cfg)) as Config;
  if (c.tokens?.internal) c.tokens.internal = mask(c.tokens.internal);
  return c;
}

function mask(s: string): string {
  if (!s) return "";
  return s.length <= 8 ? "****" : `${s.slice(0, 4)}…${s.slice(-2)}`;
}

/**
 * Semeia o config lendo valores REAIS do prod (nunca hardcode de faixa WG):
 *  - VP_INTERNAL_TOKEN, POSTGRES_USER/DB do .env do hub;
 *  - tabela nodes (name, region, agent_url, public_host, http_host) via psql.
 */
export async function initConfig(localSrc: string): Promise<{ cfg: Config; warnings: string[] }> {
  const warnings: string[] = [];
  const control = DEFAULTS.controlSsh;
  const compose = `${DEFAULTS.controlCompose}`;

  // 1) .env do hub.
  const envRes = await sh(control, `cat ${compose}/.env 2>/dev/null`);
  if (envRes.code !== 0) fail("não consegui ler o .env do hub", { detail: envRes.err.slice(0, 300), target: control });
  const env = parseEnv(envRes.out);
  const token = env["VP_INTERNAL_TOKEN"] ?? process.env.VP_INTERNAL_TOKEN ?? "";
  if (!token) warnings.push("VP_INTERNAL_TOKEN não encontrado no .env do hub — comandos HTTP ficarão sem token");
  const pgUser = env["POSTGRES_USER"] ?? "veloz";
  const pgDb = env["POSTGRES_DB"] ?? "velozpanel";

  // 2) tabela nodes via psql (superuser; RO role pode ainda não existir no init).
  const q = "select name, coalesce(region,''), coalesce(agent_url,''), coalesce(public_host,''), coalesce(http_host,'') from nodes order by name";
  const nres = await sh(
    control,
    `cd ${compose} && docker compose -f ${DEFAULTS.composeFile} exec -T ${DEFAULTS.postgresService} psql -U ${pgUser} -d ${pgDb} -tAF'|' -c "${q}"`,
  );
  const nodes: Record<string, NodeCfg> = {};
  if (nres.code === 0) {
    for (const line of nres.out.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      const [name, region, agentUrl, publicHost, httpHost] = t.split("|");
      if (!name) continue;
      const wgHost = (agentUrl ?? "").replace(/^https?:\/\//, "").split(":")[0] ?? "";
      nodes[name] = {
        ssh: nodeSshFor(name, wgHost || publicHost || ""),
        agent: agentUrl || (wgHost ? `http://${wgHost}:4100` : ""),
        publicHost: publicHost || undefined,
        httpHost: httpHost || undefined,
        region: region || undefined,
      };
    }
  } else {
    warnings.push("não consegui ler a tabela nodes — preencha `nodes` no config manualmente");
  }

  const cfg: Config = {
    project: DEFAULTS.project,
    hosts: {
      control: { ssh: control, wg: DEFAULTS.controlWg },
      build: { ssh: DEFAULTS.buildSsh, wg: DEFAULTS.buildWg },
    },
    nodes,
    apiInternal: DEFAULTS.apiInternal,
    paths: {
      srcLocal: localSrc,
      siteLocal: DEFAULTS.siteLocal,
      srcRemote: DEFAULTS.srcRemote,
      siteRemote: DEFAULTS.siteRemote,
      controlCompose: DEFAULTS.controlCompose,
      composeFile: DEFAULTS.composeFile,
    },
    tokens: { internal: token },
    dbRole: { velozpanel: DEFAULTS.roRole, pdns: DEFAULTS.roRole },
    db: { superUser: pgUser, velozpanel: pgDb, pdns: "pdns", postgresService: DEFAULTS.postgresService },
  };
  return { cfg, warnings };
}

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i === -1) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}
