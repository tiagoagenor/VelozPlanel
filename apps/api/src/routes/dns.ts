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
  apiError,
} from "@velozplanel/contracts";
import type { DnsZone, DnsRRset, DnsServerInfo, CreateZoneResult, VerifyResult, DiscoverResult } from "@velozplanel/contracts";
import { requireAdmin } from "../auth";
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
} from "../dns-service";

const zoneParam = z.object({ name: z.string().min(3).max(253) });

/** Rotas ADMIN de DNS (gerência global). Delegam a lógica ao dns-service. */
export async function dnsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/admin/dns/server-info",
    { schema: { response: { 200: dnsServerInfoSchema, 401: apiError, 403: apiError } } },
    async (req): Promise<DnsServerInfo> => {
      await requireAdmin(req);
      return { nameservers: NAMESERVERS };
    },
  );

  app.get(
    "/admin/dns/zones",
    { schema: { response: { 200: z.array(dnsZoneSchema), 401: apiError, 403: apiError, 502: apiError } } },
    async (req): Promise<DnsZone[]> => {
      await requireAdmin(req);
      return buildZoneList({ systemOnly: true }); // super admin vê só os domínios do sistema
    },
  );

  app.post(
    "/admin/dns/zones",
    { schema: { body: createZoneInput, response: { 200: createZoneResultSchema, 401: apiError, 403: apiError, 409: apiError, 502: apiError } } },
    async (req): Promise<CreateZoneResult> => {
      const actor = await requireAdmin(req);
      return createZoneChecked(actor, req.body.name, req, null);
    },
  );

  app.get(
    "/admin/dns/zones/:name/rrsets",
    { schema: { params: zoneParam, response: { 200: z.array(dnsRRsetSchema), 401: apiError, 403: apiError, 404: apiError, 502: apiError } } },
    async (req): Promise<DnsRRset[]> => {
      await requireAdmin(req);
      return listRRsets(req.params.name.replace(/\.$/, "").toLowerCase());
    },
  );

  app.put(
    "/admin/dns/zones/:name/rrset",
    { schema: { params: zoneParam, body: upsertRRsetInput, response: { 200: z.array(dnsRRsetSchema), 401: apiError, 403: apiError, 404: apiError, 422: apiError, 502: apiError } } },
    async (req): Promise<DnsRRset[]> => {
      const actor = await requireAdmin(req);
      return upsertRRsetChecked(actor, req.params.name, req.body, req);
    },
  );

  app.delete(
    "/admin/dns/zones/:name/rrset",
    { schema: { params: zoneParam, body: deleteRRsetInput, response: { 200: z.array(dnsRRsetSchema), 401: apiError, 403: apiError, 404: apiError, 502: apiError } } },
    async (req): Promise<DnsRRset[]> => {
      const actor = await requireAdmin(req);
      return deleteRRsetChecked(actor, req.params.name, req.body, req);
    },
  );

  app.get(
    "/admin/dns/zones/:name/discover",
    { schema: { params: zoneParam, response: { 200: discoverResultSchema, 401: apiError, 403: apiError } } },
    async (req): Promise<DiscoverResult> => {
      await requireAdmin(req);
      return discoverZone(req.params.name.replace(/\.$/, "").toLowerCase());
    },
  );

  app.post(
    "/admin/dns/zones/:name/verify",
    { schema: { params: zoneParam, response: { 200: verifyResultSchema, 401: apiError, 403: apiError } } },
    async (req): Promise<VerifyResult> => {
      await requireAdmin(req);
      return verifyAndRecord(req.params.name.replace(/\.$/, "").toLowerCase());
    },
  );

  app.delete(
    "/admin/dns/zones/:name",
    { schema: { params: zoneParam, response: { 204: z.null(), 401: apiError, 403: apiError, 404: apiError, 409: apiError, 502: apiError } } },
    async (req, reply) => {
      const actor = await requireAdmin(req);
      await deleteZoneChecked(actor, req.params.name, req);
      return reply.status(204).send(null);
    },
  );
}
