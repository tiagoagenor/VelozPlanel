import { execFile } from "node:child_process";
import type { Config } from "../config.js";
import { type Args, opt, optList, yes } from "../lib/args.js";
import { ok, fail, needConfirm, usage } from "../lib/out.js";
import { httpJson } from "../lib/http.js";
import { newLogId, writeLog } from "../lib/logs.js";

function api(cfg: Config, path: string): string {
  return `${cfg.apiInternal}/api/v1/internal/dns${path}`;
}

function dig(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile("dig", ["+short", ...args], { timeout: 10_000 }, (_e, out) => resolve((out ?? "").trim()));
  });
}

export async function dns(sub: string, a: Args, cfg: Config): Promise<void> {
  const token = cfg.tokens.internal;

  if (sub === "zones") {
    const r = await httpJson(api(cfg, "/zones"), { token });
    if (!r.ok) return fail("falha ao listar zonas", { status: r.status });
    const zones = ((r.json as { zones?: unknown[] })?.zones ?? []) as Record<string, unknown>[];
    return ok({ zones: zones.map((z) => ({ name: z.name, serial: z.serial ?? null, kind: z.kind ?? null })), count: zones.length });
  }

  if (sub === "get") {
    const zone = a._[0];
    if (!zone) usage("uso: jamees dns get <zone> [--name n] [--type T] [--limit N]");
    const r = await httpJson(api(cfg, `/rrsets?zone=${encodeURIComponent(zone!)}`), { token });
    if (!r.ok) return fail("falha ao ler rrsets", { zone, status: r.status });
    let rrsets = (((r.json as { rrsets?: unknown[] })?.rrsets ?? []) as Record<string, unknown>[]);
    const name = opt(a, "name");
    const type = opt(a, "type");
    if (name) rrsets = rrsets.filter((x) => String(x.name).replace(/\.$/, "") === name.replace(/\.$/, "") || String(x.name).startsWith(name));
    if (type) rrsets = rrsets.filter((x) => String(x.type).toUpperCase() === type.toUpperCase());
    const limit = Math.max(1, Math.min(500, Number(opt(a, "limit") ?? 50)));
    const truncated = rrsets.length > limit;
    const out: Record<string, unknown> = { zone, rrsets: rrsets.slice(0, limit), count: rrsets.length, truncated };
    if (truncated) {
      const logId = newLogId("dns");
      writeLog(logId, JSON.stringify(rrsets, null, 2));
      out.logId = logId;
    }
    return ok(out);
  }

  if (sub === "upsert") {
    const zone = a._[0];
    const name = opt(a, "name");
    const type = opt(a, "type");
    const ttl = Number(opt(a, "ttl") ?? 300);
    const records = optList(a, "content");
    if (!zone || !name || !type || !records.length) usage('uso: jamees dns upsert <zone> --name <fqdn> --type <T> --ttl <s> --content <val> [--content <val>…]');
    if (!yes(a)) {
      // plano: mostra o rrset atual (antes)
      const cur = await httpJson(api(cfg, `/rrsets?zone=${encodeURIComponent(zone!)}`), { token });
      const before = (((cur.json as { rrsets?: Record<string, unknown>[] })?.rrsets ?? [])).find((x) => String(x.type).toUpperCase() === type!.toUpperCase() && String(x.name).replace(/\.$/, "").endsWith(name!.replace(/\.$/, "")));
      needConfirm({ action: "dns upsert", zone, name, type, ttl, before: before?.records ?? null, after: records });
    }
    const r = await httpJson(api(cfg, "/rrset"), { method: "PUT", token, body: { zone, name, type, ttl, records } });
    if (!r.ok) return fail("upsert falhou", { zone, name, type, status: r.status, detail: r.text.slice(0, 200) });
    const j = (r.json ?? {}) as Record<string, unknown>;
    return ok({ zone, name: j.name ?? name, type, ttl, records, serialAfter: j.serialAfter ?? null });
  }

  if (sub === "del") {
    const zone = a._[0];
    const name = opt(a, "name");
    const type = opt(a, "type");
    if (!zone || !name || !type) usage("uso: jamees dns del <zone> --name <fqdn> --type <T> [--yes]");
    if (!yes(a)) needConfirm({ action: "dns del", zone, name, type });
    const r = await httpJson(api(cfg, "/rrset"), { method: "DELETE", token, body: { zone, name, type } });
    if (!r.ok) return fail("del falhou", { zone, name, type, status: r.status });
    const j = (r.json ?? {}) as Record<string, unknown>;
    return ok({ zone, name: j.name ?? name, type, deleted: true, serialAfter: j.serialAfter ?? null });
  }

  if (sub === "set-ns") {
    const zone = a._[0];
    const ns = optList(a, "ns");
    const glue = opt(a, "glue");
    if (!zone || ns.length < 1) usage("uso: jamees dns set-ns <zone> --ns <host1> --ns <host2> [--glue <ip>] [--yes]");
    const cur = await httpJson(api(cfg, `/rrsets?zone=${encodeURIComponent(zone!)}`), { token });
    const nsBefore = (((cur.json as { rrsets?: Record<string, unknown>[] })?.rrsets ?? [])).filter((x) => String(x.type) === "NS" && String(x.name).replace(/\.$/, "") === zone!.replace(/\.$/, "")).flatMap((x) => (x.records as string[]) ?? []);
    if (!yes(a)) needConfirm({ action: "dns set-ns", zone, nsBefore, nsAfter: ns, glue: glue ?? null });
    const r = await httpJson(api(cfg, "/rrset"), { method: "PUT", token, body: { zone, name: zone, type: "NS", ttl: 3600, records: ns } });
    if (!r.ok) return fail("set-ns falhou", { zone, status: r.status, detail: r.text.slice(0, 200) });
    let glueRes: unknown = undefined;
    if (glue) {
      for (const h of ns) {
        if (h.replace(/\.$/, "").endsWith(zone!.replace(/\.$/, ""))) {
          await httpJson(api(cfg, "/rrset"), { method: "PUT", token, body: { zone, name: h, type: "A", ttl: 3600, records: [glue] } });
        }
      }
      glueRes = glue;
    }
    const j = (r.json ?? {}) as Record<string, unknown>;
    return ok({ zone, nsBefore, nsAfter: ns, glue: glueRes, serialAfter: j.serialAfter ?? null });
  }

  if (sub === "verify") {
    const zone = a._[0];
    if (!zone) usage("uso: jamees dns verify <zone>");
    const r = await httpJson(api(cfg, `/rrsets?zone=${encodeURIComponent(zone!)}`), { token });
    if (!r.ok) return fail("falha ao ler a zona", { zone, status: r.status });
    const rrsets = (((r.json as { rrsets?: Record<string, unknown>[] })?.rrsets ?? []));
    const soa = rrsets.find((x) => String(x.type) === "SOA");
    const soaSerial = soa ? Number(String((soa.records as string[])?.[0] ?? "").split(/\s+/)[2] ?? "0") : null;
    const isApex = (x: Record<string, unknown>) => String(x.fqdn ?? "").replace(/\.$/, "") === zone!.replace(/\.$/, "") || String(x.name) === "@" || String(x.name).replace(/\.$/, "") === zone!.replace(/\.$/, "");
    const nsInZone = rrsets.filter((x) => String(x.type) === "NS" && isApex(x)).flatMap((x) => (x.records as string[]) ?? []).map((s) => s.replace(/\.$/, ""));
    const nsParent = (await dig(["NS", zone!, "@1.1.1.1"])).split(/\r?\n/).map((s) => s.replace(/\.$/, "")).filter(Boolean).sort();
    const soaServed = await dig(["SOA", zone!, "@1.1.1.1"]);
    const servedSerial = soaServed ? Number(soaServed.split(/\s+/)[2] ?? "0") : null;
    const issues: string[] = [];
    if (soaSerial !== null && servedSerial !== null && soaSerial !== servedSerial) issues.push(`serial servido (${servedSerial}) != PowerDNS (${soaSerial})`);
    const nsMismatch = JSON.stringify([...nsInZone].sort()) !== JSON.stringify([...nsParent].sort());
    if (nsMismatch && nsParent.length) issues.push("NS no pai divergem dos NS da zona");
    return ok({ zone, soaSerial, servedSerial, nsInZone: nsInZone.sort(), nsParent, issues });
  }

  usage(`subcomando de dns desconhecido: ${sub}`, { valid: ["zones", "get", "upsert", "del", "set-ns", "verify"] });
}
