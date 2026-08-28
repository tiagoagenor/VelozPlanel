/**
 * Cliente da HTTP API do PowerDNS Authoritative (backend gpgsql).
 *
 * A API do painel fala EXCLUSIVAMENTE por aqui — nunca escreve no SQL do pdns.
 * O daemon roda no control-plane (187) e a API o alcança pela rede compose
 * (`http://pdns:8081`), NUNCA exposto publicamente. Em dev (sem `PDNS_API_KEY`)
 * as chamadas falham com `PdnsUnavailable`, tratado como 502 nas rotas.
 */

const PDNS_API_URL = process.env.PDNS_API_URL ?? "http://pdns:8081";
const PDNS_API_KEY = process.env.PDNS_API_KEY ?? "";
const SERVER_ID = "localhost";
const BASE = `${PDNS_API_URL}/api/v1/servers/${SERVER_ID}`;

/**
 * Nameservers deste servidor (para SOA/NS/glue e o card de delegação).
 * Lê DNS_NS1..DNS_NS4 (_HOST/_IP); entradas sem host/IP são ignoradas. Assim dá
 * para ter 2 (default) ou até 4 nameservers, e apontar todos para a mesma
 * máquina agora (ex.: ns1..ns4 → 187) e espalhar depois.
 */
function parseNameservers(): Array<{ host: string; ip: string }> {
  const out: Array<{ host: string; ip: string }> = [];
  for (let i = 1; i <= 4; i++) {
    const host = (process.env[`DNS_NS${i}_HOST`] ?? "").trim().replace(/\.$/, "");
    const ip = (process.env[`DNS_NS${i}_IP`] ?? "").trim();
    if (host && ip) out.push({ host: host.toLowerCase(), ip });
  }
  if (out.length) return out;
  // Default seguro (dev / sem env): nameservers da marca (jamees.com → 187).
  return [
    { host: "ns1.jamees.com", ip: "187.127.49.205" },
    { host: "ns2.jamees.com", ip: "187.127.49.205" },
  ];
}

export const NAMESERVERS = parseNameservers();
/** Conjunto de hosts de nameserver (para classificar glue como "system"). */
export const NS_HOSTS = new Set(NAMESERVERS.map((n) => n.host));

/** Lançado quando o pdns está indisponível/desconfigurado (vira 502 na rota). */
export class PdnsUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdnsUnavailable";
  }
}

/** Erro tipado com status HTTP devolvido pela própria API do pdns. */
export class PdnsHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PdnsHttpError";
    this.status = status;
  }
}

export interface PdnsRecord {
  content: string;
  disabled: boolean;
}
export interface PdnsRRset {
  name: string; // canônico, com ponto final
  type: string;
  ttl: number;
  records: PdnsRecord[];
}
export interface PdnsZoneSummary {
  id: string; // = name canônico
  name: string;
  kind: string;
  serial: number;
}
export interface PdnsZone extends PdnsZoneSummary {
  rrsets: PdnsRRset[];
}

async function pdnsFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!PDNS_API_KEY) throw new PdnsUnavailable("servidor DNS não configurado (PDNS_API_KEY ausente)");
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "X-API-Key": PDNS_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new PdnsUnavailable(`servidor DNS inacessível: ${(err as Error).message}`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      /* texto cru */
    }
    throw new PdnsHttpError(res.status, msg || `pdns respondeu ${res.status}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

/* ─────────────── Canonicalização ─────────────── */

/** Zona canônica com ponto final (id do pdns). */
export function zoneId(zone: string): string {
  const z = zone.replace(/\.$/, "").toLowerCase();
  return `${z}.`;
}

/** FQDN canônico a partir de um rótulo relativo à zona ("@" = ápice). */
export function fqdnOf(zone: string, name: string): string {
  const z = zone.replace(/\.$/, "").toLowerCase();
  const n = name.trim().toLowerCase();
  if (n === "" || n === "@" || n === z || n === `${z}.`) return `${z}.`;
  if (n.endsWith(".")) return n;
  if (n === z || n.endsWith(`.${z}`)) return `${n}.`;
  return `${n}.${z}.`;
}

/** Rótulo relativo à zona para exibição ("@" no ápice). */
export function labelOf(zone: string, fqdn: string): string {
  const z = zone.replace(/\.$/, "").toLowerCase();
  const f = fqdn.replace(/\.$/, "").toLowerCase();
  if (f === z) return "@";
  if (f.endsWith(`.${z}`)) return f.slice(0, -(z.length + 1));
  return f;
}

/** Ajusta o conteúdo ao formato do pdns (ponto final em alvos de hostname). */
export function canonicalizeContent(type: string, content: string, zone: string): string {
  const c = content.trim();
  const withDot = (host: string): string => {
    const h = host.trim();
    if (h.endsWith(".")) return h;
    // já é FQDN (tem ponto) → só adiciona o ponto final; senão, relativiza à zona.
    return h.includes(".") ? `${h}.` : `${h}.${zone.replace(/\.$/, "")}.`;
  };
  switch (type) {
    case "CNAME":
    case "NS":
    case "ALIAS":
      return withDot(c);
    case "MX": {
      const m = c.match(/^(\d+)\s+(.+)$/);
      return m ? `${m[1]} ${withDot(m[2]!)}` : c;
    }
    case "SRV": {
      // prio weight port target
      const p = c.split(/\s+/);
      if (p.length === 4) return `${p[0]} ${p[1]} ${p[2]} ${withDot(p[3]!)}`;
      return c;
    }
    case "TXT": {
      // O pdns guarda TXT entre aspas — normaliza para o read-after-write bater.
      if (c.startsWith('"') && c.endsWith('"')) return c;
      return `"${c.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }
    default:
      return c; // A/AAAA/CAA — conteúdo cru
  }
}

/* ─────────────── Operações ─────────────── */

export async function listZones(): Promise<PdnsZoneSummary[]> {
  return pdnsFetch<PdnsZoneSummary[]>("/zones");
}

export async function getZone(zone: string): Promise<PdnsZone> {
  return pdnsFetch<PdnsZone>(`/zones/${encodeURIComponent(zoneId(zone))}`);
}

export async function zoneExists(zone: string): Promise<boolean> {
  try {
    await getZone(zone);
    return true;
  } catch (err) {
    if (err instanceof PdnsHttpError && err.status === 404) return false;
    if (err instanceof PdnsHttpError && err.status === 422) return false;
    throw err;
  }
}

/**
 * Cria a zona como Master (SOA + NS nascem automáticos) e, se algum nameserver
 * pertencer à própria zona, grava o glue (A/AAAA de ns1/ns2).
 */
export async function createZone(zone: string): Promise<void> {
  const z = zone.replace(/\.$/, "").toLowerCase();
  const nameservers = NAMESERVERS.map((n) => `${n.host}.`);
  await pdnsFetch("/zones", {
    method: "POST",
    body: JSON.stringify({
      name: `${z}.`,
      kind: "Master",
      soa_edit_api: "DEFAULT",
      nameservers,
    }),
  });

  // Glue: para cada nameserver que é sub-host desta zona, publica o A dele.
  // Vários NS no mesmo host (mesma máquina) apenas repetem o mesmo IP — ok.
  const inZone = (host: string): boolean => host === z || host.endsWith(`.${z}`);
  const byHost = new Map<string, Set<string>>();
  for (const n of NAMESERVERS) {
    if (!inZone(n.host)) continue;
    const set = byHost.get(n.host) ?? new Set<string>();
    set.add(n.ip);
    byHost.set(n.host, set);
  }
  const glue: PdnsRRset[] = [...byHost.entries()].map(([host, ips]) => ({
    name: `${host}.`,
    type: "A",
    ttl: 3600,
    records: [...ips].map((ip) => ({ content: ip, disabled: false })),
  }));
  if (glue.length) await replaceRRsets(zone, glue);
}

/** Substitui (REPLACE) um conjunto de RRsets. */
export async function replaceRRsets(zone: string, rrsets: PdnsRRset[]): Promise<void> {
  await pdnsFetch(`/zones/${encodeURIComponent(zoneId(zone))}`, {
    method: "PATCH",
    body: JSON.stringify({
      rrsets: rrsets.map((r) => ({
        name: r.name,
        type: r.type,
        ttl: r.ttl,
        changetype: "REPLACE",
        records: r.records,
      })),
    }),
  });
}

/** Remove um RRset inteiro (name,type). */
export async function deleteRRset(zone: string, name: string, type: string): Promise<void> {
  await pdnsFetch(`/zones/${encodeURIComponent(zoneId(zone))}`, {
    method: "PATCH",
    body: JSON.stringify({
      rrsets: [{ name: fqdnOf(zone, name), type, changetype: "DELETE" }],
    }),
  });
}

export async function deleteZone(zone: string): Promise<void> {
  await pdnsFetch(`/zones/${encodeURIComponent(zoneId(zone))}`, { method: "DELETE" });
}

/** Serial atual (SOA) da zona, ou null se indisponível. */
export function serialOf(z: PdnsZone): number | null {
  const soa = z.rrsets.find((r) => r.type === "SOA");
  if (!soa || !soa.records[0]) return z.serial ?? null;
  const parts = soa.records[0].content.split(/\s+/);
  const serial = Number(parts[2]);
  return Number.isFinite(serial) ? serial : z.serial ?? null;
}
