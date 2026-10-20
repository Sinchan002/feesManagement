import type { Request } from "express"
import type { Prisma } from "@prisma/client"
import { prisma, type Db } from "./prisma"

export type AuditInput = {
  action: string
  entityType: string
  entityId?: string | null
  summary: string
  metadata?: Prisma.InputJsonValue
}

export type Actor = { id: string | null; role: string; ip?: string | null }

export const actorFrom = (req: Request): Actor => ({
  id: req.auth?.userId ?? null,
  role: req.auth?.role ?? "ANONYMOUS",
  ip: req.ip ?? null,
})
export const SYSTEM_ACTOR: Actor = { id: null, role: "SYSTEM" }

/** Append an audit entry. Pass the transaction client so the entry commits with the change. */
export async function audit(actor: Actor, input: AuditInput, db: Db = prisma) {
  await db.auditLog.create({
    data: {
      actorId: actor.id,
      actorRole: actor.role,
      ip: actor.ip ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary,
      metadata: input.metadata,
    },
  })
}
