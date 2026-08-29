import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { count, eq, desc, sql } from "drizzle-orm";
import {
  adminUser as adminUserSchema,
  createUserInput,
  updateUserInput,
  adminEnvironment as adminEnvSchema,
  resourceChangeInput,
  grantSubdomainChangesInput,
  setDefaultRegionInput,
  sshSecuritySettings,
  setSshSecurityInput,
  auditEntry as auditEntrySchema,
  wgPeer as wgPeerSchema,
  addWgPeerInput,
  plan as planSchema,
  createPlanInput,
  updatePlanInput,
  envType as envTypeSchema,
  createEnvTypeInput,
  updateEnvTypeInput,
  creditTransaction as creditTxSchema,
  addCreditInput,
  billingSettings as billingSettingsSchema,
  billingRunHour as billingRunHourSchema,
  updateBillingSettingsInput,
  adminOverview as adminOverviewSchema,
  moduleInfo as moduleInfoSchema,
  apiError,
} from "@velozplanel/contracts";
import type {
  AdminUser,
  AdminEnvironment,
  AuditEntry,
  WgPeer,
  Plan,
  EnvType,
  CreditTransaction,
  BillingSettings,
  BillingRunHour,
  AdminOverview,
  ModuleInfo,
  PlanId,
  RuntimeKind,
  EnvState,
  AccountStatus,
  UserRole,
} from "@velozplanel/contracts";
import { db } from "../db/client";
import { balanceBreakdown, balanceBreakdownByUser, type BalanceBreakdown } from "../credits";
import { users, environments, nodes, databases, auditLogs, wgPeers, plans, envTypes, creditTransactions, platformSettings, reservedSubdomains } from "../db/schema";
import { reservedSubdomain as reservedSubdomainSchema, createReservedSubdomainInput, type ReservedSubdomain } from "@velozplanel/contracts";
import type { UserRow, EnvironmentRow, WgPeerRow, AuditLogRow, PlanRow, EnvTypeRow, CreditTransactionRow } from "../db/schema";
import { requireAdmin, hashPassword, ApiHttpError } from "../auth";
import { recordAudit } from "../audit";
import { rowToPlan, listPlans } from "../plans";
import { getSettings, runBilling, billingStatus, chargedTodayCents, recentRunHours } from "../billing";
import * as agent from "../agent";
import { agentUrlForEnv } from "../nodes";

const idParams = z.object({ id: z.string().uuid() });

async function envCountByUser(): Promise<Map<string, number>> {
  const rows = await db
    .select({ ownerId: environments.ownerId, c: count() })
    .from(environments)
    .groupBy(environments.ownerId);
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.ownerId, r.c);
  return m;
}

const ZERO_BALANCE: BalanceBreakdown = { totalCents: 0, bonusCents: 0, moneyCents: 0 };

function toAdminUser(u: UserRow, envCount: number, bal: BalanceBreakdown): AdminUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role as UserRole,
    status: (u.status as AccountStatus) ?? "active",
    envCount,
    balanceCents: bal.totalCents,
    bonusCents: bal.bonusCents,
    createdAt: u.createdAt.toISOString(),
  };
}

function toCreditTx(r: CreditTransactionRow): CreditTransaction {
  return {
    id: r.id,
    userId: r.userId,
    amountCents: r.amountCents,
    kind: r.kind,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
  };
}

function toWgPeer(p: WgPeerRow): WgPeer {
  return {
    id: p.id,
    nodeId: p.nodeId,
    name: p.name,
    privateIp: p.privateIp,
    endpoint: p.endpoint,
    publicKey: p.publicKey,
    status: p.status as WgPeer["status"],
    createdAt: p.createdAt.toISOString(),
  };
}

function toAuditEntry(a: AuditLogRow): AuditEntry {
  return {
    id: a.id,
    ts: a.ts.toISOString(),
    actorEmail: a.actorEmail,
    actorRole: a.actorRole,
    action: a.action,
    target: a.target,
    detail: a.detail,
    ip: a.ip,
  };
}

const MODULES: ModuleInfo[] = [
  { key: "runtime-php", label: "Runtime PHP", description: "PHP 5.6–8.4 por ambiente", scope: "environment", status: "active" },
  { key: "runtime-node", label: "Runtime Node.js", description: "Node 18–24 por ambiente", scope: "environment", status: "active" },
  { key: "files", label: "Arquivos", description: "Gerenciador de arquivos do ambiente", scope: "environment", status: "active" },
  { key: "db-mysql", label: "Banco MySQL/MariaDB", description: "Bancos por ambiente", scope: "node", status: "active" },
  { key: "ssl", label: "SSL/HTTPS", description: "Certificados (Let's Encrypt na infra)", scope: "environment", status: "builtin" },
  { key: "ssh", label: "SSH/SFTP", description: "Acesso por terminal (gateway na infra)", scope: "environment", status: "builtin" },
  { key: "dns", label: "DNS", description: "Domínio e registros por ambiente", scope: "environment", status: "builtin" },
  { key: "metrics", label: "Métricas", description: "Gráficos de consumo", scope: "platform", status: "active" },
  { key: "wireguard", label: "Rede WireGuard", description: "Malha privada entre nós", scope: "node", status: "planned" },
  { key: "backup", label: "Backup", description: "Backups e restauração", scope: "node", status: "planned" },
  { key: "pagamento", label: "Pagamento", description: "Gateway de pagamento plugável", scope: "platform", status: "planned" },
];

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /* ── Dashboard ── */
  app.get(
    "/admin/overview",
    { schema: { response: { 200: adminOverviewSchema, 401: apiError, 403: apiError } } },
    async (req): Promise<AdminOverview> => {
      await requireAdmin(req);
      const [allNodes, envs, allUsers, dbCount, allPlans] = await Promise.all([
        db.select().from(nodes),
        db.select().from(environments),
        db.select().from(users),
        db.select({ c: count() }).from(databases),
        listPlans(),
      ]);
      const priceByPlan = new Map(allPlans.map((p) => [p.id, p.priceMonthCents]));
      let monthly = 0;
      const envState = { running: 0, paused: 0, error: 0 };
      for (const e of envs) {
        if (e.state === "running") envState.running++;
        else if (e.state === "paused") envState.paused++;
        else if (e.state === "error") envState.error++;
        monthly += priceByPlan.get(e.plan) ?? 0;
      }
      return {
        nodes: { total: allNodes.length, online: allNodes.filter((n) => n.status === "online").length },
        environments: { total: envs.length, running: envState.running, paused: envState.paused, error: envState.error },
        users: { total: allUsers.length, clients: allUsers.filter((u) => u.role === "client").length },
        databases: dbCount[0]?.c ?? 0,
        monthlyRevenueCents: monthly,
      };
    },
  );

  /* ── Usuários ── */
  app.get(
    "/admin/users",
    { schema: { response: { 200: z.array(adminUserSchema), 401: apiError, 403: apiError } } },
    async (req): Promise<AdminUser[]> => {
      await requireAdmin(req);
      const [allUsers, counts, balances] = await Promise.all([
        db.select().from(users),
        envCountByUser(),
        balanceBreakdownByUser(),
      ]);
      return allUsers.map((u) => toAdminUser(u, counts.get(u.id) ?? 0, balances.get(u.id) ?? ZERO_BALANCE));
    },
  );

  app.post(
    "/admin/users",
    { schema: { body: createUserInput, response: { 200: adminUserSchema, 401: apiError, 403: apiError, 409: apiError } } },
    async (req): Promise<AdminUser> => {
      const actor = await requireAdmin(req);
      const existing = await db.select().from(users).where(eq(users.email, req.body.email)).limit(1);
      if (existing[0]) throw new ApiHttpError(409, "email_taken", "já existe um usuário com este e-mail");
      const passwordHash = await hashPassword(req.body.password);
      const inserted = await db
        .insert(users)
        .values({ name: req.body.name, email: req.body.email, role: req.body.role, passwordHash })
        .returning();
      const u = inserted[0];
      if (!u) throw new ApiHttpError(500, "internal_error", "falha ao criar usuário");
      await recordAudit(actor, "user.create", u.email, `role=${u.role}`, req);
      return toAdminUser(u, 0, ZERO_BALANCE);
    },
  );

  app.patch(
    "/admin/users/:id",
    { schema: { params: idParams, body: updateUserInput, response: { 200: adminUserSchema, 401: apiError, 403: apiError, 404: apiError } } },
    async (req): Promise<AdminUser> => {
      const actor = await requireAdmin(req);
      const patch: Partial<UserRow> = {};
      if (req.body.name !== undefined) patch.name = req.body.name;
      if (req.body.role !== undefined) patch.role = req.body.role;
      if (req.body.status !== undefined) patch.status = req.body.status;
      if (req.body.password !== undefined) patch.passwordHash = await hashPassword(req.body.password);
      const updated = await db.update(users).set(patch).where(eq(users.id, req.params.id)).returning();
      const u = updated[0];
      if (!u) throw new ApiHttpError(404, "not_found", "usuário não encontrado");
      const counts = await envCountByUser();
      const bal = await balanceBreakdown(u.id);
      await recordAudit(actor, "user.update", u.email, JSON.stringify(req.body), req);
      return toAdminUser(u, counts.get(u.id) ?? 0, bal);
    },
  );

  app.delete(
    "/admin/users/:id",
    { schema: { params: idParams, response: { 204: z.null(), 401: apiError, 403: apiError, 404: apiError, 409: apiError } } },
    async (req, reply) => {
      const actor = await requireAdmin(req);
      if (req.params.id === actor.id) throw new ApiHttpError(409, "self_delete", "você não pode excluir a própria conta");
      const rows = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);
      const u = rows[0];
      if (!u) throw new ApiHttpError(404, "not_found", "usuário não encontrado");
      await db.delete(users).where(eq(users.id, req.params.id));
      await recordAudit(actor, "user.delete", u.email, null, req);
      return reply.status(204).send(null);
    },
  );

  /* ── Ambientes da frota ── */
  const listEnvs = async (ownerId?: string): Promise<AdminEnvironment[]> => {
    const rows = await db
      .select({
        e: environments,
        ownerEmail: users.email,
        nodeName: nodes.name,
      })
      .from(environments)
      .leftJoin(users, eq(environments.ownerId, users.id))
      .leftJoin(nodes, eq(environments.nodeId, nodes.id));
    return rows
      .filter((r) => !ownerId || r.e.ownerId === ownerId)
      .map(({ e, ownerEmail, nodeName }) => ({
        id: e.id,
        name: e.name,
        ownerId: e.ownerId,
        ownerEmail: ownerEmail ?? "—",
        nodeId: e.nodeId,
        nodeName: nodeName ?? null,
        plan: e.plan as PlanId,
        runtime: { kind: e.runtimeKind as RuntimeKind, version: e.runtimeVersion },
        state: e.state as EnvState,
        createdAt: e.createdAt.toISOString(),
        subdomainChangesLeft: e.subdomainChangesLeft,
      }));
  };

  app.get(
    "/admin/environments",
    { schema: { response: { 200: z.array(adminEnvSchema), 401: apiError, 403: apiError } } },
    async (req): Promise<AdminEnvironment[]> => {
      await requireAdmin(req);
      return listEnvs();
    },
  );

  app.get(
    "/admin/users/:id/environments",
    { schema: { params: idParams, response: { 200: z.array(adminEnvSchema), 401: apiError, 403: apiError } } },
    async (req): Promise<AdminEnvironment[]> => {
      await requireAdmin(req);
      return listEnvs(req.params.id);
    },
  );

  /* ── Alterar vCPU/RAM a quente (requisito nº 9) ── */
  app.post(
    "/admin/environments/:id/resources",
    { schema: { params: idParams, body: resourceChangeInput, response: { 200: adminEnvSchema, 401: apiError, 403: apiError, 404: apiError, 502: apiError } } },
    async (req): Promise<AdminEnvironment> => {
      const actor = await requireAdmin(req);
      const rows = await db.select().from(environments).where(eq(environments.id, req.params.id)).limit(1);
      const env = rows[0];
      if (!env) throw new ApiHttpError(404, "not_found", "ambiente não encontrado");
      const { vcpu, memMb, reason } = req.body;
      // aplica a quente se estiver rodando (best-effort)
      if (env.containerId && env.state === "running") {
        try {
          await agent.updateResources(await agentUrlForEnv(env), env.containerId, memMb, vcpu);
        } catch (err) {
          throw new ApiHttpError(502, "agent_error", `falha ao aplicar recursos no nó: ${(err as Error).message}`);
        }
      }
      await db
        .update(environments)
        .set({ vcpuOverride: vcpu, memMbOverride: memMb })
        .where(eq(environments.id, env.id));
      await recordAudit(actor, "env.resources", `${env.name}`, `vcpu=${vcpu} memMb=${memMb} motivo="${reason}"`, req);
      const list = await listEnvs();
      const updated = list.find((e) => e.id === env.id);
      if (!updated) throw new ApiHttpError(500, "internal_error", "erro ao recarregar ambiente");
      return updated;
    },
  );

  // Libera N trocas adicionais de subdomínio para o cliente do ambiente.
  app.post(
    "/admin/environments/:id/subdomain-grant",
    { schema: { params: idParams, body: grantSubdomainChangesInput, response: { 200: adminEnvSchema, 401: apiError, 403: apiError, 404: apiError } } },
    async (req): Promise<AdminEnvironment> => {
      const actor = await requireAdmin(req);
      const rows = await db.select().from(environments).where(eq(environments.id, req.params.id)).limit(1);
      const env = rows[0];
      if (!env) throw new ApiHttpError(404, "not_found", "ambiente não encontrado");
      const { count: n } = req.body;
      await db
        .update(environments)
        .set({ subdomainChangesLeft: sql`${environments.subdomainChangesLeft} + ${n}` })
        .where(eq(environments.id, env.id));
      await recordAudit(actor, "env.subdomain_grant", `${env.name}`, `+${n} troca(s) de subdomínio`, req);
      const list = await listEnvs();
      const updated = list.find((e) => e.id === env.id);
      if (!updated) throw new ApiHttpError(500, "internal_error", "erro ao recarregar ambiente");
      return updated;
    },
  );

  // Define a região pré-selecionada no wizard de criar ambiente.
  app.put(
    "/admin/default-region",
    { schema: { body: setDefaultRegionInput, response: { 200: z.object({ region: z.string() }), 401: apiError, 403: apiError } } },
    async (req): Promise<{ region: string }> => {
      const actor = await requireAdmin(req);
      await db.insert(platformSettings).values({ id: 1 }).onConflictDoNothing();
      await db.update(platformSettings).set({ defaultRegion: req.body.region }).where(eq(platformSettings.id, 1));
      await recordAudit(actor, "settings.default_region", req.body.region, "", req);
      return { region: req.body.region };
    },
  );

  // Segurança do acesso SSH/SFTP: desconexão por inatividade (0 = desativado).
  app.get(
    "/admin/ssh-security",
    { schema: { response: { 200: sshSecuritySettings, 401: apiError, 403: apiError } } },
    async (req): Promise<{ idleTimeoutSeconds: number }> => {
      await requireAdmin(req);
      const rows = await db.select({ v: platformSettings.sshIdleTimeoutSeconds }).from(platformSettings).where(eq(platformSettings.id, 1)).limit(1);
      return { idleTimeoutSeconds: rows[0]?.v ?? 900 };
    },
  );
  app.put(
    "/admin/ssh-security",
    { schema: { body: setSshSecurityInput, response: { 200: sshSecuritySettings, 401: apiError, 403: apiError } } },
    async (req): Promise<{ idleTimeoutSeconds: number }> => {
      const actor = await requireAdmin(req);
      await db.insert(platformSettings).values({ id: 1 }).onConflictDoNothing();
      await db.update(platformSettings).set({ sshIdleTimeoutSeconds: req.body.idleTimeoutSeconds }).where(eq(platformSettings.id, 1));
      await recordAudit(actor, "settings.ssh_idle_timeout", String(req.body.idleTimeoutSeconds), "", req);
      return { idleTimeoutSeconds: req.body.idleTimeoutSeconds };
    },
  );

  /* ── Auditoria ── */
  app.get(
    "/admin/audit",
    { schema: { querystring: z.object({ limit: z.coerce.number().int().min(1).max(500).default(200) }), response: { 200: z.array(auditEntrySchema), 401: apiError, 403: apiError } } },
    async (req): Promise<AuditEntry[]> => {
      await requireAdmin(req);
      const rows = await db.select().from(auditLogs).orderBy(desc(auditLogs.ts)).limit(req.query.limit);
      return rows.map(toAuditEntry);
    },
  );

  /* ── Rede / WireGuard ── */
  app.get(
    "/admin/wg/peers",
    { schema: { response: { 200: z.array(wgPeerSchema), 401: apiError, 403: apiError } } },
    async (req): Promise<WgPeer[]> => {
      await requireAdmin(req);
      const rows = await db.select().from(wgPeers).orderBy(desc(wgPeers.createdAt));
      return rows.map(toWgPeer);
    },
  );

  app.post(
    "/admin/wg/peers",
    { schema: { body: addWgPeerInput, response: { 200: wgPeerSchema, 401: apiError, 403: apiError } } },
    async (req): Promise<WgPeer> => {
      const actor = await requireAdmin(req);
      const inserted = await db
        .insert(wgPeers)
        .values({
          name: req.body.name,
          nodeId: req.body.nodeId ?? null,
          privateIp: req.body.privateIp,
          endpoint: req.body.endpoint ?? null,
          publicKey: req.body.publicKey ?? null,
        })
        .returning();
      const p = inserted[0];
      if (!p) throw new ApiHttpError(500, "internal_error", "falha ao adicionar peer");
      await recordAudit(actor, "wg.peer.add", p.name, p.privateIp, req);
      return toWgPeer(p);
    },
  );

  app.delete(
    "/admin/wg/peers/:id",
    { schema: { params: idParams, response: { 204: z.null(), 401: apiError, 403: apiError, 404: apiError } } },
    async (req, reply) => {
      const actor = await requireAdmin(req);
      const rows = await db.select().from(wgPeers).where(eq(wgPeers.id, req.params.id)).limit(1);
      const p = rows[0];
      if (!p) throw new ApiHttpError(404, "not_found", "peer não encontrado");
      await db.delete(wgPeers).where(eq(wgPeers.id, req.params.id));
      await recordAudit(actor, "wg.peer.remove", p.name, null, req);
      return reply.status(204).send(null);
    },
  );

  /* ── Planos (CRUD) ── */
  app.get(
    "/admin/plans",
    { schema: { response: { 200: z.array(planSchema), 401: apiError, 403: apiError } } },
    async (req): Promise<Plan[]> => {
      await requireAdmin(req);
      const rows = await listPlans();
      return rows.map(rowToPlan);
    },
  );

  app.post(
    "/admin/plans",
    { schema: { body: createPlanInput, response: { 200: planSchema, 401: apiError, 403: apiError, 409: apiError } } },
    async (req): Promise<Plan> => {
      const actor = await requireAdmin(req);
      const existing = await db.select().from(plans).where(eq(plans.id, req.body.id)).limit(1);
      if (existing[0]) throw new ApiHttpError(409, "plan_exists", "já existe um plano com este id");
      const maxOrder = (await listPlans()).length;
      const inserted = await db
        .insert(plans)
        .values({
          id: req.body.id,
          label: req.body.label,
          vcpu: req.body.vcpu,
          memMb: req.body.memMb,
          diskGb: req.body.diskGb,
          priceMonthCents: req.body.priceMonthCents,
          maxEnvironments: req.body.maxEnvironments,
          active: req.body.active,
          sortOrder: maxOrder,
        })
        .returning();
      const p = inserted[0];
      if (!p) throw new ApiHttpError(500, "internal_error", "falha ao criar plano");
      await recordAudit(actor, "plan.create", p.id, `R$${(p.priceMonthCents / 100).toFixed(2)}`, req);
      return rowToPlan(p);
    },
  );

  app.patch(
    "/admin/plans/:id",
    { schema: { params: z.object({ id: z.string() }), body: updatePlanInput, response: { 200: planSchema, 401: apiError, 403: apiError, 404: apiError } } },
    async (req): Promise<Plan> => {
      const actor = await requireAdmin(req);
      const patch: Partial<PlanRow> = {};
      if (req.body.label !== undefined) patch.label = req.body.label;
      if (req.body.vcpu !== undefined) patch.vcpu = req.body.vcpu;
      if (req.body.memMb !== undefined) patch.memMb = req.body.memMb;
      if (req.body.diskGb !== undefined) patch.diskGb = req.body.diskGb;
      if (req.body.priceMonthCents !== undefined) patch.priceMonthCents = req.body.priceMonthCents;
      if (req.body.maxEnvironments !== undefined) patch.maxEnvironments = req.body.maxEnvironments;
      if (req.body.active !== undefined) patch.active = req.body.active;
      const updated = await db.update(plans).set(patch).where(eq(plans.id, req.params.id)).returning();
      const p = updated[0];
      if (!p) throw new ApiHttpError(404, "not_found", "plano não encontrado");
      await recordAudit(actor, "plan.update", p.id, JSON.stringify(req.body), req);
      return rowToPlan(p);
    },
  );

  app.delete(
    "/admin/plans/:id",
    { schema: { params: z.object({ id: z.string() }), response: { 204: z.null(), 401: apiError, 403: apiError, 404: apiError, 409: apiError } } },
    async (req, reply) => {
      const actor = await requireAdmin(req);
      const inUse = await db.select().from(environments).where(eq(environments.plan, req.params.id)).limit(1);
      if (inUse[0]) throw new ApiHttpError(409, "plan_in_use", "há ambientes usando este plano; desative-o em vez de excluir");
      const rows = await db.select().from(plans).where(eq(plans.id, req.params.id)).limit(1);
      if (!rows[0]) throw new ApiHttpError(404, "not_found", "plano não encontrado");
      await db.delete(plans).where(eq(plans.id, req.params.id));
      await recordAudit(actor, "plan.delete", req.params.id, null, req);
      return reply.status(204).send(null);
    },
  );

  /* ── Tipos de ambiente (preço por tipo — CRUD) ── */
  const rowToEnvType = (r: EnvTypeRow): EnvType => ({
    id: r.id,
    label: r.label,
    category: r.category as EnvType["category"],
    image: r.image,
    internalPort: r.internalPort,
    dataPath: r.dataPath,
    needsDb: r.needsDb,
    childType: r.childType,
    defaultTool: r.defaultTool as EnvType["defaultTool"],
    allowsPublicDomain: r.allowsPublicDomain,
    priceMonthCents: r.priceMonthCents,
    minVcpu: r.minVcpu,
    minMemMb: r.minMemMb,
    active: r.active,
    sortOrder: r.sortOrder,
  });

  app.get(
    "/admin/env-types",
    { schema: { response: { 200: z.array(envTypeSchema), 401: apiError, 403: apiError } } },
    async (req): Promise<EnvType[]> => {
      await requireAdmin(req);
      const rows = await db.select().from(envTypes).orderBy(envTypes.sortOrder);
      return rows.map(rowToEnvType);
    },
  );

  app.post(
    "/admin/env-types",
    { schema: { body: createEnvTypeInput, response: { 200: envTypeSchema, 401: apiError, 403: apiError, 409: apiError } } },
    async (req): Promise<EnvType> => {
      const actor = await requireAdmin(req);
      const existing = await db.select().from(envTypes).where(eq(envTypes.id, req.body.id)).limit(1);
      if (existing[0]) throw new ApiHttpError(409, "type_exists", "já existe um tipo com este id");
      const maxOrder = (await db.select().from(envTypes)).length;
      const inserted = await db
        .insert(envTypes)
        .values({
          id: req.body.id,
          label: req.body.label,
          category: req.body.category,
          image: req.body.image,
          internalPort: req.body.internalPort,
          dataPath: req.body.dataPath,
          needsDb: req.body.needsDb,
          childType: req.body.childType,
          defaultTool: req.body.defaultTool,
          allowsPublicDomain: req.body.allowsPublicDomain,
          priceMonthCents: req.body.priceMonthCents,
          minVcpu: req.body.minVcpu,
          minMemMb: req.body.minMemMb,
          active: req.body.active,
          sortOrder: maxOrder,
        })
        .returning();
      const t = inserted[0];
      if (!t) throw new ApiHttpError(500, "internal_error", "falha ao criar tipo");
      await recordAudit(actor, "envtype.create", t.id, `R$${(t.priceMonthCents / 100).toFixed(2)}`, req);
      return rowToEnvType(t);
    },
  );

  app.patch(
    "/admin/env-types/:id",
    { schema: { params: z.object({ id: z.string() }), body: updateEnvTypeInput, response: { 200: envTypeSchema, 401: apiError, 403: apiError, 404: apiError } } },
    async (req): Promise<EnvType> => {
      const actor = await requireAdmin(req);
      const patch: Partial<EnvTypeRow> = {};
      if (req.body.label !== undefined) patch.label = req.body.label;
      if (req.body.priceMonthCents !== undefined) patch.priceMonthCents = req.body.priceMonthCents;
      if (req.body.minVcpu !== undefined) patch.minVcpu = req.body.minVcpu;
      if (req.body.minMemMb !== undefined) patch.minMemMb = req.body.minMemMb;
      if (req.body.defaultTool !== undefined) patch.defaultTool = req.body.defaultTool;
      if (req.body.allowsPublicDomain !== undefined) patch.allowsPublicDomain = req.body.allowsPublicDomain;
      if (req.body.active !== undefined) patch.active = req.body.active;
      const updated = await db.update(envTypes).set(patch).where(eq(envTypes.id, req.params.id)).returning();
      const t = updated[0];
      if (!t) throw new ApiHttpError(404, "not_found", "tipo não encontrado");
      await recordAudit(actor, "envtype.update", t.id, JSON.stringify(req.body), req);
      return rowToEnvType(t);
    },
  );

  app.delete(
    "/admin/env-types/:id",
    { schema: { params: z.object({ id: z.string() }), response: { 204: z.null(), 401: apiError, 403: apiError, 404: apiError, 409: apiError } } },
    async (req, reply) => {
      const actor = await requireAdmin(req);
      const inUse = await db.select().from(environments).where(eq(environments.typeId, req.params.id)).limit(1);
      if (inUse[0]) throw new ApiHttpError(409, "type_in_use", "há ambientes usando este tipo; desative-o em vez de excluir");
      const rows = await db.select().from(envTypes).where(eq(envTypes.id, req.params.id)).limit(1);
      if (!rows[0]) throw new ApiHttpError(404, "not_found", "tipo não encontrado");
      await db.delete(envTypes).where(eq(envTypes.id, req.params.id));
      await recordAudit(actor, "envtype.delete", req.params.id, null, req);
      return reply.status(204).send(null);
    },
  );

  /* ── Subdomínios reservados (jamees.top) ── */
  const rowToReserved = (r: typeof reservedSubdomains.$inferSelect): ReservedSubdomain => ({
    name: r.name, reason: r.reason, locked: r.locked, createdAt: r.createdAt.toISOString(),
  });

  app.get(
    "/admin/reserved-subdomains",
    { schema: { response: { 200: z.array(reservedSubdomainSchema), 401: apiError, 403: apiError } } },
    async (req): Promise<ReservedSubdomain[]> => {
      await requireAdmin(req);
      const rows = await db.select().from(reservedSubdomains).orderBy(reservedSubdomains.name);
      return rows.map(rowToReserved);
    },
  );

  app.post(
    "/admin/reserved-subdomains",
    { schema: { body: createReservedSubdomainInput, response: { 200: reservedSubdomainSchema, 401: apiError, 403: apiError, 409: apiError } } },
    async (req): Promise<ReservedSubdomain> => {
      const actor = await requireAdmin(req);
      const existing = await db.select().from(reservedSubdomains).where(eq(reservedSubdomains.name, req.body.name)).limit(1);
      if (existing[0]) throw new ApiHttpError(409, "reserved_exists", "esse subdomínio já está reservado");
      const inserted = await db.insert(reservedSubdomains).values({ name: req.body.name, reason: req.body.reason ?? "reservado" }).returning();
      await recordAudit(actor, "reserved_subdomain.create", req.body.name, req.body.reason ?? null, req);
      return rowToReserved(inserted[0]!);
    },
  );

  app.delete(
    "/admin/reserved-subdomains/:name",
    { schema: { params: z.object({ name: z.string() }), response: { 204: z.null(), 401: apiError, 403: apiError, 404: apiError, 409: apiError } } },
    async (req, reply) => {
      const actor = await requireAdmin(req);
      const name = req.params.name.toLowerCase();
      const rows = await db.select().from(reservedSubdomains).where(eq(reservedSubdomains.name, name)).limit(1);
      if (!rows[0]) throw new ApiHttpError(404, "not_found", "reserva não encontrada");
      if (rows[0].locked) throw new ApiHttpError(409, "reserved_locked", "esse reservado é travado (infra/marca) e não pode ser removido");
      await db.delete(reservedSubdomains).where(eq(reservedSubdomains.name, name));
      await recordAudit(actor, "reserved_subdomain.delete", name, null, req);
      return reply.status(204).send(null);
    },
  );

  /* ── Créditos (saldo do cliente) ── */
  app.get(
    "/admin/users/:id/credits",
    { schema: { params: idParams, response: { 200: z.array(creditTxSchema), 401: apiError, 403: apiError } } },
    async (req): Promise<CreditTransaction[]> => {
      await requireAdmin(req);
      const rows = await db
        .select()
        .from(creditTransactions)
        .where(eq(creditTransactions.userId, req.params.id))
        .orderBy(desc(creditTransactions.createdAt));
      return rows.map(toCreditTx);
    },
  );

  app.post(
    "/admin/users/:id/credit",
    { schema: { params: idParams, body: addCreditInput, response: { 200: creditTxSchema, 401: apiError, 403: apiError, 404: apiError } } },
    async (req): Promise<CreditTransaction> => {
      const actor = await requireAdmin(req);
      const target = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);
      if (!target[0]) throw new ApiHttpError(404, "not_found", "usuário não encontrado");
      // Positivo: dinheiro (admin_money) ou bônus (admin_bonus). Negativo: débito.
      const txKind =
        req.body.amountCents < 0 ? "admin_debit" : req.body.kind === "bonus" ? "admin_bonus" : "admin_money";
      const inserted = await db
        .insert(creditTransactions)
        .values({
          userId: req.params.id,
          amountCents: req.body.amountCents,
          kind: txKind,
          reason: req.body.reason ?? null,
        })
        .returning();
      const tx = inserted[0];
      if (!tx) throw new ApiHttpError(500, "internal_error", "falha ao lançar crédito");
      await recordAudit(
        actor,
        "user.credit",
        target[0].email,
        `${txKind} R$${(req.body.amountCents / 100).toFixed(2)} motivo="${req.body.reason ?? ""}"`,
        req,
      );
      return toCreditTx(tx);
    },
  );

  /* ── Faturamento (cron de cobrança) ── */
  const buildBilling = async (): Promise<BillingSettings> => {
    const s = await getSettings();
    const st = billingStatus();
    const today = await chargedTodayCents();
    return {
      enabled: s.billingEnabled,
      intervalMinutes: s.billingIntervalMinutes,
      freeMinutes: s.billingFreeMinutes ?? 1,
      suspendOnZero: s.suspendOnZero,
      domainPriceMonthCents: s.domainPriceMonthCents ?? 100,
      rateVcpuMonthCents: s.rateVcpuMonthCents ?? 2000,
      rateRamGbMonthCents: s.rateRamGbMonthCents ?? 2000,
      rateDiskGbMonthCents: s.rateDiskGbMonthCents ?? 25,
      // "Última execução" = quando TERMINOU (não o cursor do agendador).
      lastRunAt: s.billingLastRunFinishedAt
        ? s.billingLastRunFinishedAt.toISOString()
        : s.billingLastRunAt
          ? s.billingLastRunAt.toISOString()
          : null,
      nextRunAt:
        s.billingEnabled && s.billingLastRunAt
          ? new Date(s.billingLastRunAt.getTime() + s.billingIntervalMinutes * 60_000).toISOString()
          : null,
      running: st.running,
      chargedTodayCents: today,
      lastInstances: s.billingLastInstances ?? null,
      lastSuspended: s.billingLastSuspended ?? null,
      lastChargedCents: s.billingLastChargedCents ?? null,
      lastOk: s.billingLastOk ?? null,
    };
  };

  app.get(
    "/admin/billing",
    { schema: { response: { 200: billingSettingsSchema, 401: apiError, 403: apiError } } },
    async (req): Promise<BillingSettings> => {
      await requireAdmin(req);
      return buildBilling();
    },
  );

  app.patch(
    "/admin/billing",
    { schema: { body: updateBillingSettingsInput, response: { 200: billingSettingsSchema, 401: apiError, 403: apiError } } },
    async (req): Promise<BillingSettings> => {
      const actor = await requireAdmin(req);
      await getSettings(); // garante a linha
      const patch: Partial<{ billingEnabled: boolean; billingIntervalMinutes: number; billingFreeMinutes: number; suspendOnZero: boolean; domainPriceMonthCents: number; rateVcpuMonthCents: number; rateRamGbMonthCents: number; rateDiskGbMonthCents: number }> = {};
      if (req.body.enabled !== undefined) patch.billingEnabled = req.body.enabled;
      if (req.body.intervalMinutes !== undefined) patch.billingIntervalMinutes = req.body.intervalMinutes;
      if (req.body.freeMinutes !== undefined) patch.billingFreeMinutes = req.body.freeMinutes;
      if (req.body.suspendOnZero !== undefined) patch.suspendOnZero = req.body.suspendOnZero;
      if (req.body.domainPriceMonthCents !== undefined) patch.domainPriceMonthCents = req.body.domainPriceMonthCents;
      if (req.body.rateVcpuMonthCents !== undefined) patch.rateVcpuMonthCents = req.body.rateVcpuMonthCents;
      if (req.body.rateRamGbMonthCents !== undefined) patch.rateRamGbMonthCents = req.body.rateRamGbMonthCents;
      if (req.body.rateDiskGbMonthCents !== undefined) patch.rateDiskGbMonthCents = req.body.rateDiskGbMonthCents;
      await db.update(platformSettings).set(patch).where(eq(platformSettings.id, 1));
      await recordAudit(actor, "billing.settings", null, JSON.stringify(req.body), req);
      return buildBilling();
    },
  );

  app.get(
    "/admin/billing-runs",
    { schema: { response: { 200: z.array(billingRunHourSchema), 401: apiError, 403: apiError } } },
    async (req): Promise<BillingRunHour[]> => {
      await requireAdmin(req);
      const rows = await recentRunHours(72);
      return rows.map((r) => ({
        hour: r.hour.toISOString(),
        runs: r.runs,
        chargedCents: r.chargedCents,
        chargeEvents: r.chargeEvents,
        suspended: r.suspended,
        instances: r.instances,
        errors: r.errors,
        firstRunAt: r.firstRunAt.toISOString(),
        lastRunAt: r.lastRunAt.toISOString(),
      }));
    },
  );

  app.post(
    "/admin/billing/run",
    { schema: { response: { 200: billingSettingsSchema, 401: apiError, 403: apiError } } },
    async (req): Promise<BillingSettings> => {
      const actor = await requireAdmin(req);
      const res = await runBilling(req.log);
      await db.update(platformSettings).set({ billingLastRunAt: new Date() }).where(eq(platformSettings.id, 1));
      await recordAudit(
        actor,
        "billing.run_now",
        null,
        `debitado R$${(res.chargedCents / 100).toFixed(2)} em ${res.envsCharged} ambiente(s), ${res.suspended} suspenso(s)`,
        req,
      );
      return buildBilling();
    },
  );

  /* ── Módulos ── */
  app.get(
    "/admin/modules",
    { schema: { response: { 200: z.array(moduleInfoSchema), 401: apiError, 403: apiError } } },
    async (req): Promise<ModuleInfo[]> => {
      await requireAdmin(req);
      return MODULES;
    },
  );
}
