import { Router } from "express"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { prisma } from "../../lib/prisma"
import { idParam, optionalText, pageMeta, paginate, paginationSchema, parse, toCsv } from "../../lib/http"
import { badRequest, notFound } from "../../lib/errors"
import { actorFrom } from "../../lib/audit"
import { rupees } from "../../lib/money"
import { isProduction } from "../../config/env"
import { assertCanAccessStudent, authenticate, ownStudentId, requireAdmin, requireStudent } from "../../middleware/auth"
import { paymentLimiter } from "../../middleware/rate-limit"
import { getSettings } from "../settings/service"
import { createOnlineOrder, reconcileOnlinePayment, verifyCheckout } from "./online"
import { MockProvider } from "./providers/mock"
import { getPaymentProvider } from "./providers"
import { receiptData, renderReceiptPdf } from "./receipt"
import { allocateCredit, paymentInclude, recordManualPayment, serializePayment, voidPayment } from "./service"

export const paymentsRouter = Router()
paymentsRouter.use(authenticate)

// ───────────── Admin ledger ─────────────

const listSchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  studentId: z.string().max(64).optional(),
  batchId: z.string().max(64).optional(),
  source: z.enum(["MANUAL", "ONLINE"]).optional(),
  method: z.string().trim().toUpperCase().optional(),
  status: z.enum(["SUCCEEDED", "VOIDED", "CREATED", "FAILED", "ALL"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

function ledgerWhere(q: z.infer<typeof listSchema>): Prisma.PaymentWhereInput {
  return {
    // The ledger shows completed entries by default; abandoned online attempts are opt-in.
    ...(q.status === "ALL" ? {} : q.status ? { status: q.status } : { status: { in: ["SUCCEEDED", "VOIDED"] } }),
    ...(q.studentId ? { studentId: q.studentId } : {}),
    ...(q.batchId ? { allocations: { some: { charge: { batchId: q.batchId } } } } : {}),
    ...(q.source ? { source: q.source } : {}),
    ...(q.method ? { method: q.method as Prisma.EnumPaymentMethodFilter["equals"] } : {}),
    ...(q.from || q.to ? { paymentDate: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    ...(q.search
      ? {
          OR: [
            { code: { contains: q.search, mode: "insensitive" } },
            { receiptNumber: { contains: q.search, mode: "insensitive" } },
            { transactionReference: { contains: q.search, mode: "insensitive" } },
            { providerPaymentId: { contains: q.search, mode: "insensitive" } },
            { student: { code: { contains: q.search, mode: "insensitive" } } },
            { student: { user: { name: { contains: q.search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  }
}

paymentsRouter.get("/", requireAdmin, async (req, res) => {
  const q = parse(listSchema, req.query)
  const where = ledgerWhere(q)
  const [total, rows] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({ where, include: paymentInclude, orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }], ...paginate(q) }),
  ])
  res.json({ data: rows.map(serializePayment), meta: pageMeta(total, q) })
})

paymentsRouter.get("/export.csv", requireAdmin, async (req, res) => {
  const q = parse(listSchema, req.query)
  const rows = await prisma.payment.findMany({
    where: ledgerWhere(q),
    include: paymentInclude,
    orderBy: { paymentDate: "desc" },
    take: 10_000,
  })
  const csv = toCsv(
    ["Payment", "Receipt", "Date", "Student code", "Student", "Amount", "Method", "Source", "Status", "Periods", "Reference", "Recorded by", "Notes"],
    rows.map(serializePayment).map((p) => [
      p.code,
      p.receiptNumber,
      p.paymentDate?.toISOString().slice(0, 10),
      p.student.code,
      p.student.name,
      p.amount.toFixed(2),
      p.method,
      p.source,
      p.status,
      p.periods.join(" "),
      p.transactionReference,
      p.recordedBy,
      p.notes,
    ]),
  )
  res.setHeader("Content-Type", "text/csv; charset=utf-8")
  res.setHeader("Content-Disposition", `attachment; filename="payments-${new Date().toISOString().slice(0, 10)}.csv"`)
  res.send(csv)
})

const allocationSchema = z.array(z.object({ chargeId: z.string().min(1).max(64), amount: rupees() })).max(50)

const manualSchema = z.object({
  studentId: z.string().min(1, "Select a student").max(64),
  amount: rupees(),
  method: z
    .string()
    .trim()
    .toUpperCase()
    .transform((m) => m.replace(/[\s-]+/g, "_"))
    .pipe(z.enum(["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "CARD", "NET_BANKING", "OTHER"])),
  paymentDate: z.coerce
    .date()
    .optional()
    .refine((d) => !d || d.getTime() <= Date.now() + 60_000, "Payment date cannot be in the future"),
  transactionReference: optionalText(100),
  notes: optionalText(500),
  /** Explicit split across charges. If omitted, oldest unpaid charges are paid first. */
  allocations: allocationSchema.optional(),
  autoAllocate: z.boolean().default(true),
})

/** Record a cash / UPI / bank-transfer / cheque payment received offline. */
paymentsRouter.post("/manual", requireAdmin, async (req, res) => {
  const input = parse(manualSchema, req.body)
  const idempotencyKey = req.get("idempotency-key")?.slice(0, 100) ?? null
  const { payment, replayed } = await recordManualPayment(actorFrom(req), {
    ...input,
    paymentDate: input.paymentDate ?? new Date(),
    idempotencyKey,
  })
  const full = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id }, include: paymentInclude })
  res.status(replayed ? 200 : 201).json({ data: serializePayment(full) })
})

paymentsRouter.post("/:id/allocations", requireAdmin, async (req, res) => {
  const id = idParam(req)
  const { allocations } = parse(z.object({ allocations: allocationSchema.min(1) }), req.body)
  await allocateCredit(actorFrom(req), id, allocations)
  const full = await prisma.payment.findUniqueOrThrow({ where: { id }, include: paymentInclude })
  res.json({ data: serializePayment(full) })
})

paymentsRouter.post("/:id/void", requireAdmin, async (req, res) => {
  const id = idParam(req)
  const { reason } = parse(z.object({ reason: z.string().trim().min(5, "Give a reason").max(500) }), req.body)
  await voidPayment(actorFrom(req), id, reason)
  const full = await prisma.payment.findUniqueOrThrow({ where: { id }, include: paymentInclude })
  res.json({ data: serializePayment(full) })
})

/** Ask the gateway about an online payment whose confirmation never arrived. */
paymentsRouter.post("/:id/reconcile", requireAdmin, async (req, res) => {
  const id = idParam(req)
  const result = await reconcileOnlinePayment(actorFrom(req), id)
  const full = await prisma.payment.findUniqueOrThrow({ where: { id }, include: paymentInclude })
  res.json({ data: { result: result.outcome, payment: serializePayment(full) } })
})

// ───────────── Online payments (students) ─────────────

paymentsRouter.get("/online/config", async (_req, res) => {
  const settings = await getSettings()
  const provider = getPaymentProvider()
  res.json({ data: { provider: provider.name, keyId: provider.publicKey, methods: settings.paymentMethods } })
})

const orderSchema = z.object({ chargeIds: z.array(z.string().min(1).max(64)).max(50).optional() })

paymentsRouter.post("/online/orders", requireStudent, paymentLimiter, async (req, res) => {
  const { chargeIds } = parse(orderSchema, req.body)
  res.status(201).json({ data: await createOnlineOrder(actorFrom(req), ownStudentId(req), chargeIds) })
})

// Accepts the Razorpay checkout handler's field names as-is.
const verifySchema = z
  .object({
    orderId: z.string().max(100).optional(),
    paymentId: z.string().max(100).optional(),
    signature: z.string().max(200).optional(),
    razorpay_order_id: z.string().max(100).optional(),
    razorpay_payment_id: z.string().max(100).optional(),
    razorpay_signature: z.string().max(200).optional(),
  })
  .transform((b) => ({
    orderId: b.orderId ?? b.razorpay_order_id ?? "",
    paymentId: b.paymentId ?? b.razorpay_payment_id ?? "",
    signature: b.signature ?? b.razorpay_signature ?? "",
  }))
  .refine((b) => b.orderId && b.paymentId && b.signature, "orderId, paymentId and signature are required")

paymentsRouter.post("/online/verify", requireStudent, paymentLimiter, async (req, res) => {
  const input = parse(verifySchema, req.body)
  const result = await verifyCheckout(actorFrom(req), ownStudentId(req), input)
  if (result.outcome === "ignored") throw badRequest("This order has already been paid.")
  const full = await prisma.payment.findUniqueOrThrow({ where: { id: result.paymentId }, include: paymentInclude })
  res.json({ data: serializePayment(full) })
})

/**
 * Development only: plays the part of the hosted checkout page for the mock gateway, returning
 * what a real gateway would hand the browser. The browser must still call /online/verify.
 */
paymentsRouter.post("/online/mock-checkout", requireStudent, async (req, res) => {
  const provider = getPaymentProvider()
  if (isProduction || !(provider instanceof MockProvider)) throw notFound("Route")
  const { orderId, outcome, method } = parse(
    z.object({
      orderId: z.string().min(1),
      outcome: z.enum(["success", "failure"]).default("success"),
      method: z.enum(["upi", "card", "netbanking"]).default("upi"),
    }),
    req.body,
  )
  const payment = await prisma.payment.findUnique({ where: { providerOrderId: orderId } })
  if (!payment || payment.studentId !== ownStudentId(req)) throw notFound("Payment order")
  const { payment: _gw, ...checkoutResponse } = provider.simulateCheckout(orderId, outcome, method)
  res.json({ data: checkoutResponse })
})

// ───────────── Shared (admin or owner) ─────────────

paymentsRouter.get("/:id", async (req, res) => {
  const payment = await prisma.payment.findUnique({ where: { id: idParam(req) }, include: paymentInclude })
  if (!payment) throw notFound("Payment")
  assertCanAccessStudent(req, payment.studentId, "Payment")
  res.json({ data: serializePayment(payment) })
})

async function loadReceipt(req: Parameters<typeof idParam>[0]) {
  const payment = await prisma.payment.findUnique({ where: { id: idParam(req) }, include: paymentInclude })
  if (!payment) throw notFound("Receipt")
  assertCanAccessStudent(req, payment.studentId, "Receipt")
  if (!payment.receiptNumber || (payment.status !== "SUCCEEDED" && payment.status !== "VOIDED")) {
    throw notFound("Receipt")
  }
  return { payment: serializePayment(payment), academy: (await getSettings()).academy }
}

paymentsRouter.get("/:id/receipt", async (req, res) => {
  const { payment, academy } = await loadReceipt(req)
  res.json({ data: receiptData(payment, academy) })
})

paymentsRouter.get("/:id/receipt.pdf", async (req, res) => {
  const { payment, academy } = await loadReceipt(req)
  const pdf = await renderReceiptPdf(payment, academy)
  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `attachment; filename="${payment.receiptNumber}.pdf"`)
  res.setHeader("Cache-Control", "private, no-store")
  res.send(pdf)
})
