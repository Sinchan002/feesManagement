import { beforeEach, describe, expect, it } from "vitest"
import { currentPeriod } from "../src/lib/dates"
import { ADMIN, api, auth, createAdmin, createBatch, createStudent, login, prisma, resetDb, sentMail } from "./helpers"

let admin: string
let batchId: string

beforeEach(async () => {
  await resetDb()
  admin = await createAdmin()
  batchId = (await createBatch(admin)).id
})

describe("registration and approval", () => {
  it("lets a pending applicant sign in but blocks all access until approved", async () => {
    const reg = await api().post("/api/auth/register").send({
      name: "Rohan Joshi",
      email: "Rohan.J@Example.com",
      phone: "+91 98765 43210",
      className: "Grade 10",
      requestedSubjects: ["Mathematics"],
      preferredBatchId: batchId,
      password: "Secret123",
      preferenceNote: "Weekday evening batch please",
    })
    expect(reg.status).toBe(201)
    expect(reg.body.data.status).toBe("PENDING")

    const pendingLogin = await api().post("/api/auth/login").send({ email: "rohan.j@example.com", password: "Secret123" })
    expect(pendingLogin.status).toBe(200)
    expect(pendingLogin.body.data.user).toMatchObject({ status: "PENDING", redirectTo: "/pending", student: null })
    expect(pendingLogin.body.data.user.registration).toMatchObject({ schoolClass: "Grade 10", preferredBatch: "Grade 10 • Mathematics" })
    const pendingToken = pendingLogin.body.data.token as string

    // Only status + logout work while pending.
    expect((await api().get("/api/auth/me").set(auth(pendingToken))).status).toBe(200)
    for (const path of ["/api/me/dashboard", "/api/me/charges", "/api/payments/online/config", "/api/students"]) {
      const blocked = await api().get(path).set(auth(pendingToken))
      expect(blocked.status, path).toBe(403)
      expect(blocked.body.code, path).toBe("APPROVAL_PENDING")
    }

    const list = await api().get("/api/registrations").set(auth(admin))
    expect(list.body.data).toHaveLength(1)
    expect(list.body.data[0]).toMatchObject({ email: "rohan.j@example.com", schoolClass: "Grade 10", requestedSubjects: ["Mathematics"] })

    const approved = await api().post(`/api/registrations/${reg.body.data.id}/approve`).set(auth(admin)).send({ batchId })
    expect(approved.status).toBe(200)
    expect(approved.body.data.status).toBe("APPROVED")

    // Approving twice is rejected.
    const again = await api().post(`/api/registrations/${reg.body.data.id}/approve`).set(auth(admin)).send({ batchId })
    expect(again.status).toBe(409)

    // The session opened while pending now has full student access.
    const me = await api().get("/api/auth/me").set(auth(pendingToken))
    expect(me.body.data).toMatchObject({ role: "STUDENT", status: "ACTIVE", redirectTo: "/student", registration: null })
    expect(me.body.data.student.batch.id).toBe(batchId)
    expect((await api().get("/api/me/dashboard").set(auth(pendingToken))).status).toBe(200)
  })

  it("declining permanently deletes the applicant's account and data", async () => {
    const reg = await api().post("/api/auth/register").send({
      name: "Sara Khan", email: "sara@example.com", phone: "9876543210", className: "Grade 12", password: "Secret123",
    })
    const pendingToken = await login("sara@example.com", "Secret123")

    const res = await api().post(`/api/registrations/${reg.body.data.id}/reject`).set(auth(admin)).send({ reason: "Batch full" })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ deleted: true })

    expect(await prisma.user.findUnique({ where: { email: "sara@example.com" } })).toBeNull()
    expect(await prisma.registration.count()).toBe(0)
    expect(await prisma.auditLog.count({ where: { summary: { contains: "Sara" } } })).toBe(0)
    expect(await prisma.auditLog.count({ where: { action: "REGISTRATION_DECLINED" } })).toBe(1)
    expect(sentMail.some((m) => m.to === "sara@example.com" && m.text.includes("Batch full"))).toBe(true)

    // The open session is gone and the account no longer exists.
    expect((await api().get("/api/auth/me").set(auth(pendingToken))).status).toBe(401)
    expect((await api().post("/api/auth/login").send({ email: "sara@example.com", password: "Secret123" })).status).toBe(401)
    // Declining twice → 404; the person may register again.
    expect((await api().post(`/api/registrations/${reg.body.data.id}/reject`).set(auth(admin)).send({})).status).toBe(404)
    const again = await api().post("/api/auth/register").send({
      name: "Sara Khan", email: "sara@example.com", phone: "9876543210", className: "Grade 12", password: "Secret123",
    })
    expect(again.status).toBe(201)
  })

  it("does not reveal account status to someone without the password", async () => {
    await api().post("/api/auth/register").send({
      name: "Sara Khan", email: "sara@example.com", phone: "9876543210", className: "Grade 12", password: "Secret123",
    })
    const res = await api().post("/api/auth/login").send({ email: "sara@example.com", password: "wrong-password1" })
    expect(res.status).toBe(401)
    expect(res.body.message).toBe("Incorrect email or password.")
  })
})

describe("authorization", () => {
  it("rejects missing or invalid tokens", async () => {
    expect((await api().get("/api/students")).status).toBe(401)
    expect((await api().get("/api/students").set(auth("not-a-real-token"))).status).toBe(401)
  })

  it("enforces roles server-side", async () => {
    const student = await createStudent(admin, batchId)
    for (const path of ["/api/students", "/api/registrations", "/api/batches", "/api/payments", "/api/reports/dashboard", "/api/audit-logs", "/api/settings"]) {
      expect((await api().get(path).set(auth(student.token))).status, path).toBe(403)
    }
    expect((await api().post("/api/payments/manual").set(auth(student.token)).send({})).status).toBe(403)
    expect((await api().get("/api/me/dashboard").set(auth(admin))).status).toBe(403)
    expect((await api().get("/api/me/dashboard").set(auth(student.token))).status).toBe(200)
  })

  it("prevents a student from reading another student's records", async () => {
    const a = await createStudent(admin, batchId, "Student A")
    const b = await createStudent(admin, batchId, "Student B")
    await api().post("/api/fees/charges/generate").set(auth(admin)).send({ period: currentPeriod() })
    const pay = await api().post("/api/payments/manual").set(auth(admin)).send({ studentId: b.studentId, amount: 3200, method: "Cash" })
    const bCharge = await prisma.feeCharge.findFirstOrThrow({ where: { studentId: b.studentId } })

    expect((await api().get(`/api/payments/${pay.body.data.id}`).set(auth(a.token))).status).toBe(404)
    expect((await api().get(`/api/payments/${pay.body.data.id}/receipt.pdf`).set(auth(a.token))).status).toBe(404)
    expect((await api().get(`/api/fees/charges/${bCharge.id}`).set(auth(a.token))).status).toBe(404)
    // …but the owner can.
    expect((await api().get(`/api/payments/${pay.body.data.id}/receipt`).set(auth(b.token))).status).toBe(200)
    // Online orders can only include the student's own charges.
    const order = await api().post("/api/payments/online/orders").set(auth(a.token)).send({ chargeIds: [bCharge.id] })
    expect(order.status).toBe(400)
  })
})

describe("sessions and passwords", () => {
  it("logout revokes the token", async () => {
    const token = await login(ADMIN.email, ADMIN.password)
    expect((await api().post("/api/auth/logout").set(auth(token))).status).toBe(200)
    expect((await api().get("/api/auth/me").set(auth(token))).status).toBe(401)
  })

  it("deactivation blocks the student immediately, reactivation restores access", async () => {
    const s = await createStudent(admin, batchId)
    const off = await api().patch(`/api/students/${s.studentId}/status`).set(auth(admin)).send({ status: "INACTIVE", reason: "Left" })
    expect(off.status).toBe(200)
    expect((await api().get("/api/me/dashboard").set(auth(s.token))).status).toBe(401)
    expect((await api().post("/api/auth/login").send({ email: s.email, password: s.password })).status).toBe(403)

    await api().patch(`/api/students/${s.studentId}/status`).set(auth(admin)).send({ status: "ACTIVE" })
    expect(await login(s.email, s.password)).toBeTruthy()
  })

  it("resets a password with a single-use emailed token and revokes sessions", async () => {
    const s = await createStudent(admin, batchId)
    const forgot = await api().post("/api/auth/forgot-password").send({ email: s.email })
    expect(forgot.status).toBe(200)
    // Same response for unknown emails.
    const unknown = await api().post("/api/auth/forgot-password").send({ email: "nobody@example.com" })
    expect(unknown.body).toEqual(forgot.body)

    const mail = sentMail.find((m) => m.to === s.email && m.subject.includes("Reset"))!
    const token = decodeURIComponent(/token=([^\s]+)/.exec(mail.text)![1]!)

    expect((await api().post("/api/auth/reset-password").send({ token, password: "short" })).status).toBe(400)
    expect((await api().post("/api/auth/reset-password").send({ token, password: "NewPassword9" })).status).toBe(200)
    expect((await api().post("/api/auth/reset-password").send({ token, password: "Another99x" })).status).toBe(400)

    expect((await api().get("/api/auth/me").set(auth(s.token))).status).toBe(401)
    expect(await login(s.email, "NewPassword9")).toBeTruthy()
  })

  it("changes password while keeping the current session", async () => {
    const s = await createStudent(admin, batchId)
    const other = await login(s.email, s.password)
    const res = await api().post("/api/auth/change-password").set(auth(s.token)).send({ currentPassword: s.password, newPassword: "Changed123" })
    expect(res.status).toBe(200)
    expect((await api().get("/api/auth/me").set(auth(s.token))).status).toBe(200)
    expect((await api().get("/api/auth/me").set(auth(other))).status).toBe(401)
  })
})
