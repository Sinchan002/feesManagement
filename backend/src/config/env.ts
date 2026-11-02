import "dotenv/config"
import { z } from "zod"

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1")

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z.string().default("http://localhost:8443,http://localhost:5173"),
  APP_URL: z.string().url().default("http://localhost:8443"),
  TRUST_PROXY: bool.default(false),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  SESSION_REMEMBER_TTL_DAYS: z.coerce.number().positive().default(30),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().positive().default(30),

  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: bool.default(false),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASSWORD: z.string().optional().default(""),
  MAIL_FROM: z.string().default("SriKrishna Physics Academy <fees@srikrishnaphysics.in>"),

  PAYMENT_PROVIDER: z.enum(["razorpay", "mock", "none"]).default("mock"),
  PAYMENT_CURRENCY: z.string().length(3).default("INR"),
  RAZORPAY_KEY_ID: z.string().optional().default(""),
  RAZORPAY_KEY_SECRET: z.string().optional().default(""),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(""),
  MOCK_PAYMENT_SECRET: z.string().default("mock-dev-secret"),

  SCHEDULER_ENABLED: bool.default(true),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error("Invalid environment configuration:")
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`)
  process.exit(1)
}

export const env = parsed.data
export const isProduction = env.NODE_ENV === "production"
export const isTest = env.NODE_ENV === "test"

if (env.PAYMENT_PROVIDER === "mock" && isProduction) {
  console.error("PAYMENT_PROVIDER=mock is not allowed in production.")
  process.exit(1)
}
if (env.PAYMENT_PROVIDER === "razorpay") {
  for (const key of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"] as const) {
    if (!env[key]) {
      console.error(`${key} is required when PAYMENT_PROVIDER=razorpay.`)
      process.exit(1)
    }
  }
}
