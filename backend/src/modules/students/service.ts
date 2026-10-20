import type { Batch, Enrollment, FeeCharge, Student, User } from "@prisma/client"
import { prisma, type Db } from "../../lib/prisma"
import { outstandingOf, toRupees } from "../../lib/money"

export type FeeStanding = { outstanding: number; overdue: number; feeStatus: "PAID" | "DUE" | "OVERDUE" }

type OpenCharge = Pick<FeeCharge, "studentId" | "amount" | "adjustmentTotal" | "paidAmount" | "dueDate">

export function standingFrom(charges: OpenCharge[], now = new Date()): FeeStanding {
  let outstanding = 0
  let overdue = 0
  for (const c of charges) {
    const due = outstandingOf(c)
    outstanding += due
    if (c.dueDate < now) overdue += due
  }
  return {
    outstanding: toRupees(outstanding),
    overdue: toRupees(overdue),
    feeStatus: overdue > 0 ? "OVERDUE" : outstanding > 0 ? "DUE" : "PAID",
  }
}

/** Fee standing (outstanding / overdue) per student, from open charges. */
export async function standings(studentIds: string[] | null, db: Db = prisma) {
  const charges = await db.feeCharge.findMany({
    where: {
      status: { in: ["PENDING", "PARTIALLY_PAID"] },
      ...(studentIds ? { studentId: { in: studentIds } } : {}),
    },
    select: { studentId: true, amount: true, adjustmentTotal: true, paidAmount: true, dueDate: true },
  })
  const byStudent = new Map<string, OpenCharge[]>()
  for (const c of charges) {
    const list = byStudent.get(c.studentId) ?? []
    list.push(c)
    byStudent.set(c.studentId, list)
  }
  const result = new Map<string, FeeStanding>()
  for (const [id, list] of byStudent) result.set(id, standingFrom(list))
  return result
}

export const NO_DUES: FeeStanding = { outstanding: 0, overdue: 0, feeStatus: "PAID" }

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]!.toUpperCase())
    .join("")

type StudentWithRelations = Student & {
  user: Pick<User, "id" | "name" | "email" | "phone" | "status" | "lastLoginAt">
  enrollments: (Enrollment & { batch: Batch | null })[]
}

/** The student's current enrollment, if it still points at an existing batch. */
export const currentEnrollment = <E extends { endedAt: Date | null; batch: Batch | null }>(enrollments: E[]) =>
  enrollments.find((e): e is E & { batch: Batch } => e.endedAt === null && e.batch !== null)

export function serializeStudent(s: StudentWithRelations, standing: FeeStanding = NO_DUES) {
  const current = currentEnrollment(s.enrollments)
  return {
    id: s.id,
    code: s.code,
    userId: s.user.id,
    name: s.user.name,
    initials: initials(s.user.name),
    email: s.user.email,
    phone: s.user.phone,
    schoolClass: s.schoolClass,
    subjects: s.subjects,
    address: s.address,
    notes: s.notes,
    parent: {
      name: s.parentName,
      relation: s.parentRelation,
      email: s.parentEmail,
      phone: s.parentPhone,
    },
    batch: current
      ? {
          id: current.batch.id,
          code: current.batch.code,
          name: current.batch.name,
          schedule: current.batch.schedule,
          time: current.batch.endTime ? `${current.batch.startTime} – ${current.batch.endTime}` : current.batch.startTime,
          monthlyFee: toRupees(current.batch.monthlyFee),
          status: current.batch.status,
          enrolledAt: current.startedAt,
        }
      : null,
    status: s.status,
    accountStatus: s.user.status,
    lastLoginAt: s.user.lastLoginAt,
    joinedAt: s.joinedAt,
    ...standing,
  }
}

export const studentInclude = {
  user: { select: { id: true, name: true, email: true, phone: true, status: true, lastLoginAt: true } },
  enrollments: { where: { endedAt: null }, include: { batch: true } },
} as const

export const serializeEnrollment = (
  e: Enrollment & { batch: Pick<Batch, "id" | "code" | "name"> | null; changedBy?: Pick<User, "name"> | null },
) => ({
  id: e.id,
  // A deleted batch keeps its name in the history but no longer has an id/code.
  batch: e.batch
    ? { id: e.batch.id, code: e.batch.code, name: e.batch.name, deleted: false }
    : { id: null, code: null, name: e.batchName, deleted: true },
  startedAt: e.startedAt,
  endedAt: e.endedAt,
  active: e.endedAt === null,
  reason: e.reason,
  endReason: e.endReason,
  changedBy: e.changedBy?.name ?? null,
})
