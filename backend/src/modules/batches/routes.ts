import { Router } from "express"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { prisma } from "../../lib/prisma"
import { idParam, parse } from "../../lib/http"
import { badRequest, notFound } from "../../lib/errors"
import { actorFrom, audit } from "../../lib/audit"
import { nextBatchCode, nextRegistrationCode } from "../../lib/codes"
import { sendMail } from "../../lib/mailer"
import { toRupees } from "../../lib/money"
import { authenticate, requireAdmin } from "../../middleware/auth"
import {
  createBatchSchema,
  enrolledCounts,
  serializeBatch,
  updateBatchSchema,
  type BatchInput,
} from "./service"

/**
 * Public, read-only list of the batches the teacher has created (active only). It feeds the
 * landing page's "Courses & batches" section and the registration form's preferred-batch picker,
 * so both always show the same real data.
 */
export const publicBatchesRouter = Router()

publicBatchesRouter.get("/", async (_req, res) => {
  const batches = await prisma.batch.findMany({
    where: { status: "ACTIVE" },
    orderBy: [{ classLevel: "asc" }, { name: "asc" }],
  })
  const counts = await enrolledCounts(batches.map((b) => b.id))
  res.json({
    data: batches.map((b) => {
      const s = serializeBatch(b, counts.get(b.id) ?? 0)
      // Only what a prospective student needs — no student names or internal fields.
      return {
        id: s.id,
        code: s.code,
        name: s.name,
        classLevel: s.classLevel,
        subjects: s.subjects,
        schedule: s.schedule,
        time: s.time,
        monthlyFee: s.monthlyFee,
        capacity: s.capacity,
        seatsLeft: s.seatsAvailable,
        hasSeats: s.seatsAvailable > 0,
      }
    }),
  })
})

export const batchesRouter = Router()
batchesRouter.use(authenticate, requireAdmin)

const listSchema = z.object({
  status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]).optional(),
  search: z.string().trim().max(100).optional(),
  classLevel: z.string().trim().max(40).optional(),
})

batchesRouter.get("/", async (req, res) => {
  const q = parse(listSchema, req.query)
  const where: Prisma.BatchWhereInput = {
    ...(q.status ? { status: q.status } : { status: { not: "ARCHIVED" } }),
    ...(q.classLevel ? { classLevel: q.classLevel } : {}),
    ...(q.search
      ? {
          OR: [
            { name: { contains: q.search, mode: "insensitive" } },
            { code: { contains: q.search, mode: "insensitive" } },
          ],
        }
      : {}),
  }
  const batches = await prisma.batch.findMany({ where, orderBy: [{ status: "asc" }, { code: "asc" }] })
  const counts = await enrolledCounts(batches.map((b) => b.id))
  res.json({ data: batches.map((b) => serializeBatch(b, counts.get(b.id) ?? 0)) })
})

batchesRouter.get("/:id", async (req, res) => {
  const batch = await prisma.batch.findUnique({
    where: { id: idParam(req) },
    include: {
      enrollments: {
        where: { endedAt: null },
        include: { student: { include: { user: { select: { name: true, email: true, phone: true } } } } },
        orderBy: { startedAt: "asc" },
      },
      feeChanges: { orderBy: { createdAt: "desc" }, include: { changedBy: { select: { name: true } } } },
    },
  })
  if (!batch) throw notFound("Batch")
  const activeStudents = batch.enrollments.filter((e) => e.student.status === "ACTIVE")
  res.json({
    data: {
      ...serializeBatch(batch, activeStudents.length),
      roster: batch.enrollments.map((e) => ({
        studentId: e.studentId,
        code: e.student.code,
        name: e.student.user.name,
        email: e.student.user.email,
        phone: e.student.user.phone,
        status: e.student.status,
        enrolledAt: e.startedAt,
      })),
      feeHistory: batch.feeChanges.map((f) => ({
        oldFee: f.oldFee === null ? null : toRupees(f.oldFee),
        newFee: toRupees(f.newFee),
        changedBy: f.changedBy?.name ?? null,
        changedAt: f.createdAt,
      })),
    },
  })
})

batchesRouter.post("/", async (req, res) => {
  const input = parse(createBatchSchema, req.body) as unknown as BatchInput
  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.batch.create({
      data: { ...input, endTime: input.endTime ?? null, code: await nextBatchCode(tx) },
    })
    await tx.batchFeeChange.create({
      data: { batchId: created.id, oldFee: null, newFee: created.monthlyFee, changedById: req.auth!.userId },
    })
    await audit(
      actorFrom(req),
      {
        action: "BATCH_CREATED",
        entityType: "Batch",
        entityId: created.id,
        summary: `Batch ${created.code} "${created.name}" created at ₹${toRupees(created.monthlyFee)}/month`,
      },
      tx,
    )
    return created
  })
  res.status(201).json({ data: serializeBatch(batch, 0) })
})

batchesRouter.patch("/:id", async (req, res) => {
  const id = idParam(req)
  const input = parse(updateBatchSchema, req.body) as Partial<BatchInput>
  if (Object.keys(input).length === 0) throw badRequest("Nothing to update.")

  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.batch.findUnique({ where: { id } })
    if (!before) throw notFound("Batch")
    const enrolled = (await enrolledCounts([id], tx)).get(id) ?? 0
    if (input.capacity !== undefined && input.capacity < enrolled) {
      throw badRequest(`Capacity cannot be lower than current enrollment (${enrolled}).`)
    }
    const updated = await tx.batch.update({ where: { id }, data: input })

    // Fee changes affect FUTURE charges only. Already-generated charges keep their amount.
    if (input.monthlyFee !== undefined && input.monthlyFee !== before.monthlyFee) {
      await tx.batchFeeChange.create({
        data: { batchId: id, oldFee: before.monthlyFee, newFee: input.monthlyFee, changedById: req.auth!.userId },
      })
      await audit(
        actorFrom(req),
        {
          action: "BATCH_FEE_CHANGED",
          entityType: "Batch",
          entityId: id,
          summary: `${before.name}: monthly fee ₹${toRupees(before.monthlyFee)} → ₹${toRupees(input.monthlyFee)} (applies to future charges only)`,
          metadata: { oldFee: toRupees(before.monthlyFee), newFee: toRupees(input.monthlyFee) },
        },
        tx,
      )
    }
    const changed = Object.keys(input).filter((k) => k !== "monthlyFee")
    if (changed.length) {
      await audit(
        actorFrom(req),
        {
          action: "BATCH_UPDATED",
          entityType: "Batch",
          entityId: id,
          summary: `${updated.name} updated (${changed.join(", ")})`,
          metadata: { changes: changed },
        },
        tx,
      )
    }
    return { updated, enrolled }
  })
  res.json({ data: serializeBatch(result.updated, result.enrolled) })
})

/**
 * Delete a batch permanently. Students are never deleted with it:
 *  - each current student's enrollment is closed (the history row keeps the batch name);
 *  - active students are queued in Registrations as "needs a new batch" (REALLOCATION),
 *    so the teacher can allocate them again; their account and fee records are untouched;
 *  - fee charges keep their amounts and batch-name snapshot (they only lose the link).
 */
batchesRouter.delete("/:id", async (req, res) => {
  const id = idParam(req)
  const actor = actorFrom(req)

  const { batch, moved } = await prisma.$transaction(async (tx) => {
    // Lock the batch so no one can be assigned to it while it is being deleted.
    await tx.$queryRaw`SELECT id FROM "Batch" WHERE id = ${id} FOR UPDATE`
    const batch = await tx.batch.findUnique({ where: { id } })
    if (!batch) throw notFound("Batch")

    const open = await tx.enrollment.findMany({
      where: { batchId: id, endedAt: null },
      include: { student: { include: { user: true } } },
    })
    const now = new Date()
    const moved: { name: string; email: string }[] = []
    for (const e of open) {
      await tx.enrollment.update({
        where: { id: e.id },
        data: { endedAt: now, endReason: `Batch "${batch.name}" was deleted` },
      })
      const { student } = e
      if (student.status !== "ACTIVE" || student.user.status !== "ACTIVE") continue
      const alreadyQueued = await tx.registration.findFirst({ where: { userId: student.userId, status: "PENDING" } })
      if (!alreadyQueued) {
        await tx.registration.create({
          data: {
            code: await nextRegistrationCode(tx),
            kind: "REALLOCATION",
            userId: student.userId,
            name: student.user.name,
            email: student.user.email,
            phone: student.user.phone ?? "",
            schoolClass: student.schoolClass,
            requestedSubjects: student.subjects,
            notes: `Previous batch "${batch.name}" was deleted. Allocate a new batch.`,
          },
        })
      }
      moved.push({ name: student.user.name, email: student.user.email })
    }

    await tx.batch.delete({ where: { id } })
    await audit(
      actor,
      {
        action: "BATCH_DELETED",
        entityType: "Batch",
        entityId: id,
        summary: `Batch ${batch.code} "${batch.name}" deleted${
          moved.length ? `; ${moved.length} student(s) moved to Registrations for a new batch` : ""
        }`,
        metadata: { studentsMoved: moved.map((m) => m.name) },
      },
      tx,
    )
    return { batch, moved }
  })

  for (const m of moved) {
    await sendMail({
      to: m.email,
      subject: "Your batch has changed",
      text: `Hello ${m.name},

The batch "${batch.name}" has been discontinued. Your teacher will assign you to a new batch shortly — you'll get an email when that happens.

Your account, fees and receipts are not affected.`,
    })
  }
  res.json({ data: { id, deleted: true, studentsMoved: moved.length } })
})
