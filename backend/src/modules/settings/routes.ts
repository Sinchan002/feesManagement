import { Router } from "express"
import { z } from "zod"
import { authenticate, requireAdmin } from "../../middleware/auth"
import { parse } from "../../lib/http"
import { actorFrom, audit } from "../../lib/audit"
import { mailerConfigured } from "../../lib/mailer"
import { env } from "../../config/env"
import { getSettings, getState, saveSettings, settingsSchema } from "./service"

const { shape } = settingsSchema
const settingsPatchSchema = z.object({
  academy: shape.academy.partial().optional(),
  billing: shape.billing.partial().optional(),
  reminders: shape.reminders.partial().optional(),
  notifications: shape.notifications.partial().optional(),
  paymentMethods: shape.paymentMethods.partial().optional(),
})

export const settingsRouter = Router()

settingsRouter.use(authenticate, requireAdmin)

settingsRouter.get("/", async (_req, res) => {
  res.json({ data: await getSettings() })
})

/** Partial update — any top-level section may be omitted. */
settingsRouter.patch("/", async (req, res) => {
  const current = await getSettings()
  const body = parse(settingsPatchSchema, req.body) as Record<string, object | undefined>
  const next: Record<string, unknown> = { ...current }
  for (const [key, value] of Object.entries(body)) {
    if (value) next[key] = { ...(current as Record<string, object>)[key], ...value }
  }
  const saved = await saveSettings(parse(settingsSchema, next))
  await audit(actorFrom(req), {
    action: "SETTINGS_UPDATED",
    entityType: "Setting",
    entityId: "app",
    summary: `Settings updated (${Object.keys(body).join(", ") || "no changes"})`,
    metadata: body,
  })
  res.json({ data: saved })
})

/** Integration status for the "Automation health" card. */
settingsRouter.get("/health", async (_req, res) => {
  res.json({
    data: {
      emailProvider: mailerConfigured() ? "CONNECTED" : "CONSOLE_ONLY",
      paymentGateway: env.PAYMENT_PROVIDER,
      paymentGatewayLive: env.PAYMENT_PROVIDER === "razorpay",
      schedulerEnabled: env.SCHEDULER_ENABLED && !process.env.VERCEL,
      lastChargeGeneration: await getState("lastChargeGeneration"),
      lastReminderRun: await getState("lastReminderRun"),
    },
  })
})
