/** Billing periods are "YYYY-MM" strings, interpreted in UTC. */

export const periodStart = (period: string) => {
  const [y, m] = period.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, 1))
}
/** Exclusive end of a period. */
export const periodEnd = (period: string) => {
  const [y, m] = period.split("-").map(Number)
  return new Date(Date.UTC(y, m, 1))
}
export const periodOf = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
export const currentPeriod = () => periodOf(new Date())
export const addMonths = (period: string, delta: number) => {
  const d = periodStart(period)
  d.setUTCMonth(d.getUTCMonth() + delta)
  return periodOf(d)
}
export const periodLabel = (period: string) =>
  periodStart(period).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })
/** The academy runs on Indian time (IST, UTC+5:30); fees fall due at the end of that day there. */
const ACADEMY_UTC_OFFSET_MINUTES = 330
const OFFSET_MS = ACADEMY_UTC_OFFSET_MINUTES * 60 * 1000

export const dueDateFor = (period: string, dueDay: number) => {
  const [y, m] = period.split("-").map(Number)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const endOfDayUtc = Date.UTC(y, m - 1, Math.min(dueDay, lastDay), 23, 59, 59)
  return new Date(endOfDayUtc - OFFSET_MS)
}

/** Today's calendar date at the academy (India time), e.g. { day: 10, period: "2026-10" }. */
export const academyToday = (now = new Date()) => {
  const local = new Date(now.getTime() + OFFSET_MS)
  const year = local.getUTCFullYear()
  const month = local.getUTCMonth() + 1
  return { year, month, day: local.getUTCDate(), period: `${year}-${String(month).padStart(2, "0")}` }
}

/** 11:59:59 PM India time, `addDays` days after the academy's current date. */
export const academyEndOfDay = (now = new Date(), addDays = 0) => {
  const t = academyToday(now)
  return new Date(Date.UTC(t.year, t.month - 1, t.day + addDays, 23, 59, 59) - OFFSET_MS)
}
