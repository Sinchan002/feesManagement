import { Router } from "express"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { prisma } from "../../lib/prisma"
import { idParam, pageMeta, paginate, paginationSchema, parse, periodSchema } from "../../lib/http"
import { badRequest, conflict, notFound } from "../../lib/errors"
import { actorFrom, audit } from "../../lib/audit"
import { nextChargeCode } from "../../lib/codes"
import { rupees, toRupees } from "../../lib/money"
import { dueDateFor, periodLabel } from "../../lib/dates"
import { assertCanAccessStudent, authenticate, requireAdmin } from "../../middleware/auth"
import { getSettings } from "../settings/service"
import { currentEnrollment } from "../students/service"
import {
  addAdjustment,
  chargeInclude,
  generateMonthlyCharges,
  lockCharges,
  monthlyDedupeKey,
  serializeCharge,
} from "./service"
import { sendFeeReminders } from "./reminders"

export const feesRouter = Router()
feesRouter.use(authenticate)

const listSchema = paginationSchema.extend({
  studentId: z.string().max(64).optional(),
  batchId: z.string().max(64).optional(),
  period: periodSchema.optional(),
  status: z.enum(["PENDING", "PARTIALLY_PAID", "PAID", "VOID", "OPEN", "OVERDUE"]).optional(),
  search: z.string().trim().max(100).optional(),
})

feesRouter.get("/charges", requireAdmin, async (req, res) => {
  const q = parse(listSchema, req.query)
  const status: Prisma.FeeChargeWhereInput =
    q.status === "OPEN"
      ? { status: { in: ["PENDING", "PARTIALLY_PAID"] } }
      : q.status === "OVERDUE"
        ? { status: { in: ["PENDING", "PARTIALLY_PAID"] }, dueDate: { lt: new Date() } }
        : q.status
          ? { status: q.status }
          : {}
  const where: Prisma.FeeChargeWhereInput = {
    ...status,
    ...(q.studentId ? { studentId: q.studentId } : {}),
    ...(q.batchId ? { batchId: q.batchId } : {}),
    ...(q.period ? { billingPeriod: q.period } : {}),
    ...(q.search
      ? {
          OR: [
            { code: { contains: q.search, mode: "insensitive" } },
            { description: { contains: q.search, mode: "insensitive" } },
            { student: { code: { contains: q.search, mode: "insensitive" } } },
            { student: { user: { name: { contains: q.search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  }
  const [total, rows] = await Promise.all([
    prisma.feeCharge.count({ where }),
    prisma.feeCharge.findMany({ where, include: chargeInclude, orderBy: [{ dueDate: "desc" }, { code: "desc" }], ...paginate(q) }),
  ])
  res.json({ data: rows.map(serializeCharge), meta: pageMeta(total, q) })
})

/** Admins can read any charge; students only their own. */
feesRouter.get("/charges/:id", async (req, res) => {
  const charge = await prisma.feeCharge.findUnique({ where: { id: idParam(req) }, include: chargeInclude })
  if (!charge) throw notFound("Fee charge")
  assertCanAccessStudent(req, charge.studentId, "Fee charge")
  res.json({ data: serializeCharge(charge) })
})

const createSchema = z
  .object({
    studentId: z.string().min(1).max(64),
    type: z.enum(["MONTHLY", "ADMISSION", "OTHER"]).default("OTHER"),
    billingPeriod: periodSchema.optional(),
    description: z.string().trim().min(3).max(200).optional(),
    /** Optional for MONTHLY — defaults to the current batch fee. */
    amount: rupees().optional(),
    dueDate: z.coerce.date().optional(),
  })
  .refine((d) => d.type !== "MONTHLY" || d.billingPeriod, {
    message: "Monthly charges need a billing period",
    path: ["billingPeriod"],
  })
  .refine((d) => d.type === "MONTHLY" || (d.amount !== undefined && d.description), {
    message: "Enter a description and amount",
    path: ["amount"],
  })

/** Create a single charge (one-off fee, or one student's monthly fee). */
feesRouter.post("/charges", requireAdmin, async (req, res) => {
  const input = parse(createSchema, req.body)
  const settings = await getSettings()
  const student = await prisma.student.findUnique({
    where: { id: input.studentId },
    include: { user: true, enrollments: { where: { endedAt: null }, include: { batch: true } } },
  })
  if (!student) throw notFound("Student")
  const enrollment = currentEnrollment(student.enrollments)
  if (input.type === "MONTHLY" && !enrollment && input.amount === undefined) {
    throw badRequest("The student has no batch; enter the amount explicitly.")
  }
  const amount = input.amount ?? enrollment!.batch.monthlyFee
  const period = input.billingPeriod ?? null
  const dueDate = input.dueDate ?? (period ? dueDateFor(period, settings.billing.dueDay) : new Date())
  const description =
    input.description ??
    `Monthly fee – ${periodLabel(period!)}${enrollment ? ` (${enrollment.batch.name})` : ""}`
  const dedupeKey = input.type === "MONTHLY" ? monthlyDedupeKey(student.id, period!) : null
  if (dedupeKey && (await prisma.feeCharge.findUnique({ where: { dedupeKey } }))) {
    throw conflict(`${student.user.name} has already been charged for ${periodLabel(period!)}.`)
  }

  const charge = await prisma.$transaction(async (tx) => {
    const created = await tx.feeCharge.create({
      data: {
        code: await nextChargeCode(tx),
        studentId: student.id,
        enrollmentId: enrollment?.id ?? null,
        batchId: enrollment?.batchId ?? null,
        batchNameAtCharge: enrollment?.batch.name ?? null,
        type: input.type,
        billingPeriod: period,
        description,
        amount,
        dueDate,
        dedupeKey,
        createdById: req.auth!.userId,
      },
      include: chargeInclude,
    })
    await audit(
      actorFrom(req),
      {
        action: "CHARGE_CREATED",
        entityType: "FeeCharge",
        entityId: created.id,
        summary: `${created.code} ₹${toRupees(amount)} charged to ${student.user.name}: ${description}`,
      },
      tx,
    )
    return created
  })
  res.status(201).json({ data: serializeCharge(charge) })
})

const generateSchema = z.object({
  period: periodSchema,
  batchId: z.string().max(64).optional(),
  dueDate: z.coerce.date().optional(),
})

/** Bill every enrolled student for a month. Safe to run repeatedly. */
feesRouter.post("/charges/generate", requireAdmin, async (req, res) => {
  const input = parse(generateSchema, req.body)
  if (input.batchId && !(await prisma.batch.findUnique({ where: { id: input.batchId } }))) throw notFound("Batch")
  const result = await generateMonthlyCharges({ ...input, actor: actorFrom(req) })
  res.json({ data: result })
})

const adjustmentSchema = z.object({
  /** Signed rupees: negative for a discount/waiver, positive for a surcharge. */
  amount: rupees({ allowNegative: true }),
  reason: z.string().trim().min(5, "Document the reason for this adjustment").max(500),
})

/** The only way to change what a generated charge asks for — always documented. */
feesRouter.post("/charges/:id/adjustments", requireAdmin, async (req, res) => {
  const id = idParam(req)
  const { amount, reason } = parse(adjustmentSchema, req.body)
  await prisma.$transaction((tx) => addAdjustment(tx, { chargeId: id, amount, reason, actor: actorFrom(req) }))
  const charge = await prisma.feeCharge.findUniqueOrThrow({ where: { id }, include: chargeInclude })
  res.status(201).json({ data: serializeCharge(charge) })
})

const voidSchema = z.object({ reason: z.string().trim().min(5, "Give a reason").max(500) })

/** Cancel a charge raised in error. Only possible while nothing has been paid against it. */
feesRouter.post("/charges/:id/void", requireAdmin, async (req, res) => {
  const id = idParam(req)
  const { reason } = parse(voidSchema, req.body)
  await prisma.$transaction(async (tx) => {
    const [charge] = await lockCharges(tx, [id])
    if (!charge) throw notFound("Fee charge")
    if (charge.status === "VOID") throw conflict("This charge is already void.")
    if (charge.paidAmount > 0) {
      throw conflict("Payments have been applied to this charge. Void those payments first, or add an adjustment.")
    }
    // The dedupe key is released so the month can be billed again correctly if needed.
    await tx.feeCharge.update({
      where: { id },
      data: { status: "VOID", voidedAt: new Date(), voidReason: reason, dedupeKey: null },
    })
    await audit(
      actorFrom(req),
      { action: "CHARGE_VOIDED", entityType: "FeeCharge", entityId: id, summary: `${charge.code} voided: ${reason}` },
      tx,
    )
  })
  const charge = await prisma.feeCharge.findUniqueOrThrow({ where: { id }, include: chargeInclude })
  res.json({ data: serializeCharge(charge) })
})

/** "Send reminders" button on the dashboard. */
feesRouter.post("/reminders/send", requireAdmin, async (req, res) => {
  res.json({ data: await sendFeeReminders(actorFrom(req)) })
})
