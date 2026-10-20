/** Normalised view of a payment as reported by a gateway. Amounts are in paise. */
export type GatewayPayment = {
  id: string
  orderId: string | null
  amount: number
  currency: string
  status: "created" | "authorized" | "captured" | "failed" | "refunded"
  method: string | null
  errorDescription: string | null
}

export type GatewayOrder = { orderId: string; amount: number; currency: string }

export type WebhookEventData = {
  eventId: string | null
  eventType: string
  payment: GatewayPayment | null
  orderId: string | null
}

/**
 * Everything the app needs from a payment gateway. Adding another gateway (Stripe, PayU, Cashfree…)
 * means implementing this interface; the order/verify/webhook flows stay unchanged.
 */
export interface PaymentProvider {
  readonly name: string
  /** Public key the browser checkout needs (never the secret). */
  readonly publicKey: string | null
  createOrder(input: {
    amount: number
    currency: string
    receipt: string
    notes?: Record<string, string>
  }): Promise<GatewayOrder>
  /** Verify the signature the checkout returned to the browser. */
  verifyCheckoutSignature(input: { orderId: string; paymentId: string; signature: string }): boolean
  /** Ask the gateway for the authoritative state of a payment. */
  fetchPayment(paymentId: string): Promise<GatewayPayment>
  /** All payment attempts for an order (used for reconciliation). */
  fetchOrderPayments(orderId: string): Promise<GatewayPayment[]>
  /** Capture an authorised payment (for gateways configured for manual capture). */
  capturePayment(paymentId: string, amount: number, currency: string): Promise<GatewayPayment>
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): WebhookEventData
}
