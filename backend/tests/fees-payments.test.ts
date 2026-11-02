import { beforeEach, describe, expect, it } from "vitest"
import { currentPeriod, addMonths } from "../src/lib/dates"
import { getPaymentProvider } from "../src/modules/payments/providers"
import type { MockProvider } from "../src/modules/payments/providers/mock"
import { api, auth, createAdmin, createBatch, createStudent, login, prisma, resetDb } from "./helpers"
import { withRealClock } from "./setup-clock"

let admin: string
let batch: { id: string }
let student: Awaited<ReturnType<typeof createStudent>>
const period = currentPeriod()
const mock = () => getPaymentProvider() as MockProvider

beforeEach(async () => {
  await resetDb()
  admin = await createAdmin()
  batch = await createBatch(admin, { fee: 3200 })
  student = await createStudent(admin, batch.id)
})

const generate = (p = period) => api().post("/api/fees/charges/generate").set(auth(admin)).send({ period: p })
const charges = () => prisma.feeCharge.findMany({ where: { studentId: student.studentId }, orderBy: { createdAt: "asc" } })

describe("fee charges", () => {
  it("reports how many students still need this month's fee", async () => {
    const status = () => api().get("/api/fees/charges/generation-status").set(auth(admin))
    const before = (await status()).body.data
    expect(before.pendingStudents).toBe(1)
    await generate(before.period)
    expect((await status()).body.data.pendingStudents).toBe(0)
  })

  it("generates monthly charges idempotently", async () => {
    const first = await generate()
    expect(first.body.data.created).toBe(1)
    const second = await generate()
    expect(second.body.data.created).toBe(0)
    expect(await charges()).toHaveLength(1)
    expect((await charges())[0]!.amount).toBe(320000)
  })

  it("a batch fee change applies to future charges only", async () => {
    await generate()
    const res = await api().patch(`/api/batches/${batch.id}`).set(auth(admin)).send({ fee: 4000 })
    expect(res.status).toBe(200)
    expect((await charges())[0]!.amount).toBe(320000) // unchanged

    await generate(addMonths(period, 1))
    const all = await charges()
    expect(all.map((c) => c.amount)).toEqual([320000, 400000])

    const detail = await api().get(`/api/batches/${batch.id}`).set(auth(admin))
    expect(detail.body.data.feeHistory.map((f: { newFee: number }) => f.newFee)).toEqual([4000, 3200])
  })

  it("original charge amounts are immutable even at the database level", async () => {
    await generate()
    const [c] = await charges()
    await expect(prisma.feeCharge.update({ where: { id: c!.id }, data: { amount: 1 } })).rejects.toThrow(/immutable/)
  })

  it("changes what is owed only through documented adjustments", async () => {
    await generate()
    const [c] = await charges()
    const noReason = await api().post(`/api/fees/charges/${c!.id}/adjustments`).set(auth(admin)).send({ amount: -500 })
    expect(noReason.status).toBe(400)

    const res = await api()
      .post(`/api/fees/charges/${c!.id}/adjustments`)
      .set(auth(admin))
      .send({ amount: -500, reason: "Sibling discount approved by teacher" })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ amount: 3200, adjustmentTotal: -500, netAmount: 2700, outstanding: 2700 })
    expect(res.body.data.adjustments[0].reason).toBe("Sibling discount approved by teacher")

    const log = await prisma.auditLog.findFirst({ where: { action: "FEE_ADJUSTED" } })
    expect(log?.summary).toContain("Sibling discount")
  })

  it("cannot void a charge that has payments", async () => {
    await generate()
    const [c] = await charges()
    await api().post("/api/payments/manual").set(auth(admin)).send({ studentId: student.studentId, amount: 1000, method: "Cash" })
    const res = await api().post(`/api/fees/charges/${c!.id}/void`).set(auth(admin)).send({ reason: "Raised in error" })
    expect(res.status).toBe(409)
  })
})

describe("manual payments", () => {
  it("records partial payments and allocates them to specific charges", async () => {
    await generate()
    await generate(addMonths(period, 1))
    const [june, july] = await charges()

    const res = await api()
      .post("/api/payments/manual")
      .set(auth(admin))
      .send({
        studentId: student.studentId,
        amount: 4000,
        method: "UPI",
        transactionReference: "UPI-REF-1",
        notes: "Paid at front desk",
        allocations: [
          { chargeId: june!.id, amount: 3200 },
          { chargeId: july!.id, amount: 800 },
        ],
      })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ status: "SUCCEEDED", source: "MANUAL", method: "UPI", recordedBy: "Test Teacher", unallocatedAmount: 0 })
    expect(res.body.data.receiptNumber).toMatch(/^RCPT-/)

    const [j1, j2] = await charges()
    expect([j1!.status, j2!.status]).toEqual(["PAID", "PARTIALLY_PAID"])
    expect(j2!.paidAmount).toBe(80000)

    // The same UPI reference cannot be recorded twice.
    const dup = await api().post("/api/payments/manual").set(auth(admin)).send({ studentId: student.studentId, amount: 100, method: "UPI", transactionReference: "UPI-REF-1" })
    expect(dup.status).toBe(409)
  })

  it("rejects allocating more than is outstanding", async () => {
    await generate()
    const [c] = await charges()
    const res = await api()
      .post("/api/payments/manual")
      .set(auth(admin))
      .send({ studentId: student.studentId, amount: 5000, method: "Cash", allocations: [{ chargeId: c!.id, amount: 5000 }] })
    expect(res.status).toBe(400)
    expect(await prisma.payment.count()).toBe(0) // whole transaction rolled back
  })

  it("auto-allocates oldest first and keeps the remainder as credit", async () => {
    await generate()
    const res = await api().post("/api/payments/manual").set(auth(admin)).send({ studentId: student.studentId, amount: 5000, method: "Cash" })
    expect(res.body.data).toMatchObject({ allocatedAmount: 3200, unallocatedAmount: 1800 })
  })

  it("an idempotency key makes a double-submitted form record once", async () => {
    await generate()
    const send = () =>
      api().post("/api/payments/manual").set(auth(admin)).set("Idempotency-Key", "form-123").send({ studentId: student.studentId, amount: 3200, method: "Cash" })
    const [a, b] = [await send(), await send()]
    expect(a.status).toBe(201)
    expect(b.status).toBe(200)
    expect(b.body.data.id).toBe(a.body.data.id)
    expect(await prisma.payment.count()).toBe(1)
  })

  it("voiding a payment restores the charge and keeps the record", async () => {
    await generate()
    const pay = await api().post("/api/payments/manual").set(auth(admin)).send({ studentId: student.studentId, amount: 3200, method: "Cash" })
    const res = await api().post(`/api/payments/${pay.body.data.id}/void`).set(auth(admin)).send({ reason: "Entered twice by mistake" })
    expect(res.body.data.status).toBe("VOIDED")
    const [c] = await charges()
    expect(c).toMatchObject({ status: "PENDING", paidAmount: 0 })
  })
})

describe("online payments", () => {
  const createOrder = () => api().post("/api/payments/online/orders").set(auth(student.token)).send({})
  const checkout = (orderId: string, outcome = "success") =>
    api().post("/api/payments/online/mock-checkout").set(auth(student.token)).send({ orderId, outcome })

  it("computes the order amount on the server", async () => {
    await generate()
    // Order reuse compares Date.now() with Prisma's own createdAt, so use the real clock here.
    await withRealClock(async () => {
      // Sessions made under the pinned clock may already be expired in real time — sign in again.
      const token = await login(student.email, student.password)
      const order = () => api().post("/api/payments/online/orders").set(auth(token)).send({ amount: 1 })
      const res = await order()
      expect(res.status).toBe(201)
      expect(res.body.data).toMatchObject({ amount: 3200, amountInSubunits: 320000, currency: "INR" })
      // Repeating reuses the open order rather than creating duplicates.
      expect((await order()).body.data.orderId).toBe(res.body.data.orderId)
    })
  })

  it("rejects a forged signature and never marks the payment successful", async () => {
    await generate()
    const order = (await createOrder()).body.data
    const gw = (await checkout(order.orderId)).body.data
    const res = await api()
      .post("/api/payments/online/verify")
      .set(auth(student.token))
      .send({ ...gw, razorpay_signature: "0".repeat(64) })
    expect(res.status).toBe(400)
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: order.paymentId } })).status).toBe("CREATED")
    expect((await charges())[0]!.status).toBe("PENDING")
  })

  it("requires the gateway to confirm capture, not just a valid signature", async () => {
    await generate()
    const order = (await createOrder()).body.data
    const gw = (await checkout(order.orderId)).body.data
    mock().setPaymentStatus(gw.razorpay_payment_id, "created")
    const res = await api().post("/api/payments/online/verify").set(auth(student.token)).send(gw)
    expect(res.status).toBe(409)
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: order.paymentId } })).status).toBe("CREATED")
  })

  it("verifies, allocates once, and is idempotent across verify + webhook", async () => {
    await generate()
    const order = (await createOrder()).body.data
    const gw = (await checkout(order.orderId)).body.data

    const v1 = await api().post("/api/payments/online/verify").set(auth(student.token)).send(gw)
    expect(v1.status).toBe(200)
    expect(v1.body.data).toMatchObject({ status: "SUCCEEDED", source: "ONLINE", method: "UPI", verifiedVia: "CHECKOUT_VERIFY" })

    // Browser retries verify — same result, nothing duplicated.
    const v2 = await api().post("/api/payments/online/verify").set(auth(student.token)).send(gw)
    expect(v2.status).toBe(200)
    expect(v2.body.data.id).toBe(v1.body.data.id)

    // Webhook for the same payment arrives afterwards.
    const body = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: gw.razorpay_payment_id, order_id: order.orderId, amount: 320000, currency: "INR", status: "captured", method: "upi" } } },
    })
    const hook = await api()
      .post("/api/webhooks/mock")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", mock().signWebhook(body))
      .set("X-Razorpay-Event-Id", "evt_1")
      .send(body)
    expect(hook.status).toBe(200)

    expect(await prisma.paymentAllocation.count()).toBe(1)
    expect(await prisma.payment.count({ where: { status: "SUCCEEDED" } })).toBe(1)
    const [c] = await charges()
    expect(c).toMatchObject({ status: "PAID", paidAmount: 320000 })
  })

  it("settles from the webhook alone, ignores redelivered events, and rejects bad signatures", async () => {
    await generate()
    const order = (await createOrder()).body.data
    const gw = (await checkout(order.orderId)).body.data
    const body = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: gw.razorpay_payment_id, order_id: order.orderId, amount: 320000, currency: "INR", status: "captured", method: "card" } } },
    })
    const send = (sig: string) =>
      api().post("/api/webhooks/mock").set("Content-Type", "application/json").set("X-Razorpay-Signature", sig).set("X-Razorpay-Event-Id", "evt_42").send(body)

    expect((await send("bad")).status).toBe(400)
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: order.paymentId } })).status).toBe("CREATED")

    const first = await send(mock().signWebhook(body))
    expect(first.body).toMatchObject({ received: true, duplicate: false, status: "PROCESSED" })
    const again = await send(mock().signWebhook(body))
    expect(again.body).toMatchObject({ received: true, duplicate: true })

    const p = await prisma.payment.findUniqueOrThrow({ where: { id: order.paymentId } })
    expect(p).toMatchObject({ status: "SUCCEEDED", verifiedVia: "WEBHOOK", method: "CARD" })
    expect(await prisma.paymentAllocation.count()).toBe(1)
  })

  it("rejects a webhook whose amount does not match the order", async () => {
    await generate()
    const order = (await createOrder()).body.data
    const gw = (await checkout(order.orderId)).body.data
    const body = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: gw.razorpay_payment_id, order_id: order.orderId, amount: 100, currency: "INR", status: "captured" } } },
    })
    const res = await api().post("/api/webhooks/mock").set("Content-Type", "application/json").set("X-Razorpay-Signature", mock().signWebhook(body)).send(body)
    expect(res.status).toBe(400)
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: order.paymentId } })).status).toBe("CREATED")
  })

  it("records failures, and a later successful retry on the same order still settles", async () => {
    await generate()
    const order = (await createOrder()).body.data
    const failed = (await checkout(order.orderId, "failure")).body.data
    const r1 = await api().post("/api/payments/online/verify").set(auth(student.token)).send(failed)
    expect(r1.status).toBe(400)
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: order.paymentId } })).status).toBe("FAILED")

    const ok = (await checkout(order.orderId)).body.data
    const r2 = await api().post("/api/payments/online/verify").set(auth(student.token)).send(ok)
    expect(r2.status).toBe(200)
    expect(r2.body.data.status).toBe("SUCCEEDED")
  })

  it("a student cannot verify another student's order", async () => {
    await generate()
    const other = await createStudent(admin, batch.id, "Other Student")
    const order = (await createOrder()).body.data
    const gw = (await checkout(order.orderId)).body.data
    const res = await api().post("/api/payments/online/verify").set(auth(other.token)).send(gw)
    expect(res.status).toBe(404)
  })

  it("serves the receipt PDF to the owner", async () => {
    await generate()
    const order = (await createOrder()).body.data
    const gw = (await checkout(order.orderId)).body.data
    const paid = await api().post("/api/payments/online/verify").set(auth(student.token)).send(gw)
    const pdf = await api().get(`/api/payments/${paid.body.data.id}/receipt.pdf`).set(auth(student.token))
    expect(pdf.status).toBe(200)
    expect(pdf.headers["content-type"]).toBe("application/pdf")
    expect(pdf.body.subarray(0, 4).toString()).toBe("%PDF")
  })
})
