/** Client-side mirrors of the server's rules (the server checks again). */

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const
export type Weekday = (typeof WEEKDAYS)[number]

const DAY_ALIASES: Record<string, Weekday> = {
  mon: "Mon", monday: "Mon", tue: "Tue", tues: "Tue", tuesday: "Tue", wed: "Wed", wednesday: "Wed",
  thu: "Thu", thur: "Thu", thurs: "Thu", thursday: "Thu", fri: "Fri", friday: "Fri",
  sat: "Sat", saturday: "Sat", sun: "Sun", sunday: "Sun",
}

/** Days we can recognise in a saved schedule (unrecognised words are ignored). */
export function knownDays(schedule: string): Weekday[] {
  const found = new Set(
    schedule
      .split(/[\s,;/&]+/)
      .map((t) => DAY_ALIASES[t.trim().toLowerCase().replace(/\.$/, "")])
      .filter(Boolean),
  )
  return WEEKDAYS.filter((d) => found.has(d))
}

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
export const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** "17:00", "5pm", "5:30 PM" → "HH:MM"; "" when it can't be read (e.g. "25:99"). */
export function toTimeInput(value: string | null | undefined): string {
  const v = (value ?? "").trim().toLowerCase().replace(/\s+/g, "")
  if (TIME_RE.test(v)) return v
  const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/.exec(v)
  if (!m) return ""
  let h = Number(m[1])
  const min = Number(m[2] ?? 0)
  if (h < 1 || h > 12 || min > 59) return ""
  if (m[3] === "pm" && h !== 12) h += 12
  if (m[3] === "am" && h === 12) h = 0
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`
}

/** Indian numbers: 10 digits, optionally with +91 / 91 / 0; spaces, dashes and brackets allowed. */
const clean = (v: string) => v.replace(/[\s()-]/g, "")
export const isMobile = (v: string) => /^(?:\+91|91|0)?[6-9]\d{9}$/.test(clean(v))
export const isPhone = (v: string) => /^(?:\+91|91|0)?\d{10}$/.test(clean(v))
export const MOBILE_MESSAGE = "Enter a valid 10-digit mobile number (optionally with +91)"
export const PHONE_MESSAGE = "Enter a valid 10-digit phone number, with STD code for landlines"
