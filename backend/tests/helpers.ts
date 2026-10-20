import request from "supertest"
import bcrypt from "bcryptjs"
import { createApp } from "../src/app"
import { prisma } from "../src/lib/prisma"
import { sentMail } from "../src/lib/mailer"

export const app = createApp()
export const api = () => request(app)

export const ADMIN = { email: "teacher@example.com", password: "Teacher123" }

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`,
  )
  sentMail.length = 0
}

export async function createAdmin() {
  await prisma.user.create({
    data: {
      email: ADMIN.email,
      name: "Test Teacher",
      role: "ADMIN",
      status: "ACTIVE",
      passwordHash: await bcrypt.hash(ADMIN.password, 4),
    },
  })
  return login(ADMIN.email, ADMIN.password)
}

export async function login(email: string, password: string) {
  const res = await api().post("/api/auth/login").send({ email, password })
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`)
  return res.body.data.token as string
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

export async function createBatch(adminToken: string, overrides: Record<string, unknown> = {}) {
  const res = await api()
    .post("/api/batches")
    .set(auth(adminToken))
    .send({
      name: "Grade 10 • Mathematics",
      classLevel: "Grade 10",
      subjects: ["Mathematics"],
      schedule: "Mon, Wed, Fri",
      time: "5:00 PM",
      capacity: 30,
      fee: 3200,
      status: "Active",
      ...overrides,
    })
  if (res.status !== 201) throw new Error(`createBatch ${res.status} ${JSON.stringify(res.body)}`)
  return res.body.data as { id: string; monthlyFee: number }
}

let counter = 0
/** Register through the public endpoint, approve as admin, and sign in as the student. */
export async function createStudent(adminToken: string, batchId: string, name = "Aarav Sharma") {
  counter += 1
  const email = `student${counter}@example.com`
  const password = "Student123"
  const reg = await api()
    .post("/api/auth/register")
    .send({
      name,
      email,
      phone: "+91 98765 43210",
      className: "Grade 10",
      password,
      preferenceNote: "Weekday evenings after 5 PM please",
    })
  if (reg.status !== 201) throw new Error(`register ${reg.status} ${JSON.stringify(reg.body)}`)
  const approve = await api()
    .post(`/api/registrations/${reg.body.data.id}/approve`)
    .set(auth(adminToken))
    .send({ batchId })
  if (approve.status !== 200) throw new Error(`approve ${approve.status} ${JSON.stringify(approve.body)}`)
  const token = await login(email, password)
  const me = await api().get("/api/auth/me").set(auth(token))
  return { token, email, password, studentId: me.body.data.student.id as string, userId: me.body.data.id as string }
}

export { prisma, sentMail }
