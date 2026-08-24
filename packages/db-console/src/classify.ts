import type { StudioEngine, DbMongoOp } from "@velozplanel/contracts";

/** Erro de validação (o statement não passa nas regras de segurança/escopo). */
export class DbConsoleError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "DbConsoleError";
  }
}

/**
 * Varre o SQL e devolve os índices dos `;` de TOPO (fora de strings/comentários).
 * Suporta aspas ' " ` , comentários -- e # (linha) e /* *​/ (bloco), e
 * dollar-quoting do Postgres ($tag$ ... $tag$). É a defesa contra stacked-injection.
 */
function topLevelSemicolons(engine: StudioEngine, sql: string): number[] {
  const out: number[] = [];
  const n = sql.length;
  let i = 0;
  const hashComment = engine === "mysql" || engine === "mariadb"; // # é comentário só no MySQL/MariaDB
  while (i < n) {
    const ch = sql[i]!;
    // comentário de linha
    if (ch === "-" && sql[i + 1] === "-") {
      i += 2;
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (hashComment && ch === "#") {
      i += 2;
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    // comentário de bloco
    if (ch === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    // aspas simples / duplas / crase
    if (ch === "'" || ch === '"' || ch === "`") {
      const q = ch;
      i++;
      while (i < n) {
        if (sql[i] === "\\" && (q === "'" || q === '"')) {
          i += 2;
          continue;
        } // escape estilo C
        if (sql[i] === q) {
          if (sql[i + 1] === q) {
            i += 2;
            continue;
          } // '' escapado
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    // dollar-quote do Postgres: $tag$ ... $tag$
    if (engine === "postgres" && ch === "$") {
      const m = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        i = end < 0 ? n : end + tag.length;
        continue;
      }
    }
    if (ch === ";") out.push(i);
    i++;
  }
  return out;
}

/** Garante 1 statement (permite um `;` final) e devolve o SQL sem o `;` final. */
export function assertSingleStatement(engine: StudioEngine, rawSql: string): string {
  const sql = rawSql.trim();
  if (!sql) throw new DbConsoleError("sql_vazio", "informe um comando");
  const semis = topLevelSemicolons(engine, sql);
  const meaningful = semis.filter((idx) => sql.slice(idx + 1).trim().length > 0);
  if (meaningful.length > 0) {
    throw new DbConsoleError(
      "multi_statement_nao_suportado",
      "envie um comando por vez (sem ';' separando vários comandos)",
    );
  }
  // remove um ';' final, se houver
  return sql.replace(/;\s*$/, "");
}

/** Primeiro verbo (token) do statement, em maiúsculas, ignorando comentários iniciais. */
export function firstVerb(engine: StudioEngine, sql: string): string {
  let s = sql.trimStart();
  // pula comentários iniciais
  for (;;) {
    if (s.startsWith("--") || ((engine === "mysql" || engine === "mariadb") && s.startsWith("#"))) {
      const nl = s.indexOf("\n");
      s = nl < 0 ? "" : s.slice(nl + 1).trimStart();
      continue;
    }
    if (s.startsWith("/*")) {
      const end = s.indexOf("*/");
      s = end < 0 ? "" : s.slice(end + 2).trimStart();
      continue;
    }
    break;
  }
  const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s);
  return (m?.[0] ?? "").toUpperCase();
}

const READ_VERBS = new Set(["SELECT", "WITH", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "TABLE", "VALUES"]);

export interface SqlClassification {
  sql: string; // single statement, sem ';' final
  isWrite: boolean; // true = precisa do modo escrita
  verb: string;
}

/**
 * Classifica um statement SQL. `isWrite=true` quando NÃO é claramente leitura
 * (ou contém INTO OUTFILE/DUMPFILE, ou EXPLAIN ANALYZE que executa). O guard
 * definitivo de leitura é a transação READ ONLY no engine — isto é a 1ª barreira.
 */
export function classifySql(engine: StudioEngine, rawSql: string): SqlClassification {
  const sql = assertSingleStatement(engine, rawSql);
  const verb = firstVerb(engine, sql);
  const hasFileWrite = /\binto\s+(outfile|dumpfile)\b/i.test(sql);
  const explainAnalyze = verb === "EXPLAIN" && /\bexplain\b[\s(]*\banalyze\b/i.test(sql);
  const isRead = READ_VERBS.has(verb) && !hasFileWrite && !explainAnalyze;
  return { sql, isWrite: !isRead, verb };
}

const MONGO_READ_OPS = new Set<DbMongoOp>([
  "find",
  "aggregate",
  "count",
  "distinct",
  "listCollections",
  "listIndexes",
]);

/** Valida a operação Mongo: whitelist + escrita exige modo escrita + veta $out/$merge/$function. */
export function classifyMongo(op: DbMongoOp, args: Record<string, unknown> | undefined): { isWrite: boolean } {
  const isWrite = !MONGO_READ_OPS.has(op);
  if (op === "aggregate") {
    const pipeline = (args?.pipeline ?? []) as unknown[];
    if (!Array.isArray(pipeline)) throw new DbConsoleError("pipeline_invalido", "pipeline deve ser um array");
    const banned = ["$out", "$merge", "$function", "$accumulator", "$where"];
    for (const stage of pipeline) {
      if (stage && typeof stage === "object") {
        for (const key of Object.keys(stage as object)) {
          if (banned.includes(key)) throw new DbConsoleError("estagio_proibido", `estágio ${key} não é permitido`);
        }
      }
    }
  }
  return { isWrite };
}
