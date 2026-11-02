import { Prisma } from "@prisma/client"
import type { FeeCharge, Payment, Student, UpiClaim, UpiClaimItem, User } from "@prisma/client"
import { z } from "zod"
import { prisma, type Db, type Tx } from "../../lib/prisma"
import { badRequest, conflict, notFound } from "../../lib/errors"
import { audit, type Actor } from "../../lib/audit"
import { nextUpiClaimCode } from "../../lib/codes"
import { outstandingOf, toRupees } from "../../lib/money"
import { sendMail } from "../../lib/mailer"
import { lockCharges } from "../fees/service"
import { createManualPaymentTx, sendReceiptEmail } from "../payments/service"
import { lockStudent } from "../students/enrollment"

// ───────────── Teacher's UPI details ─────────────

const KEY = "upi"

/** name@bank — letters, digits, dot, dash, underscore before the @. */
export const upiIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{2,64}@[a-z][a-z0-9]{1,30}$/, "Enter a valid UPI ID, like name@bank")

export const upiConfigSchema = z.object({
  upiId: upiIdSchema,
  payeeName: z.string().trim().min(2, "Enter the name shown in UPI apps").max(60),
})

type StoredUpi = { upiId: string; payeeName: string; qr?: { mime: string; data: string } | null }

async function readStored(db: Db = prisma): Promise<StoredUpi | null> {
  const row = await db.setting.findUnique({ where: { key: KEY } })
  return (row?.value as StoredUpi | undefined) ?? null
}

async function writeStored(value: StoredUpi, db: Db = prisma) {
  await db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } })
}

export async function getUpiConfig() {
  const s = await readStored()
  return {
    configured: Boolean(s?.upiId),
    upiId: s?.upiId ?? "",
    payeeName: s?.payeeName ?? "",
    hasQr: Boolean(s?.qr),
    qrDataUrl: s?.qr ? `data:${s.qr.mime};base64,${s.qr.data}` : null,
  }
}

export async function saveUpiDetails(input: z.infer<typeof upiConfigSchema>) {
  const current = await readStored()
  await writeStored({ ...input, qr: current?.qr ?? null })
}

/** Recognise the image type from its first bytes — never trust the Content-Type header alone. */
export function sniffImage(buf: Buffer): string | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png"
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg"
  if (buf.length > 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp"
  return null
}

export async function saveQr(image: Buffer) {
  const mime = sniffImage(image)
  if (!mime) throw badRequest("Upload a PNG, JPG or WebP image of your UPI QR code.")
  const current = await readStored()
  if (!current?.upiId) throw badRequest("Save your UPI ID first, then upload the QR code.")
  await writeStored({ ...current, qr: { mime, data: image.toString("base64") } })
}

export async function removeQr() {
  const current = await readStored()
  if (current) await writeStored({ ...current, qr: null })
}

// ───────────── Student claims ─────────────

export const claimSchema = z.object({
  chargeIds: z.array(z.string().min(1).max(64)).min(1, "Choose the fees you paid").max(50),
  transactionReference: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{6,35}$/, "Enter the UPI reference / UTR number (6–35 letters or digits, no spaces)"),
  paymentDate: z.coerce
    .date()
    .optional()
    .refine((d) => !d || d.getTime() <= Date.now() + 60_000, "Payment date cannot be in the future")
    .refine((d) => !d || d.getTime() >= Date.now() - 90 * 24 * 3600 * 1000, "Payment date is too old"),
  notes: z.string().trim().max(300).nullish().transform((v) => v || null),
})

const claimInclude = {
  student: { select: { id: true, code: true, user: { select: { name: true, email: true } } } },
  reviewedBy: { select: { name: true } },
  payment: { select: { id: true, code: true, receiptNumber: true } },
  items: { include: { charge: true }, orderBy: { id: "asc" } },
} as const

type ClaimRow = UpiClaim & {
  student: Pick<Student, "id" | "code"> & { user: Pick<User, "name" | "email"> }
  reviewedBy: Pick<User, "name"> | null
  payment: Pick<Payment, "id" | "code" | "receiptNumber"> | null
  items: (UpiClaimItem & { charge: FeeCharge })[]
}

export const serializeClaim = (c: ClaimRow) => ({
  id: c.id,
  code: c.code,
  status: c.status,
  student: { id: c.student.id, code: c.student.code, name: c.student.user.name },
  amount: toRupees(c.amount),
  transactionReference: c.transactionReference,
  paymentDate: c.paymentDate,
  notes: c.notes,
  items: [...c.items]
    .sort((x, y) => x.charge.dueDate.getTime() - y.charge.dueDate.getTime())
    .map((i) => ({
    chargeId: i.chargeId,
    code: i.charge.code,
    description: i.charge.description,
    billingPeriod: i.charge.billingPeriod,
    claimedAmount: toRupees(i.amount),
    /** What is still due on the fee right now (it may have been paid another way since). */
    outstandingNow: i.charge.status === "VOID" ? 0 : toRupees(outstandingOf(i.charge)),
    dueDate: i.charge.dueDate,
  })),
  reviewedBy: c.reviewedBy?.name ?? null,
  reviewedAt: c.reviewedAt,
  reviewNote: c.reviewNote,
  payment: c.payment,
  createdAt: c.createdAt,
})

export const listClaims = async (where: Prisma.UpiClaimWhereInput, take = 100) =>
  (await prisma.upiClaim.findMany({ where, include: claimInclude, orderBy: { createdAt: "desc" }, take })).map(serializeClaim)

export const pendingClaimCount = () => prisma.upiClaim.count({ where: { status: "PENDING" } })

/** Fee ids that already have a claim waiting for the teacher. */
export async function chargeIdsWithPendingClaim(chargeIds: string[] | null, db: Db = prisma) {
  const items = await db.upiClaimItem.findMany({
    where: { claim: { status: "PENDING" }, ...(chargeIds ? { chargeId: { in: chargeIds } } : {}) },
    select: { chargeId: true },
  })
  return new Set(items.map((i) => i.chargeId))
}

export async function submitClaim(actor: Actor, studentId: string, input: z.infer<typeof claimSchema>) {
  const reference = input.transactionReference
  const taken = await prisma.upiClaim.findFirst({
    where: { transactionReference: { equals: reference, mode: "insensitive" }, status: { in: ["PENDING", "APPROVED"] } },
  })
  const paid = await prisma.payment.findFirst({
    where: { transactionReference: { equals: reference, mode: "insensitive" }, status: "SUCCEEDED" },
  })
  if (taken || paid) {
    throw conflict("This reference number has already been used for a payment. Check the number and try again.")
  }

  try {
    const claim = await prisma.$transaction(async (tx) => {
      await lockStudent(tx, studentId)
      const charges = await lockCharges(tx, input.chargeIds)
      if (charges.length !== new Set(input.chargeIds).size) throw badRequest("Some of the selected fees were not found.")
      for (const c of charges) {
        if (c.studentId !== studentId) throw badRequest("Some of the selected fees are not yours.")
        if (c.status === "VOID" || outstandingOf(c) <= 0) throw badRequest(`${c.code} has nothing left to pay.`)
      }
      const pending = await chargeIdsWithPendingClaim(input.chargeIds, tx)
      if (pending.size) throw conflict("A payment for one of these fees is already waiting for the teacher to verify.")

      const items = charges.map((c) => ({ chargeId: c.id, amount: outstandingOf(c) }))
      const created = await tx.upiClaim.create({
        data: {
          code: await nextUpiClaimCode(tx),
          studentId,
          amount: items.reduce((s, i) => s + i.amount, 0),
          transactionReference: reference,
          paymentDate: input.paymentDate ?? new Date(),
          notes: input.notes,
          items: { create: items },
        },
        include: claimInclude,
      })
      await audit(
        actor,
        {
          action: "UPI_CLAIM_SUBMITTED",
          entityType: "UpiClaim",
          entityId: created.id,
          summary: `${created.student.user.name} reported a UPI payment of ₹${toRupees(created.amount).toLocaleString("en-IN")} (ref ${reference}) for ${items.length} fee(s) — awaiting verification`,
        },
        tx,
      )
      return created
    })
    return serializeClaim(claim)
  } catch (error) {
    // The unique index on live references caught a concurrent duplicate.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw conflict("This reference number has already been used for a payment. Check the number and try again.")
    }
    throw error
  }
}

// ───────────── Teacher's decision ─────────────

export const approveSchema = z.object({
  /** Fees to mark paid. Defaults to the ones the student listed. */
  chargeIds: z.array(z.string().min(1).max(64)).min(1).max(50).optional(),
  /** Amount actually received in the bank, in rupees. Defaults to the claimed total. */
  amount: z.number().positive().max(10_000_000).optional(),
  note: z.string().trim().max(300).nullish().transform((v) => v || null),
})

export async function approveClaim(actor: Actor, claimId: string, input: z.infer<typeof approveSchema>) {
  const { claim, payment } = await prisma.$transaction(async (tx: Tx) => {
    // The row lock makes a double click or two admins deciding at once safe.
    await tx.$queryRaw`SELECT id FROM "UpiClaim" WHERE id = ${claimId} FOR UPDATE`
    const claim = await tx.upiClaim.findUnique({ where: { id: claimId }, include: { items: true } })
    if (!claim) throw notFound("UPI payment")
    if (claim.status !== "PENDING") throw conflict(`This payment has already been ${claim.status.toLowerCase()}.`)

    const amount = input.amount !== undefined ? Math.round(input.amount * 100) : claim.amount
    if (Math.abs(input.amount !== undefined ? input.amount * 100 - amount : 0) > 1e-6) throw badRequest("Amounts can have at most two decimal places.")
    const chargeIds = input.chargeIds ?? claim.items.map((i) => i.chargeId)
    await lockStudent(tx, claim.studentId)
    const charges = (await lockCharges(tx, chargeIds)).sort(
      (a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.createdAt.getTime() - b.createdAt.getTime(),
    )
    if (charges.length !== new Set(chargeIds).size) throw badRequest("Some of the selected fees were not found.")
    if (charges.some((c) => c.studentId !== claim.studentId)) throw badRequest("A selected fee does not belong to this student.")

    // Pay the selected fees oldest first; anything beyond what they owe stays as advance credit.
    let remaining = amount
    const allocations: { chargeId: string; amount: number }[] = []
    for (const c of charges) {
      const due = c.status === "VOID" ? 0 : outstandingOf(c)
      const part = Math.min(remaining, due)
      if (part > 0) allocations.push({ chargeId: c.id, amount: part })
      remaining -= part
    }
    if (allocations.length === 0) {
      throw badRequest("None of the selected fees has an amount due. Select other fees, or reject this payment.")
    }

    const payment = await createManualPaymentTx(tx, actor, {
      studentId: claim.studentId,
      amount,
      method: "UPI",
      paymentDate: claim.paymentDate,
      transactionReference: claim.transactionReference,
      notes: [`Student UPI claim ${claim.code}`, input.note].filter(Boolean).join(" — "),
      allocations,
      autoAllocate: false,
      idempotencyKey: `upi-claim:${claim.id}`,
    })
    const updated = await tx.upiClaim.update({
      where: { id: claim.id },
      data: { status: "APPROVED", reviewedById: actor.id, reviewedAt: new Date(), reviewNote: input.note, paymentId: payment.id },
      include: claimInclude,
    })
    await audit(
      actor,
      {
        action: "UPI_CLAIM_APPROVED",
        entityType: "UpiClaim",
        entityId: claim.id,
        summary: `${updated.student.user.name}'s UPI payment ${claim.code} verified: ₹${toRupees(amount).toLocaleString("en-IN")} marked against ${allocations.length} fee(s) (ref ${claim.transactionReference})`,
        metadata: { claimedAmount: toRupees(claim.amount), receivedAmount: toRupees(amount), paymentId: payment.id },
      },
      tx,
    )
    return { claim: updated, payment }
  })
  await sendReceiptEmail(payment.id)
  return serializeClaim(claim)
}

export const rejectSchema = z.object({ reason: z.string().trim().min(3, "Give a short reason").max(300) })

export async function rejectClaim(actor: Actor, claimId: string, reason: string) {
  const claim = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "UpiClaim" WHERE id = ${claimId} FOR UPDATE`
    const existing = await tx.upiClaim.findUnique({ where: { id: claimId } })
    if (!existing) throw notFound("UPI payment")
    if (existing.status !== "PENDING") throw conflict(`This payment has already been ${existing.status.toLowerCase()}.`)
    const updated = await tx.upiClaim.update({
      where: { id: claimId },
      data: { status: "REJECTED", reviewedById: actor.id, reviewedAt: new Date(), reviewNote: reason },
      include: claimInclude,
    })
    await audit(
      actor,
      {
        action: "UPI_CLAIM_REJECTED",
        entityType: "UpiClaim",
        entityId: claimId,
        summary: `${updated.student.user.name}'s UPI payment ${updated.code} (ref ${updated.transactionReference}) was not verified: ${reason}`,
      },
      tx,
    )
    return updated
  })
  await sendMail({
    to: claim.student.user.email,
    subject: "We could not verify your UPI payment",
    text: `Hello ${claim.student.user.name},\n\nYour payment report ${claim.code} (reference ${claim.transactionReference}, ₹${toRupees(claim.amount).toLocaleString("en-IN")}) could not be verified.\n\nReason: ${reason}\n\nYour fees are still due. If you did pay, check the reference number and submit it again from your dashboard, or contact the academy.`,
  })
  return serializeClaim(claim)
}
