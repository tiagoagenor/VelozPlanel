import type { Config } from "../config.js";
import { type Args, opt } from "../lib/args.js";
import { ok, fail, usage } from "../lib/out.js";
import { sh, shq } from "../lib/ssh.js";
import { composeCmd } from "../lib/docker.js";
import { newLogId, writeLog } from "../lib/logs.js";

const DBS: Record<string, string> = { velozpanel: "velozpanel", pdns: "pdns" };
const READ_ONLY = /^\s*(select|with|explain)\b/i;

/** psql como ROLE somente-leitura + sessão read-only + statement_timeout. */
function psql(cfg: Config, dbKey: string, sqlOrArgs: string): string {
  const db = DBS[dbKey]!;
  const role = dbKey === "pdns" ? cfg.dbRole.pdns : cfg.dbRole.velozpanel;
  return `${composeCmd(cfg)} exec -T -e PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=15000' ${cfg.db.postgresService} psql -U ${role} -d ${db} ${sqlOrArgs}`;
}

export async function db(sub: string, a: Args, cfg: Config): Promise<void> {
  const dbKey = opt(a, "db");
  if (!dbKey || !DBS[dbKey]) usage("uso: --db <velozpanel|pdns>", { valid: Object.keys(DBS) });

  if (sub === "tables") {
    const q = "select table_schema, table_name from information_schema.tables where table_schema not in ('pg_catalog','information_schema') order by 1,2";
    const r = await sh(cfg.hosts.control.ssh, psql(cfg, dbKey!, `-tA -F '|' -c ${shq(q)}`));
    if (r.code !== 0) return failPsql(r, dbKey!);
    const tables = r.out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const [schema, name] = l.split("|");
      return { schema, name };
    });
    return ok({ db: dbKey, tables });
  }

  if (sub === "query") {
    const raw = opt(a, "sql");
    if (!raw) usage('uso: jamees db query --db <..> --sql "SELECT …" [--limit N]');
    const sql = raw!.trim().replace(/;\s*$/, "");
    if (!READ_ONLY.test(sql)) fail("apenas SELECT/WITH/EXPLAIN são permitidos", { refused: true });
    if (sql.includes(";")) fail("apenas uma instrução (sem ';' interno)", { refused: true });
    const limit = Math.max(1, Math.min(1000, Number(opt(a, "limit") ?? 50)));
    // --csv (header + linhas); head limita as linhas trazidas ao Mac.
    // pipefail: senão o exit code seria o do `head` (0) e mascararia erro do psql.
    const r = await sh(cfg.hosts.control.ssh, `set -o pipefail; ${psql(cfg, dbKey!, `--csv -c ${shq(sql)}`)} | head -n ${limit + 2}`);
    if (r.code !== 0) return failPsql(r, dbKey!);
    const rowsRaw = r.out.replace(/\s+$/, "").split(/\r?\n/).filter((l) => l.length > 0);
    if (!rowsRaw.length) return ok({ db: dbKey, columns: [], rowCount: 0, rows: [], truncated: false });
    const columns = parseCsvLine(rowsRaw[0]!);
    const dataLines = rowsRaw.slice(1);
    const truncated = dataLines.length > limit;
    const rows = dataLines.slice(0, limit).map((l) => {
      const vals = parseCsvLine(l);
      const o: Record<string, string> = {};
      columns.forEach((c, i) => (o[c] = vals[i] ?? ""));
      return o;
    });
    const out: Record<string, unknown> = { db: dbKey, columns, rowCount: rows.length, rows, truncated };
    if (truncated) {
      const logId = newLogId("query");
      writeLog(logId, r.out);
      out.logId = logId;
    }
    return ok(out);
  }
  usage(`subcomando de db desconhecido: ${sub}`, { valid: ["query", "tables"] });
}

function failPsql(r: { err: string; out: string }, dbKey: string): never {
  const msg = (r.err || r.out).trim();
  const hint = /role .* does not exist|não existe|does not exist/i.test(msg)
    ? "o role somente-leitura não existe — rode a migração (push-and-seed) que cria o jamees_ro"
    : undefined;
  fail("consulta falhou", { db: dbKey, tail: msg.split(/\r?\n/).slice(-8), hint });
}

/** Parser CSV simples (aspas duplas ao estilo Postgres). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
