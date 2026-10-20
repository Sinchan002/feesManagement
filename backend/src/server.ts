import { env } from "./config/env"
import { createApp } from "./app"
import { prisma } from "./lib/prisma"
import { startScheduler } from "./jobs/scheduler"

async function main() {
  await prisma.$connect()
  const app = createApp()
  const server = app.listen(env.PORT, () => {
    console.info(`API listening on http://localhost:${env.PORT}/api (payments: ${env.PAYMENT_PROVIDER})`)
  })
  const timer = env.SCHEDULER_ENABLED ? startScheduler() : null

  const shutdown = (signal: string) => {
    console.info(`${signal} received, shutting down…`)
    if (timer) clearInterval(timer)
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0))
    })
    setTimeout(() => process.exit(1), 10_000).unref()
  }
  process.on("SIGINT", () => shutdown("SIGINT"))
  process.on("SIGTERM", () => shutdown("SIGTERM"))
}

main().catch((error) => {
  console.error("Failed to start:", error)
  process.exit(1)
})
