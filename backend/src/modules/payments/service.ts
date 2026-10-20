import type { FeeCharge, Payment, PaymentAllocation, PaymentMethod, Student, User } from "@prisma/client"
import { prisma, type Tx } from "../../lib/prisma"
import { badRequest, conflict, notFound } from "../../lib/errors"
import { outstandingOf, toRupees } from "../../lib/money"
import { audit, SYSTEM_ACTOR, type Actor } from "../../lib/audit"
import { nextPaymentCode, nextReceiptNumber } from "../../lib/codes"
import { sendMail } from "../../lib/mailer"
import { allocate, lockCharges, unallocatePayment } from "../fees/service"
import { getSettings } from "../settings/service"
import type { GatewayPayment } from "./providers"

export const paymentInclude = {
  student: { select: { id: true, code: true, user: { select: { name: true, email: true } } } },
  recordedBy: { select: { name: true } },
  allocations: {
    include: { charge: { select: { id: true, code: true, description: true, billingPeriod: true } } },
    orderBy: { createdAt: "asc" },
  },
} as const

type PaymentRow = Payment & {
  student: Pick<Student, "id" | "code"> & { user: Pick<User, "name" | "email"> }
  recordedBy: Pick<User, "name"> | null
  allocations: (PaymentAllocation & { charge: Pick<FeeCharge, "id" | "code" | "description" | "billingPeriod"> })[]
}

export function serializePayment(p: PaymentRow) {
  const allocated = p.allocations.reduce((sum, a) => sum + a.amount, 0)
  const periods = [...new Set(p.allocations.map((a) => a.charge.billingPeriod).filter(Boolean))].sort()
  return {
    id: p.id,
    code: p.code,
    receiptNumber: p.receiptNumber,
    studentId: p.studentId,
    student: { id: p.student.id, code: p.student.code, name: p.student.user.name },
    amount: toRupees(p.amount),
    allocatedAmount: toRupees(allocated),
    unallocatedAmount: p.status === "SUCCEEDED" ? toRupees(p.amount - allocated) : 0,
    currency: p.currency,
    source: p.source,
    method: p.method,
    status: p.status,
    paymentDate: p.paymentDate,
    periods,
    transactionReference: p.transactionReference ?? p.providerPaymentId,
    notes: p.notes,
    recordedBy: p.recordedBy?.name ?? (p.source === "ONLINE" ? "Online (gateway verified)" : null),
    provider: p.provider,
    providerOrderId: p.providerOrderId,
    providerPaymentId: p.providerPaymentId,
    verifiedAt: p.verifiedAt,
    verifiedVia: p.verifiedVia,
    failureReason: p.failureReason,
    voidedAt: p.voidedAt,
    voidReason: p.voidReason,
    createdAt: p.createdAt,
    allocations: p.allocations.map((a) => ({
      chargeId: a.charge.id,
      chargeCode: a.charge.code,
      description: a.charge.description,
      billingPeriod: a.charge.billingPeriod,
      amount: toRupees(a.amount),
    })),
  }
}

export type AllocationRequest = { chargeId: string; amount: number }

/**
 * Lock the student's charges and apply allocations. With `auto`, the amount is spread over the
 * oldest open charges first. Returns the total allocated (paise).
 */
async function applyAllocations(
  tx: Tx,
  opts: { paymentId: string; studentId: string; available: number; requested?: AllocationRequest[]; auto: boolean },
) {
  let plan: AllocationRequest[] = []
  if (opts.requested?.length) {
    const ids = opts.requested.map((r) => r.chargeId)
    if (new Set(ids).size !== ids.length) throw badRequest("Each charge can appear only once in an allocation.")
    const charges = await lockCharges(tx, ids)
    for (const r of opts.requested) {
      const charge = charges.find((c) => c.id === r.chargeId)
      if (!charge || charge.studentId !== opts.studentId) throw badRequest("A selected charge does not belong to this student.")
      if (charge.status === "VOID") throw badRequest(`${charge.code} is void.`)
      if (r.amount > outstandingOf(charge)) {
        throw badRequest(`${charge.code} has only ₹${toRupees(outstandingOf(charge))} outstanding.`)
      }
    }
    plan = opts.requested
  } else if (opts.auto) {
    const open = await tx.feeCharge.findMany({
      where: { studentId: opts.studentId, status: { in: ["PENDING", "PARTIALLY_PAID"] } },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    })
    const charges = await lockCharges(tx, open.map((c) => c.id))
    charges.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.createdAt.getTime() - b.createdAt.getTime())
    let remaining = opts.available
    for (const c of charges) {
      if (remaining <= 0) break
      const amount = Math.min(remaining, outstandingOf(c))
      if (amount > 0) plan.push({ chargeId: c.id, amount })
      remaining -= amount
    }
  }

  const total = plan.reduce((sum, p) => sum + p.amount, 0)
  if (total > opts.available) throw badRequest("Allocations exceed the payment amount.")
  for (const p of plan) {
    // Re-read inside the lock so the outstanding check uses current numbers.
    const charge = await tx.feeCharge.findUniqueOrThrow({ where: { id: p.chargeId } })
    await allocate(tx, charge, opts.paymentId, p.amount)
  }
  return total
}

export async function recordManualPayment(
  actor: Actor,
  input: {
    studentId: string
    amount: number
    method: PaymentMethod
    paymentDate: Date
    transactionReference: string | null
    notes: string | null
    allocations?: AllocationRequest[]
    autoAllocate: boolean
    idempotencyKey: string | null
  },
) {
  if (input.idempotencyKey) {
    const previous = await prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } })
    if (previous) return { payment: previous, replayed: true }
  }
  const student = await prisma.student.findUnique({ where: { id: input.studentId }, include: { user: true } })
  if (!student) throw notFound("Student")
  if (input.transactionReference && input.method !== "CASH") {
    const dup = await prisma.payment.findFirst({
      where: {
        method: input.method,
        transactionReference: input.transactionReference,
        status: "SUCCEEDED",
      },
    })
    if (dup) throw conflict(`A ${input.method} payment with reference "${input.transactionReference}" is already recorded (${dup.code}).`)
  }

  const payment = await prisma.$transaction(async (tx) => {
    const created = await tx.payment.create({
      data: {
        code: await nextPaymentCode(tx),
        receiptNumber: await nextReceiptNumber(tx, input.paymentDate),
        studentId: student.id,
        amount: input.amount,
        source: "MANUAL",
        method: input.method,
        status: "SUCCEEDED",
        paymentDate: input.paymentDate,
        transactionReference: input.transactionReference,
        notes: input.notes,
        recordedById: actor.id,
        verifiedAt: new Date(),
        verifiedVia: "MANUAL",
        idempotencyKey: input.idempotencyKey,
      },
    })
    const allocated = await applyAllocations(tx, {
      paymentId: created.id,
      studentId: student.id,
      available: input.amount,
      requested: input.allocations,
      auto: input.autoAllocate,
    })
    await audit(
      actor,
      {
        action: "PAYMENT_RECORDED",
        entityType: "Payment",
        entityId: created.id,
        summary: `${student.user.name} • ₹${toRupees(input.amount).toLocaleString("en-IN")} via ${input.method} recorded manually (${created.receiptNumber})`,
        metadata: { allocated: toRupees(allocated), unallocated: toRupees(input.amount - allocated) },
      },
      tx,
    )
    return created
  })
  void sendReceiptEmail(payment.id)
  return { payment, replayed: false }
}

/** Apply a payment's unallocated balance (credit) to charges. */
export async function allocateCredit(actor: Actor, paymentId: string, requested: AllocationRequest[]) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`
    const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: { allocations: true } })
    if (!payment) throw notFound("Payment")
    if (payment.status !== "SUCCEEDED") throw badRequest("Only successful payments can be allocated.")
    const existing = new Set(payment.allocations.map((a) => a.chargeId))
    if (requested.some((r) => existing.has(r.chargeId))) {
      throw conflict("This payment is already allocated to one of those charges.")
    }
    const available = payment.amount - payment.allocations.reduce((s, a) => s + a.amount, 0)
    const total = await applyAllocations(tx, {
      paymentId,
      studentId: payment.studentId,
      available,
      requested,
      auto: false,
    })
    await audit(
      actor,
      {
        action: "PAYMENT_ALLOCATED",
        entityType: "Payment",
        entityId: paymentId,
        summary: `₹${toRupees(total)} of ${payment.code} allocated to ${requested.length} charge(s)`,
      },
      tx,
    )
  })
}

/** Reverse a manually recorded payment entered in error. The record is kept, marked VOIDED. */
export async function voidPayment(actor: Actor, paymentId: string, reason: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`
    const payment = await tx.payment.findUnique({ where: { id: paymentId } })
    if (!payment) throw notFound("Payment")
    if (payment.status !== "SUCCEEDED") throw conflict("Only successful payments can be voided.")
    if (payment.source !== "MANUAL") {
      throw badRequest("Online payments cannot be voided here. Issue a refund from the payment gateway.")
    }
    await unallocatePayment(tx, paymentId)
    await tx.payment.update({
      where: { id: paymentId },
      data: { status: "VOIDED", voidedAt: new Date(), voidReason: reason },
    })
    await audit(
      actor,
      {
        action: "PAYMENT_VOIDED",
        entityType: "Payment",
        entityId: paymentId,
        summary: `${payment.code} (₹${toRupees(payment.amount)}) voided: ${reason}`,
      },
      tx,
    )
  })
}

const METHOD_MAP: Record<string, PaymentMethod> = {
  upi: "UPI",
  card: "CARD",
  netbanking: "NET_BANKING",
  wallet: "WALLET",
  emi: "CARD",
}

export type FinalizeResult =
  | { outcome: "succeeded"; paymentId: string }
  | { outcome: "already_processed"; paymentId: string }
  | { outcome: "ignored"; reason: string }

/**
 * The single place an online payment becomes SUCCEEDED. Called from checkout verification,
 * the webhook and reconciliation — whichever arrives first wins; the others are no-ops.
 * The caller must already have proven `gw` is authentic (signature + gateway fetch, or signed webhook).
 */
export async function finalizeOnlinePayment(
  paymentId: string,
  gw: GatewayPayment,
  via: "CHECKOUT_VERIFY" | "WEBHOOK" | "RECONCILE",
  actor: Actor = SYSTEM_ACTOR,
): Promise<FinalizeResult> {
  const result = await prisma.$transaction(async (tx): Promise<FinalizeResult> => {
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`
    const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: { orderItems: true, student: { include: { user: true } } } })
    if (!payment) throw notFound("Payment")

    if (payment.status === "SUCCEEDED") {
      if (payment.providerPaymentId === gw.id) return { outcome: "already_processed", paymentId }
      // A second captured payment on an already-paid order: never record it twice; flag for refund.
      await audit(
        actor,
        {
          action: "DUPLICATE_GATEWAY_PAYMENT",
          entityType: "Payment",
          entityId: paymentId,
          summary: `Gateway payment ${gw.id} captured for already-paid order ${payment.providerOrderId}; refund it from the gateway dashboard`,
          metadata: { gatewayPaymentId: gw.id, amount: toRupees(gw.amount) },
        },
        tx,
      )
      return { outcome: "ignored", reason: "order already paid" }
    }
    if (payment.status === "VOIDED") return { outcome: "ignored", reason: "payment voided" }

    if (gw.orderId !== payment.providerOrderId) throw badRequest("Gateway payment does not belong to this order.")
    if (gw.amount !== payment.amount || gw.currency !== payment.currency) {
      throw badRequest("Gateway payment amount does not match the order.")
    }
    if (gw.status !== "captured") throw badRequest(`Gateway reports the payment as ${gw.status}.`)

    const now = new Date()
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: "SUCCEEDED",
        providerPaymentId: gw.id,
        method: METHOD_MAP[gw.method ?? ""] ?? "ONLINE",
        paymentDate: now,
        verifiedAt: now,
        verifiedVia: via,
        failureReason: null,
        receiptNumber: await nextReceiptNumber(tx, now),
      },
    })

    // Allocate to the charges the order was created for, capped at what is still due.
    // Anything left over (e.g. the charge was paid in cash meanwhile) stays as credit.
    const charges = await lockCharges(tx, payment.orderItems.map((i) => i.chargeId))
    let allocated = 0
    for (const item of payment.orderItems) {
      const charge = charges.find((c) => c.id === item.chargeId)
      if (!charge || charge.status === "VOID") continue
      const amount = Math.min(item.amount, outstandingOf(charge))
      if (amount > 0) {
        await allocate(tx, charge, paymentId, amount)
        allocated += amount
      }
    }
    await audit(
      actor,
      {
        action: "PAYMENT_RECEIVED",
        entityType: "Payment",
        entityId: paymentId,
        summary: `${payment.student.user.name} • ₹${toRupees(payment.amount).toLocaleString("en-IN")} paid online (verified via ${via.toLowerCase().replace("_", " ")})`,
        metadata: {
          gatewayPaymentId: gw.id,
          allocated: toRupees(allocated),
          credit: toRupees(payment.amount - allocated),
        },
      },
      tx,
    )
    return { outcome: "succeeded", paymentId }
  })

  if (result.outcome === "succeeded") void sendReceiptEmail(paymentId)
  return result
}

/** Record a failed attempt. A later successful attempt on the same order can still succeed. */
export async function markOnlinePaymentFailed(paymentId: string, reason: string | null) {
  await prisma.payment.updateMany({
    where: { id: paymentId, status: "CREATED" },
    data: { status: "FAILED", failureReason: reason ?? "Payment failed" },
  })
}

export async function sendReceiptEmail(paymentId: string) {
  try {
    const settings = await getSettings()
    if (!settings.notifications.sendPaymentReceipts) return
    const p = await prisma.payment.findUnique({ where: { id: paymentId }, include: paymentInclude })
    if (!p || p.status !== "SUCCEEDED") return
    const s = serializePayment(p)
    const lines = s.allocations.map((a) => `  • ${a.description}: ₹${a.amount.toLocaleString("en-IN")}`).join("\n")
    await sendMail({
      to: p.student.user.email,
      subject: `Payment received – receipt ${s.receiptNumber}`,
      text: `Hello ${s.student.name},\n\nWe have received your payment of ₹${s.amount.toLocaleString("en-IN")} (${s.method}).\nReceipt number: ${s.receiptNumber}\n${lines ? `\nApplied to:\n${lines}\n` : ""}\nYou can download the receipt from your student dashboard.\n\nThank you!`,
    })
  } catch (error) {
    console.error("[receipt] email failed", (error as Error).message)
  }
}
