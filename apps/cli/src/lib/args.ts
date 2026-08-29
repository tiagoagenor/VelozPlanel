/** Parser mínimo (sem deps): positionais + --chave valor + --flag + --chave repetida. */
export interface Args {
  _: string[];
  flags: Record<string, string | string[] | boolean>;
}

const KNOWN_BOOL = new Set(["yes", "y", "schema", "no-health", "rollback", "dry", "check", "quiet", "human", "json"]);

export function parseArgs(argv: string[]): Args {
  const _: string[] = [];
  const flags: Record<string, string | string[] | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") {
      _.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (KNOWN_BOOL.has(key) || next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        // valor; suporta repetição (ex.: --content a --content b)
        const prev = flags[key];
        if (prev === undefined) flags[key] = next;
        else if (Array.isArray(prev)) prev.push(next);
        else flags[key] = [String(prev), next];
        i++;
      }
    } else if (a.startsWith("-") && a.length > 1) {
      flags[a.slice(1)] = true;
    } else {
      _.push(a);
    }
  }
  return { _, flags };
}

export function flag(a: Args, name: string): boolean {
  return a.flags[name] === true || a.flags[name] === "true";
}
export function opt(a: Args, name: string): string | undefined {
  const v = a.flags[name];
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0];
  return undefined;
}
export function optList(a: Args, name: string): string[] {
  const v = a.flags[name];
  if (v === undefined || v === true) return [];
  return Array.isArray(v) ? v : [String(v)];
}
export function yes(a: Args): boolean {
  return flag(a, "yes") || flag(a, "y");
}
