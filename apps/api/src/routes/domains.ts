import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  dnsZone as dnsZoneSchema,
  dnsRRset as dnsRRsetSchema,
  dnsServerInfo as dnsServerInfoSchema,
  createZoneInput,
  createZoneResult as createZoneResultSchema,
  upsertRRsetInput,
  deleteRRsetInput,
  verifyResult as verifyResultSchema,
  discoverResult as discoverResultSchema,
  dnsZoneEffective as dnsZoneEffectiveSchema,
  dnsPoint as dnsPointSchema,
  pointInput,
  pointResult as pointResultSchema,
  apiError,
} from "@velozplanel/contracts";
import type {
  DnsZone,
  DnsRRset,
  DnsServerInfo,
  CreateZoneResult,
  VerifyResult,
  DiscoverResult,
  DnsZoneEffective,
  PointResult,
} from "@velozplanel/contracts";
import { requireUser } from "../auth";
import { NAMESERVERS } from "../dns-pdns";
import { discoverZone } from "../dns-resolver";
import {
  buildZoneList,
  createZoneChecked,
  listRRsets,
  upsertRRsetChecked,
  deleteRRsetChecked,
  deleteZoneChecked,
  verifyAndRecord,
  loadZoneForUser,
  effectiveForZone,
  pointEnvironment,
  unpointEnvironment,
  domainsForEnvironment,
  exportZone,
} from "../dns-service";
import type { DnsPoint } from "@velozplanel/contracts";

const zoneParam = z.object({ zone: z.string().min(3).max(253) });
const zoneExport = z.object({ content: z.string() });

/** Rotas do CLIENTE: cada usuário gerencia os PRÓPRIOS domínios. */
export async function domainsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/domains/server-info",
    { schema: { response: { 200: dnsServerInfoSchema, 401: apiError } } },
    async (req): Promise<DnsServerInfo> => {
      await requireUser(req);
      return { nameservers: NAMESERVERS };
    },
  );

  app.get(
    "/domains",
    { schema: { response: { 200: z.array(dnsZoneSchema), 401: apiError, 502: apiError } } },
    async (req): Promise<DnsZone[]> => {
      const user = await requireUser(req);
      return buildZoneList({ ownerId: user.id });
    },
  );

  app.post(
    "/domains",
    { schema: { body: createZoneInput, response: { 200: createZoneResultSchema, 401: apiError, 409: apiError, 502: apiError } } },
    async (req): Promise<CreateZoneResult> => {
      const user = await requireUser(req);
      return createZoneChecked(user, req.body.name, req, user.id);
    },
  );

  // Domínios/subdomínios apontando para um ambiente (aba do ambiente).
  app.get(
    "/domains/by-env/:envId",
    { schema: { params: z.object({ envId: z.string().uuid() }), response: { 200: z.array(dnsPointSchema), 401: apiError, 403: apiError, 404: apiError, 502: apiError } } },
    async (req): Promise<DnsPoint[]> => {
      const user = await requireUser(req);
      return domainsForEnvironment(user, req.params.envId);
    },
  );

  app.get(
    "/domains/:zone/rrsets",
    { schema: { params: zoneParam, response: { 200: z.array(dnsRRsetSchema), 401: apiError, 403: apiError, 404: apiError, 502: apiError } } },
    async (req): Promise<DnsRRset[]> => {
      const user = await requireUser(req);
      const zone = req.params.zone.replace(/\.$/, "").toLowerCase();
      await loadZoneForUser(zone, user);
      return listRRsets(zone);
    },
  );

  app.put(
    "/domains/:zone/rrset",
    { schema: { params: zoneParam, body: upsertRRsetInput, response: { 200: z.array(dnsRRsetSchema), 401: apiError, 403: apiError, 404: apiError, 422: apiError, 502: apiError } } },
    async (req): Promise<DnsRRset[]> => {
      const user = await requireUser(req);
      const zone = req.params.zone.replace(/\.$/, "").toLowerCase();
      await loadZoneForUser(zone, user);
      return upsertRRsetChecked(user, zone, req.body, req);
    },
  );

  app.delete(
    "/domains/:zone/rrset",
    { schema: { params: zoneParam, body: deleteRRsetInput, response: { 200: z.array(dnsRRsetSchema), 401: apiError, 403: apiError, 404: apiError, 502: apiError } } },
    async (req): Promise<DnsRRset[]> => {
      const user = await requireUser(req);
      const zone = req.params.zone.replace(/\.$/, "").toLowerCase();
      await loadZoneForUser(zone, user);
      return deleteRRsetChecked(user, zone, req.body, req);
    },
  );

  app.get(
    "/domains/:zone/discover",
    { schema: { params: zoneParam, response: { 200: discoverResultSchema, 401: apiError, 403: apiError, 404: apiError } } },
    async (req): Promise<DiscoverResult> => {
      const user = await requireUser(req);
      const zone = req.params.zone.replace(/\.$/, "").toLowerCase();
      await loadZoneForUser(zone, user);
      return discoverZone(zone);
    },
  );

  app.post(
    "/domains/:zone/verify",
    { schema: { params: zoneParam, response: { 200: verifyResultSchema, 401: apiError, 403: apiError, 404: apiError } } },
    async (req): Promise<VerifyResult> => {
      const user = await requireUser(req);
      const zone = req.params.zone.replace(/\.$/, "").toLowerCase();
      await loadZoneForUser(zone, user);
      return verifyAndRecord(zone);
    },
  );

  app.get(
    "/domains/:zone/effective",
    { schema: { params: zoneParam, response: { 200: dnsZoneEffectiveSchema, 401: apiError, 403: apiError, 404: apiError, 502: apiError } } },
    async (req): Promise<DnsZoneEffective> => {
      const user = await requireUser(req);
      return effectiveForZone(req.params.zone.replace(/\.$/, "").toLowerCase(), user);
    },
  );

  app.post(
    "/domains/:zone/point",
    { schema: { params: zoneParam, body: pointInput, response: { 200: pointResultSchema, 401: apiError, 403: apiError, 404: apiError, 409: apiError, 422: apiError, 502: apiError } } },
    async (req): Promise<PointResult> => {
      const user = await requireUser(req);
      const effective = await pointEnvironment(user, req.params.zone.replace(/\.$/, "").toLowerCase(), req.body, req);
      return { effective };
    },
  );

  app.delete(
    "/domains/:zone/point",
    { schema: { params: zoneParam, body: z.object({ label: z.string().default("@") }), response: { 200: pointResultSchema, 401: apiError, 403: apiError, 404: apiError, 502: apiError } } },
    async (req): Promise<PointResult> => {
      const user = await requireUser(req);
      const effective = await unpointEnvironment(user, req.params.zone.replace(/\.$/, "").toLowerCase(), req.body.label, req);
      return { effective };
    },
  );

  app.delete(
    "/domains/:zone",
    { schema: { params: zoneParam, response: { 204: z.null(), 401: apiError, 403: apiError, 404: apiError, 409: apiError, 502: apiError } } },
    async (req, reply) => {
      const user = await requireUser(req);
      const zone = req.params.zone.replace(/\.$/, "").toLowerCase();
      await loadZoneForUser(zone, user);
      await deleteZoneChecked(user, zone, req);
      return reply.status(204).send(null);
    },
  );

  app.get(
    "/domains/:zone/export",
    { schema: { params: zoneParam, response: { 200: zoneExport, 401: apiError, 403: apiError, 404: apiError, 502: apiError } } },
    async (req): Promise<{ content: string }> => {
      const user = await requireUser(req);
      const zone = req.params.zone.replace(/\.$/, "").toLowerCase();
      await loadZoneForUser(zone, user);
      return { content: await exportZone(zone) };
    },
  );
}
