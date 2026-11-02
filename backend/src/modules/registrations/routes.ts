import { Router } from "express"
import { batchTimeLabel } from "../../lib/schedule"
import { z } from "zod"
import type { Batch, Prisma, Registration, User } from "@prisma/client"
import { prisma } from "../../lib/prisma"
import { idParam, optionalText, pageMeta, paginate, paginationSchema, parse } from "../../lib/http"
import { conflict, notFound } from "../../lib/errors"
import { actorFrom, audit } from "../../lib/audit"
import { nextStudentCode } from "../../lib/codes"
import { sendMail, type Mail } from "../../lib/mailer"
import { toRupees } from "../../lib/money"
import { periodLabel } from "../../lib/dates"
import { env } from "../../config/env"
import { authenticate, requireAdmin } from "../../middleware/auth"
import { issuePasswordToken } from "../auth/service"
import { assignBatch } from "../students/enrollment"

export const registrationsRouter = Router()
registrationsRouter.use(authenticate, requireAdmin)

type RegistrationRow = Registration & {
  preferredBatch: Pick<Batch, "id" | "code" | "name"> | null
  assignedBatch: Pick<Batch, "id" | "code" | "name"> | null
  reviewedBy: Pick<User, "name"> | null
  user: { student: { code: string } | null } | null
}

const batchRef = { select: { id: true, code: true, name: true } } as const
const include = {
  preferredBatch: batchRef,
  assignedBatch: batchRef,
  reviewedBy: { select: { name: true } },
  user: { select: { student: { select: { code: true } } } },
}

const serialize = (r: RegistrationRow) => ({
  id: r.id,
  code: r.code,
  /** NEW = applicant from the public form; REALLOCATION = existing student whose batch was deleted. */
  kind: r.kind,
  studentCode: r.user?.student?.code ?? null,
  name: r.name,
  email: r.email,
  phone: r.phone,
  schoolClass: r.schoolClass,
  requestedSubjects: r.requestedSubjects,
  preferredBatch: r.preferredBatch,
  notes: r.notes,
  status: r.status,
  assignedBatch: r.assignedBatch,
  reviewedBy: r.reviewedBy?.name ?? null,
  reviewedAt: r.reviewedAt,
  reviewNote: r.reviewNote,
  submittedAt: r.createdAt,
})

const listSchema = paginationSchema.extend({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "ALL"]).default("PENDING"),
  search: z.string().trim().max(100).optional(),
})

registrationsRouter.get("/", async (req, res) => {
  const q = parse(listSchema, req.query)
  const where: Prisma.RegistrationWhereInput = {
    ...(q.status !== "ALL" ? { status: q.status } : {}),
    ...(q.search
      ? {
          OR: [
            { name: { contains: q.search, mode: "insensitive" } },
            { email: { contains: q.search, mode: "insensitive" } },
            { code: { contains: q.search, mode: "insensitive" } },
            { schoolClass: { contains: q.search, mode: "insensitive" } },
          ],
        }
      : {}),
  }
  const [total, rows, pendingCount] = await Promise.all([
    prisma.registration.count({ where }),
    prisma.registration.findMany({ where, include, orderBy: { createdAt: q.status === "PENDING" ? "asc" : "desc" }, ...paginate(q) }),
    prisma.registration.count({ where: { status: "PENDING" } }),
  ])
  res.json({ data: rows.map(serialize), meta: { ...pageMeta(total, q), pendingCount } })
})

registrationsRouter.get("/:id", async (req, res) => {
  const row = await prisma.registration.findUnique({ where: { id: idParam(req) }, include })
  if (!row) throw notFound("Registration")
  res.json({ data: serialize(row) })
})

const approveSchema = z.object({
  batchId: z.string().min(1, "Choose a batch").max(64),
  note: optionalText(500),
})

/**
 * Approve: activates (or creates) the student account, creates the student profile and
 * allocates the batch — all in one transaction.
 */
registrationsRouter.post("/:id/approve", async (req, res) => {
  const id = idParam(req)
  const { batchId, note } = parse(approveSchema, req.body)
  const actor = actorFrom(req)

  const { mails, registration, charge } = await prisma.$transaction(async (tx) => {
    // Claim the request atomically so it cannot be approved twice or approved and rejected concurrently.
    const claimed = await tx.registration.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "APPROVED", reviewedById: actor.id, reviewedAt: new Date(), reviewNote: note, assignedBatchId: batchId },
    })
    if (claimed.count === 0) {
      const exists = await tx.registration.findUnique({ where: { id } })
      if (!exists) throw notFound("Registration")
      throw conflict(`This registration has already been ${exists.status.toLowerCase()}.`)
    }
    const reg = await tx.registration.findUniqueOrThrow({ where: { id } })
    const mails: Mail[] = []

    // Find or create the account.
    let user = reg.userId ? await tx.user.findUnique({ where: { id: reg.userId } }) : null
    if (!user) user = await tx.user.findUnique({ where: { email: reg.email } })
    if (user && user.role !== "STUDENT") throw conflict("This email belongs to a staff account.")
    if (user) {
      user = await tx.user.update({ where: { id: user.id }, data: { status: "ACTIVE" } })
    } else {
      user = await tx.user.create({
        data: { email: reg.email, name: reg.name, phone: reg.phone, role: "STUDENT", status: "ACTIVE" },
      })
    }
    if (reg.userId !== user.id) await tx.registration.update({ where: { id }, data: { userId: user.id } })
    if (!user.passwordHash) mails.push((await issuePasswordToken(user, "SET_PASSWORD", tx)).mail)

    // Create or reactivate the student profile.
    const existingStudent = await tx.student.findUnique({ where: { userId: user.id } })
    const student = existingStudent
      ? await tx.student.update({
          where: { id: existingStudent.id },
          data: { status: "ACTIVE", schoolClass: reg.schoolClass, subjects: reg.requestedSubjects },
        })
      : await tx.student.create({
          data: {
            code: await nextStudentCode(tx),
            userId: user.id,
            schoolClass: reg.schoolClass,
            subjects: reg.requestedSubjects,
            notes: reg.notes,
          },
        })

    const { batch, charge } = await assignBatch(tx, {
      studentId: student.id,
      batchId,
      actor,
      studentName: reg.name,
      reason: note ?? `Approved registration ${reg.code}`,
    })
    await audit(
      actor,
      {
        action: "REGISTRATION_APPROVED",
        entityType: "Registration",
        entityId: id,
        summary:
          reg.kind === "REALLOCATION"
            ? `${reg.name} (${student.code}) allocated to new batch ${batch.name}`
            : `${reg.name}'s registration approved; student ${student.code} allocated to ${batch.name}`,
        metadata: { studentId: student.id, batchId },
      },
      tx,
    )
    mails.push({
      to: user.email,
      subject: reg.kind === "REALLOCATION" ? "You have a new batch" : "Your registration has been approved",
      text: `Hello ${reg.name},\n\n${
        reg.kind === "REALLOCATION" ? "You have been moved" : "Your registration has been approved and you have been allocated"
      } to ${batch.name} (${batch.schedule}, ${batchTimeLabel(batch.startTime, batch.endTime)}).${
        charge
          ? `\n\nYour fee of ₹${toRupees(charge.amount).toLocaleString("en-IN")} for ${
              charge.billingPeriod ? periodLabel(charge.billingPeriod) : "this month"
            } is due by ${charge.dueDate.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" })}.`
          : ""
      }\n\nSign in at ${env.APP_URL}/login to see your schedule and fees.`,
    })
    const registration = await tx.registration.findUniqueOrThrow({ where: { id }, include })
    return { mails, registration, studentId: student.id, charge }
  })

  for (const mail of mails) await sendMail(mail)
  res.json({
    data: {
      ...serialize(registration),
      // This month's fee, when the placement happened before the 15th (see billOnPlacement).
      firstCharge: charge
        ? { amount: toRupees(charge.amount), billingPeriod: charge.billingPeriod, dueDate: charge.dueDate }
        : null,
    },
  })
})

const rejectSchema = z.object({ reason: optionalText(500) })

/**
 * Decline a registration. The applicant's data is deleted permanently: the pending account
 * (sessions and reset tokens cascade), every registration row of theirs, and audit entries that
 * name them. One anonymised audit entry records that the teacher declined the request.
 */
registrationsRouter.post("/:id/reject", async (req, res) => {
  const id = idParam(req)
  const { reason } = parse(rejectSchema, req.body)
  const actor = actorFrom(req)

  const declined = await prisma.$transaction(async (tx) => {
    // Row lock: a concurrent approve waits for this to finish (and vice versa).
    await tx.$queryRaw`SELECT id FROM "Registration" WHERE id = ${id} FOR UPDATE`
    const reg = await tx.registration.findUnique({ where: { id } })
    if (!reg) throw notFound("Registration")
    if (reg.status !== "PENDING") throw conflict(`This registration has already been ${reg.status.toLowerCase()}.`)

    const user = reg.userId
      ? await tx.user.findUnique({ where: { id: reg.userId }, include: { student: true } })
      : null
    // Only a brand-new applicant is deleted. An existing student (e.g. a re-allocation request
    // after their batch was deleted) is never removed by declining — the request is just dismissed.
    const deleteAccount = Boolean(
      reg.kind === "NEW" && user && user.status !== "ACTIVE" && !user.student && user.role === "STUDENT",
    )

    const registrationIds = deleteAccount
      ? (await tx.registration.findMany({ where: { OR: [{ id }, { userId: user!.id }] }, select: { id: true } })).map((r) => r.id)
      : [id]
    await tx.auditLog.deleteMany({
      where: {
        OR: [
          { entityType: "Registration", entityId: { in: registrationIds } },
          ...(deleteAccount ? [{ actorId: user!.id }, { entityType: "User", entityId: user!.id }] : []),
        ],
      },
    })
    await tx.registration.deleteMany({ where: { id: { in: registrationIds } } })
    if (deleteAccount) await tx.user.delete({ where: { id: user!.id } })

    await audit(
      actor,
      {
        action: "REGISTRATION_DECLINED",
        entityType: "Registration",
        entityId: null,
        summary: deleteAccount
          ? `Registration ${reg.code} (${reg.schoolClass}) declined; applicant data permanently deleted`
          : `Re-allocation request ${reg.code} for ${reg.name} dismissed; the student remains without a batch`,
      },
      tx,
    )
    return { ...reg, accountDeleted: deleteAccount }
  })

  if (declined.accountDeleted) await sendMail({
    to: declined.email,
    subject: "Update on your registration",
    text: `Hello ${declined.name},\n\nThank you for your interest. Unfortunately we are unable to offer you a place at this time.${
      reason ? `\n\nNote from the teacher: ${reason}` : ""
    }\n\nYour registration and account details have been deleted. You are welcome to register again later.`,
  })
  res.json({ data: { id, code: declined.code, status: "DECLINED", deleted: declined.accountDeleted } })
})
