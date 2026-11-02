import { beforeEach, describe, expect, it } from "vitest"
import { academyToday } from "../src/lib/dates"
import { PINNED_NOW } from "./setup-clock"
import { api, auth, createAdmin, createBatch, createStudent, prisma, resetDb } from "./helpers"

let admin: string
const period = academyToday(PINNED_NOW).period

beforeEach(async () => {
  await resetDb()
  admin = await createAdmin()
})

const batchBody = (overrides: Record<string, unknown>) => ({
  name: "Physics Evening",
  classLevel: "Class 10",
  schedule: ["Mon", "Wed"],
  startTime: "17:00",
  endTime: "18:30",
  capacity: 20,
  monthlyFee: 500,
  ...overrides,
})

describe("batch days and times", () => {
  it("rejects invalid days", async () => {
    const res = await api().post("/api/batches").set(auth(admin)).send(batchBody({ schedule: "xyz abc" }))
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/teaching days/)
    const none = await api().post("/api/batches").set(auth(admin)).send(batchBody({ schedule: [] }))
    expect(none.status).toBe(400)
  })

  it("rejects impossible times and an end before the start", async () => {
    expect((await api().post("/api/batches").set(auth(admin)).send(batchBody({ startTime: "25:99" }))).status).toBe(400)
    const backwards = await api().post("/api/batches").set(auth(admin)).send(batchBody({ startTime: "13:00", endTime: "12:00" }))
    expect(backwards.status).toBe(400)
    expect(backwards.body.message).toBe("End time must be after the start time")
    const missingEnd = await api().post("/api/batches").set(auth(admin)).send(batchBody({ endTime: undefined }))
    expect(missingEnd.status).toBe(400)
  })

  it("normalises days and formats times", async () => {
    const res = await api().post("/api/batches").set(auth(admin)).send(batchBody({ schedule: "friday, mon wed" }))
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ schedule: "Mon, Wed, Fri", days: ["Mon", "Wed", "Fri"], time: "5:00 PM – 6:30 PM" })
  })

  it("checks the time range when only one side is updated", async () => {
    const b = (await api().post("/api/batches").set(auth(admin)).send(batchBody({}))).body.data
    const res = await api().patch(`/api/batches/${b.id}`).set(auth(admin)).send({ endTime: "16:00" })
    expect(res.status).toBe(400)
    expect((await api().patch(`/api/batches/${b.id}`).set(auth(admin)).send({ endTime: "19:00" })).status).toBe(200)
  })
})

describe("phone numbers", () => {
  it("rejects a 17-digit student phone and accepts normal formats", async () => {
    const send = (phone: string, n: number) =>
      api().post("/api/auth/register").send({
        name: "Phone Test", email: `phone${n}@example.com`, phone, className: "Class 10", password: "Secret123",
      })
    expect((await send("+91 900000000123456", 1)).status).toBe(400)
    expect((await send("12345", 2)).status).toBe(400)
    expect((await send("5876543210", 3)).status).toBe(400) // not a mobile number
    for (const [i, ok] of ["+91 98765 43210", "9876543210", "098765-43210"].entries()) {
      expect((await send(ok, 10 + i)).status, ok).toBe(201)
    }
  })

  it("validates the academy phone in settings", async () => {
    const bad = await api().patch("/api/settings").set(auth(admin)).send({ academy: { phone: "abc" } })
    expect(bad.status).toBe(400)
    expect((await api().patch("/api/settings").set(auth(admin)).send({ academy: { phone: "03242 255123" } })).status).toBe(200)
    expect((await api().patch("/api/settings").set(auth(admin)).send({ academy: { phone: "" } })).status).toBe(200)
  })
})

describe("advance credit", () => {
  it("is applied to fees created after the payment (the reported case)", async () => {
    const batch = await createBatch(admin, { fee: 800 })
    const s = await createStudent(admin, batch.id, "Credit Student")
    // ₹500 recorded before any fee exists → all of it is advance credit.
    const pay = await api().post("/api/payments/manual").set(auth(admin)).send({ studentId: s.studentId, amount: 500, method: "Cash" })
    expect(pay.body.data.unallocatedAmount).toBe(500)

    await api().post("/api/fees/charges/generate").set(auth(admin)).send({ period })
    const [fee] = await prisma.feeCharge.findMany({ where: { studentId: s.studentId } })
    expect(fee).toMatchObject({ amount: 80000, paidAmount: 50000, status: "PARTIALLY_PAID" })

    // A ₹600 discount takes the fee to ₹200, which the credit already covers in full.
    const adj = await api().post(`/api/fees/charges/${fee!.id}/adjustments`).set(auth(admin)).send({ amount: -300, reason: "Scholarship approved" })
    expect(adj.body.data).toMatchObject({ netAmount: 500, outstanding: 0, status: "PAID" })
    expect(await prisma.auditLog.count({ where: { action: "CREDIT_APPLIED" } })).toBe(1)
  })

  it("covers part of a fee and keeps the rest of the credit for later fees", async () => {
    const batch = await createBatch(admin, { fee: 300 })
    const s = await createStudent(admin, batch.id, "Big Payer")
    await api().post("/api/payments/manual").set(auth(admin)).send({ studentId: s.studentId, amount: 500, method: "Cash" })
    const first = await api().post("/api/fees/charges").set(auth(admin)).send({ studentId: s.studentId, type: "MONTHLY", billingPeriod: period })
    expect(first.body.data).toMatchObject({ outstanding: 0, status: "PAID" })
    const other = await api().post("/api/fees/charges").set(auth(admin)).send({ studentId: s.studentId, type: "OTHER", description: "Lab fee", amount: 400 })
    expect(other.body.data).toMatchObject({ paidAmount: 200, outstanding: 200, status: "PARTIALLY_PAID" })
  })
})
