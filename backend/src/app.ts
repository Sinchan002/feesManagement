import express from "express"
import cors from "cors"
import helmet from "helmet"
import { env } from "./config/env"
import { errorHandler, notFoundHandler } from "./middleware/error-handler"
import { authRouter } from "./modules/auth/routes"
import { batchesRouter, publicBatchesRouter } from "./modules/batches/routes"
import { registrationsRouter } from "./modules/registrations/routes"
import { studentsRouter } from "./modules/students/routes"
import { feesRouter } from "./modules/fees/routes"
import { paymentsRouter } from "./modules/payments/routes"
import { webhooksRouter } from "./modules/webhooks/routes"
import { reportsRouter } from "./modules/reports/routes"
import { auditRouter } from "./modules/audit/routes"
import { settingsRouter } from "./modules/settings/routes"
import { meRouter } from "./modules/me/routes"
import { upiRouter } from "./modules/upi/routes"

export function createApp() {
  const app = express()
  app.disable("x-powered-by")
  app.set("trust proxy", env.TRUST_PROXY ? 1 : false)

  app.use(helmet())
  const origins = env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || origins.includes(origin)),
      allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
      maxAge: 600,
    }),
  )

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() })
  })

  // Webhooks need the raw body for signature checks — mount before express.json().
  app.use("/api/webhooks", webhooksRouter)

  app.use(express.json({ limit: "100kb" }))
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store")
    next()
  })

  app.use("/api/auth", authRouter)
  app.use("/api/public/batches", publicBatchesRouter)
  app.use("/api/me", meRouter)
  app.use("/api/registrations", registrationsRouter)
  app.use("/api/batches", batchesRouter)
  app.use("/api/students", studentsRouter)
  app.use("/api/fees", feesRouter)
  app.use("/api/payments", paymentsRouter)
  app.use("/api/upi", upiRouter)
  app.use("/api/reports", reportsRouter)
  app.use("/api/audit-logs", auditRouter)
  app.use("/api/settings", settingsRouter)

  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}
