import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { LOGS_DIR, ensureHome } from "./paths.js";

/** Gera um logId curto e ordenável (timestamp + sufixo). */
export function newLogId(prefix = "log"): string {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const rnd = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${ts}-${rnd}`;
}

/** Grava uma saída grande (build/logs/query) e devolve o caminho. */
export function writeLog(logId: string, content: string): string {
  ensureHome();
  const p = join(LOGS_DIR, `${logId}.log`);
  writeFileSync(p, content, { mode: 0o600 });
  rotate();
  return p;
}

export function tailLog(logId: string, lines = 40): { lines: string[]; exists: boolean } {
  const p = join(LOGS_DIR, `${logId}.log`);
  if (!existsSync(p)) return { lines: [], exists: false };
  const all = readFileSync(p, "utf8").replace(/\s+$/, "").split(/\r?\n/);
  return { lines: all.slice(Math.max(0, all.length - lines)), exists: true };
}

export function pullLog(logId: string, cursor = 0, lines = 200): { lines: string[]; cursor: number; more: boolean; exists: boolean } {
  const p = join(LOGS_DIR, `${logId}.log`);
  if (!existsSync(p)) return { lines: [], cursor, more: false, exists: false };
  const all = readFileSync(p, "utf8").split(/\r?\n/);
  const slice = all.slice(cursor, cursor + lines);
  const next = cursor + slice.length;
  return { lines: slice, cursor: next, more: next < all.length, exists: true };
}

/** Rotação simples: remove logs com mais de 14 dias ou além dos 200 mais novos. */
function rotate(): void {
  try {
    const files = readdirSync(LOGS_DIR)
      .filter((f) => f.endsWith(".log"))
      .map((f) => ({ f, p: join(LOGS_DIR, f), m: statSync(join(LOGS_DIR, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    const cutoff = Date.now() - 14 * 24 * 3600 * 1000;
    files.forEach((x, i) => {
      if (i >= 200 || x.m < cutoff) {
        try {
          unlinkSync(x.p);
        } catch {
          /* ignora */
        }
      }
    });
  } catch {
    /* ignora */
  }
}
