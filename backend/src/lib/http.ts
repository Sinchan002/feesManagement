import type { Request } from "express"
import { z } from "zod"
import { badRequest } from "./errors"

/** Parse untrusted input with a zod schema, throwing a 400 with field errors on failure. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data ?? {})
  if (!result.success) {
    const fields = result.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }))
    throw badRequest(fields[0]?.message ?? "Invalid request", { fields })
  }
  return result.data
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
})

export const paginate = ({ page, pageSize }: { page: number; pageSize: number }) => ({
  skip: (page - 1) * pageSize,
  take: pageSize,
})

export const pageMeta = (total: number, { page, pageSize }: { page: number; pageSize: number }) => ({
  total,
  page,
  pageSize,
  totalPages: Math.max(1, Math.ceil(total / pageSize)),
})

export const idParam = (req: Request, name = "id") => {
  const value = req.params[name]
  if (typeof value !== "string" || !value || value.length > 64) throw badRequest("Invalid id")
  return value
}

/** Billing period "YYYY-MM". */
export const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use the YYYY-MM format")

/** Optional free text: trims, and turns "" into null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null))

/**
 * Indian phone numbers: 10 digits, optionally prefixed with +91 / 91 / 0. Spaces, dashes and
 * brackets are allowed for readability ("+91 98765 43210"). Mobiles start with 6–9.
 */
const PHONE_SEPARATORS = /[\s()-]/g
const MOBILE_RE = /^(?:\+91|91|0)?[6-9]\d{9}$/
const ANY_PHONE_RE = /^(?:\+91|91|0)?\d{10}$/ // also allows landlines with STD code
export const isMobile = (v: string) => MOBILE_RE.test(v.replace(PHONE_SEPARATORS, ""))
export const isPhone = (v: string) => ANY_PHONE_RE.test(v.replace(PHONE_SEPARATORS, ""))

/** Student / parent mobile number. */
export const phoneSchema = z
  .string()
  .trim()
  .max(20, "Enter a valid 10-digit mobile number")
  .refine(isMobile, "Enter a valid 10-digit mobile number (optionally with +91)")

/** Academy phone: mobile or landline (with STD code). */
export const landlineOrMobileSchema = z
  .string()
  .trim()
  .max(20, "Enter a valid phone number")
  .refine(isPhone, "Enter a valid 10-digit phone number, with STD code for landlines (e.g. 03242 255123)")

export const csvEscape = (value: unknown) => {
  const s = value === null || value === undefined ? "" : String(value)
  // Neutralise spreadsheet formula injection, then quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export const toCsv = (header: string[], rows: unknown[][]) =>
  [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n"
