import express, { Router } from "express"
import { z } from "zod"
import { badRequest } from "../../lib/errors"
import { actorFrom, audit } from "../../lib/audit"
import { idParam, parse } from "../../lib/http"
import { authenticate, ownStudentId, requireAdmin, requireStudent } from "../../middleware/auth"
import { paymentLimiter } from "../../middleware/rate-limit"
import {
  approveClaim,
  approveSchema,
  claimSchema,
  getUpiConfig,
  listClaims,
  pendingClaimCount,
  rejectClaim,
  rejectSchema,
  removeQr,
  saveQr,
  saveUpiDetails,
  submitClaim,
  upiConfigSchema,
} from "./service"

export const upiRouter = Router()
upiRouter.use(authenticate)

// ───────────── Payment details (teacher edits, everyone signed in reads) ─────────────

/** What a student needs to pay: UPI ID, payee name and QR image. */
upiRouter.get("/config", async (_req, res) => {
  res.json({ data: await getUpiConfig() })
})

upiRouter.put("/config", requireAdmin, async (req, res) => {
  const input = parse(upiConfigSchema, req.body)
  await saveUpiDetails(input)
  await audit(actorFrom(req), {
    action: "UPI_DETAILS_UPDATED",
    entityType: "Setting",
    entityId: "upi",
    summary: `UPI payment details saved (${input.upiId})`,
  })
  res.json({ data: await getUpiConfig() })
})

/** The QR image arrives as raw bytes (Content-Type: image/png | image/jpeg | image/webp), max 1 MB. */
upiRouter.put(
  "/qr",
  requireAdmin,
  express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: "1mb" }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw badRequest("Upload a PNG, JPG or WebP image (up to 1 MB).")
    }
    await saveQr(req.body)
    await audit(actorFrom(req), { action: "UPI_QR_UPDATED", entityType: "Setting", entityId: "upi", summary: "UPI QR code image uploaded" })
    res.json({ data: await getUpiConfig() })
  },
)

upiRouter.delete("/qr", requireAdmin, async (req, res) => {
  await removeQr()
  await audit(actorFrom(req), { action: "UPI_QR_REMOVED", entityType: "Setting", entityId: "upi", summary: "UPI QR code image removed" })
  res.json({ data: await getUpiConfig() })
})

// ───────────── Student: report a payment ─────────────

upiRouter.post("/claims", requireStudent, paymentLimiter, async (req, res) => {
  const input = parse(claimSchema, req.body)
  const config = await getUpiConfig()
  if (!config.configured) throw badRequest("UPI payment is not set up yet. Please pay at the academy.")
  res.status(201).json({ data: await submitClaim(actorFrom(req), ownStudentId(req), input) })
})

upiRouter.get("/claims/mine", requireStudent, async (req, res) => {
  res.json({ data: await listClaims({ studentId: ownStudentId(req) }, 30) })
})

// ───────────── Teacher: verify ─────────────

const listSchema = z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED", "ALL"]).default("PENDING") })

upiRouter.get("/claims", requireAdmin, async (req, res) => {
  const { status } = parse(listSchema, req.query)
  res.json({
    data: await listClaims(status === "ALL" ? {} : { status }),
    meta: { pendingCount: await pendingClaimCount() },
  })
})

upiRouter.post("/claims/:id/approve", requireAdmin, async (req, res) => {
  res.json({ data: await approveClaim(actorFrom(req), idParam(req), parse(approveSchema, req.body)) })
})

upiRouter.post("/claims/:id/reject", requireAdmin, async (req, res) => {
  const { reason } = parse(rejectSchema, req.body)
  res.json({ data: await rejectClaim(actorFrom(req), idParam(req), reason) })
})
