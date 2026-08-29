#!/usr/bin/env node
import { parseArgs } from "./lib/args.js";
import { emit, fail } from "./lib/out.js";
import { loadConfig } from "./config.js";

const GROUPS = ["deploy", "dns", "nodes", "db", "containers", "caddy", "env", "panel", "status", "billing", "config", "logs", "version", "help"];

async function main(): Promise<void> {
  const raw = process.argv.slice(2);
  const group = raw[0];
  const sub = raw[1] ?? "";
  const a = parseArgs(raw.slice(2));

  if (!group || group === "help" || group === "--help" || group === "-h") {
    return emit({ ok: true, jamees: "CLI de operações", groups: GROUPS.filter((g) => g !== "help"), hint: "ex.: jamees status · jamees deploy api --yes · jamees dns get <zona>" });
  }
  if (group === "version") {
    return emit({ ok: true, cli: "0.1.0", configVersion: 1 });
  }

  // config e logs não exigem config carregado (init/pull são locais)
  if (group === "config") {
    const { configCmd } = await import("./cmds/configcmd.js");
    return configCmd(sub, a);
  }
  if (group === "logs") {
    const { logsCmd } = await import("./cmds/logscmd.js");
    return logsCmd(sub, a);
  }

  const cfg = loadConfig();
  switch (group) {
    case "deploy": {
      const { deploy } = await import("./cmds/deploy.js");
      return deploy(sub, a, cfg);
    }
    case "dns": {
      const { dns } = await import("./cmds/dns.js");
      return dns(sub, a, cfg);
    }
    case "nodes": {
      const { nodes } = await import("./cmds/nodes.js");
      return nodes(sub, a, cfg);
    }
    case "db": {
      const { db } = await import("./cmds/db.js");
      return db(sub, a, cfg);
    }
    case "containers": {
      const { containers } = await import("./cmds/containers.js");
      return containers(sub, a, cfg);
    }
    case "caddy": {
      const { caddy } = await import("./cmds/caddy.js");
      return caddy(sub, a, cfg);
    }
    case "env": {
      const { env } = await import("./cmds/env.js");
      return env(sub, a, cfg);
    }
    case "panel": {
      const { panel } = await import("./cmds/panel.js");
      return panel(sub, a, cfg);
    }
    case "status": {
      const { status } = await import("./cmds/status.js");
      return status(sub, a, cfg);
    }
    case "billing": {
      const { status } = await import("./cmds/status.js");
      return status("billing", a, cfg);
    }
    default:
      return fail(`grupo desconhecido: ${group}`, { groups: GROUPS }, 2);
  }
}

main().catch((e: unknown) => {
  emit({ ok: false, error: "erro inesperado", detail: e instanceof Error ? e.message : String(e) }, 1);
});
