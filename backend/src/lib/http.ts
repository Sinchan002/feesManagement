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

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{10,20}$/, "Enter a valid phone number")

export const csvEscape = (value: unknown) => {
  const s = value === null || value === undefined ? "" : String(value)
  // Neutralise spreadsheet formula injection, then quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export const toCsv = (header: string[], rows: unknown[][]) =>
  [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n"
