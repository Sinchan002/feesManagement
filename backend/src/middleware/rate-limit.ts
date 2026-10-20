import rateLimit from "express-rate-limit"
import { isTest } from "../config/env"

const message = { message: "Too many attempts. Please wait a few minutes and try again.", code: "RATE_LIMITED" }

const limiter = (windowMinutes: number, limit: number, opts: { onlyFailures?: boolean } = {}) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message,
    // Students often share one IP (academy Wi-Fi); only failed attempts should count.
    skipSuccessfulRequests: opts.onlyFailures ?? false,
    skip: () => isTest,
  })

export const loginLimiter = limiter(15, 10, { onlyFailures: true })
export const registrationLimiter = limiter(60, 10)
export const passwordResetLimiter = limiter(15, 5)
export const paymentLimiter = limiter(10, 30)
