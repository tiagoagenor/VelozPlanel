import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Drift-check (issue ALTA-2): colunas declaradas no schema.ts do Drizzle mas
 * AUSENTES no banco quebram a API em runtime (push-and-seed.ts é uma lista
 * MANUAL de ALTER TABLE). Rodamos ANTES de tocar a imagem, então abortar não
 * deixa a tag :prod apontando para código incompatível.
 *
 * Parser best-effort: extrai (tabela -> colunas db) do schema.ts por regex dos
 * construtores Drizzle. Na dúvida, tende a apontar drift (seguro: o operador
 * roda `--schema`, que é idempotente).
 */
const COL_RE = /\b(?:text|integer|boolean|timestamp|uuid|jsonb|json|doublePrecision|bigint|numeric|real|serial|varchar|char|date|time)\s*\(\s*"([^"]+)"/g;

export interface SchemaColumns {
  byTable: Record<string, Set<string>>; // tabela db -> colunas db
}

export function parseSchema(srcLocal: string): SchemaColumns {
  const path = join(srcLocal, "apps/api/src/db/schema.ts");
  const src = readFileSync(path, "utf8");
  const byTable: Record<string, Set<string>> = {};
  // Acha cada bloco pgTable("nome", { ... }) por contagem de chaves.
  const tableRe = /pgTable\(\s*"([^"]+)"\s*,\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(src))) {
    const table = m[1]!;
    let i = m.index + m[0].length - 1; // aponta para o '{'
    let depth = 0;
    let end = i;
    for (; end < src.length; end++) {
      const ch = src[end];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    const body = src.slice(i, end);
    const cols = new Set<string>();
    let c: RegExpExecArray | null;
    COL_RE.lastIndex = 0;
    while ((c = COL_RE.exec(body))) cols.add(c[1]!);
    byTable[table] = cols;
  }
  return { byTable };
}

/** Colunas presentes no schema.ts e ausentes no banco (information_schema). */
export function diffColumns(schema: SchemaColumns, dbCols: Record<string, Set<string>>): string[] {
  const drift: string[] = [];
  for (const [table, cols] of Object.entries(schema.byTable)) {
    const have = dbCols[table];
    if (!have) continue; // tabela nova inteira: push-and-seed cria via CREATE TABLE IF NOT EXISTS
    for (const col of cols) {
      if (!have.has(col)) drift.push(`${table}.${col}`);
    }
  }
  return drift.sort();
}
