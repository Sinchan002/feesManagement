import { hmacSha256Hex, randomToken, safeEqual } from "../../../lib/crypto"
import { notFound } from "../../../lib/errors"
import { parseRazorpayWebhook } from "./razorpay"
import type { GatewayPayment, PaymentProvider } from "./types"

/**
 * Development/test stand-in for a real gateway. It behaves like Razorpay (same signature scheme
 * and webhook format) but keeps its "gateway" state in memory. It is refused in production.
 */
export class MockProvider implements PaymentProvider {
  readonly name = "mock"
  readonly publicKey = "mock_key"
  private orders = new Map<string, { amount: number; currency: string }>()
  private payments = new Map<string, GatewayPayment>()

  constructor(private readonly secret: string) {}

  async createOrder(input: { amount: number; currency: string }) {
    const orderId = `order_mock_${randomToken(9)}`
    this.orders.set(orderId, { amount: input.amount, currency: input.currency })
    return { orderId, amount: input.amount, currency: input.currency }
  }

  /** Simulates the customer completing checkout. Returns what the gateway hands the browser. */
  simulateCheckout(orderId: string, outcome: "success" | "failure", method = "upi") {
    const order = this.orders.get(orderId)
    if (!order) throw notFound("Mock order")
    const payment: GatewayPayment = {
      id: `pay_mock_${randomToken(9)}`,
      orderId,
      amount: order.amount,
      currency: order.currency,
      status: outcome === "success" ? "captured" : "failed",
      method,
      errorDescription: outcome === "success" ? null : "Payment declined by the bank (simulated)",
    }
    this.payments.set(payment.id, payment)
    return {
      payment,
      razorpay_order_id: orderId,
      razorpay_payment_id: payment.id,
      razorpay_signature: hmacSha256Hex(this.secret, `${orderId}|${payment.id}`),
    }
  }

  /** Test helper: forget a payment's capture (e.g. to simulate a forged success). */
  setPaymentStatus(paymentId: string, status: GatewayPayment["status"]) {
    const p = this.payments.get(paymentId)
    if (p) p.status = status
  }

  signWebhook(rawBody: string | Buffer) {
    return hmacSha256Hex(this.secret, rawBody)
  }

  verifyCheckoutSignature({ orderId, paymentId, signature }: { orderId: string; paymentId: string; signature: string }) {
    return safeEqual(hmacSha256Hex(this.secret, `${orderId}|${paymentId}`), signature)
  }

  async fetchPayment(paymentId: string) {
    const p = this.payments.get(paymentId)
    if (!p) throw notFound("Gateway payment")
    return { ...p }
  }

  async fetchOrderPayments(orderId: string) {
    return [...this.payments.values()].filter((p) => p.orderId === orderId)
  }

  async capturePayment(paymentId: string) {
    const p = this.payments.get(paymentId)
    if (!p) throw notFound("Gateway payment")
    p.status = "captured"
    return { ...p }
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined) {
    return Boolean(signature) && safeEqual(hmacSha256Hex(this.secret, rawBody), signature!)
  }

  parseWebhook = parseRazorpayWebhook
}
