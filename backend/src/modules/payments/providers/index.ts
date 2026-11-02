import { notFound } from "../../../lib/errors"
import { env } from "../../../config/env"
import { MockProvider } from "./mock"
import { RazorpayProvider } from "./razorpay"
import type { PaymentProvider } from "./types"

let provider: PaymentProvider | null = null

export function getPaymentProvider(): PaymentProvider {
  if (env.PAYMENT_PROVIDER === "none") throw notFound("Online payments")
  if (!provider) {
    provider =
      env.PAYMENT_PROVIDER === "razorpay"
        ? new RazorpayProvider(env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET, env.RAZORPAY_WEBHOOK_SECRET)
        : new MockProvider(env.MOCK_PAYMENT_SECRET)
  }
  return provider
}

export type { PaymentProvider, GatewayPayment } from "./types"
