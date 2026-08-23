/**
 * Lógica de DNS compartilhada entre a área ADMIN (/admin/dns/*) e a área do
 * CLIENTE (/domains/*). Sem `requireAdmin`/`requireUser` aqui — as rotas fazem a
 * autorização e chamam estas funções puras. Mantém a proteção system/panel, o
 * read-after-write e as validações num único lugar.
 */
import { isIPv4, isIPv6 } from "node:net";
import { eq, and } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type {
  DnsRRset,
  DnsZone,
  VerifyResult,
  DnsZoneEffective,
  DnsPoint,
  CreateZoneResult,
  DiscoverResult,
  ServingStatus,
  SessionUser,
} from "@velozplanel/contracts";
import { db } from "./db/client";
import { dnsZonesMeta, envDomains, environments, users } from "./db/schema";
import type { DnsZoneMetaRow, EnvironmentRow } from "./db/schema";
import { ApiHttpError } from "./auth";
import { recordAudit } from "./audit";
import { httpHostForNode, agentUrlForNode } from "./nodes";
import * as agent from "./agent";
import { classifyRRset } from "./dns-protect";
import { verifyZone, discoverZone, resolveA } from "./dns-resolver";
import * as pdns from "./dns-pdns";
import { PdnsUnavailable, PdnsHttpError } from "./dns-pdns";

/* ─────────────── Erros do pdns → HTTP tipado ─────────────── */

export function mapPdnsError(err: unknown): never {
  if (err instanceof PdnsUnavailable) throw new ApiHttpError(502, "dns_unavailable", err.message);
  if (err instanceof PdnsHttpError) {
    if (err.status === 404) throw new ApiHttpError(404, "not_found", "zona não encontrada");
    if (err.status === 409) throw new ApiHttpError(409, "zone_exists", "já existe uma zona com este nome");
    throw new ApiHttpError(502, "dns_backend", `servidor DNS recusou: ${err.message}`);
  }
  throw err;
}

/* ─────────────── RRsets → contrato ─────────────── */

const RRSET_ORDER = ["SOA", "NS", "A", "AAAA", "CNAME", "MX", "TXT", "SRV", "CAA"];

export function toRRset(zone: string, r: pdns.PdnsRRset): DnsRRset {
  const label = pdns.labelOf(zone, r.name);
  const records = r.records
    .filter((x) => !x.disabled)
    .map((x) => (r.type === "TXT" ? x.content.replace(/^"(.*)"$/, "$1").replace(/\\"/g, '"').replace(/\\\\/g, "\\") : x.content));
  const p = classifyRRset(zone, label, r.type, records);
  return {
    name: label,
    fqdn: r.name,
    type: r.type as DnsRRset["type"],
    ttl: r.ttl,
    records,
    protected: p.protected,
    protectedReason: p.protectedReason,
    protectedMsg: p.protectedMsg,
  };
}

export function sortRRsets(a: DnsRRset, b: DnsRRset): number {
  if (a.name !== b.name) {
    if (a.name === "@") return -1;
    if (b.name === "@") return 1;
    return a.name.localeCompare(b.name);
  }
  return RRSET_ORDER.indexOf(a.type) - RRSET_ORDER.indexOf(b.type);
}

export function countUserRRsets(rrsets: DnsRRset[]): number {
  return rrsets.filter((r) => r.protectedReason !== "system").length;
}

export async function listRRsets(zone: string): Promise<DnsRRset[]> {
  try {
    const full = await pdns.getZone(zone);
    return full.rrsets.map((r) => toRRset(zone, r)).sort(sortRRsets);
  } catch (err) {
    mapPdnsError(err);
  }
}

/* ─────────────── Autorização por dono ─────────────── */

/** Carrega a meta da zona e garante que o usuário pode gerenciá-la. */
export async function loadZoneForUser(zone: string, user: SessionUser): Promise<DnsZoneMetaRow> {
  const z = zone.replace(/\.$/, "").toLowerCase();
  const rows = await db.select().from(dnsZonesMeta).where(eq(dnsZonesMeta.zone, z)).limit(1);
  const meta = rows[0];
  if (!meta) throw new ApiHttpError(404, "not_found", "domínio não encontrado");
  if (user.role !== "admin" && meta.ownerId !== user.id) {
    throw new ApiHttpError(403, "forbidden", "sem acesso a este domínio");
  }
  return meta;
}

async function loadEnvForUser(id: string, user: SessionUser): Promise<EnvironmentRow> {
  const rows = await db.select().from(environments).where(eq(environments.id, id)).limit(1);
  const env = rows[0];
  if (!env) throw new ApiHttpError(404, "not_found", "ambiente não encontrado");
  if (user.role !== "admin" && env.ownerId !== user.id) {
    throw new ApiHttpError(403, "forbidden", "sem acesso a este ambiente");
  }
  return env;
}

/* ─────────────── Validações por tipo (PT-BR) ─────────────── */

export function validateRecords(type: string, label: string, records: string[]): void {
  const apex = label === "@" || label === "";
  if (type === "CNAME" && apex) {
    throw new ApiHttpError(422, "cname_apex", "CNAME não é permitido no domínio raiz (@). Use um registro A.");
  }
  for (const raw of records) {
    const c = raw.trim();
    if (type === "A" && !isIPv4(c)) throw new ApiHttpError(422, "bad_ipv4", `"${c}" não é um IPv4 válido`);
    if (type === "AAAA" && !isIPv6(c)) throw new ApiHttpError(422, "bad_ipv6", `"${c}" não é um IPv6 válido`);
    if (type === "MX" && !/^\d+\s+\S+/.test(c)) throw new ApiHttpError(422, "bad_mx", 'MX deve ser "prioridade destino" (ex.: 10 mail.exemplo.com)');
    if (type === "SRV" && !/^\d+\s+\d+\s+\d+\s+\S+/.test(c)) throw new ApiHttpError(422, "bad_srv", 'SRV deve ser "prioridade peso porta destino" (ex.: 10 5 443 servico.exemplo.com)');
    if (type === "CAA" && !/^\d+\s+(issue|issuewild|iodef)\s+\S+/.test(c)) throw new ApiHttpError(422, "bad_caa", 'CAA deve ser "flags tag valor" (ex.: 0 issue "letsencrypt.org")');
    if (type === "TXT" && c.replace(/^"|"$/g, "").length > 255) throw new ApiHttpError(422, "bad_txt", "cada valor TXT deve ter no máximo 255 caracteres");
  }
}

/* ─────────────── Upsert / delete de RRset (com proteção) ─────────────── */

export async function upsertRRsetChecked(
  actor: SessionUser,
  zone: string,
  body: { name: string; type: string; ttl: number; records: string[] },
  req: FastifyRequest,
): Promise<DnsRRset[]> {
  const z = zone.replace(/\.$/, "").toLowerCase();
  const label = body.name.trim() === "" ? "@" : body.name.trim();
  const type = body.type;

  const prot = classifyRRset(z, label, type, body.records);
  if (prot.protectedReason === "system") {
    throw new ApiHttpError(403, "protected_system", prot.protectedMsg ?? "registro gerenciado pelo servidor");
  }
  validateRecords(type, label, body.records);

  let existing: pdns.PdnsZone;
  try {
    existing = await pdns.getZone(z);
  } catch (err) {
    mapPdnsError(err);
  }
  const fqdn = pdns.fqdnOf(z, label);
  const sameName = existing.rrsets.filter((r) => r.name === fqdn && r.type !== type);
  if (type === "CNAME" && sameName.length) {
    throw new ApiHttpError(422, "cname_coexist", "não é possível ter CNAME junto de outros registros no mesmo nome");
  }
  if (type !== "CNAME" && sameName.some((r) => r.type === "CNAME")) {
    throw new ApiHttpError(422, "cname_coexist", "este nome já tem um CNAME; remova-o antes de adicionar outros tipos");
  }

  const records = body.records.map((c) => ({ content: pdns.canonicalizeContent(type, c.trim(), z), disabled: false }));
  try {
    await pdns.replaceRRsets(z, [{ name: fqdn, type, ttl: body.ttl, records }]);
    const after = await pdns.getZone(z);
    const saved = after.rrsets.find((r) => r.name === fqdn && r.type === type);
    const savedSet = new Set((saved?.records ?? []).map((x) => x.content));
    const ok = records.every((r) => savedSet.has(r.content)) && savedSet.size === records.length;
    if (!ok) throw new ApiHttpError(502, "dns_backend", "o servidor DNS não confirmou a gravação");
    await recordAudit(actor, "dns.rrset.upsert", `${label} ${type} @ ${z}`, body.records.join(", "), req);
    return after.rrsets.map((r) => toRRset(z, r)).sort(sortRRsets);
  } catch (err) {
    if (err instanceof ApiHttpError) throw err;
    mapPdnsError(err);
  }
}

export async function deleteRRsetChecked(
  actor: SessionUser,
  zone: string,
  body: { name: string; type: string },
  req: FastifyRequest,
): Promise<DnsRRset[]> {
  const z = zone.replace(/\.$/, "").toLowerCase();
  const label = body.name.trim() === "" ? "@" : body.name.trim();
  const type = body.type;
  let existing: pdns.PdnsZone;
  try {
    existing = await pdns.getZone(z);
  } catch (err) {
    mapPdnsError(err);
  }
  const fqdn = pdns.fqdnOf(z, label);
  const target = existing.rrsets.find((r) => r.name === fqdn && r.type === type);
  const contents = target?.records.map((x) => x.content) ?? [];
  const prot = classifyRRset(z, label, type, contents);
  if (prot.protected) throw new ApiHttpError(403, "protected_record", prot.protectedMsg ?? "registro protegido");
  try {
    await pdns.deleteRRset(z, label, type);
    // Se esse label estava vinculado a um ambiente, desvincula também.
    await db.delete(envDomains).where(and(eq(envDomains.zone, z), eq(envDomains.label, label))).catch(() => {});
    await recordAudit(actor, "dns.rrset.delete", `${label} ${type} @ ${z}`, null, req);
    const after = await pdns.getZone(z);
    return after.rrsets.map((r) => toRRset(z, r)).sort(sortRRsets);
  } catch (err) {
    mapPdnsError(err);
  }
}

/* ─────────────── Criar / listar / excluir zona ─────────────── */

/** Cria a zona no pdns + linha meta (com dono). Anti-squatting: se já resolve, pending_verification. */
export async function createZoneChecked(
  actor: SessionUser,
  name: string,
  req: FastifyRequest,
  ownerId: string | null,
): Promise<CreateZoneResult> {
  const z = name.replace(/\.$/, "").toLowerCase();

  // Isolamento: um cliente não pode cadastrar um domínio que seja igual, pai ou
  // filho de um domínio de OUTRA conta ou do SISTEMA (owner_id null). Admin
  // (ownerId null) cadastra domínios do sistema livremente.
  if (ownerId !== null) {
    const all = await db.select().from(dnsZonesMeta);
    for (const m of all) {
      const related = m.zone === z || z.endsWith(`.${m.zone}`) || m.zone.endsWith(`.${z}`);
      if (related && m.ownerId !== ownerId) {
        throw new ApiHttpError(403, "zone_conflict", "este domínio (ou um domínio-pai/filho) pertence a outra conta ou ao sistema");
      }
    }
  }

  try {
    if (await pdns.zoneExists(z)) throw new ApiHttpError(409, "zone_exists", "já existe um domínio com este nome");
  } catch (err) {
    if (err instanceof ApiHttpError) throw err;
    mapPdnsError(err);
  }

  const discovered = await discoverZone(z).catch(() => ({ partial: true, rrsets: [] as DiscoverResult["rrsets"] }));
  const apexA = discovered.rrsets.find((r) => r.name === "@" && r.type === "A");
  // Conservador: se já resolve OU o discover foi parcial (timeout), tratamos como "já em uso".
  const alreadyResolves = discovered.rrsets.length > 0 || discovered.partial === true;
  const resolvesTo = apexA?.records ?? [];

  try {
    await pdns.createZone(z);
  } catch (err) {
    mapPdnsError(err);
  }

  const status = alreadyResolves ? "pending_verification" : "pending";
  await db
    .insert(dnsZonesMeta)
    .values({ zone: z, status, createdBy: actor.id, ownerId })
    .onConflictDoNothing({ target: dnsZonesMeta.zone });

  await recordAudit(actor, "dns.zone.create", z, alreadyResolves ? "já resolvia (verificar delegação antes)" : null, req);

  const full = await pdns.getZone(z).catch(() => null);
  const rrsets = full ? full.rrsets.map((r) => toRRset(z, r)) : [];
  const ownerEmail = ownerId ? (await db.select({ e: users.email }).from(users).where(eq(users.id, ownerId)).limit(1))[0]?.e ?? null : null;
  const zone: DnsZone = {
    name: z,
    status,
    serial: full ? pdns.serialOf(full) : null,
    checkedAt: null,
    checkMsg: null,
    recordCount: countUserRRsets(rrsets),
    environmentId: null,
    ownerId,
    ownerEmail,
    deletable: true,
    undeletableReason: null,
  };
  return { zone, alreadyResolves, resolvesTo };
}

/**
 * Lista de zonas (pdns = fonte da verdade) + meta.
 *  - { ownerId } → só do dono (cliente).
 *  - { systemOnly } → só os do SISTEMA (owner null) — a área do super admin.
 *  - sem filtro → todas.
 */
export async function buildZoneList(filter?: { ownerId?: string; systemOnly?: boolean }): Promise<DnsZone[]> {
  let summaries: pdns.PdnsZoneSummary[];
  try {
    summaries = await pdns.listZones();
  } catch (err) {
    mapPdnsError(err);
  }
  const metaRows = await db.select().from(dnsZonesMeta);
  const metaByZone = new Map(metaRows.map((m) => [m.zone, m]));
  const ownerIds = [...new Set(metaRows.map((m) => m.ownerId).filter((x): x is string => !!x))];
  const emailById = new Map<string, string>();
  if (ownerIds.length) {
    const urows = await db.select({ id: users.id, email: users.email }).from(users);
    for (const u of urows) emailById.set(u.id, u.email);
  }

  const zones: DnsZone[] = [];
  for (const s of summaries) {
    const nm = s.name.replace(/\.$/, "");
    const meta = metaByZone.get(nm);
    if (filter?.ownerId && meta?.ownerId !== filter.ownerId) continue;
    if (filter?.systemOnly && meta?.ownerId != null) continue;
    let rrsets: DnsRRset[] = [];
    try {
      const full = await pdns.getZone(nm);
      rrsets = full.rrsets.map((r) => toRRset(nm, r));
    } catch {
      /* zona sumiu no meio — ignora */
    }
    const hasPanelProtected = rrsets.some((r) => r.protectedReason === "panel");
    const linkedEnv = meta?.environmentId ?? null;
    // Domínio apontado NÃO bloqueia a exclusão — ela desfaz os apontamentos em
    // cascata. Só registros da infra do painel travam a exclusão.
    const undeletableReason = hasPanelProtected ? "Contém registros da infraestrutura do painel." : null;
    zones.push({
      name: nm,
      status: (meta?.status as DnsZone["status"]) ?? "pending",
      serial: meta?.serial ?? s.serial ?? null,
      checkedAt: meta?.checkedAt ? meta.checkedAt.toISOString() : null,
      checkMsg: meta?.checkMsg ?? null,
      recordCount: countUserRRsets(rrsets),
      environmentId: linkedEnv,
      ownerId: meta?.ownerId ?? null,
      ownerEmail: meta?.ownerId ? emailById.get(meta.ownerId) ?? null : null,
      deletable: undeletableReason === null,
      undeletableReason,
    });
  }
  return zones.sort((a, b) => a.name.localeCompare(b.name));
}

export async function deleteZoneChecked(actor: SessionUser, zone: string, req: FastifyRequest): Promise<void> {
  const z = zone.replace(/\.$/, "").toLowerCase();
  try {
    const full = await pdns.getZone(z);
    const hasPanel = full.rrsets.some(
      (r) => classifyRRset(z, pdns.labelOf(z, r.name), r.type, r.records.map((x) => x.content)).protectedReason === "panel",
    );
    if (hasPanel) throw new ApiHttpError(409, "zone_protected", "o domínio contém registros da infraestrutura do painel");
  } catch (err) {
    if (err instanceof ApiHttpError) throw err;
    mapPdnsError(err);
  }

  // Cascata: despublica os vhosts/HTTPS de todos os apontamentos deste domínio.
  const links = await db.select().from(envDomains).where(eq(envDomains.zone, z));
  const byEnv = new Map<string, string[]>();
  for (const l of links) {
    const arr = byEnv.get(l.environmentId) ?? [];
    arr.push(l.label);
    byEnv.set(l.environmentId, arr);
  }
  for (const [envId, labels] of byEnv) {
    const env = (await db.select().from(environments).where(eq(environments.id, envId)).limit(1))[0];
    await unpublishForEnv(env, z, labels);
    // Limpa a coluna de domínio do ambiente, se apontava para esta zona.
    if (env?.domain && (env.domain === z || env.domain.endsWith(`.${z}`))) {
      await db.update(environments).set({ domain: null }).where(eq(environments.id, envId)).catch(() => {});
    }
  }

  try {
    await pdns.deleteZone(z);
  } catch (err) {
    mapPdnsError(err);
  }
  await db.delete(envDomains).where(eq(envDomains.zone, z)).catch(() => {});
  await db.delete(dnsZonesMeta).where(eq(dnsZonesMeta.zone, z));
  await recordAudit(actor, "dns.zone.delete", z, null, req);
}

/* ─────────────── Verificação (com diagnóstico do apontamento) ─────────────── */

export async function verifyAndRecord(zone: string): Promise<VerifyResult> {
  const z = zone.replace(/\.$/, "").toLowerCase();
  const base = await verifyZone(z);

  // Diagnóstico: se há um apontamento primário, compara o A público com o host do ambiente.
  const primary = (await db.select().from(envDomains).where(and(eq(envDomains.zone, z), eq(envDomains.isPrimary, true))).limit(1))[0]
    ?? (await db.select().from(envDomains).where(eq(envDomains.zone, z)).limit(1))[0];
  let resolvedTo: string[] = [];
  let expected: string | null = null;
  let match = false;
  if (primary) {
    const env = (await db.select().from(environments).where(eq(environments.id, primary.environmentId)).limit(1))[0];
    if (env) expected = await httpHostForNode(env.nodeId);
    const fqdn = primary.label === "@" ? z : `${primary.label}.${z}`;
    resolvedTo = await resolveA(fqdn);
    match = expected !== null && resolvedTo.includes(expected);
  }

  const result: VerifyResult = { ...base, resolvedTo, expected, match };
  await db
    .update(dnsZonesMeta)
    .set({ status: result.status, serial: result.serial, checkedAt: new Date(result.checkedAt), checkMsg: result.error })
    .where(eq(dnsZonesMeta.zone, z))
    .catch(() => {});
  return result;
}

/* ─────────────── Apontar / desapontar para ambiente ─────────────── */

function fqdnFor(zone: string, label: string): string {
  return label === "@" ? zone : `${label}.${zone}`;
}

/**
 * Best-effort: publica o vhost/HTTPS de cada label no Caddy do nó do ambiente
 * (via agente). Marca env_domains.published. Falha silenciosa (fica "dns_pronto").
 */
async function publishForEnv(env: EnvironmentRow, zone: string, labels: string[]): Promise<void> {
  if (!env.httpPort) return;
  let agentUrl: string;
  try {
    agentUrl = await agentUrlForNode(env.nodeId);
  } catch {
    return;
  }
  const upstream = `127.0.0.1:${env.httpPort}`;
  for (const label of labels) {
    const fqdn = fqdnFor(zone, label);
    try {
      await agent.publishSite(agentUrl, fqdn, upstream);
      await db.update(envDomains).set({ published: true }).where(and(eq(envDomains.zone, zone), eq(envDomains.label, label)));
    } catch {
      /* nó sem Caddy gerenciável ou agente fora — segue como dns_pronto */
    }
  }
}

async function unpublishForEnv(env: EnvironmentRow | undefined, zone: string, labels: string[]): Promise<void> {
  if (!env) return;
  let agentUrl: string;
  try {
    agentUrl = await agentUrlForNode(env.nodeId);
  } catch {
    return;
  }
  for (const label of labels) {
    await agent.unpublishSite(agentUrl, fqdnFor(zone, label)).catch(() => {});
  }
}

export async function pointEnvironment(
  user: SessionUser,
  zone: string,
  input: { label: string; environmentId: string; includeWww: boolean },
  req: FastifyRequest,
): Promise<DnsZoneEffective> {
  const z = zone.replace(/\.$/, "").toLowerCase();
  await loadZoneForUser(z, user);
  const env = await loadEnvForUser(input.environmentId, user);

  const host = await httpHostForNode(env.nodeId);
  if (!host || !isIPv4(host)) {
    throw new ApiHttpError(409, "no_host", "este ambiente ainda não tem um IP público para receber o domínio");
  }

  const rawLabel = input.label.trim().replace(/\.$/, "").toLowerCase();
  const label = rawLabel === "" || rawLabel === z ? "@" : rawLabel;

  // Alvos a apontar: o label pedido (+ www quando for o apex e includeWww).
  const targets: Array<{ label: string; primary: boolean }> = [{ label, primary: true }];
  if (label === "@" && input.includeWww) targets.push({ label: "www", primary: false });

  let existing: pdns.PdnsZone;
  try {
    existing = await pdns.getZone(z);
  } catch (err) {
    mapPdnsError(err);
  }

  for (const t of targets) {
    const fqdn = pdns.fqdnOf(z, t.label);
    // CNAME no mesmo nome bloqueia um A.
    if (existing.rrsets.some((r) => r.name === fqdn && r.type === "CNAME")) {
      throw new ApiHttpError(422, "cname_conflict", `o nome "${t.label}" já tem um CNAME; remova-o antes de apontar para um ambiente`);
    }
  }

  for (const t of targets) {
    const fqdn = pdns.fqdnOf(z, t.label);
    try {
      await pdns.replaceRRsets(z, [{ name: fqdn, type: "A", ttl: 300, records: [{ content: host, disabled: false }] }]);
    } catch (err) {
      mapPdnsError(err);
    }
    // Vínculo (upsert por zona+label).
    const existingLink = (await db.select().from(envDomains).where(and(eq(envDomains.zone, z), eq(envDomains.label, t.label))).limit(1))[0];
    if (existingLink) {
      await db.update(envDomains).set({ environmentId: env.id, ownerId: env.ownerId, isPrimary: t.primary }).where(eq(envDomains.id, existingLink.id));
    } else {
      await db.insert(envDomains).values({ zone: z, label: t.label, environmentId: env.id, ownerId: env.ownerId, isPrimary: t.primary });
    }
  }

  // O label primário vira o domínio do ambiente (coluna única).
  if (targets.some((t) => t.primary)) {
    await db.update(environments).set({ domain: fqdnFor(z, label) }).where(eq(environments.id, env.id)).catch(() => {});
    await db.update(dnsZonesMeta).set({ environmentId: env.id }).where(eq(dnsZonesMeta.zone, z)).catch(() => {});
  }

  // Publica o vhost/HTTPS no Caddy do nó (best-effort).
  await publishForEnv(env, z, targets.map((t) => t.label));

  await recordAudit(user, "dns.point", `${fqdnFor(z, label)} → ${env.name}`, null, req);
  return effectiveForZone(z, user);
}

export async function unpointEnvironment(user: SessionUser, zone: string, label: string, req: FastifyRequest): Promise<DnsZoneEffective> {
  const z = zone.replace(/\.$/, "").toLowerCase();
  await loadZoneForUser(z, user);
  const lbl = label.trim() === "" ? "@" : label.trim().toLowerCase();

  const link = (await db.select().from(envDomains).where(and(eq(envDomains.zone, z), eq(envDomains.label, lbl))).limit(1))[0];
  if (link) {
    // Remove o A criado + o vínculo. www acompanha o apex.
    const labels = lbl === "@" ? ["@", "www"] : [lbl];
    const env = (await db.select().from(environments).where(eq(environments.id, link.environmentId)).limit(1))[0];
    await unpublishForEnv(env, z, labels); // tira o vhost do Caddy do nó
    for (const l of labels) {
      await pdns.deleteRRset(z, l, "A").catch(() => {});
      await db.delete(envDomains).where(and(eq(envDomains.zone, z), eq(envDomains.label, l))).catch(() => {});
    }
    // Se era o domínio primário do ambiente, limpa a coluna.
    if (link.isPrimary) {
      await db.update(environments).set({ domain: null }).where(eq(environments.id, link.environmentId)).catch(() => {});
    }
    // Se a zona não tem mais vínculos, solta environment_id da meta.
    const rest = await db.select().from(envDomains).where(eq(envDomains.zone, z));
    if (rest.length === 0) await db.update(dnsZonesMeta).set({ environmentId: null }).where(eq(dnsZonesMeta.zone, z)).catch(() => {});
    await recordAudit(user, "dns.unpoint", `${fqdnFor(z, lbl)}`, null, req);
  }
  return effectiveForZone(z, user);
}

/* ─────────────── Preview "como está ficando" ─────────────── */

export async function effectiveForZone(zone: string, user: SessionUser): Promise<DnsZoneEffective> {
  const z = zone.replace(/\.$/, "").toLowerCase();
  await loadZoneForUser(z, user);

  let full: pdns.PdnsZone;
  try {
    full = await pdns.getZone(z);
  } catch (err) {
    mapPdnsError(err);
  }
  const rrsets = full.rrsets.map((r) => toRRset(z, r));
  const links = await db.select().from(envDomains).where(eq(envDomains.zone, z));

  const points: DnsZoneEffective["points"] = [];
  const warnings: DnsZoneEffective["warnings"] = [];

  for (const link of links) {
    const env = (await db.select().from(environments).where(eq(environments.id, link.environmentId)).limit(1))[0];
    const host = env ? await httpHostForNode(env.nodeId) : null;
    const fqdn = fqdnFor(z, link.label);
    const aRR = rrsets.find((r) => r.name === link.label && r.type === "A");
    const managed = !!host && !!aRR && aRR.records.includes(host);
    const resolved = await resolveA(fqdn);
    const resolvedTo = resolved[0] ?? null;

    let servingStatus: ServingStatus;
    if (link.published) servingStatus = "publicado";
    else if (!aRR) servingStatus = "sem_apontamento";
    else if (host && resolved.includes(host)) servingStatus = "dns_pronto";
    else servingStatus = "aguardando_propagacao";

    points.push({
      zone: z,
      label: link.label,
      fqdn,
      environmentId: link.environmentId,
      environmentName: env?.name ?? "(ambiente removido)",
      envState: env?.state ?? "unknown",
      servingStatus,
      managed,
      resolvedTo,
    });
    if (aRR && !managed) {
      warnings.push({ label: link.label, msg: `${fqdn} aponta para um IP que não é o do ambiente atual — reaponte para corrigir.` });
    }
  }

  const mail = rrsets
    .filter((r) => r.type === "MX")
    .flatMap((r) => r.records.map((c) => {
      const m = c.match(/^(\d+)\s+(.+)$/);
      return { via: (m?.[2] ?? c).replace(/\.$/, ""), prio: m ? Number(m[1]) : 0 };
    }));

  const ssl = rrsets
    .filter((r) => r.type === "CAA")
    .flatMap((r) => r.records.map((c) => {
      const m = c.match(/issue(?:wild)?\s+"?([^"]+)"?/);
      return { ca: m?.[1] ?? c };
    }));

  const verifications = rrsets
    .filter((r) => r.type === "TXT")
    .flatMap((r) => r.records
      .filter((c) => /verification|verify|_domainkey|dmarc|^v=spf/i.test(c) || r.name.startsWith("_"))
      .map((c) => {
        const kind = /google-site-verification/i.test(c) ? "Google"
          : /^v=spf/i.test(c) ? "SPF (e-mail)"
          : /dmarc/i.test(c) || r.name.includes("_dmarc") ? "DMARC"
          : /_domainkey/i.test(r.name) ? "DKIM"
          : "Verificação";
        return { kind, label: r.name === "@" ? z : r.fqdn.replace(/\.$/, "") };
      }));

  return { zone: z, points, mail, ssl, verifications, warnings };
}

/** Domínios/subdomínios que apontam para um ambiente (para a aba do ambiente). */
export async function domainsForEnvironment(user: SessionUser, envId: string): Promise<DnsPoint[]> {
  const env = await loadEnvForUser(envId, user);
  const links = await db.select().from(envDomains).where(eq(envDomains.environmentId, envId));
  const host = await httpHostForNode(env.nodeId);

  const byZone = new Map<string, typeof links>();
  for (const l of links) {
    const arr = byZone.get(l.zone) ?? [];
    arr.push(l);
    byZone.set(l.zone, arr);
  }

  const points: DnsPoint[] = [];
  for (const [zone, ls] of byZone) {
    let rrsets: DnsRRset[] = [];
    try {
      const full = await pdns.getZone(zone);
      rrsets = full.rrsets.map((r) => toRRset(zone, r));
    } catch {
      /* zona sumiu — segue */
    }
    for (const l of ls) {
      const fqdn = l.label === "@" ? zone : `${l.label}.${zone}`;
      const aRR = rrsets.find((r) => r.name === l.label && r.type === "A");
      const managed = !!host && !!aRR && aRR.records.includes(host);
      const resolved = await resolveA(fqdn);
      let servingStatus: ServingStatus;
      if (l.published) servingStatus = "publicado";
      else if (!aRR) servingStatus = "sem_apontamento";
      else if (host && resolved.includes(host)) servingStatus = "dns_pronto";
      else servingStatus = "aguardando_propagacao";
      points.push({
        zone,
        label: l.label,
        fqdn,
        environmentId: envId,
        environmentName: env.name,
        envState: env.state,
        servingStatus,
        managed,
        resolvedTo: resolved[0] ?? null,
      });
    }
  }
  return points.sort((a, b) => a.fqdn.localeCompare(b.fqdn));
}

/* ─────────────── Export (BIND-like, round-trippable) ─────────────── */

export async function exportZone(zone: string): Promise<string> {
  const z = zone.replace(/\.$/, "").toLowerCase();
  const rrsets = await listRRsets(z);
  const lines: string[] = [`; Zona ${z} — exportada pelo Jamees`, `$ORIGIN ${z}.`, ""];
  for (const r of rrsets) {
    if (r.protectedReason === "system") continue; // SOA/NS/glue não exportam
    const name = r.name === "@" ? "@" : r.name;
    for (const c of r.records) lines.push(`${name}\t${r.ttl}\tIN\t${r.type}\t${c}`);
  }
  return lines.join("\n") + "\n";
}
