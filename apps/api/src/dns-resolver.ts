/**
 * Consultas DNS de saída (node:dns) para:
 *  - VERIFICAR delegação: pergunta SOA direto ao primário (187) e ao secundário
 *    (184), e NS ao resolver público (delegação no registrar).
 *  - DESCOBRIR registros atuais no mundo (para importar antes de trocar os NS,
 *    evitando takeover).
 *
 * Nunca lança para o chamador: devolve resultado tipado (erros viram flags).
 */
import { Resolver } from "node:dns/promises";
import type { DnsRecordType, DiscoverResult, VerifyResult, DnsZoneStatus } from "@velozplanel/contracts";
import { NAMESERVERS, NS_HOSTS } from "./dns-pdns";

const TIMEOUT_MS = 4000;

function makeResolver(servers?: string[]): Resolver {
  const r = new Resolver({ timeout: TIMEOUT_MS, tries: 1 });
  if (servers && servers.length) r.setServers(servers);
  return r;
}

/** SOA da zona consultada num servidor específico → serial, ou null se falhar. */
async function soaSerialAt(ip: string, zone: string): Promise<number | null> {
  try {
    const r = makeResolver([ip]);
    const soa = await r.resolveSoa(zone);
    return typeof soa.serial === "number" ? soa.serial : null;
  } catch {
    return null;
  }
}

/** Verifica delegação e sincronismo dos nameservers. Sempre resolve (nunca 500). */
export async function verifyZone(zone: string): Promise<VerifyResult> {
  const checkedAt = new Date().toISOString();
  // Consulta o SOA em cada nameserver (por IP). Vários NS no mesmo IP respondem
  // igual — o que importa é quantas ENTRADAS de NS respondem.
  const serials = await Promise.all(NAMESERVERS.map((n) => soaSerialAt(n.ip, zone)));
  const answering = serials.map((s) => s !== null);
  const primaryAnswering = answering[0] ?? false;
  const secondaryAnswering = answering.slice(1).some(Boolean);
  const anySerial = serials.find((s) => s !== null) ?? null;

  // Delegação no registrar: NS vistos pelo resolver público.
  let delegatedAtParent = false;
  let nsError: "timeout" | "servfail" | null = null;
  try {
    const pub = makeResolver();
    const ns = await pub.resolveNs(zone);
    const set = new Set(ns.map((n) => n.replace(/\.$/, "").toLowerCase()));
    delegatedAtParent = [...NS_HOSTS].some((h) => set.has(h));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "";
    if (code === "ETIMEOUT" || code === "ETIMED_OUT") nsError = "timeout";
    else if (code === "ESERVFAIL") nsError = "servfail";
    // ENOTFOUND/ENODATA = simplesmente não delegado (não é erro).
  }

  let status: DnsZoneStatus;
  if (nsError === "timeout") status = "unknown";
  else if (nsError === "servfail") status = "error";
  else if (!delegatedAtParent) status = "pending";
  else if (primaryAnswering && secondaryAnswering) status = "active";
  else if (primaryAnswering || secondaryAnswering) status = "active_no_redundancy";
  else status = "error";

  return {
    status,
    delegatedAtParent,
    primaryAnswering,
    secondaryAnswering,
    serial: anySerial,
    checkedAt,
    error: nsError,
    resolvedTo: [],
    expected: null,
    match: false,
  };
}

/** Resolve os A de um FQDN pelo resolver público (para diagnóstico de apontamento). */
export async function resolveA(fqdn: string): Promise<string[]> {
  try {
    const r = makeResolver();
    return await r.resolve4(fqdn.replace(/\.$/, ""));
  } catch {
    return [];
  }
}

/* ─────────────── Descoberta (importar registros atuais) ─────────────── */

type Found = { name: string; type: DnsRecordType; ttl: number; records: string[] };

const TTL = 3600;

/** Alvos varridos (rótulo relativo, tipo). Sem SOA/NS. */
const PROBES: Array<[string, DnsRecordType]> = [
  ["@", "A"], ["@", "AAAA"], ["@", "MX"], ["@", "TXT"], ["@", "CAA"],
  ["www", "A"], ["www", "AAAA"], ["www", "CNAME"],
  ["mail", "A"],
  ["_dmarc", "TXT"],
  ["autodiscover", "CNAME"],
];

function nameFor(zone: string, label: string): string {
  return label === "@" ? zone : `${label}.${zone}`;
}

async function probe(r: Resolver, fqdn: string, type: DnsRecordType): Promise<string[]> {
  try {
    switch (type) {
      case "A":
        return await r.resolve4(fqdn);
      case "AAAA":
        return await r.resolve6(fqdn);
      case "CNAME":
        return (await r.resolveCname(fqdn)).map((c) => `${c.replace(/\.$/, "")}.`);
      case "MX":
        return (await r.resolveMx(fqdn)).map((m) => `${m.priority} ${m.exchange.replace(/\.$/, "")}.`);
      case "TXT":
        return (await r.resolveTxt(fqdn)).map((chunks) => chunks.join(""));
      case "CAA":
        return (await r.resolveCaa(fqdn)).map((c) => {
          const tag = c.issue !== undefined ? "issue" : c.issuewild !== undefined ? "issuewild" : "iodef";
          const val = c.issue ?? c.issuewild ?? c.iodef ?? "";
          return `${c.critical ?? 0} ${tag} "${val}"`;
        });
      case "SRV":
        return (await r.resolveSrv(fqdn)).map((s) => `${s.priority} ${s.weight} ${s.port} ${s.name.replace(/\.$/, "")}.`);
      default:
        return [];
    }
  } catch {
    return [];
  }
}

/** Varre os registros atuais do domínio (resolver público). */
export async function discoverZone(zone: string): Promise<DiscoverResult> {
  const z = zone.replace(/\.$/, "").toLowerCase();
  const r = makeResolver();
  let partial = false;

  const results = await Promise.all(
    PROBES.map(async ([label, type]): Promise<Found | null> => {
      const fqdn = nameFor(z, label);
      const records = await probe(r, fqdn, type);
      if (!records.length) return null;
      return { name: label, type, ttl: TTL, records };
    }),
  ).catch((): (Found | null)[] => {
    partial = true;
    return [];
  });

  const rrsets = results.filter((x): x is Found => x !== null);
  return { partial, rrsets };
}
