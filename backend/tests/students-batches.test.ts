import { beforeEach, describe, expect, it } from "vitest"
import { currentPeriod } from "../src/lib/dates"
import { api, auth, createAdmin, createBatch, createStudent, prisma, resetDb } from "./helpers"

let admin: string

beforeEach(async () => {
  await resetDb()
  admin = await createAdmin()
})

describe("batches", () => {
  it("creates, lists and updates batches using the frontend field names", async () => {
    const b = await createBatch(admin)
    expect(b).toMatchObject({ monthlyFee: 3200 })
    const list = await api().get("/api/batches").set(auth(admin))
    expect(list.body.data[0]).toMatchObject({ name: "Grade 10 • Mathematics", time: "5:00 PM – 6:30 PM", days: ["Mon", "Wed", "Fri"], status: "ACTIVE", students: 0, capacity: 30 })

    const res = await api().patch(`/api/batches/${b.id}`).set(auth(admin)).send({ status: "Paused", schedule: "Tue, Thu" })
    expect(res.body.data).toMatchObject({ status: "PAUSED", schedule: "Tue, Thu" })

    // Public list only shows active batches, without enrollment numbers.
    const pub = await api().get("/api/public/batches")
    expect(pub.body.data).toHaveLength(0)
  })

  it("deleting a batch keeps its students and queues them in Registrations for a new batch", async () => {
    const doomed = await createBatch(admin, { name: "Old batch" })
    const next = await createBatch(admin, { name: "New batch" })
    const s = await createStudent(admin, doomed.id, "Moved Student")
    await api().post("/api/fees/charges/generate").set(auth(admin)).send({ period: currentPeriod() })

    const res = await api().delete(`/api/batches/${doomed.id}`).set(auth(admin))
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ deleted: true, studentsMoved: 1 })
    expect(await prisma.batch.findUnique({ where: { id: doomed.id } })).toBeNull()

    // The student still exists, is still active, and simply has no batch.
    const detail = await api().get(`/api/students/${s.studentId}`).set(auth(admin))
    expect(detail.body.data).toMatchObject({ status: "ACTIVE", batch: null })
    expect(detail.body.data.enrollments[0]).toMatchObject({ active: false, batch: { name: "Old batch", deleted: true } })
    // Fee charge kept with its original amount and batch name.
    expect(detail.body.data.charges[0]).toMatchObject({ amount: 3200, batchName: "Old batch" })
    // Their dashboard keeps working.
    expect((await api().get("/api/me/dashboard").set(auth(s.token))).status).toBe(200)

    // A re-allocation request is waiting for the teacher.
    const queue = await api().get("/api/registrations").set(auth(admin))
    const req = queue.body.data.find((r: { name: string }) => r.name === "Moved Student")
    expect(req).toMatchObject({ kind: "REALLOCATION", status: "PENDING", studentCode: detail.body.data.code })

    // Allocating it puts the student into the new batch.
    const ok = await api().post(`/api/registrations/${req.id}/approve`).set(auth(admin)).send({ batchId: next.id })
    expect(ok.status).toBe(200)
    const after = await api().get(`/api/students/${s.studentId}`).set(auth(admin))
    expect(after.body.data.batch).toMatchObject({ id: next.id })
    expect(after.body.data.enrollments).toHaveLength(2)
  })

  it("declining a re-allocation request never deletes the student", async () => {
    const doomed = await createBatch(admin, { name: "Old batch" })
    const s = await createStudent(admin, doomed.id, "Kept Student")
    await api().delete(`/api/batches/${doomed.id}`).set(auth(admin))
    const queue = await api().get("/api/registrations").set(auth(admin))
    const req = queue.body.data.find((r: { name: string }) => r.name === "Kept Student")

    const res = await api().post(`/api/registrations/${req.id}/reject`).set(auth(admin)).send({})
    expect(res.status).toBe(200)
    expect(res.body.data.deleted).toBe(false)
    expect(await prisma.student.findUnique({ where: { id: s.studentId } })).not.toBeNull()
    expect((await api().get("/api/me/dashboard").set(auth(s.token))).status).toBe(200)
  })

  it("enforces capacity", async () => {
    const b = await createBatch(admin, { capacity: 1 })
    await createStudent(admin, b.id)
    const reg = await api().post("/api/auth/register").send({
      name: "Late Comer", email: "late@example.com", phone: "9876543210", className: "Grade 10", password: "Secret123",
    })
    const res = await api().post(`/api/registrations/${reg.body.data.id}/approve`).set(auth(admin)).send({ batchId: b.id })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/full/)
    // The failed approval rolled back completely.
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: reg.body.data.id } })).status).toBe("PENDING")
  })
})

describe("students", () => {
  it("keeps enrollment history when the batch changes", async () => {
    const b1 = await createBatch(admin)
    const b2 = await createBatch(admin, { name: "Grade 10 • Science", fee: 2800 })
    const s = await createStudent(admin, b1.id)

    const res = await api().post(`/api/students/${s.studentId}/batch`).set(auth(admin)).send({ batchId: b2.id, reason: "Timing clash" })
    expect(res.status).toBe(200)
    expect(res.body.data.batch.id).toBe(b2.id)

    const history = await api().get(`/api/students/${s.studentId}/enrollments`).set(auth(admin))
    expect(history.body.data).toHaveLength(2)
    expect(history.body.data[0]).toMatchObject({ active: true, batch: { id: b2.id }, reason: "Timing clash" })
    expect(history.body.data[1]).toMatchObject({ active: false, batch: { id: b1.id } })

    // The student sees their history too.
    const mine = await api().get("/api/me/enrollments").set(auth(s.token))
    expect(mine.body.data).toHaveLength(2)
  })

  it("lists students with their fee standing", async () => {
    const b = await createBatch(admin)
    const s = await createStudent(admin, b.id)
    await api().post("/api/fees/charges/generate").set(auth(admin)).send({ period: currentPeriod() })
    const list = await api().get("/api/students").set(auth(admin))
    expect(list.body.data[0]).toMatchObject({ id: s.studentId, outstanding: 3200, batch: { id: b.id } })
    expect(["DUE", "OVERDUE"]).toContain(list.body.data[0].feeStatus)
    const due = await api().get("/api/students?feeStatus=PAID").set(auth(admin))
    expect(due.body.data).toHaveLength(0)
  })

  it("only deletes students without financial history", async () => {
    const b = await createBatch(admin)
    const withPayments = await createStudent(admin, b.id, "Has Payments")
    await api().post("/api/payments/manual").set(auth(admin)).send({ studentId: withPayments.studentId, amount: 500, method: "Cash" })
    const blocked = await api().delete(`/api/students/${withPayments.studentId}`).set(auth(admin))
    expect(blocked.status).toBe(409)
    expect(blocked.body.message).toMatch(/Deactivate/)

    const clean = await createStudent(admin, b.id, "No Payments")
    expect((await api().delete(`/api/students/${clean.studentId}`).set(auth(admin))).status).toBe(200)
    expect(await prisma.user.findUnique({ where: { email: clean.email } })).toBeNull()
    expect(await prisma.auditLog.findFirst({ where: { action: "STUDENT_DELETED" } })).not.toBeNull()
  })

  it("teacher can add a student directly, who then sets a password from the emailed link", async () => {
    const b = await createBatch(admin)
    const res = await api().post("/api/students").set(auth(admin)).send({
      name: "Meera Iyer", email: "meera@example.com", phone: "9900244776", schoolClass: "Grade 10", batchId: b.id,
      parentName: "Arun Iyer", parentRelation: "Father", parentEmail: "arun@example.com", parentPhone: "9900244777",
    })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ name: "Meera Iyer", batch: { id: b.id }, parent: { name: "Arun Iyer" } })
    // No password yet → cannot log in.
    expect((await api().post("/api/auth/login").send({ email: "meera@example.com", password: "Anything1" })).status).toBe(401)
  })
})

describe("reports", () => {
  it("returns dashboard metrics", async () => {
    const b = await createBatch(admin)
    const s = await createStudent(admin, b.id)
    await api().post("/api/fees/charges/generate").set(auth(admin)).send({ period: currentPeriod() })
    await api().post("/api/payments/manual").set(auth(admin)).send({ studentId: s.studentId, amount: 1600, method: "Cash" })
    const res = await api().get("/api/reports/dashboard").set(auth(admin))
    expect(res.status).toBe(200)
    expect(res.body.data.metrics).toMatchObject({ collectedThisMonth: 1600, outstandingFees: 1600, activeStudents: 1, collectionRate: 50 })
    expect(res.body.data.trend).toHaveLength(6)

    const coll = await api().get("/api/reports/collections").set(auth(admin))
    expect(coll.body.data.byBatch[0]).toMatchObject({ billed: 3200, collected: 1600, collectionRate: 50 })
  })
})
