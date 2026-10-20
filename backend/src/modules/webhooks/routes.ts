import express, { Router } from "express"
import { badRequest } from "../../lib/errors"
import { processWebhook } from "../payments/online"

/**
 * Gateway → server notifications. Mounted BEFORE the JSON body parser: the signature is an
 * HMAC of the exact raw bytes, so the body must not be re-serialised.
 */
export const webhooksRouter = Router()

webhooksRouter.post("/:provider", express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw badRequest("Empty webhook body.")
  const result = await processWebhook(String(req.params.provider), req.body, req.headers)
  res.json({ received: true, ...result })
})
