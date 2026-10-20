import type { Tx } from "../../lib/prisma"
import { badRequest, notFound } from "../../lib/errors"
import { audit, type Actor } from "../../lib/audit"
import { enrolledCounts } from "../batches/service"
import { billOnPlacement } from "../fees/service"

/** Serialise concurrent enrollment changes for one student. */
export async function lockStudent(tx: Tx, studentId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Student" WHERE id = ${studentId} FOR UPDATE`
  if (rows.length === 0) throw notFound("Student")
}

/**
 * Moves a student into `batchId`. The current enrollment (if any) is closed — never deleted —
 * so the previous assignment stays in the history. Must run inside a transaction.
 */
export async function assignBatch(
  tx: Tx,
  opts: { studentId: string; batchId: string; actor: Actor; reason?: string | null; studentName: string },
) {
  await lockStudent(tx, opts.studentId)
  // Lock the batch row too, so two concurrent assignments cannot both take the last seat.
  await tx.$queryRaw`SELECT id FROM "Batch" WHERE id = ${opts.batchId} FOR UPDATE`

  const batch = await tx.batch.findUnique({ where: { id: opts.batchId } })
  if (!batch) throw notFound("Batch")
  if (batch.status !== "ACTIVE") throw badRequest(`${batch.name} is not active. Choose an active batch.`)

  const current = await tx.enrollment.findFirst({
    where: { studentId: opts.studentId, endedAt: null },
    include: { batch: true },
  })
  if (current?.batchId === batch.id) throw badRequest(`The student is already in ${batch.name}.`)

  const enrolled = (await enrolledCounts([batch.id], tx)).get(batch.id) ?? 0
  if (enrolled >= batch.capacity) throw badRequest(`${batch.name} is full (${enrolled}/${batch.capacity}).`)

  const now = new Date()
  if (current) {
    await tx.enrollment.update({
      where: { id: current.id },
      data: { endedAt: now, endReason: opts.reason ?? `Moved to ${batch.name}` },
    })
  }
  const enrollment = await tx.enrollment.create({
    data: {
      studentId: opts.studentId,
      batchId: batch.id,
      batchName: batch.name,
      startedAt: now,
      reason: opts.reason ?? null,
      changedById: opts.actor.id,
    },
  })
  await audit(
    opts.actor,
    {
      action: current ? "STUDENT_BATCH_CHANGED" : "STUDENT_ALLOCATED",
      entityType: "Student",
      entityId: opts.studentId,
      summary: current
        ? `${opts.studentName} moved from ${current.batch?.name ?? current.batchName} to ${batch.name}`
        : `${opts.studentName} assigned to ${batch.name}`,
      metadata: { fromBatchId: current?.batchId ?? null, toBatchId: batch.id, reason: opts.reason ?? null },
    },
    tx,
  )
  // Placed before the 15th → this month's fee is billed now (never twice for the same month).
  const charge = await billOnPlacement(tx, {
    studentId: opts.studentId,
    studentName: opts.studentName,
    enrollmentId: enrollment.id,
    batch,
    actor: opts.actor,
  })
  return { enrollment, batch, previous: current, charge }
}

/** Close the current enrollment without opening a new one. */
export async function endEnrollment(
  tx: Tx,
  opts: { studentId: string; actor: Actor; reason: string; studentName: string },
) {
  await lockStudent(tx, opts.studentId)
  const current = await tx.enrollment.findFirst({
    where: { studentId: opts.studentId, endedAt: null },
    include: { batch: true },
  })
  if (!current) throw badRequest("The student is not currently assigned to a batch.")
  await tx.enrollment.update({ where: { id: current.id }, data: { endedAt: new Date(), endReason: opts.reason } })
  await audit(
    opts.actor,
    {
      action: "STUDENT_UNASSIGNED",
      entityType: "Student",
      entityId: opts.studentId,
      summary: `${opts.studentName} removed from ${current.batch?.name ?? current.batchName}`,
      metadata: { batchId: current.batchId, reason: opts.reason },
    },
    tx,
  )
}
