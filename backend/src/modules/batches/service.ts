import type { Batch } from "@prisma/client"
import { z } from "zod"
import { prisma, type Db } from "../../lib/prisma"
import { rupees, toRupees } from "../../lib/money"
import { TIME_RE, batchTimeLabel, minutesOf, parseDays, scheduleSchema, timeSchema } from "../../lib/schedule"

const statusSchema = z
  .string()
  .trim()
  .toUpperCase()
  .transform((s) => (s === "INACTIVE" ? "PAUSED" : s))
  .pipe(z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]))

const subjectsSchema = z.array(z.string().trim().min(1).max(60)).max(10)

// `time` and `fee` are accepted as aliases of `startTime` / `monthlyFee` (frontend field names).
const batchFields = {
  name: z.string().trim().min(3, "Enter a descriptive batch name").max(120),
  classLevel: z.string().trim().min(1, "Enter the class level").max(40),
  subjects: subjectsSchema,
  /** Teaching days, e.g. ["Mon","Wed","Fri"] or "Mon, Wed, Fri"; stored as "Mon, Wed, Fri". */
  schedule: scheduleSchema,
  /** 24-hour "HH:MM". */
  startTime: timeSchema,
  endTime: timeSchema,
  capacity: z.number().int().min(1, "Capacity must be at least 1").max(1000),
  monthlyFee: rupees({ allowZero: true }),
  status: statusSchema,
}

/** End must be after start (same day; batches don't run past midnight). */
export function timeRangeError(start: string, end: string) {
  if (!TIME_RE.test(start) || !TIME_RE.test(end)) return "Enter both a start and an end time"
  return minutesOf(end) > minutesOf(start) ? null : "End time must be after the start time"
}

/** Map the frontend's `time` / `fee` names onto the canonical fields before validation. */
const aliases = (raw: unknown) => {
  if (!raw || typeof raw !== "object") return raw
  const { time, fee, ...rest } = raw as Record<string, unknown>
  if (rest.startTime === undefined && time !== undefined) rest.startTime = time
  if (rest.monthlyFee === undefined && fee !== undefined) rest.monthlyFee = fee
  return rest
}

export const createBatchSchema = z.preprocess(
  aliases,
  z
    .object({
      ...batchFields,
      subjects: subjectsSchema.default([]),
      status: statusSchema.default("ACTIVE"),
    })
    .superRefine((b, ctx) => {
      const error = timeRangeError(b.startTime, b.endTime)
      if (error) ctx.addIssue({ code: "custom", message: error, path: ["endTime"] })
    }),
)

export const updateBatchSchema = z.preprocess(aliases, z.object(batchFields).partial())

export type BatchInput = {
  name: string
  classLevel: string
  subjects: string[]
  schedule: string
  startTime: string
  endTime: string
  capacity: number
  monthlyFee: number
  status: "ACTIVE" | "PAUSED" | "ARCHIVED"
}

/** Number of active students currently enrolled, keyed by batch id. */
export async function enrolledCounts(batchIds: string[], db: Db = prisma) {
  const rows = await db.enrollment.groupBy({
    by: ["batchId"],
    where: { batchId: { in: batchIds }, endedAt: null, student: { status: "ACTIVE" } },
    _count: { _all: true },
  })
  return new Map(rows.map((r) => [r.batchId, r._count._all]))
}

export function serializeBatch(b: Batch, students = 0) {
  return {
    id: b.id,
    code: b.code,
    name: b.name,
    classLevel: b.classLevel,
    subjects: b.subjects,
    schedule: b.schedule,
    /** Parsed days for the editor's checkboxes ([] if the stored value isn't valid days). */
    days: parseDays(b.schedule) ?? [],
    startTime: b.startTime,
    endTime: b.endTime,
    time: batchTimeLabel(b.startTime, b.endTime),
    capacity: b.capacity,
    students,
    seatsAvailable: Math.max(0, b.capacity - students),
    monthlyFee: toRupees(b.monthlyFee),
    status: b.status,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  }
}
