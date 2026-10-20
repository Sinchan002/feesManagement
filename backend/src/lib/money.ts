import { z } from "zod"

/** Rupees (API) → paise (DB). */
export const toPaise = (rupees: number) => Math.round(rupees * 100)
/** Paise (DB) → rupees (API). */
export const toRupees = (paise: number) => paise / 100

const hasAtMostTwoDecimals = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6

/** Zod schema for a rupee amount coming from the client. Output is paise. */
export const rupees = (opts: { allowZero?: boolean; allowNegative?: boolean } = {}) =>
  z
    .number({ error: "Enter an amount" })
    .finite()
    .refine(hasAtMostTwoDecimals, "Amounts can have at most two decimal places")
    .refine(
      (n) => opts.allowNegative || (opts.allowZero ? n >= 0 : n > 0),
      "Enter a valid amount",
    )
    .refine((n) => Math.abs(n) <= 10_000_000, "Amount is too large")
    .transform(toPaise)

export const outstandingOf = (c: { amount: number; adjustmentTotal: number; paidAmount: number }) =>
  Math.max(0, c.amount + c.adjustmentTotal - c.paidAmount)
