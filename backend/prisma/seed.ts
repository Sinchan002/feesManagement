/**
 * Seeds the teacher/admin account from ADMIN_EMAIL / ADMIN_PASSWORD:  npm run db:seed
 *
 * No batches or students are seeded. The teacher creates batches in the admin workspace, and
 * those are what the landing page and the registration form show.
 */
import "dotenv/config"
import bcrypt from "bcryptjs"
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD ?? ""
  const name = process.env.ADMIN_NAME ?? "Teacher"
  if (!email || password.length < 8) {
    throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD (min 8 characters) in .env before seeding.")
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    if (existing.role !== "ADMIN") throw new Error(`${email} already exists as a ${existing.role} account.`)
    console.info(`Admin ${email} already exists — leaving the password unchanged.`)
    return
  }
  await prisma.user.create({
    data: {
      email,
      name,
      role: "ADMIN",
      status: "ACTIVE",
      passwordHash: await bcrypt.hash(password, 12),
      passwordChangedAt: new Date(),
    },
  })
  console.info(`Created admin ${email}.`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
