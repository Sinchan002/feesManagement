import type { Batch, ChargeStatus, FeeAdjustment, FeeCharge, Payment, Student, User } from "@prisma/client"
import { prisma, type Tx } from "../../lib/prisma"
import { badRequest, notFound } from "../../lib/errors"
import { outstandingOf, toRupees } from "../../lib/money"
import { audit, type Actor } from "../../lib/audit"
import { nextChargeCode } from "../../lib/codes"
import { academyEndOfDay, academyToday, dueDateFor, periodEnd, periodLabel } from "../../lib/dates"
import { getSettings } from "../settings/service"

export const chargeInclude = {
  student: { select: { id: true, code: true, user: { select: { name: true } } } },
  adjustments: { include: { createdBy: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
  allocations: {
    where: { payment: { status: "SUCCEEDED" } },
    include: { payment: { select: { id: true, code: true, receiptNumber: true, method: true, paymentDate: true } } },
    orderBy: { createdAt: "asc" },
  },
} as const

type ChargeRow = FeeCharge & {
  student?: Pick<Student, "id" | "code"> & { user: Pick<User, "name"> }
  adjustments?: (FeeAdjustment & { createdBy: Pick<User, "name"> | null })[]
  allocations?: {
    id: string
    amount: number
    createdAt: Date
    payment: Pick<Payment, "id" | "code" | "receiptNumber" | "method" | "paymentDate">
  }[]
}

export function serializeCharge(c: ChargeRow) {
  const outstanding = c.status === "VOID" ? 0 : outstandingOf(c)
  return {
    id: c.id,
    code: c.code,
    studentId: c.studentId,
    student: c.student ? { id: c.student.id, code: c.student.code, name: c.student.user.name } : undefined,
    type: c.type,
    billingPeriod: c.billingPeriod,
    periodLabel: c.billingPeriod ? periodLabel(c.billingPeriod) : null,
    description: c.description,
    batchId: c.batchId,
    batchName: c.batchNameAtCharge,
    /** Original amount — never changes after the charge is generated. */
    amount: toRupees(c.amount),
    adjustmentTotal: toRupees(c.adjustmentTotal),
    netAmount: toRupees(c.amount + c.adjustmentTotal),
    paidAmount: toRupees(c.paidAmount),
    outstanding: toRupees(outstanding),
    dueDate: c.dueDate,
    status: c.status,
    isOverdue: outstanding > 0 && c.dueDate < new Date(),
    voidedAt: c.voidedAt,
    voidReason: c.voidReason,
    createdAt: c.createdAt,
    adjustments: c.adjustments?.map((a) => ({
      id: a.id,
      amount: toRupees(a.amount),
      reason: a.reason,
      createdBy: a.createdBy?.name ?? null,
      createdAt: a.createdAt,
    })),
    payments: c.allocations?.map((a) => ({
      allocationId: a.id,
      amount: toRupees(a.amount),
      paymentId: a.payment.id,
      paymentCode: a.payment.code,
      receiptNumber: a.payment.receiptNumber,
      method: a.payment.method,
      paidAt: a.payment.paymentDate,
    })),
  }
}

export function statusFor(c: Pick<FeeCharge, "amount" | "adjustmentTotal" | "paidAmount" | "status">): ChargeStatus {
  if (c.status === "VOID") return "VOID"
  const net = c.amount + c.adjustmentTotal
  if (c.paidAmount >= net) return "PAID"
  return c.paidAmount > 0 ? "PARTIALLY_PAID" : "PENDING"
}

/** Row-lock charges (in id order, to avoid deadlocks) for the rest of the transaction. */
export async function lockCharges(tx: Tx, chargeIds: string[]) {
  const ids = [...new Set(chargeIds)].sort()
  if (ids.length === 0) return []
  await tx.$queryRaw`SELECT id FROM "FeeCharge" WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`
  return tx.feeCharge.findMany({ where: { id: { in: ids } } })
}

/**
 * Apply part of a payment to a charge. Caller must hold the charge lock and have checked
 * that `amount` ≤ outstanding. The (paymentId, chargeId) unique key blocks double allocation.
 */
export async function allocate(tx: Tx, charge: FeeCharge, paymentId: string, amount: number) {
  if (amount <= 0) return charge
  if (amount > outstandingOf(charge)) throw badRequest(`Allocation exceeds the amount due on ${charge.code}.`)
  await tx.paymentAllocation.create({ data: { paymentId, chargeId: charge.id, amount } })
  const paidAmount = charge.paidAmount + amount
  return tx.feeCharge.update({
    where: { id: charge.id },
    data: { paidAmount, status: statusFor({ ...charge, paidAmount }) },
  })
}

/** Reverse allocations of a payment that is being voided. */
export async function unallocatePayment(tx: Tx, paymentId: string) {
  const allocations = await tx.paymentAllocation.findMany({ where: { paymentId } })
  const charges = await lockCharges(tx, allocations.map((a) => a.chargeId))
  for (const a of allocations) {
    const charge = charges.find((c) => c.id === a.chargeId)!
    const paidAmount = charge.paidAmount - a.amount
    await tx.feeCharge.update({
      where: { id: charge.id },
      data: { paidAmount, status: statusFor({ ...charge, paidAmount }) },
    })
  }
  // Allocation rows are kept (the voided payment shows what it had covered); charge totals
  // only count allocations of SUCCEEDED payments.
  return allocations
}

export async function addAdjustment(
  tx: Tx,
  opts: { chargeId: string; amount: number; reason: string; actor: Actor },
) {
  const [charge] = await lockCharges(tx, [opts.chargeId])
  if (!charge) throw notFound("Fee charge")
  if (charge.status === "VOID") throw badRequest("A void charge cannot be adjusted.")
  if (opts.amount === 0) throw badRequest("Adjustment amount cannot be zero.")
  const adjustmentTotal = charge.adjustmentTotal + opts.amount
  const net = charge.amount + adjustmentTotal
  if (net < 0) throw badRequest("The adjustment would make the charge negative.")
  if (net < charge.paidAmount) {
    throw badRequest(
      `The charge already has ₹${toRupees(charge.paidAmount)} paid; it cannot be reduced below that. Record a refund separately.`,
    )
  }
  const adjustment = await tx.feeAdjustment.create({
    data: { chargeId: charge.id, amount: opts.amount, reason: opts.reason, createdById: opts.actor.id },
  })
  const updated = await tx.feeCharge.update({
    where: { id: charge.id },
    data: { adjustmentTotal, status: statusFor({ ...charge, adjustmentTotal }) },
  })
  // A surcharge raises what is owed — use any advance credit for it.
  if (opts.amount > 0) await applyAdvanceCredit(tx, charge.studentId, opts.actor)
  await audit(
    opts.actor,
    {
      action: "FEE_ADJUSTED",
      entityType: "FeeCharge",
      entityId: charge.id,
      summary: `${charge.code} adjusted by ${opts.amount > 0 ? "+" : "−"}₹${toRupees(Math.abs(opts.amount))}: ${opts.reason}`,
      metadata: { adjustmentId: adjustment.id, amount: toRupees(opts.amount), originalAmount: toRupees(charge.amount) },
    },
    tx,
  )
  return updated
}

export const monthlyDedupeKey = (studentId: string, period: string) => `MONTHLY:${studentId}:${period}`

/**
 * Use a student's advance credit — the unallocated part of earlier successful payments — to pay
 * their open fees, oldest credit and oldest fee first. Call it inside the same transaction
 * whenever a fee is created or increased. Returns the amount applied (paise).
 */
export async function applyAdvanceCredit(tx: Tx, studentId: string, actor: Actor) {
  // Lock the student's payments, then their open charges (same order as elsewhere: payments → charges).
  await tx.$queryRaw`SELECT id FROM "Payment" WHERE "studentId" = ${studentId} AND status = 'SUCCEEDED' ORDER BY id FOR UPDATE`
  const payments = await tx.payment.findMany({
    where: { studentId, status: "SUCCEEDED" },
    include: { allocations: { select: { chargeId: true, amount: true } } },
    orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
  })
  const credits = payments
    .map((p) => ({
      payment: p,
      left: p.amount - p.allocations.reduce((s, a) => s + a.amount, 0),
      usedOn: new Set(p.allocations.map((a) => a.chargeId)),
    }))
    .filter((c) => c.left > 0)
  if (credits.length === 0) return 0

  const open = await tx.feeCharge.findMany({
    where: { studentId, status: { in: ["PENDING", "PARTIALLY_PAID"] } },
    select: { id: true },
  })
  const charges = (await lockCharges(tx, open.map((c) => c.id))).sort(
    (a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.createdAt.getTime() - b.createdAt.getTime(),
  )

  let applied = 0
  const used: string[] = []
  for (let charge of charges) {
    for (const credit of credits) {
      const due = outstandingOf(charge)
      if (due <= 0) break
      // A payment can be allocated to a given charge only once (unique paymentId+chargeId).
      if (credit.left <= 0 || credit.usedOn.has(charge.id)) continue
      const amount = Math.min(due, credit.left)
      charge = await allocate(tx, charge, credit.payment.id, amount)
      credit.left -= amount
      credit.usedOn.add(charge.id)
      applied += amount
      used.push(`${credit.payment.code} → ${charge.code} ₹${toRupees(amount)}`)
    }
  }
  if (applied > 0) {
    await audit(
      actor,
      {
        action: "CREDIT_APPLIED",
        entityType: "Student",
        entityId: studentId,
        summary: `₹${toRupees(applied)} of advance credit applied to new fees (${used.join(", ")})`,
        metadata: { applied: toRupees(applied), allocations: used },
      },
      tx,
    )
  }
  return applied
}

/** A student placed in a batch on days 1–14 (India time) is billed for that month immediately. */
export const JOINING_BILLING_CUTOFF_DAY = 15
/** If the regular due date has already passed, a newly placed student gets this many days to pay. */
export const JOINING_PAYMENT_WINDOW_DAYS = 7

/**
 * Called whenever a student is placed in a batch (approval, re-allocation, teacher adds a student,
 * batch change). Bills the current month's fee straight away when placement happens before the
 * 15th — unless the student already has this month's fee (e.g. moving between batches), which the
 * shared dedupe key guarantees. Must run inside the placement transaction.
 */
export async function billOnPlacement(
  tx: Tx,
  opts: {
    studentId: string
    studentName: string
    enrollmentId: string
    batch: Pick<Batch, "id" | "name" | "status" | "monthlyFee">
    actor: Actor
    now?: Date
  },
) {
  const now = opts.now ?? new Date()
  const today = academyToday(now)
  if (today.day >= JOINING_BILLING_CUTOFF_DAY) return null
  if (opts.batch.status !== "ACTIVE" || opts.batch.monthlyFee <= 0) return null
  const student = await tx.student.findUnique({ where: { id: opts.studentId }, select: { status: true } })
  if (student?.status !== "ACTIVE") return null

  const dedupeKey = monthlyDedupeKey(opts.studentId, today.period)
  if (await tx.feeCharge.findUnique({ where: { dedupeKey } })) return null

  const settings = await getSettings(tx)
  const regularDue = dueDateFor(today.period, settings.billing.dueDay)
  const earliestFair = academyEndOfDay(now, JOINING_PAYMENT_WINDOW_DAYS)
  const dueDate = regularDue > earliestFair ? regularDue : earliestFair

  // skipDuplicates: if the monthly run bills this student at the same instant, keep one charge.
  const created = await tx.feeCharge.createMany({
    data: [
      {
        code: await nextChargeCode(tx),
        studentId: opts.studentId,
        enrollmentId: opts.enrollmentId,
        batchId: opts.batch.id,
        batchNameAtCharge: opts.batch.name,
        type: "MONTHLY",
        billingPeriod: today.period,
        description: `Monthly fee – ${periodLabel(today.period)} (${opts.batch.name})`,
        amount: opts.batch.monthlyFee,
        dueDate,
        dedupeKey,
        createdById: opts.actor.id,
      },
    ],
    skipDuplicates: true,
  })
  if (created.count === 0) return null
  const charge = await tx.feeCharge.findUniqueOrThrow({ where: { dedupeKey } })
  await audit(
    opts.actor,
    {
      action: "CHARGE_CREATED",
      entityType: "FeeCharge",
      entityId: charge.id,
      summary: `${opts.studentName} billed ₹${toRupees(charge.amount)} for ${periodLabel(today.period)} on joining ${opts.batch.name} (placed before the ${JOINING_BILLING_CUTOFF_DAY}th)`,
    },
    tx,
  )
  await applyAdvanceCredit(tx, opts.studentId, opts.actor)
  return tx.feeCharge.findUniqueOrThrow({ where: { id: charge.id } })
}

/**
 * Create monthly charges for every active student with an open enrollment in an active batch.
 * The batch's CURRENT fee is copied into the charge; later fee changes never touch it.
 * Idempotent: a student is billed at most once per period (unique dedupe key).
 */
/** Who should be billed for a month, and who of those has no charge for it yet. */
async function monthlyBillingPlan(period: string, batchId?: string) {
  const enrollments = await prisma.enrollment.findMany({
    where: {
      endedAt: null,
      startedAt: { lt: periodEnd(period) },
      student: { status: "ACTIVE" },
      batch: { status: "ACTIVE", ...(batchId ? { id: batchId } : {}) },
    },
    include: { batch: true },
  })
  // The query only returns enrollments in an existing ACTIVE batch; the guard narrows the type.
  const withBatch = enrollments.filter((e): e is typeof e & { batch: NonNullable<typeof e.batch> } => e.batch !== null)
  const candidates = withBatch.filter((e) => e.batch.monthlyFee > 0)
  const keys = candidates.map((e) => monthlyDedupeKey(e.studentId, period))
  const existing = new Set(
    (await prisma.feeCharge.findMany({ where: { dedupeKey: { in: keys } }, select: { dedupeKey: true } })).map(
      (c) => c.dedupeKey,
    ),
  )
  const toCreate = candidates.filter((e) => !existing.has(monthlyDedupeKey(e.studentId, period)))
  return { withBatch, candidates, toCreate }
}

/** How many students still have no fee for a month — drives the "generate fees" reminder banner. */
export async function monthlyGenerationStatus(period: string) {
  const { toCreate } = await monthlyBillingPlan(period)
  return { period, pendingStudents: toCreate.length }
}

export async function generateMonthlyCharges(opts: {
  period: string
  batchId?: string
  dueDate?: Date
  actor: Actor
}) {
  const settings = await getSettings()
  const dueDate = opts.dueDate ?? dueDateFor(opts.period, settings.billing.dueDay)
  const { withBatch, candidates, toCreate } = await monthlyBillingPlan(opts.period, opts.batchId)

  const created = await prisma.$transaction(async (tx) => {
    const rows = []
    for (const e of toCreate) {
      rows.push({
        code: await nextChargeCode(tx),
        studentId: e.studentId,
        enrollmentId: e.id,
        batchId: e.batchId,
        batchNameAtCharge: e.batch.name,
        type: "MONTHLY" as const,
        billingPeriod: opts.period,
        description: `Monthly fee – ${periodLabel(opts.period)} (${e.batch.name})`,
        amount: e.batch.monthlyFee,
        dueDate,
        dedupeKey: monthlyDedupeKey(e.studentId, opts.period),
        createdById: opts.actor.id,
      })
    }
    // skipDuplicates covers a concurrent run that inserted the same key in the meantime.
    const result = await tx.feeCharge.createMany({ data: rows, skipDuplicates: true })
    await audit(
      opts.actor,
      {
        action: "CHARGES_GENERATED",
        entityType: "FeeCharge",
        summary: `${result.count} monthly charge(s) generated for ${periodLabel(opts.period)}${opts.batchId ? " (single batch)" : ""}`,
        metadata: { period: opts.period, batchId: opts.batchId ?? null, created: result.count },
      },
      tx,
    )
    // New fees are paid from any advance credit the students already have.
    for (const studentId of new Set(rows.map((r) => r.studentId))) await applyAdvanceCredit(tx, studentId, opts.actor)
    return result.count
  })

  return {
    period: opts.period,
    created,
    alreadyBilled: candidates.length - toCreate.length + (toCreate.length - created),
    skippedZeroFee: withBatch.length - candidates.length,
    dueDate,
  }
}
