import type { DbCell, DbResult } from "@velozplanel/contracts";
import type { ExecPlan } from "./build";
import { DbConsoleError } from "./classify";

export interface ExecOutput {
  stdout: Buffer;
  stderr: string;
  exitCode: number;
  truncated: boolean;
}

const TAB = 0x09;
const LF = 0x0a;
const BSLASH = 0x5c;
const NULL_BYTES = Buffer.from("NULL", "utf8");

/** Decodifica um campo (bytes já des-escapados) em DbCell: texto UTF-8 ou binário hex. */
function bytesToCell(buf: Buffer): DbCell {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return { b: true, hex: buf.toString("hex") };
  }
}

/** Des-escapa o campo do `mysql --batch` (só \0 \t \n \\ são escapados). */
function unescapeTsvField(buf: Buffer): Buffer {
  if (buf.indexOf(BSLASH) < 0) return buf;
  const out: number[] = [];
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === BSLASH && i + 1 < buf.length) {
      const nx = buf[i + 1];
      if (nx === 0x30) {
        out.push(0x00);
        i++;
        continue;
      } // \0
      if (nx === 0x74) {
        out.push(0x09);
        i++;
        continue;
      } // \t
      if (nx === 0x6e) {
        out.push(0x0a);
        i++;
        continue;
      } // \n
      if (nx === BSLASH) {
        out.push(BSLASH);
        i++;
        continue;
      } // \\
    }
    out.push(buf[i]!);
  }
  return Buffer.from(out);
}

/** Split de um Buffer por um byte, preservando bytes crus. */
function splitBuf(buf: Buffer, byte: number): Buffer[] {
  const parts: Buffer[] = [];
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === byte) {
      parts.push(buf.subarray(start, i));
      start = i + 1;
    }
  }
  parts.push(buf.subarray(start));
  return parts;
}

/** Parser do `mysql/mariadb --batch` (TSV binário-safe). */
function parseTsv(stdout: Buffer, truncated: boolean): { columns: string[]; rows: DbCell[][] } {
  let buf = stdout;
  // remove um LF final
  if (buf.length && buf[buf.length - 1] === LF) buf = buf.subarray(0, buf.length - 1);
  if (buf.length === 0) return { columns: [], rows: [] };
  const lines = splitBuf(buf, LF);
  const header = splitBuf(lines[0]!, TAB).map((b) => b.toString("utf8"));
  const rows: DbCell[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = splitBuf(lines[i]!, TAB);
    rows.push(
      fields.map((f) => (f.equals(NULL_BYTES) ? null : bytesToCell(unescapeTsvField(f)))),
    );
  }
  void truncated;
  return { columns: header, rows };
}

/** Parser CSV RFC 4180 com sentinela de NULL `\N` (não-citado). */
function parseCsv(text: string): { columns: string[]; rows: DbCell[][] } {
  const records: { value: string; quoted: boolean }[][] = [];
  let field = "";
  let quoted = false;
  let inQuotes = false;
  let row: { value: string; quoted: boolean }[] = [];
  let started = false;
  const pushField = () => {
    row.push({ value: field, quoted });
    field = "";
    quoted = false;
    started = false;
  };
  const pushRow = () => {
    pushField();
    records.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && !started) {
      inQuotes = true;
      quoted = true;
      started = true;
      continue;
    }
    if (ch === ",") {
      pushField();
      continue;
    }
    if (ch === "\n") {
      pushRow();
      continue;
    }
    if (ch === "\r") continue;
    field += ch;
    started = true;
  }
  if (field.length > 0 || row.length > 0) pushRow();
  if (records.length === 0) return { columns: [], rows: [] };
  const columns = records[0]!.map((f) => f.value);
  const rows = records.slice(1).map((rec) =>
    rec.map<DbCell>((f) => (!f.quoted && f.value === "\\N" ? null : f.value)),
  );
  return { columns, rows };
}

const PG_TAG = /^(INSERT \d+ \d+|UPDATE \d+|DELETE \d+|MERGE \d+|COPY \d+|CREATE\b.*|DROP\b.*|ALTER\b.*|TRUNCATE\b.*|GRANT\b.*|REVOKE\b.*|COMMENT\b.*|SET|DO)$/;

/** Extrai linhas afetadas de um command-tag do Postgres. */
function pgAffected(tag: string): number | null {
  const m = /^(?:INSERT \d+|UPDATE|DELETE|MERGE|COPY) (\d+)$/.exec(tag);
  return m ? Number(m[1]) : null;
}

/** Converte a saída de um exec num DbResult (ou lança DbConsoleError com a msg do engine). */
export function parseExec(plan: ExecPlan, out: ExecOutput): DbResult {
  if (out.exitCode !== 0) {
    const msg = out.stderr.trim() || `falha na execução (código ${out.exitCode})`;
    throw new DbConsoleError("engine_error", msg);
  }

  if (plan.outputKind === "mongo-ejson") {
    return { kind: "mongo", op: "mongo", ejson: out.stdout.toString("utf8").trim(), truncated: out.truncated };
  }

  if (plan.outputKind === "sql-tsv") {
    const parsed = parseTsv(out.stdout, out.truncated);
    if (plan.isWrite) {
      // caminho de escrita: última coluna affected_rows do SELECT ROW_COUNT() anexado.
      const idx = parsed.columns.indexOf("affected_rows");
      let affected: number | null = null;
      if (idx >= 0 && parsed.rows.length) {
        const v = parsed.rows[parsed.rows.length - 1]![idx];
        affected = typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : null;
        if (affected != null && affected < 0) affected = null; // DDL devolve -1
      }
      return { kind: "command", command: "OK", affectedRows: affected };
    }
    return { kind: "rows", columns: parsed.columns, rows: parsed.rows, truncated: out.truncated };
  }

  // pg-csv
  const text = out.stdout.toString("utf8");
  const lines = text.replace(/\n+$/, "").split("\n");
  const last = lines[lines.length - 1] ?? "";
  if (PG_TAG.test(last)) {
    // command (possivelmente com CSV antes, no caso de RETURNING)
    const body = lines.slice(0, -1).join("\n");
    if (body.trim().length > 0) {
      const parsed = parseCsv(body);
      return { kind: "rows", columns: parsed.columns, rows: parsed.rows, truncated: out.truncated };
    }
    return { kind: "command", command: last.split(" ")[0]!, affectedRows: pgAffected(last) };
  }
  const parsed = parseCsv(text);
  return { kind: "rows", columns: parsed.columns, rows: parsed.rows, truncated: out.truncated };
}
