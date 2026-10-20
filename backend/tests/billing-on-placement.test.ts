import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { academyToday, dueDateFor } from "../src/lib/dates"
import { PINNED_NOW } from "./setup-clock"
import { api, auth, createAdmin, createBatch, createStudent, prisma, resetDb } from "./helpers"
import { getPaymentProvider } from "../src/modules/payments/providers"
import type { MockProvider } from "../src/modules/payments/providers/mock"

/** A moment on the given day of the pinned month, given as India time (UTC+5:30). */
const istOn = (day: number, hour = 11, minute = 30) => {
  const y = PINNED_NOW.getUTCFullYear()
  const m = PINNED_NOW.getUTCMonth()
  return new Date(Date.UTC(y, m, day, hour, minute) - 330 * 60 * 1000)
}
const period = academyToday(PINNED_NOW).period

let admin: string
let batch: { id: string }

beforeEach(async () => {
  await resetDb()
  admin = await createAdmin()
  batch = await createBatch(admin, { fee: 3200 })
})
afterEach(() => {
  vi.setSystemTime(PINNED_NOW)
})

const chargesOf = (studentId: string) => prisma.feeCharge.findMany({ where: { studentId } })

async function registerAndApprove(name: string) {
  const email = `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`
  const reg = await api().post("/api/auth/register").send({
    name, email, phone: "9876543210", className: "Grade 10", password: "Secret123",
  })
  const approve = await api().post(`/api/registrations/${reg.body.data.id}/approve`).set(auth(admin)).send({ batchId: batch.id })
  const student = await prisma.student.findFirstOrThrow({ where: { user: { email } } })
  return { approve, studentId: student.id }
}

describe("billing when a student is placed in a batch", () => {
  it("bills this month immediately when approved before the 15th", async () => {
    vi.setSystemTime(istOn(10))
    const { approve, studentId } = await registerAndApprove("Early Joiner")
    expect(approve.status).toBe(200)
    expect(approve.body.data.firstCharge).toMatchObject({ amount: 3200, billingPeriod: period })

    const charges = await chargesOf(studentId)
    expect(charges).toHaveLength(1)
    expect(charges[0]).toMatchObject({ amount: 320000, billingPeriod: period, type: "MONTHLY" })
    // The regular due date (5th) has passed, so they get 7 days: end of the 17th, India time.
    expect(charges[0]!.dueDate.toISOString()).toBe(new Date(istOn(17, 23, 59).getTime() + 59_000).toISOString())
  })

  it("keeps the regular due date when that is later than 7 days from joining", async () => {
    await prisma.setting.upsert({
      where: { key: "app" },
      create: { key: "app", value: { billing: { dueDay: 25, autoGenerateCharges: true } } },
      update: { value: { billing: { dueDay: 25, autoGenerateCharges: true } } },
    })
    vi.setSystemTime(istOn(3))
    const { studentId } = await registerAndApprove("Due Later")
    const [charge] = await chargesOf(studentId)
    expect(charge!.dueDate.toISOString()).toBe(dueDateFor(period, 25).toISOString())
  })

  it("does not bill when placed on or after the 15th (India time)", async () => {
    vi.setSystemTime(istOn(15, 0, 30)) // 12:30 AM on the 15th in India is still the 14th in UTC
    const { approve, studentId } = await registerAndApprove("Late Joiner")
    expect(approve.body.data.firstCharge).toBeNull()
    expect(await chargesOf(studentId)).toHaveLength(0)
  })

  it("bills at 11:59 PM on the 14th (India time)", async () => {
    vi.setSystemTime(istOn(14, 23, 59))
    const { studentId } = await registerAndApprove("Last Minute")
    expect(await chargesOf(studentId)).toHaveLength(1)
  })

  it("never bills the same month twice (batch change, monthly run)", async () => {
    vi.setSystemTime(istOn(8))
    const other = await createBatch(admin, { name: "Other batch", fee: 4000 })
    const { studentId } = await registerAndApprove("Mover")
    await api().post(`/api/students/${studentId}/batch`).set(auth(admin)).send({ batchId: other.id })
    const run = await api().post("/api/fees/charges/generate").set(auth(admin)).send({ period })
    expect(run.body.data.created).toBe(0)
    const charges = await chargesOf(studentId)
    expect(charges).toHaveLength(1)
    expect(charges[0]!.amount).toBe(320000) // billed at the batch they joined first
  })

  it("also applies when the teacher adds a student directly", async () => {
    vi.setSystemTime(istOn(5))
    const res = await api().post("/api/students").set(auth(admin)).send({
      name: "Direct Add", email: "direct@example.com", phone: "9876543210", schoolClass: "Grade 10", batchId: batch.id,
    })
    expect(res.status).toBe(201)
    expect(await chargesOf(res.body.data.id)).toHaveLength(1)
  })

  it("does not bill for a batch with a zero fee", async () => {
    vi.setSystemTime(istOn(5))
    batch = await createBatch(admin, { name: "Free batch", fee: 0 })
    const { studentId } = await registerAndApprove("Free Rider")
    expect(await chargesOf(studentId)).toHaveLength(0)
  })
})

describe("paying selected months online", () => {
  it("charges and settles only the months the student ticked", async () => {
    const s = await createStudent(admin, batch.id, "Selective Payer")
    const prev = academyToday(new Date(Date.UTC(PINNED_NOW.getUTCFullYear(), PINNED_NOW.getUTCMonth() - 1, 15))).period
    for (const p of [prev, period]) {
      const r = await api().post("/api/fees/charges").set(auth(admin)).send({ studentId: s.studentId, type: "MONTHLY", billingPeriod: p })
      expect(r.status).toBe(201)
    }
    const [older] = await prisma.feeCharge.findMany({ where: { studentId: s.studentId }, orderBy: { billingPeriod: "asc" } })

    const order = await api().post("/api/payments/online/orders").set(auth(s.token)).send({ chargeIds: [older!.id] })
    expect(order.status).toBe(201)
    expect(order.body.data.amount).toBe(3200)

    const mock = getPaymentProvider() as MockProvider
    const gw = await api().post("/api/payments/online/mock-checkout").set(auth(s.token)).send({ orderId: order.body.data.orderId })
    const paid = await api().post("/api/payments/online/verify").set(auth(s.token)).send(gw.body.data)
    expect(paid.status).toBe(200)
    expect(mock).toBeTruthy()

    const after = await prisma.feeCharge.findMany({ where: { studentId: s.studentId }, orderBy: { billingPeriod: "asc" } })
    expect(after.map((c) => c.status)).toEqual(["PAID", "PENDING"])
  })
})
