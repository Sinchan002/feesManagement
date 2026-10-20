import { Router } from "express"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { prisma } from "../../lib/prisma"
import { idParam, optionalText, pageMeta, paginate, paginationSchema, parse, phoneSchema } from "../../lib/http"
import { badRequest, conflict, notFound } from "../../lib/errors"
import { actorFrom, audit } from "../../lib/audit"
import { nextStudentCode } from "../../lib/codes"
import { sendMail } from "../../lib/mailer"
import { authenticate, requireAdmin } from "../../middleware/auth"
import { emailSchema, issuePasswordToken, revokeAllSessions } from "../auth/service"
import { chargeInclude, serializeCharge } from "../fees/service"
import { paymentInclude, serializePayment } from "../payments/service"
import { assignBatch, endEnrollment, lockStudent } from "./enrollment"
import { NO_DUES, serializeEnrollment, serializeStudent, standingFrom, standings, studentInclude } from "./service"

export const studentsRouter = Router()
studentsRouter.use(authenticate, requireAdmin)

const listSchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  batchId: z.string().max(64).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "ALL"]).default("ACTIVE"),
  feeStatus: z.enum(["PAID", "DUE", "OVERDUE"]).optional(),
  unassigned: z.enum(["true", "false"]).optional(),
})

studentsRouter.get("/", async (req, res) => {
  const q = parse(listSchema, req.query)
  const where: Prisma.StudentWhereInput = {
    ...(q.status !== "ALL" ? { status: q.status } : {}),
    ...(q.batchId ? { enrollments: { some: { batchId: q.batchId, endedAt: null } } } : {}),
    ...(q.unassigned === "true" ? { enrollments: { none: { endedAt: null } } } : {}),
    ...(q.search
      ? {
          OR: [
            { code: { contains: q.search, mode: "insensitive" } },
            { parentName: { contains: q.search, mode: "insensitive" } },
            { user: { name: { contains: q.search, mode: "insensitive" } } },
            { user: { email: { contains: q.search, mode: "insensitive" } } },
            { user: { phone: { contains: q.search } } },
            { enrollments: { some: { endedAt: null, batch: { name: { contains: q.search, mode: "insensitive" } } } } },
          ],
        }
      : {}),
  }

  // Fee status is derived from charges, so filter on it via the set of matching student ids.
  if (q.feeStatus) {
    const all = await standings(null)
    const ids = [...all].filter(([, s]) => s.feeStatus === q.feeStatus).map(([id]) => id)
    if (q.feeStatus === "PAID") where.id = { notIn: [...all].filter(([, s]) => s.feeStatus !== "PAID").map(([id]) => id) }
    else where.id = { in: ids }
  }

  const [total, students] = await Promise.all([
    prisma.student.count({ where }),
    prisma.student.findMany({
      where,
      include: studentInclude,
      orderBy: { createdAt: "desc" },
      ...paginate(q),
    }),
  ])
  const feeMap = await standings(students.map((s) => s.id))
  res.json({
    data: students.map((s) => serializeStudent(s, feeMap.get(s.id) ?? NO_DUES)),
    meta: pageMeta(total, q),
  })
})

const parentFields = {
  parentName: optionalText(120),
  parentRelation: optionalText(40),
  parentEmail: z.union([emailSchema, z.literal("")]).nullish().transform((v) => v || null),
  parentPhone: z.union([phoneSchema, z.literal("")]).nullish().transform((v) => v || null),
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  phone: phoneSchema,
  schoolClass: z.string().trim().min(1).max(40),
  subjects: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  address: optionalText(300),
  notes: optionalText(1000),
  batchId: z.string().max(64).nullish(),
  sendInvite: z.boolean().default(true),
  ...parentFields,
})

/** Teacher adds a student directly (no registration). The student sets a password via emailed link. */
studentsRouter.post("/", async (req, res) => {
  const input = parse(createSchema, req.body)
  if (await prisma.user.findUnique({ where: { email: input.email } })) {
    throw conflict("An account with this email already exists.")
  }
  const actor = actorFrom(req)
  const { student, mail } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: input.email, name: input.name, phone: input.phone, role: "STUDENT", status: "ACTIVE" },
    })
    const student = await tx.student.create({
      data: {
        code: await nextStudentCode(tx),
        userId: user.id,
        schoolClass: input.schoolClass,
        subjects: input.subjects,
        address: input.address,
        notes: input.notes,
        parentName: input.parentName,
        parentRelation: input.parentRelation,
        parentEmail: input.parentEmail,
        parentPhone: input.parentPhone,
      },
    })
    await audit(actor, { action: "STUDENT_CREATED", entityType: "Student", entityId: student.id, summary: `Student ${student.code} ${user.name} added` }, tx)
    if (input.batchId) {
      await assignBatch(tx, { studentId: student.id, batchId: input.batchId, actor, studentName: user.name, reason: "Initial allocation" })
    }
    const mail = input.sendInvite ? (await issuePasswordToken(user, "SET_PASSWORD", tx)).mail : null
    return { student, mail }
  })
  if (mail) await sendMail(mail)
  const full = await prisma.student.findUniqueOrThrow({ where: { id: student.id }, include: studentInclude })
  res.status(201).json({ data: serializeStudent(full) })
})

studentsRouter.get("/:id", async (req, res) => {
  const id = idParam(req)
  const student = await prisma.student.findUnique({ where: { id }, include: studentInclude })
  if (!student) throw notFound("Student")
  const [enrollments, charges, payments] = await Promise.all([
    prisma.enrollment.findMany({
      where: { studentId: id },
      include: { batch: { select: { id: true, code: true, name: true } }, changedBy: { select: { name: true } } },
      orderBy: { startedAt: "desc" },
    }),
    prisma.feeCharge.findMany({ where: { studentId: id }, include: chargeInclude, orderBy: { dueDate: "desc" } }),
    prisma.payment.findMany({
      where: { studentId: id, status: { in: ["SUCCEEDED", "VOIDED"] } },
      include: paymentInclude,
      orderBy: { createdAt: "desc" },
    }),
  ])
  const open = charges.filter((c) => c.status === "PENDING" || c.status === "PARTIALLY_PAID")
  res.json({
    data: {
      ...serializeStudent(student, standingFrom(open)),
      enrollments: enrollments.map(serializeEnrollment),
      charges: charges.map(serializeCharge),
      payments: payments.map(serializePayment),
    },
  })
})

studentsRouter.get("/:id/enrollments", async (req, res) => {
  const id = idParam(req)
  if (!(await prisma.student.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Student")
  const enrollments = await prisma.enrollment.findMany({
    where: { studentId: id },
    include: { batch: { select: { id: true, code: true, name: true } }, changedBy: { select: { name: true } } },
    orderBy: { startedAt: "desc" },
  })
  res.json({ data: enrollments.map(serializeEnrollment) })
})

const updateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  schoolClass: z.string().trim().min(1).max(40).optional(),
  subjects: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
  address: optionalText(300).optional(),
  notes: optionalText(1000).optional(),
  parentName: parentFields.parentName.optional(),
  parentRelation: parentFields.parentRelation.optional(),
  parentEmail: parentFields.parentEmail.optional(),
  parentPhone: parentFields.parentPhone.optional(),
})

studentsRouter.patch("/:id", async (req, res) => {
  const id = idParam(req)
  const { name, email, phone, ...studentData } = parse(updateSchema, req.body)
  const existing = await prisma.student.findUnique({ where: { id }, include: { user: true } })
  if (!existing) throw notFound("Student")
  if (email && email !== existing.user.email && (await prisma.user.findUnique({ where: { email } }))) {
    throw conflict("Another account already uses this email.")
  }
  const userData = Object.fromEntries(Object.entries({ name, email, phone }).filter(([, v]) => v !== undefined))
  await prisma.$transaction(async (tx) => {
    if (Object.keys(userData).length) await tx.user.update({ where: { id: existing.userId }, data: userData })
    await tx.student.update({ where: { id }, data: studentData })
    await audit(
      actorFrom(req),
      {
        action: "STUDENT_UPDATED",
        entityType: "Student",
        entityId: id,
        summary: `Profile of ${name ?? existing.user.name} updated`,
        metadata: { fields: [...Object.keys(userData), ...Object.keys(studentData)] },
      },
      tx,
    )
  })
  const full = await prisma.student.findUniqueOrThrow({ where: { id }, include: studentInclude })
  res.json({ data: serializeStudent(full, (await standings([id])).get(id) ?? NO_DUES) })
})

const statusSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE"]),
  reason: optionalText(500),
})

/** Activate or deactivate. Deactivation blocks login immediately and revokes all sessions. */
studentsRouter.patch("/:id/status", async (req, res) => {
  const id = idParam(req)
  const { status, reason } = parse(statusSchema, req.body)
  const student = await prisma.student.findUnique({ where: { id }, include: { user: true } })
  if (!student) throw notFound("Student")
  if (student.status === status) throw badRequest(`The student is already ${status.toLowerCase()}.`)

  await prisma.$transaction(async (tx) => {
    await tx.student.update({ where: { id }, data: { status } })
    await tx.user.update({
      where: { id: student.userId },
      data: { status: status === "ACTIVE" ? "ACTIVE" : "DEACTIVATED" },
    })
    if (status === "INACTIVE") await revokeAllSessions(student.userId, tx)
    await audit(
      actorFrom(req),
      {
        action: status === "ACTIVE" ? "STUDENT_REACTIVATED" : "STUDENT_DEACTIVATED",
        entityType: "Student",
        entityId: id,
        summary: `${student.user.name} ${status === "ACTIVE" ? "reactivated" : "deactivated"}${reason ? `: ${reason}` : ""}`,
        metadata: { reason },
      },
      tx,
    )
  })
  const full = await prisma.student.findUniqueOrThrow({ where: { id }, include: studentInclude })
  res.json({ data: serializeStudent(full, (await standings([id])).get(id) ?? NO_DUES) })
})

const batchChangeSchema = z.object({
  batchId: z.string().min(1).max(64),
  reason: optionalText(500),
})

/** Assign or change the student's batch. The previous enrollment is closed and kept as history. */
studentsRouter.post("/:id/batch", async (req, res) => {
  const id = idParam(req)
  const { batchId, reason } = parse(batchChangeSchema, req.body)
  const student = await prisma.student.findUnique({ where: { id }, include: { user: true } })
  if (!student) throw notFound("Student")
  if (student.status !== "ACTIVE") throw badRequest("Reactivate the student before assigning a batch.")
  await prisma.$transaction((tx) =>
    assignBatch(tx, { studentId: id, batchId, reason, actor: actorFrom(req), studentName: student.user.name }),
  )
  const full = await prisma.student.findUniqueOrThrow({ where: { id }, include: studentInclude })
  res.json({ data: serializeStudent(full, (await standings([id])).get(id) ?? NO_DUES) })
})

/** Remove the student from their batch without assigning a new one. */
studentsRouter.delete("/:id/batch", async (req, res) => {
  const id = idParam(req)
  const { reason } = parse(z.object({ reason: z.string().trim().min(3, "Give a reason").max(500) }), req.body)
  const student = await prisma.student.findUnique({ where: { id }, include: { user: true } })
  if (!student) throw notFound("Student")
  await prisma.$transaction((tx) =>
    endEnrollment(tx, { studentId: id, reason, actor: actorFrom(req), studentName: student.user.name }),
  )
  const full = await prisma.student.findUniqueOrThrow({ where: { id }, include: studentInclude })
  res.json({ data: serializeStudent(full, (await standings([id])).get(id) ?? NO_DUES) })
})

/** Re-send the "set your password" link for an account. */
studentsRouter.post("/:id/send-password-link", async (req, res) => {
  const id = idParam(req)
  const student = await prisma.student.findUnique({ where: { id }, include: { user: true } })
  if (!student) throw notFound("Student")
  if (student.user.status !== "ACTIVE") throw badRequest("Activate the account first.")
  const { mail } = await issuePasswordToken(student.user, student.user.passwordHash ? "RESET" : "SET_PASSWORD")
  await sendMail(mail)
  await audit(actorFrom(req), { action: "PASSWORD_LINK_SENT", entityType: "Student", entityId: id, summary: `Password link sent to ${student.user.email}` })
  res.json({ data: { success: true } })
})

/**
 * Permanently delete a student. Only allowed when there is no financial history; fee charges
 * and payments must be preserved for auditing, so such students should be deactivated instead.
 */
studentsRouter.delete("/:id", async (req, res) => {
  const id = idParam(req)
  const student = await prisma.student.findUnique({
    where: { id },
    include: { user: true, _count: { select: { charges: true, payments: true } } },
  })
  if (!student) throw notFound("Student")
  if (student._count.charges > 0 || student._count.payments > 0) {
    throw conflict(
      "This student has fee or payment records, which must be kept for auditing. Deactivate the student instead.",
      { charges: student._count.charges, payments: student._count.payments },
    )
  }
  await prisma.$transaction(async (tx) => {
    await lockStudent(tx, id)
    await tx.enrollment.deleteMany({ where: { studentId: id } })
    await tx.student.delete({ where: { id } })
    await tx.user.delete({ where: { id: student.userId } })
    await audit(
      actorFrom(req),
      {
        action: "STUDENT_DELETED",
        entityType: "Student",
        entityId: id,
        summary: `Student ${student.code} ${student.user.name} (${student.user.email}) permanently deleted`,
      },
      tx,
    )
  })
  res.json({ data: { id, deleted: true } })
})
