/**
 * Splitter de dumps SQL para importação statement-a-statement.
 *
 * Cada "chunk" é o texto EXATO a alimentar no cliente nativo (mysql/psql) para
 * executar UM statement lógico — já com o terminador/wrapper necessário — mais
 * um `preview` curto (1 linha) para a UI.
 *
 * Ciente de:
 *  - strings/identificadores citados: '..' , ".." , `..`
 *  - comentários: `-- …`, `# …` (MySQL), `/* … *​/`
 *  - DELIMITER (MySQL): procedures/triggers com terminador custom
 *  - dollar-quoting (Postgres): `$tag$ … $tag$`
 *  - blocos `COPY … FROM stdin;` … `\.` (Postgres) tratados como 1 chunk
 *  - meta-comandos de barra invertida por linha (`\connect`, `\restrict`) (Postgres)
 *
 * Objetivo: manter o TEXTO ORIGINAL intacto no `feed` (comentários condicionais
 * `/*! … *​/` do mysqldump são executáveis e precisam ser preservados). Os
 * comentários só afetam a detecção do terminador, nunca são removidos do feed.
 */
export interface SqlChunk {
  /** Texto a enviar ao cliente para executar este statement (SEM o marcador). */
  feed: string;
  /** Resumo curto de 1 linha para exibir na UI. */
  preview: string;
}

const PREVIEW_MAX = 160;

/** Resumo cosmético de 1 linha (tira comentários/quebras) para exibir na UI. */
function makePreview(raw: string): string {
  let s = raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/#[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > PREVIEW_MAX) s = s.slice(0, PREVIEW_MAX) + "…";
  return s || "(vazio)";
}

/** Avança além de uma string/identificador citado iniciado em `open` (aspas em sql[open]). */
function skipQuoted(sql: string, open: number, q: string, backslash: boolean): number {
  const n = sql.length;
  let k = open + 1;
  while (k < n) {
    const ch = sql[k]!;
    if (backslash && ch === "\\") {
      k += 2;
      continue;
    }
    if (ch === q) {
      if (sql[k + 1] === q) {
        k += 2; // aspas duplicadas ('' "" ``) — escape padrão do SQL
        continue;
      }
      return k + 1;
    }
    k++;
  }
  return n;
}

/** Se em `p` começa um dollar-quote ($tag$ ou $$), retorna a tag "$tag$"; senão null. */
function dollarTag(sql: string, p: number): string | null {
  if (sql[p] !== "$") return null;
  const n = sql.length;
  let k = p + 1;
  if (sql[k] === "$") return "$$"; // tag vazia
  // Tag deve ser um identificador válido (letra/_ inicial) — evita casar `$1` (parâmetro).
  if (!/[A-Za-z_]/.test(sql[k] ?? "")) return null;
  k++;
  while (k < n) {
    if (sql[k] === "$") return sql.slice(p, k + 1);
    if (/[A-Za-z0-9_]/.test(sql[k]!)) {
      k++;
      continue;
    }
    return null;
  }
  return null;
}

/** Fim de um bloco `COPY … FROM stdin`: a linha que contém só `\.` Retorna o índice após ela. */
function findCopyEnd(sql: string, from: number): number {
  const n = sql.length;
  let lineStart = from;
  while (lineStart <= n) {
    let lineEnd = sql.indexOf("\n", lineStart);
    if (lineEnd < 0) lineEnd = n;
    if (sql.slice(lineStart, lineEnd).replace(/\r$/, "").trim() === "\\.") {
      return lineEnd; // até o fim da linha `\.` (não consome o \n seguinte)
    }
    if (lineEnd >= n) break;
    lineStart = lineEnd + 1;
  }
  return n; // sem `\.` (dump truncado) — engole o resto
}

/**
 * Quebra um dump SQL em statements executáveis. Não valida nem classifica —
 * apenas separa fielmente; a execução (e o modo escrita) é do chamador.
 */
export function splitSqlStatements(engine: "mysql" | "mariadb" | "postgres", sql: string): SqlChunk[] {
  const isMysql = engine === "mysql" || engine === "mariadb";
  const chunks: SqlChunk[] = [];
  const n = sql.length;
  let i = 0;
  let delimiter = ";";

  const eol = (from: number): number => {
    const nl = sql.indexOf("\n", from);
    return nl < 0 ? n : nl;
  };

  while (i < n) {
    // pula espaços em branco à esquerda do próximo statement
    while (i < n && /\s/.test(sql[i]!)) i++;
    if (i >= n) break;

    // Diretiva DELIMITER (MySQL): "DELIMITER x" numa linha — muda o terminador do cliente.
    if (isMysql && /^delimiter[ \t]/i.test(sql.slice(i, eol(i)) + " ")) {
      const lineEnd = eol(i);
      const d = sql.slice(i + "delimiter".length, lineEnd).trim();
      delimiter = d || ";";
      i = lineEnd + 1;
      continue;
    }

    // Meta-comando de barra invertida (Postgres): \connect, \restrict, \unrestrict…
    if (!isMysql && sql[i] === "\\") {
      const lineEnd = eol(i);
      const feed = sql.slice(i, lineEnd).trim();
      if (feed) chunks.push({ feed, preview: feed });
      i = lineEnd + 1;
      continue;
    }

    // Varre um statement até o terminador atual, respeitando strings/comentários/etc.
    const start = i;
    let k = i;
    let termAt = -1;
    while (k < n) {
      const ch = sql[k]!;
      const two = ch + (sql[k + 1] ?? "");
      if (two === "--") {
        k = eol(k);
        continue;
      }
      if (isMysql && ch === "#") {
        k = eol(k);
        continue;
      }
      if (two === "/*") {
        const close = sql.indexOf("*/", k + 2);
        k = close < 0 ? n : close + 2;
        continue;
      }
      if (ch === "'") {
        k = skipQuoted(sql, k, "'", isMysql);
        continue;
      }
      if (ch === '"') {
        k = skipQuoted(sql, k, '"', isMysql);
        continue;
      }
      if (isMysql && ch === "`") {
        k = skipQuoted(sql, k, "`", false);
        continue;
      }
      if (!isMysql && ch === "$") {
        const tag = dollarTag(sql, k);
        if (tag) {
          const close = sql.indexOf(tag, k + tag.length);
          k = close < 0 ? n : close + tag.length;
          continue;
        }
      }
      if (sql.startsWith(delimiter, k)) {
        termAt = k;
        break;
      }
      k++;
    }

    const rawEnd = termAt < 0 ? n : termAt;
    const stmt = sql.slice(start, rawEnd);
    const afterTerm = termAt < 0 ? n : termAt + delimiter.length;

    if (stmt.trim()) {
      if (isMysql && delimiter !== ";") {
        // Procedure/trigger com delimitador custom: reproduz o DELIMITER ao redor e
        // volta para `;` (para o marcador de progresso, que sempre usa `;`).
        chunks.push({
          feed: `DELIMITER ${delimiter}\n${stmt}${delimiter}\nDELIMITER ;`,
          preview: makePreview(stmt),
        });
        i = afterTerm;
        continue;
      }

      // Postgres: COPY … FROM stdin  → engole os dados inline até a linha `\.`
      if (!isMysql && /^\s*copy\b[\s\S]*\bfrom\s+stdin\b/i.test(stmt)) {
        const copyEnd = findCopyEnd(sql, afterTerm);
        chunks.push({ feed: sql.slice(start, copyEnd), preview: makePreview(stmt) });
        i = copyEnd;
        continue;
      }

      chunks.push({ feed: `${stmt};`, preview: makePreview(stmt) });
    }
    i = afterTerm;
  }
  return chunks;
}
