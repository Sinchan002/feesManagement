import { hmacSha256Hex, safeEqual } from "../../../lib/crypto"
import { ApiError } from "../../../lib/errors"
import type { GatewayOrder, GatewayPayment, PaymentProvider, WebhookEventData } from "./types"

type RazorpayPaymentEntity = {
  id: string
  order_id?: string | null
  amount: number
  currency: string
  status: GatewayPayment["status"]
  method?: string | null
  error_description?: string | null
}

export const normaliseRazorpayPayment = (p: RazorpayPaymentEntity): GatewayPayment => ({
  id: p.id,
  orderId: p.order_id ?? null,
  amount: p.amount,
  currency: p.currency,
  status: p.status,
  method: p.method ?? null,
  errorDescription: p.error_description ?? null,
})

/** Razorpay webhook body → normalised event. Shared with the mock provider. */
export function parseRazorpayWebhook(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
): WebhookEventData {
  const body = JSON.parse(rawBody.toString("utf8")) as {
    event?: string
    payload?: { payment?: { entity?: RazorpayPaymentEntity }; order?: { entity?: { id?: string } } }
  }
  const header = headers["x-razorpay-event-id"]
  const entity = body.payload?.payment?.entity
  return {
    eventId: (Array.isArray(header) ? header[0] : header) ?? null,
    eventType: body.event ?? "unknown",
    payment: entity ? normaliseRazorpayPayment(entity) : null,
    orderId: body.payload?.order?.entity?.id ?? entity?.order_id ?? null,
  }
}

export class RazorpayProvider implements PaymentProvider {
  readonly name = "razorpay"
  private readonly baseUrl = "https://api.razorpay.com/v1"

  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly webhookSecret: string,
  ) {}

  get publicKey() {
    return this.keyId
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    })
    const json = (await response.json().catch(() => ({}))) as { error?: { description?: string } }
    if (!response.ok) {
      console.error(`[razorpay] ${method} ${path} → ${response.status}`, json.error?.description)
      throw new ApiError(502, "The payment gateway is unavailable. Please try again shortly.", "GATEWAY_ERROR")
    }
    return json as T
  }

  async createOrder(input: { amount: number; currency: string; receipt: string; notes?: Record<string, string> }) {
    const order = await this.request<{ id: string; amount: number; currency: string }>("POST", "/orders", {
      amount: input.amount,
      currency: input.currency,
      receipt: input.receipt.slice(0, 40),
      notes: input.notes,
    })
    return { orderId: order.id, amount: order.amount, currency: order.currency } satisfies GatewayOrder
  }

  verifyCheckoutSignature({ orderId, paymentId, signature }: { orderId: string; paymentId: string; signature: string }) {
    const expected = hmacSha256Hex(this.keySecret, `${orderId}|${paymentId}`)
    return safeEqual(expected, signature)
  }

  async fetchPayment(paymentId: string) {
    return normaliseRazorpayPayment(
      await this.request<RazorpayPaymentEntity>("GET", `/payments/${encodeURIComponent(paymentId)}`),
    )
  }

  async fetchOrderPayments(orderId: string) {
    const res = await this.request<{ items: RazorpayPaymentEntity[] }>(
      "GET",
      `/orders/${encodeURIComponent(orderId)}/payments`,
    )
    return res.items.map(normaliseRazorpayPayment)
  }

  async capturePayment(paymentId: string, amount: number, currency: string) {
    return normaliseRazorpayPayment(
      await this.request<RazorpayPaymentEntity>("POST", `/payments/${encodeURIComponent(paymentId)}/capture`, {
        amount,
        currency,
      }),
    )
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined) {
    if (!signature) return false
    return safeEqual(hmacSha256Hex(this.webhookSecret, rawBody), signature)
  }

  parseWebhook = parseRazorpayWebhook
}
