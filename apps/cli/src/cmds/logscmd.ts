import type { Args } from "../lib/args.js";
import { opt } from "../lib/args.js";
import { ok, fail, usage } from "../lib/out.js";
import { pullLog, tailLog } from "../lib/logs.js";

export async function logsCmd(sub: string, a: Args): Promise<void> {
  const id = opt(a, "id");
  if (!id) usage(`uso: jamees logs ${sub || "pull|tail"} --id <logId> [...]`);
  if (sub === "pull") {
    const cursor = Number(opt(a, "cursor") ?? 0);
    const lines = Number(opt(a, "lines") ?? 200);
    const r = pullLog(id!, cursor, lines);
    if (!r.exists) return fail("logId não encontrado", { id });
    return ok({ logId: id, cursor: r.cursor, lines: r.lines, more: r.more });
  }
  if (sub === "tail") {
    const n = Number(opt(a, "lines") ?? 40);
    const r = tailLog(id!, n);
    if (!r.exists) return fail("logId não encontrado", { id });
    return ok({ logId: id, lines: r.lines });
  }
  usage(`subcomando de logs desconhecido: ${sub}`, { valid: ["pull", "tail"] });
}
