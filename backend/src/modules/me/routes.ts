import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../lib/prisma"
import { optionalText, parse, phoneSchema } from "../../lib/http"
import { actorFrom, audit } from "../../lib/audit"
import { authenticate, ownStudentId, requireStudent } from "../../middleware/auth"
import { emailSchema } from "../auth/service"
import { chargeInclude, serializeCharge } from "../fees/service"
import { paymentInclude, serializePayment } from "../payments/service"
import { getSettings } from "../settings/service"
import { serializeEnrollment, serializeStudent, standingFrom, studentInclude } from "../students/service"

/**
 * Student self-service. Every query is scoped to the signed-in student's own id taken from the
 * session — never from the URL or body — so one student can never read another's data.
 */
export const meRouter = Router()
meRouter.use(authenticate, requireStudent)

async function loadProfile(studentId: string) {
  const [student, open] = await Promise.all([
    prisma.student.findUniqueOrThrow({ where: { id: studentId }, include: studentInclude }),
    prisma.feeCharge.findMany({ where: { studentId, status: { in: ["PENDING", "PARTIALLY_PAID"] } } }),
  ])
  return serializeStudent(student, standingFrom(open))
}

meRouter.get("/dashboard", async (req, res) => {
  const studentId = ownStudentId(req)
  const [profile, openCharges, recentPayments, settings] = await Promise.all([
    loadProfile(studentId),
    prisma.feeCharge.findMany({
      where: { studentId, status: { in: ["PENDING", "PARTIALLY_PAID"] } },
      include: chargeInclude,
      orderBy: { dueDate: "asc" },
    }),
    prisma.payment.findMany({
      where: { studentId, status: "SUCCEEDED" },
      include: paymentInclude,
      orderBy: { paymentDate: "desc" },
      take: 5,
    }),
    getSettings(),
  ])
  const charges = openCharges.map(serializeCharge)
  res.json({
    data: {
      profile,
      teacher: settings.academy.teacherName,
      outstanding: profile.outstanding,
      overdue: profile.overdue,
      feeStatus: profile.feeStatus,
      nextDue: charges[0] ?? null,
      openCharges: charges,
      recentPayments: recentPayments.map(serializePayment),
      latestReceiptPaymentId: recentPayments[0]?.id ?? null,
      onlinePaymentMethods: settings.paymentMethods,
    },
  })
})

meRouter.get("/profile", async (req, res) => {
  res.json({ data: await loadProfile(ownStudentId(req)) })
})

// Students may update their contact and parent details; name, email, class and batch are teacher-managed.
const profileSchema = z.object({
  phone: phoneSchema.optional(),
  address: optionalText(300).optional(),
  parentName: optionalText(120).optional(),
  parentRelation: optionalText(40).optional(),
  parentEmail: z.union([emailSchema, z.literal("")]).nullish().transform((v) => v || null).optional(),
  parentPhone: z.union([phoneSchema, z.literal("")]).nullish().transform((v) => v || null).optional(),
})

meRouter.patch("/profile", async (req, res) => {
  const studentId = ownStudentId(req)
  const { phone, ...rest } = parse(profileSchema, req.body)
  await prisma.$transaction(async (tx) => {
    if (phone) await tx.user.update({ where: { id: req.auth!.userId }, data: { phone } })
    await tx.student.update({ where: { id: studentId }, data: rest })
    await audit(
      actorFrom(req),
      {
        action: "PROFILE_UPDATED",
        entityType: "Student",
        entityId: studentId,
        summary: `${req.auth!.name} updated their profile`,
        metadata: { fields: [...(phone ? ["phone"] : []), ...Object.keys(rest)] },
      },
      tx,
    )
  })
  res.json({ data: await loadProfile(studentId) })
})

meRouter.get("/batch", async (req, res) => {
  const studentId = ownStudentId(req)
  const enrollment = await prisma.enrollment.findFirst({
    where: { studentId, endedAt: null, batchId: { not: null } },
    include: { batch: true },
  })
  const batch = enrollment?.batch
  const settings = await getSettings()
  res.json({
    data: batch
      ? {
          id: batch.id,
          code: batch.code,
          name: batch.name,
          classLevel: batch.classLevel,
          subjects: batch.subjects,
          schedule: batch.schedule,
          startTime: batch.startTime,
          endTime: batch.endTime,
          status: batch.status,
          monthlyFee: batch.monthlyFee / 100,
          enrolledAt: enrollment.startedAt,
          teacher: settings.academy.teacherName,
        }
      : null,
  })
})

meRouter.get("/enrollments", async (req, res) => {
  const enrollments = await prisma.enrollment.findMany({
    where: { studentId: ownStudentId(req) },
    include: { batch: { select: { id: true, code: true, name: true } } },
    orderBy: { startedAt: "desc" },
  })
  res.json({ data: enrollments.map((e) => serializeEnrollment({ ...e, changedBy: null })) })
})

const chargesQuery = z.object({ status: z.enum(["OPEN", "PAID", "ALL"]).default("ALL") })

meRouter.get("/charges", async (req, res) => {
  const { status } = parse(chargesQuery, req.query)
  const charges = await prisma.feeCharge.findMany({
    where: {
      studentId: ownStudentId(req),
      ...(status === "OPEN"
        ? { status: { in: ["PENDING", "PARTIALLY_PAID"] } }
        : status === "PAID"
          ? { status: "PAID" }
          : { status: { not: "VOID" } }),
    },
    include: chargeInclude,
    orderBy: { dueDate: "desc" },
  })
  res.json({ data: charges.map(serializeCharge) })
})

meRouter.get("/payments", async (req, res) => {
  const payments = await prisma.payment.findMany({
    where: { studentId: ownStudentId(req), status: { in: ["SUCCEEDED", "VOIDED"] } },
    include: paymentInclude,
    orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
  })
  res.json({ data: payments.map(serializePayment) })
})
