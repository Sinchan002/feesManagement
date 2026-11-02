import { z } from "zod"
import { landlineOrMobileSchema } from "../../lib/http"
import { prisma, type Db } from "../../lib/prisma"

export const settingsSchema = z.object({
  academy: z.object({
    name: z.string().trim().min(2).max(120),
    teacherName: z.string().trim().min(2).max(120),
    address: z.string().trim().max(300).default(""),
    phone: z.union([landlineOrMobileSchema, z.literal("")]).default(""),
  }),
  billing: z.object({
    /** Day of month monthly fees are due. */
    dueDay: z.number().int().min(1).max(28),
    /** Generate the month's charges automatically on the 1st. */
    autoGenerateCharges: z.boolean(),
  }),
  reminders: z.object({
    enabled: z.boolean(),
    /** Day of month the advance-fee reminder email is sent. */
    dayOfMonth: z.number().int().min(1).max(28),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h)"),
    replyTo: z.union([z.email(), z.literal("")]),
    gracePeriodDays: z.number().int().min(0).max(60),
    notifyParents: z.boolean(),
  }),
  notifications: z.object({
    sendPaymentReceipts: z.boolean(),
  }),
  paymentMethods: z.object({
    upi: z.boolean(),
    card: z.boolean(),
    netBanking: z.boolean(),
    cash: z.boolean(),
  }),
})

export type Settings = z.infer<typeof settingsSchema>

export const DEFAULT_SETTINGS: Settings = {
  academy: {
    name: "SriKrishna Physics Academy",
    teacherName: "SriKrishna Mondal",
    address: "",
    phone: "",
  },
  billing: { dueDay: 5, autoGenerateCharges: true },
  reminders: {
    enabled: true,
    dayOfMonth: 25,
    time: "09:00",
    replyTo: "fees@srikrishnaphysics.in",
    gracePeriodDays: 7,
    notifyParents: true,
  },
  notifications: { sendPaymentReceipts: true },
  paymentMethods: { upi: true, card: true, netBanking: false, cash: true },
}

const KEY = "app"

/** Deep-merge stored settings over defaults so new keys get sensible values. */
function merge(stored: unknown): Settings {
  const s = (stored ?? {}) as Partial<Record<keyof Settings, object>>
  const out = {} as Record<string, unknown>
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    out[key] = { ...DEFAULT_SETTINGS[key], ...(s[key] ?? {}) }
  }
  const parsed = settingsSchema.safeParse(out)
  return parsed.success ? parsed.data : DEFAULT_SETTINGS
}

export async function getSettings(db: Db = prisma): Promise<Settings> {
  const row = await db.setting.findUnique({ where: { key: KEY } })
  return merge(row?.value)
}

export async function saveSettings(value: Settings, db: Db = prisma) {
  await db.setting.upsert({
    where: { key: KEY },
    create: { key: KEY, value },
    update: { value },
  })
  return value
}

/** Small key/value store for scheduler bookkeeping. */
export async function getState<T>(key: string, db: Db = prisma): Promise<T | null> {
  const row = await db.setting.findUnique({ where: { key: `state:${key}` } })
  return (row?.value as T) ?? null
}
export async function setState(key: string, value: object | string | number, db: Db = prisma) {
  await db.setting.upsert({
    where: { key: `state:${key}` },
    create: { key: `state:${key}`, value },
    update: { value },
  })
}
