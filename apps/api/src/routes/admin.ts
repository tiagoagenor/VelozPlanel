import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { count, eq, desc } from "drizzle-orm";
import {
  adminUser as adminUserSchema,
  createUserInput,
  updateUserInput,
  adminEnvironment as adminEnvSchema,
  resourceChangeInput,
  auditEntry as auditEntrySchema,
  wgPeer as wgPeerSchema,
  addWgPeerInput,
  plan as planSchema,
  createPlanInput,
  updatePlanInput,
  creditTransaction as creditTxSchema,
  addCreditInput,
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
  CreditTransaction,
  AdminOverview,
  ModuleInfo,
  PlanId,
  RuntimeKind,
  EnvState,
  AccountStatus,
  UserRole,
} from "@velozplanel/contracts";
import { db } from "../db/client";
import { users, environments, nodes, databases, auditLogs, wgPeers, plans, creditTransactions } from "../db/schema";
import type { UserRow, EnvironmentRow, WgPeerRow, AuditLogRow, PlanRow, CreditTransactionRow } from "../db/schema";
import { requireAdmin, hashPassword, ApiHttpError } from "../auth";
import { recordAudit } from "../audit";
import { rowToPlan, listPlans } from "../plans";
import * as agent from "../agent";

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

/** Saldo (soma do razão de créditos) por usuário. */
async function balanceByUser(): Promise<Map<string, number>> {
  const rows = await db.select().from(creditTransactions);
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.userId, (m.get(r.userId) ?? 0) + r.amountCents);
  return m;
}

async function userBalance(userId: string): Promise<number> {
  const rows = await db.select().from(creditTransactions).where(eq(creditTransactions.userId, userId));
  return rows.reduce((s, r) => s + r.amountCents, 0);
}

function toAdminUser(u: UserRow, envCount: number, balanceCents: number): AdminUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role as UserRole,
    status: (u.status as AccountStatus) ?? "active",
    envCount,
    balanceCents,
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
        balanceByUser(),
      ]);
      return allUsers.map((u) => toAdminUser(u, counts.get(u.id) ?? 0, balances.get(u.id) ?? 0));
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
      return toAdminUser(u, 0, 0);
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
      const bal = await userBalance(u.id);
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
          await agent.updateResources(env.containerId, memMb, vcpu);
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
      const inserted = await db
        .insert(creditTransactions)
        .values({
          userId: req.params.id,
          amountCents: req.body.amountCents,
          kind: req.body.amountCents >= 0 ? "admin_credit" : "admin_debit",
          reason: req.body.reason ?? null,
        })
        .returning();
      const tx = inserted[0];
      if (!tx) throw new ApiHttpError(500, "internal_error", "falha ao lançar crédito");
      await recordAudit(
        actor,
        "user.credit",
        target[0].email,
        `R$${(req.body.amountCents / 100).toFixed(2)} motivo="${req.body.reason ?? ""}"`,
        req,
      );
      return toCreditTx(tx);
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
