import type { FastifyRequest } from "fastify";
import { db } from "./db/client";
import { auditLogs } from "./db/schema";
import type { SessionUser } from "@velozplanel/contracts";

/** Registra uma ação na auditoria (append-only). Nunca lança (não quebra a operação). */
export async function recordAudit(
  actor: SessionUser,
  action: string,
  target: string | null,
  detail: string | null,
  req?: FastifyRequest,
): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actorEmail: actor.email,
      actorRole: actor.role,
      action,
      target,
      detail,
      ip: req?.ip ?? null,
    });
  } catch {
    // auditoria não pode derrubar a ação principal
  }
}
