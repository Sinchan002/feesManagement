import { prisma } from "../lib/prisma"
import { SYSTEM_ACTOR } from "../lib/audit"
import { currentPeriod } from "../lib/dates"
import { generateMonthlyCharges } from "../modules/fees/service"
import { sendFeeReminders } from "../modules/fees/reminders"
import { getSettings, getState, setState } from "../modules/settings/service"

const TICK_MS = 15 * 60 * 1000
const LOCK_KEY = 7_342_001 // arbitrary app-wide advisory lock id

/**
 * Atomically claim a once-per-period job. Uses a transaction-scoped advisory lock so that with
 * several server instances only one runs it.
 */
async function claim(job: string, period: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY})`
    const last = await getState<string>(job, tx)
    if (last === period) return false
    await setState(job, period, tx)
    return true
  })
}

export async function runScheduledJobs(now = new Date()) {
  const settings = await getSettings()
  const period = currentPeriod()

  if (settings.billing.autoGenerateCharges && (await getState<string>("lastChargeGeneration")) !== period) {
    if (await claim("lastChargeGeneration", period)) {
      const result = await generateMonthlyCharges({ period, actor: SYSTEM_ACTOR })
      console.info(`[scheduler] generated ${result.created} charge(s) for ${period}`)
    }
  }

  if (settings.reminders.enabled) {
    const [hh, mm] = settings.reminders.time.split(":").map(Number)
    const due =
      now.getDate() > settings.reminders.dayOfMonth ||
      (now.getDate() === settings.reminders.dayOfMonth && now.getHours() * 60 + now.getMinutes() >= hh * 60 + mm)
    if (due && (await getState<string>("lastReminderRun")) !== period && (await claim("lastReminderRun", period))) {
      const result = await sendFeeReminders(SYSTEM_ACTOR)
      console.info(`[scheduler] reminders sent to ${result.studentsNotified} student(s)`)
    }
  }
}

export function startScheduler() {
  const tick = () =>
    runScheduledJobs().catch((error) => console.error("[scheduler] run failed:", (error as Error).message))
  setTimeout(tick, 10_000)
  return setInterval(tick, TICK_MS)
}
