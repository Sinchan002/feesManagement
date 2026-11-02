import { Prisma } from "@prisma/client"
import { prisma } from "../../lib/prisma"
import { badRequest, conflict, notFound } from "../../lib/errors"
import { outstandingOf, toRupees } from "../../lib/money"
import { audit, type Actor } from "../../lib/audit"
import { nextPaymentCode } from "../../lib/codes"
import { sha256 } from "../../lib/crypto"
import { env } from "../../config/env"
import { getSettings } from "../settings/service"
import { chargeIdsWithPendingClaim } from "../upi/service"
import { getPaymentProvider, type GatewayPayment } from "./providers"
import { finalizeOnlinePayment, markOnlinePaymentFailed, type FinalizeResult } from "./service"

const ORDER_REUSE_WINDOW_MS = 30 * 60 * 1000

/**
 * Create a gateway order for some (or all) of a student's open charges.
 * The amount is computed here from the database — never taken from the client.
 */
export async function createOnlineOrder(actor: Actor, studentId: string, chargeIds?: string[]) {
  const settings = await getSettings()
  const { upi, card, netBanking } = settings.paymentMethods
  if (!upi && !card && !netBanking) throw badRequest("Online payments are currently disabled. Please pay at the academy.")

  const student = await prisma.student.findUnique({ where: { id: studentId }, include: { user: true } })
  if (!student || student.status !== "ACTIVE") throw notFound("Student")

  const found = await prisma.feeCharge.findMany({
    where: {
      studentId,
      status: { in: ["PENDING", "PARTIALLY_PAID"] },
      ...(chargeIds?.length ? { id: { in: chargeIds } } : {}),
    },
    orderBy: { dueDate: "asc" },
  })
  if (chargeIds?.length && found.length !== new Set(chargeIds).size) {
    throw badRequest("Some selected fees are not payable (already paid, void, or not yours).")
  }
  // Fees with a UPI payment waiting for the teacher can't also be paid here (it would be paid twice).
  const awaiting = await chargeIdsWithPendingClaim(found.map((c) => c.id))
  if (chargeIds?.length && found.some((c) => awaiting.has(c.id))) {
    throw badRequest("A UPI payment for one of these fees is waiting for the teacher to verify. Choose other months, or wait for the result.")
  }
  const charges = found.filter((c) => !awaiting.has(c.id))
  const items = charges.map((c) => ({ chargeId: c.id, amount: outstandingOf(c) })).filter((i) => i.amount > 0)
  if (items.length === 0) throw badRequest("You have no outstanding fees to pay.")
  const amount = items.reduce((s, i) => s + i.amount, 0)
  const currency = env.PAYMENT_CURRENCY
  const provider = getPaymentProvider()

  // Re-use a recent unpaid order for the same fees instead of creating duplicates.
  const recent = await prisma.payment.findFirst({
    where: {
      studentId,
      source: "ONLINE",
      status: { in: ["CREATED", "FAILED"] },
      amount,
      provider: provider.name,
      createdAt: { gt: new Date(Date.now() - ORDER_REUSE_WINDOW_MS) },
      providerOrderId: { not: null },
    },
    include: { orderItems: true },
    orderBy: { createdAt: "desc" },
  })
  const sameItems =
    recent &&
    recent.orderItems.length === items.length &&
    items.every((i) => recent.orderItems.some((o) => o.chargeId === i.chargeId && o.amount === i.amount))

  let payment = sameItems ? recent : null
  if (!payment) {
    const draft = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          code: await nextPaymentCode(tx),
          studentId,
          amount,
          currency,
          source: "ONLINE",
          method: "ONLINE",
          status: "CREATED",
          provider: provider.name,
          orderItems: { create: items },
        },
        include: { orderItems: true },
      })
      await audit(
        actor,
        {
          action: "PAYMENT_ORDER_CREATED",
          entityType: "Payment",
          entityId: created.id,
          summary: `${student.user.name} started an online payment of ₹${toRupees(amount).toLocaleString("en-IN")}`,
        },
        tx,
      )
      return created
    })
    const order = await provider.createOrder({
      amount,
      currency,
      receipt: draft.code,
      notes: { paymentId: draft.id, studentCode: student.code },
    })
    if (order.amount !== amount || order.currency !== currency) {
      throw new Error("Gateway created an order with an unexpected amount")
    }
    payment = await prisma.payment.update({
      where: { id: draft.id },
      data: { providerOrderId: order.orderId },
      include: { orderItems: true },
    })
  }

  return {
    paymentId: payment.id,
    code: payment.code,
    provider: provider.name,
    keyId: provider.publicKey,
    orderId: payment.providerOrderId!,
    amount: toRupees(amount),
    amountInSubunits: amount,
    currency,
    description: `Tuition fees (${items.length} item${items.length > 1 ? "s" : ""})`,
    prefill: { name: student.user.name, email: student.user.email, contact: student.user.phone ?? "" },
    charges: charges.map((c) => ({ id: c.id, code: c.code, description: c.description, amount: toRupees(outstandingOf(c)) })),
  }
}

/**
 * Called by the browser after checkout. Success is decided ONLY by (1) a valid HMAC signature
 * and (2) the gateway confirming the payment is captured for this order and amount.
 */
export async function verifyCheckout(
  actor: Actor,
  studentId: string,
  input: { orderId: string; paymentId: string; signature: string },
) {
  const provider = getPaymentProvider()
  const payment = await prisma.payment.findUnique({ where: { providerOrderId: input.orderId } })
  // Resource-level check: the order must belong to the signed-in student.
  if (!payment || payment.studentId !== studentId || payment.provider !== provider.name) throw notFound("Payment order")

  if (!provider.verifyCheckoutSignature(input)) {
    await audit(actor, {
      action: "PAYMENT_SIGNATURE_INVALID",
      entityType: "Payment",
      entityId: payment.id,
      summary: `Rejected checkout confirmation with an invalid signature for ${payment.code}`,
    })
    throw badRequest("Payment verification failed. If money was deducted, it will be confirmed automatically or refunded.")
  }

  let gw = await provider.fetchPayment(input.paymentId)
  if (gw.status === "authorized" && gw.orderId === payment.providerOrderId && gw.amount === payment.amount) {
    gw = await provider.capturePayment(gw.id, payment.amount, payment.currency)
  }
  if (gw.status === "failed") {
    await markOnlinePaymentFailed(payment.id, gw.errorDescription)
    throw badRequest(gw.errorDescription ?? "The payment failed. Please try again.")
  }
  if (gw.status !== "captured") {
    throw conflict("The payment is still being processed. It will be confirmed automatically once complete.")
  }
  return finalizeOnlinePayment(payment.id, gw, "CHECKOUT_VERIFY", actor)
}

/** Admin: ask the gateway for the order's payments and settle the record if one was captured. */
export async function reconcileOnlinePayment(actor: Actor, paymentId: string): Promise<FinalizeResult | { outcome: "pending" }> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
  if (!payment) throw notFound("Payment")
  if (payment.source !== "ONLINE" || !payment.providerOrderId) throw badRequest("Only online payments can be reconciled.")
  const provider = getPaymentProvider()
  if (payment.provider !== provider.name) throw badRequest("This payment belongs to a different gateway.")
  const attempts = await provider.fetchOrderPayments(payment.providerOrderId)
  const captured = attempts.find((a) => a.status === "captured" && a.amount === payment.amount)
  if (captured) return finalizeOnlinePayment(paymentId, captured, "RECONCILE", actor)
  if (attempts.length && attempts.every((a) => a.status === "failed")) {
    await markOnlinePaymentFailed(paymentId, attempts.at(-1)?.errorDescription ?? null)
  }
  return { outcome: "pending" }
}

/**
 * Webhook processing. Signature verified on the raw body; each event id is stored once, so
 * redelivered events are acknowledged without being processed again.
 */
export async function processWebhook(
  providerName: string,
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
) {
  const provider = getPaymentProvider()
  if (provider.name !== providerName) throw notFound("Webhook endpoint")
  const signatureHeader = headers["x-razorpay-signature"]
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader
  if (!provider.verifyWebhookSignature(rawBody, signature)) {
    throw badRequest("Invalid webhook signature.")
  }

  let event
  try {
    event = provider.parseWebhook(rawBody, headers)
  } catch {
    throw badRequest("Malformed webhook payload.")
  }
  const eventId = event.eventId ?? sha256(rawBody.toString("utf8"))

  const key = { provider_eventId: { provider: provider.name, eventId } }
  const seen = async () => {
    const existing = await prisma.webhookEvent.findUnique({ where: key })
    if (existing && (existing.status === "PROCESSED" || existing.status === "IGNORED")) {
      return { done: true as const, status: existing.status }
    }
    return { done: false as const, existing } // unseen, or a previous attempt failed — process again
  }

  let check = await seen()
  if (check.done) return { duplicate: true, status: check.status }
  let record = check.existing
  if (!record) {
    try {
      record = await prisma.webhookEvent.create({
        data: {
          provider: provider.name,
          eventId,
          eventType: event.eventType,
          payload: JSON.parse(rawBody.toString("utf8")) as Prisma.InputJsonValue,
        },
      })
    } catch (error) {
      // A concurrent delivery of the same event inserted it first.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error
      check = await seen()
      if (check.done) return { duplicate: true, status: check.status }
      record = check.existing!
    }
  }

  try {
    const status = await handleEvent(event.eventType, event.payment, event.orderId)
    await prisma.webhookEvent.update({
      where: { id: record.id },
      data: { status, processedAt: new Date(), error: null },
    })
    return { duplicate: false, status }
  } catch (error) {
    await prisma.webhookEvent.update({
      where: { id: record.id },
      data: { status: "FAILED", error: (error as Error).message.slice(0, 500) },
    })
    throw error // non-2xx makes the gateway retry later
  }
}

async function handleEvent(type: string, gw: GatewayPayment | null, orderId: string | null) {
  const relevant = ["payment.captured", "order.paid", "payment.failed"]
  if (!relevant.includes(type) || !gw) return "IGNORED"
  const payment = await prisma.payment.findUnique({ where: { providerOrderId: gw.orderId ?? orderId ?? "" } })
  if (!payment) return "IGNORED" // order not created by this system

  if (type === "payment.failed") {
    await markOnlinePaymentFailed(payment.id, gw.errorDescription)
    return "PROCESSED"
  }
  const result = await finalizeOnlinePayment(payment.id, gw, "WEBHOOK")
  return result.outcome === "ignored" ? "IGNORED" : "PROCESSED"
}
