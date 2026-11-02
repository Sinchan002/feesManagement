import { beforeEach, describe, expect, it } from "vitest"
import { addMonths, academyToday } from "../src/lib/dates"
import { PINNED_NOW } from "./setup-clock"
import { api, auth, createAdmin, createBatch, createStudent, prisma, resetDb } from "./helpers"

const period = academyToday(PINNED_NOW).period
const lastPeriod = addMonths(period, -1)
// A real 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")

let admin: string
let student: Awaited<ReturnType<typeof createStudent>>
let feeIds: { old: string; current: string }

beforeEach(async () => {
  await resetDb()
  admin = await createAdmin()
  const batch = await createBatch(admin, { fee: 500 })
  student = await createStudent(admin, batch.id, "UPI Payer")
  for (const p of [lastPeriod, period]) {
    await api().post("/api/fees/charges").set(auth(admin)).send({ studentId: student.studentId, type: "MONTHLY", billingPeriod: p })
  }
  const charges = await prisma.feeCharge.findMany({ where: { studentId: student.studentId }, orderBy: { billingPeriod: "asc" } })
  feeIds = { old: charges[0]!.id, current: charges[1]!.id }
})

const setUp = async () => {
  await api().put("/api/upi/config").set(auth(admin)).send({ upiId: "SriKrishna@okhdfc", payeeName: "SriKrishna Physics" })
}
const claim = (body: Record<string, unknown>, token = student.token) =>
  api().post("/api/upi/claims").set(auth(token)).send({ transactionReference: "412345678901", ...body })

describe("teacher's UPI details", () => {
  it("saves a valid UPI ID, rejects bad ones, and students cannot change it", async () => {
    expect((await api().put("/api/upi/config").set(auth(admin)).send({ upiId: "not a upi id", payeeName: "X Y" })).status).toBe(400)
    expect((await api().put("/api/upi/config").set(auth(student.token)).send({ upiId: "a@b", payeeName: "Hack" })).status).toBe(403)

    const before = await api().get("/api/upi/config").set(auth(student.token))
    expect(before.body.data).toMatchObject({ configured: false, upiId: "", qrDataUrl: null })

    await setUp()
    const after = await api().get("/api/upi/config").set(auth(student.token))
    expect(after.body.data).toMatchObject({ configured: true, upiId: "srikrishna@okhdfc", payeeName: "SriKrishna Physics", hasQr: false })
  })

  it("accepts a real QR image and refuses disguised files", async () => {
    // The ID must come first.
    const early = await api().put("/api/upi/qr").set(auth(admin)).set("Content-Type", "image/png").send(PNG)
    expect(early.status).toBe(400)
    await setUp()

    const fake = await api().put("/api/upi/qr").set(auth(admin)).set("Content-Type", "image/png").send(Buffer.from("<script>alert(1)</script>"))
    expect(fake.status).toBe(400)
    expect((await api().put("/api/upi/qr").set(auth(student.token)).set("Content-Type", "image/png").send(PNG)).status).toBe(403)

    const ok = await api().put("/api/upi/qr").set(auth(admin)).set("Content-Type", "image/png").send(PNG)
    expect(ok.status).toBe(200)
    const seen = await api().get("/api/upi/config").set(auth(student.token))
    expect(seen.body.data.qrDataUrl).toMatch(/^data:image\/png;base64,iVBOR/)

    await api().delete("/api/upi/qr").set(auth(admin))
    expect((await api().get("/api/upi/config").set(auth(student.token))).body.data.qrDataUrl).toBeNull()
  })
})

describe("student reports a payment, teacher verifies", () => {
  it("needs the teacher's UPI details first", async () => {
    const res = await claim({ chargeIds: [feeIds.current] })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/not set up/)
  })

  it("computes the amount on the server and changes nothing until approved", async () => {
    await setUp()
    const res = await claim({ chargeIds: [feeIds.old, feeIds.current], amount: 1 })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ status: "PENDING", amount: 1000, transactionReference: "412345678901" })
    expect(res.body.data.items).toHaveLength(2)
    // Still unpaid.
    expect((await prisma.feeCharge.findMany({ where: { studentId: student.studentId } })).map((c) => c.status)).toEqual(["PENDING", "PENDING"])
    expect(await prisma.payment.count()).toBe(0)
    // The student's dashboard shows it as waiting, and the teacher's dashboard counts it.
    const dash = await api().get("/api/me/dashboard").set(auth(student.token))
    expect(dash.body.data.upiClaims[0]).toMatchObject({ status: "PENDING" })
    expect(dash.body.data.pendingClaimChargeIds.sort()).toEqual([feeIds.current, feeIds.old].sort())
    const report = await api().get("/api/reports/dashboard").set(auth(admin))
    expect(report.body.data.metrics.pendingUpiClaims).toBe(1)
  })

  it("blocks duplicate references, double claims on a fee, and other students' fees", async () => {
    await setUp()
    expect((await claim({ chargeIds: [feeIds.old] })).status).toBe(201)

    // Same reference again (any letter case) — even for a different fee.
    const dupRef = await claim({ chargeIds: [feeIds.current], transactionReference: "412345678901" })
    expect(dupRef.status).toBe(409)
    // The same fee is already awaiting verification.
    const dupFee = await claim({ chargeIds: [feeIds.old], transactionReference: "999999999999" })
    expect(dupFee.status).toBe(409)
    // Bad reference formats.
    expect((await claim({ chargeIds: [feeIds.current], transactionReference: "12 34" })).status).toBe(400)

    // Another student cannot claim this student's fee.
    const other = await createStudent(admin, (await prisma.batch.findFirstOrThrow()).id, "Other Kid")
    const steal = await claim({ chargeIds: [feeIds.current], transactionReference: "777777777777" }, other.token)
    expect(steal.status).toBe(400)
    // Students can't approve, or read the teacher's list.
    expect((await api().get("/api/upi/claims").set(auth(student.token))).status).toBe(403)
    const id = (await prisma.upiClaim.findFirstOrThrow()).id
    expect((await api().post(`/api/upi/claims/${id}/approve`).set(auth(student.token)).send({})).status).toBe(403)
  })

  it("won't let a fee with a pending claim also be paid through the online gateway", async () => {
    await setUp()
    await claim({ chargeIds: [feeIds.old] })
    const blocked = await api().post("/api/payments/online/orders").set(auth(student.token)).send({ chargeIds: [feeIds.old] })
    expect(blocked.status).toBe(400)
  })

  it("approval records a UPI payment, marks the fees paid and issues a receipt", async () => {
    await setUp()
    const c = (await claim({ chargeIds: [feeIds.old, feeIds.current] })).body.data
    const res = await api().post(`/api/upi/claims/${c.id}/approve`).set(auth(admin)).send({})
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ status: "APPROVED", reviewedBy: "Test Teacher" })
    expect(res.body.data.payment.receiptNumber).toMatch(/^RCPT-/)

    const fees = await prisma.feeCharge.findMany({ where: { studentId: student.studentId } })
    expect(fees.map((f) => f.status)).toEqual(["PAID", "PAID"])
    const pay = await prisma.payment.findFirstOrThrow()
    expect(pay).toMatchObject({ method: "UPI", source: "MANUAL", status: "SUCCEEDED", amount: 100000, transactionReference: "412345678901" })

    // The student can download the receipt; approving twice is refused; the reference is now spent.
    expect((await api().get(`/api/payments/${pay.id}/receipt.pdf`).set(auth(student.token))).status).toBe(200)
    expect((await api().post(`/api/upi/claims/${c.id}/approve`).set(auth(admin)).send({})).status).toBe(409)
    expect(await prisma.payment.count()).toBe(1)
  })

  it("lets the teacher choose which fees to mark and the amount actually received", async () => {
    await setUp()
    const c = (await claim({ chargeIds: [feeIds.old, feeIds.current] })).body.data
    // Only ₹500 arrived, and the teacher marks just the older month.
    const res = await api().post(`/api/upi/claims/${c.id}/approve`).set(auth(admin)).send({ chargeIds: [feeIds.old], amount: 500, note: "Checked in HDFC statement" })
    expect(res.status).toBe(200)
    const fees = await prisma.feeCharge.findMany({ where: { studentId: student.studentId }, orderBy: { billingPeriod: "asc" } })
    expect(fees.map((f) => f.status)).toEqual(["PAID", "PENDING"])
    expect((await prisma.payment.findFirstOrThrow()).notes).toContain("Checked in HDFC statement")

    // Received less than a whole fee → partially paid.
    const c2 = (await claim({ chargeIds: [feeIds.current], transactionReference: "555555555555" })).body.data
    await api().post(`/api/upi/claims/${c2.id}/approve`).set(auth(admin)).send({ amount: 200 })
    expect((await prisma.feeCharge.findUniqueOrThrow({ where: { id: feeIds.current } }))).toMatchObject({ status: "PARTIALLY_PAID", paidAmount: 20000 })
  })

  it("rejection leaves the fees unpaid, tells the student, and frees the reference", async () => {
    await setUp()
    const c = (await claim({ chargeIds: [feeIds.current] })).body.data
    expect((await api().post(`/api/upi/claims/${c.id}/reject`).set(auth(admin)).send({})).status).toBe(400) // reason required
    const res = await api().post(`/api/upi/claims/${c.id}/reject`).set(auth(admin)).send({ reason: "Amount not received in bank" })
    expect(res.body.data).toMatchObject({ status: "REJECTED", reviewNote: "Amount not received in bank" })
    expect(await prisma.payment.count()).toBe(0)
    expect((await prisma.feeCharge.findUniqueOrThrow({ where: { id: feeIds.current } })).status).toBe("PENDING")
    expect((await api().get("/api/upi/claims/mine").set(auth(student.token))).body.data[0]).toMatchObject({ status: "REJECTED" })
    // Corrected reference can be submitted again for the same fee.
    expect((await claim({ chargeIds: [feeIds.current], transactionReference: "412345678902" })).status).toBe(201)
    // A decided claim cannot be decided again.
    expect((await api().post(`/api/upi/claims/${c.id}/reject`).set(auth(admin)).send({ reason: "again" })).status).toBe(409)
  })

  it("two simultaneous approvals record only one payment", async () => {
    await setUp()
    const c = (await claim({ chargeIds: [feeIds.current] })).body.data
    const results = await Promise.all([
      api().post(`/api/upi/claims/${c.id}/approve`).set(auth(admin)).send({}),
      api().post(`/api/upi/claims/${c.id}/approve`).set(auth(admin)).send({}),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    expect(await prisma.payment.count()).toBe(1)
  })
})
