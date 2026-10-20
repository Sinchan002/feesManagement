import { Router } from "express"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { prisma } from "../../lib/prisma"
import { pageMeta, paginate, paginationSchema, parse, toCsv } from "../../lib/http"
import { authenticate, requireAdmin } from "../../middleware/auth"

export const auditRouter = Router()
auditRouter.use(authenticate, requireAdmin)

const listSchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  action: z.string().trim().toUpperCase().max(60).optional(),
  entityType: z.string().trim().max(40).optional(),
  entityId: z.string().trim().max(64).optional(),
  actorRole: z.enum(["ADMIN", "STUDENT", "SYSTEM"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

const whereFrom = (q: z.infer<typeof listSchema>): Prisma.AuditLogWhereInput => ({
  ...(q.action ? { action: q.action } : {}),
  ...(q.entityType ? { entityType: q.entityType } : {}),
  ...(q.entityId ? { entityId: q.entityId } : {}),
  ...(q.actorRole ? { actorRole: q.actorRole } : {}),
  ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
  ...(q.search
    ? {
        OR: [
          { summary: { contains: q.search, mode: "insensitive" } },
          { action: { contains: q.search, mode: "insensitive" } },
          { actor: { name: { contains: q.search, mode: "insensitive" } } },
        ],
      }
    : {}),
})

const serialize = (a: Prisma.AuditLogGetPayload<{ include: { actor: { select: { name: true } } } }>) => ({
  id: a.id,
  action: a.action,
  entityType: a.entityType,
  entityId: a.entityId,
  summary: a.summary,
  metadata: a.metadata,
  actor: a.actor?.name ?? (a.actorRole === "SYSTEM" ? "Automated workflow" : null),
  actorRole: a.actorRole,
  ip: a.ip,
  createdAt: a.createdAt,
})

auditRouter.get("/", async (req, res) => {
  const q = parse(listSchema, req.query)
  const where = whereFrom(q)
  const [total, rows, actions] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, include: { actor: { select: { name: true } } }, orderBy: { createdAt: "desc" }, ...paginate(q) }),
    prisma.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
  ])
  res.json({ data: rows.map(serialize), meta: { ...pageMeta(total, q), actions: actions.map((a) => a.action) } })
})

auditRouter.get("/export.csv", async (req, res) => {
  const q = parse(listSchema, req.query)
  const rows = await prisma.auditLog.findMany({
    where: whereFrom(q),
    include: { actor: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 20_000,
  })
  const csv = toCsv(
    ["Time", "Action", "Summary", "Actor", "Role", "Entity", "Entity id", "IP"],
    rows.map(serialize).map((a) => [a.createdAt.toISOString(), a.action, a.summary, a.actor, a.actorRole, a.entityType, a.entityId, a.ip]),
  )
  res.setHeader("Content-Type", "text/csv; charset=utf-8")
  res.setHeader("Content-Disposition", `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`)
  res.send(csv)
})
