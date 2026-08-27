/**
 * Introspecção de schema para o Data Studio (IDE). Roda SELECTs read-only via o
 * mesmo executor do Studio (`exec`) e devolve metadados tipados (schema, tabela).
 * Por engine (mysql/mariadb = "mysql", postgres = "pg"). Tolerante a falha: cada
 * sub-consulta é isolada — se uma parte falha (ex.: DDL), o resto ainda volta.
 */
import type {
  DbResult,
  DbSchema,
  DbTableMeta,
  DbColumn,
  DbIndex,
  DbForeignKey,
  DbTrigger,
  DbTableRef,
} from "@velozplanel/contracts";

export type SqlEngine = "mysql" | "mariadb" | "postgres";
/** Executa um SQL read-only e devolve o DbResult. */
export type ExecFn = (sql: string) => Promise<DbResult>;

/** Nome de objeto seguro (sem aspas, backtick, ; — vem do param da rota). */
export function isSafeIdent(name: string): boolean {
  return /^[A-Za-z0-9_$ .-]{1,128}$/.test(name);
}

/** Literal SQL: dobra aspas simples. */
function lit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** DbResult(rows) → array de objetos { coluna: string|null } (binário vira null). */
function rowsToObjects(r: DbResult): Record<string, string | null>[] {
  if (r.kind !== "rows") return [];
  return r.rows.map((row) => {
    const obj: Record<string, string | null> = {};
    r.columns.forEach((col, i) => {
      const cell = row[i];
      obj[col] = typeof cell === "string" ? cell : null; // null | {b,hex} → null
    });
    return obj;
  });
}

const toBool = (v: string | null): boolean => v === "t" || v === "1" || v === "true" || v === "YES";

async function safe(exec: ExecFn, sql: string): Promise<Record<string, string | null>[]> {
  try {
    return rowsToObjects(await exec(sql));
  } catch {
    return [];
  }
}

/* ───────────────────────── Schema (tabelas/views + versão) ───────────────────────── */

export async function introspectSchema(engine: SqlEngine, database: string, exec: ExecFn): Promise<DbSchema> {
  const pg = engine === "postgres";
  const versionSql = pg ? "SELECT current_setting('server_version') AS v" : "SELECT version() AS v";
  const tablesSql = pg
    ? `SELECT c.relname AS name,
              CASE WHEN c.relkind IN ('v','m') THEN 'view' ELSE 'table' END AS type,
              CASE WHEN c.relkind IN ('r','p') THEN c.reltuples::bigint ELSE NULL END AS rows
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = current_schema() AND c.relkind IN ('r','p','v','m')
       ORDER BY (c.relkind IN ('v','m')), c.relname`
    : `SELECT table_name AS name,
              CASE WHEN table_type = 'VIEW' THEN 'view' ELSE 'table' END AS type,
              table_rows AS \`rows\`
       FROM information_schema.tables
       WHERE table_schema = DATABASE()
       ORDER BY (table_type = 'VIEW'), table_name`;

  // Sequencial: o agente permite só 1 consulta por ambiente (lock) — paralelo dá 429.
  const verRows = await safe(exec, versionSql);
  const tblRows = await safe(exec, tablesSql);
  const raw = verRows[0]?.v ?? null;
  const version = raw ? (pg ? `PostgreSQL ${raw}` : raw) : null;
  const tables: DbTableRef[] = tblRows.map((r) => {
    const n = r.rows == null ? null : Number(r.rows);
    return {
      name: r.name ?? "",
      type: r.type === "view" ? "view" : "table",
      rows: n != null && Number.isFinite(n) && n >= 0 ? n : null,
    };
  });
  return { database, engine, version, tables };
}

/* ───────────────────────── Tabela (colunas, PK, índices, FKs, triggers, DDL) ───────────────────────── */

export async function introspectTable(engine: SqlEngine, table: string, exec: ExecFn): Promise<DbTableMeta> {
  const pg = engine === "postgres";
  const t = lit(table);

  // Colunas
  const colsSql = pg
    ? `SELECT column_name AS name,
              CASE
                WHEN character_maximum_length IS NOT NULL THEN udt_name || '(' || character_maximum_length || ')'
                WHEN udt_name IN ('numeric','decimal') AND numeric_precision IS NOT NULL
                     THEN udt_name || '(' || numeric_precision || ',' || COALESCE(numeric_scale, 0) || ')'
                ELSE udt_name
              END AS type,
              is_nullable AS nullable, column_default AS "default"
       FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = ${t}
       ORDER BY ordinal_position`
    : `SELECT column_name AS name, column_type AS type, is_nullable AS nullable,
              column_default AS \`default\`, column_key AS ckey
       FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ${t}
       ORDER BY ordinal_position`;

  // Índices
  const idxSql = pg
    ? `SELECT i.relname AS name, ix.indisunique AS "unique", ix.indisprimary AS "primary",
              (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
                 FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum) AS cols
       FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid
       WHERE ix.indrelid = (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                            WHERE n.nspname = current_schema() AND c.relname = ${t})
       ORDER BY ix.indisprimary DESC, i.relname`
    : `SELECT index_name AS name, (MAX(non_unique) = 0) AS \`unique\`,
              (index_name = 'PRIMARY') AS \`primary\`,
              GROUP_CONCAT(column_name ORDER BY seq_in_index) AS cols
       FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = ${t}
       GROUP BY index_name ORDER BY (index_name = 'PRIMARY') DESC, index_name`;

  // Triggers
  const trgSql = pg
    ? `SELECT DISTINCT trigger_name AS name, action_timing AS timing, event_manipulation AS event
       FROM information_schema.triggers
       WHERE trigger_schema = current_schema() AND event_object_table = ${t}
       ORDER BY trigger_name`
    : `SELECT trigger_name AS name, action_timing AS timing, event_manipulation AS event
       FROM information_schema.triggers
       WHERE trigger_schema = DATABASE() AND event_object_table = ${t}`;

  // Foreign keys
  const fkSql = pg
    ? `SELECT tc.constraint_name AS name, kcu.column_name AS col,
              ccu.table_name AS ref_table, ccu.column_name AS ref_col
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = current_schema() AND tc.table_name = ${t}
       ORDER BY tc.constraint_name`
    : `SELECT constraint_name AS name, column_name AS col,
              referenced_table_name AS ref_table, referenced_column_name AS ref_col
       FROM information_schema.key_column_usage
       WHERE table_schema = DATABASE() AND table_name = ${t} AND referenced_table_name IS NOT NULL
       ORDER BY constraint_name, ordinal_position`;

  const isViewSql = pg
    ? `SELECT table_type AS t FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ${t}`
    : `SELECT table_type AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ${t}`;

  // Sequencial (lock de 1 consulta por ambiente no agente — paralelo dá 429).
  const colRows = await safe(exec, colsSql);
  const idxRows = await safe(exec, idxSql);
  const trgRows = await safe(exec, trgSql);
  const fkRows = await safe(exec, fkSql);
  const typeRows = await safe(exec, isViewSql);

  const indexes: DbIndex[] = idxRows.map((r) => ({
    name: r.name ?? "",
    columns: (r.cols ?? "").split(",").filter(Boolean),
    unique: toBool(r.unique ?? null),
    primary: toBool(r.primary ?? null),
  }));
  const primaryKey = indexes.find((i) => i.primary)?.columns ?? [];
  // colunas de índices únicos de 1 coluna → marca a coluna como unique
  const uniqueCols = new Set(indexes.filter((i) => i.unique && !i.primary && i.columns.length === 1).map((i) => i.columns[0]!));

  const columns: DbColumn[] = colRows.map((r) => {
    const name = r.name ?? "";
    const isPk = pg ? primaryKey.includes(name) : r.ckey === "PRI";
    return {
      name,
      type: r.type ?? "",
      nullable: r.nullable === "YES" || r.nullable === "1",
      default: r.default ?? null,
      isPrimaryKey: isPk,
      isUnique: pg ? uniqueCols.has(name) : r.ckey === "UNI",
    };
  });

  const triggers: DbTrigger[] = trgRows.map((r) => ({
    name: r.name ?? "",
    timing: r.timing ?? "",
    event: r.event ?? "",
  }));

  // Agrupa FKs por constraint_name
  const fkMap = new Map<string, DbForeignKey>();
  for (const r of fkRows) {
    const nm = r.name ?? "";
    const fk = fkMap.get(nm) ?? { name: nm, columns: [], refTable: r.ref_table ?? "", refColumns: [] };
    if (r.col) fk.columns.push(r.col);
    if (r.ref_col) fk.refColumns.push(r.ref_col);
    fkMap.set(nm, fk);
  }
  const foreignKeys = [...fkMap.values()];

  const type: "table" | "view" = /VIEW/i.test(typeRows[0]?.t ?? "") ? "view" : "table";
  const createSql = await buildCreateSql(engine, table, type, columns, primaryKey, indexes, exec);

  return { name: table, type, columns, primaryKey, indexes, foreignKeys, triggers, createSql, rows: null };
}

/** DDL da tabela: mysql via SHOW CREATE TABLE; postgres reconstruído dos metadados. */
async function buildCreateSql(
  engine: SqlEngine,
  table: string,
  type: "table" | "view",
  columns: DbColumn[],
  primaryKey: string[],
  indexes: DbIndex[],
  exec: ExecFn,
): Promise<string | null> {
  if (engine !== "postgres") {
    const rows = await safe(exec, `SHOW CREATE TABLE \`${table}\``);
    // mysql devolve colunas "Table" e "Create Table" (ou "View"/"Create View")
    const r = rows[0];
    if (!r) return null;
    return r["Create Table"] ?? r["Create View"] ?? Object.values(r)[1] ?? null;
  }
  if (type === "view" || columns.length === 0) return null;
  const q = (id: string) => `"${id}"`;
  const lines: string[] = [];
  for (const c of columns) {
    let line = `  ${q(c.name)} ${c.type}`;
    if (!c.nullable) line += " NOT NULL";
    if (c.default != null) line += ` DEFAULT ${c.default}`;
    lines.push(line);
  }
  if (primaryKey.length) lines.push(`  PRIMARY KEY (${primaryKey.map(q).join(", ")})`);
  for (const i of indexes.filter((ix) => ix.unique && !ix.primary)) {
    lines.push(`  CONSTRAINT ${q(i.name)} UNIQUE (${i.columns.map(q).join(", ")})`);
  }
  return `CREATE TABLE ${q(table)} (\n${lines.join(",\n")}\n);`;
}
