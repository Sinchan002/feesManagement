import { vi } from "vitest"

/**
 * Billing depends on the day of the month (a student placed before the 15th is billed at once).
 * Pin the clock to the 20th of the current month so the suite behaves the same on any real date.
 * Only `Date` is faked; the clock keeps ticking, and individual tests may move it with
 * vi.setSystemTime().
 */
const real = new Date()
export const PINNED_NOW = new Date(Date.UTC(real.getUTCFullYear(), real.getUTCMonth(), 20, 6, 0, 0))

const pin = () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true })
  vi.setSystemTime(PINNED_NOW)
}
pin()

/**
 * Run with the real clock. Needed where app code compares JS time with timestamps Prisma fills in
 * itself (e.g. `createdAt` defaults), which always use the real clock.
 */
export async function withRealClock<T>(fn: () => Promise<T>) {
  vi.useRealTimers()
  try {
    return await fn()
  } finally {
    pin()
  }
}
