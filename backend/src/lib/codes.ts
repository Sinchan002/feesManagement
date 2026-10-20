import type { Db } from "./prisma"

const START: Record<string, number> = {
  student: 2000,
  batch: 100,
  payment: 8000,
}

/** Atomically allocate the next human-readable number for a sequence (INSERT … ON CONFLICT). */
export async function nextNumber(db: Db, name: string): Promise<number> {
  const row = await db.counter.upsert({
    where: { name },
    create: { name, value: (START[name] ?? 0) + 1 },
    update: { value: { increment: 1 } },
  })
  return row.value
}

const pad = (n: number, width: number) => String(n).padStart(width, "0")

export const nextStudentCode = async (db: Db) => `ST-${await nextNumber(db, "student")}`
export const nextBatchCode = async (db: Db) => `B-${await nextNumber(db, "batch")}`
export const nextRegistrationCode = async (db: Db) =>
  `RG-${pad(await nextNumber(db, "registration"), 3)}`
export const nextPaymentCode = async (db: Db) => `PAY-${await nextNumber(db, "payment")}`
export const nextChargeCode = async (db: Db) => `FC-${pad(await nextNumber(db, "charge"), 6)}`
export async function nextReceiptNumber(db: Db, date = new Date()) {
  const year = date.getFullYear()
  return `RCPT-${year}-${pad(await nextNumber(db, `receipt-${year}`), 6)}`
}
