import { z } from "zod"

/** Batch schedules: days are stored as "Mon, Wed, Fri"; times as 24-hour "HH:MM". */
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const
export type Weekday = (typeof WEEKDAYS)[number]

const DAY_ALIASES: Record<string, Weekday> = {
  mon: "Mon", monday: "Mon",
  tue: "Tue", tues: "Tue", tuesday: "Tue",
  wed: "Wed", wednesday: "Wed",
  thu: "Thu", thur: "Thu", thurs: "Thu", thursday: "Thu",
  fri: "Fri", friday: "Fri",
  sat: "Sat", saturday: "Sat",
  sun: "Sun", sunday: "Sun",
}

/** "mon fri" / "Monday, Friday" / ["Mon","Fri"] → ["Mon","Fri"] in week order; null if any token is not a day. */
export function parseDays(input: string | string[]): Weekday[] | null {
  const tokens = (Array.isArray(input) ? input : input.split(/[\s,;/&]+/))
    .map((t) => t.trim().toLowerCase().replace(/\.$/, ""))
    .filter(Boolean)
  const days = new Set<Weekday>()
  for (const t of tokens) {
    const day = DAY_ALIASES[t]
    if (!day) return null
    days.add(day)
  }
  return WEEKDAYS.filter((d) => days.has(d))
}

export const formatDays = (days: readonly Weekday[]) => days.join(", ")

/** Accepts "Mon, Wed, Fri" or an array of days; outputs the normalised string. */
export const scheduleSchema = z
  .union([z.string().trim().max(120), z.array(z.string().max(20)).max(7)])
  .transform((v, ctx) => {
    const days = parseDays(v)
    if (!days) {
      ctx.addIssue({ code: "custom", message: "Choose teaching days from Mon–Sun" })
      return z.NEVER
    }
    if (days.length === 0) {
      ctx.addIssue({ code: "custom", message: "Choose at least one teaching day" })
      return z.NEVER
    }
    return formatDays(days)
  })

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
export const timeSchema = z.string().trim().regex(TIME_RE, "Use a valid time (HH:MM, 24-hour)")
export const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** "17:00" → "5:00 PM". Values saved before validation existed are shown as typed. */
export function formatTime(value: string) {
  if (!TIME_RE.test(value)) return value
  const [h, m] = value.split(":").map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`
}

export const batchTimeLabel = (start: string, end: string | null) =>
  end ? `${formatTime(start)} – ${formatTime(end)}` : formatTime(start)

/** Best-effort conversion of legacy free-text times ("5pm", "5:30 PM", "17:00") to "HH:MM". */
export function parseLegacyTime(value: string): string | null {
  const v = value.trim().toLowerCase().replace(/\s+/g, "")
  if (TIME_RE.test(v)) return v
  const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/.exec(v)
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2] ?? 0)
  if (h < 1 || h > 12 || min > 59) return null
  if (m[3] === "pm" && h !== 12) h += 12
  if (m[3] === "am" && h === 12) h = 0
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`
}
