import bcrypt from "bcryptjs"
import { z } from "zod"
import type { User } from "@prisma/client"
import { prisma, type Db } from "../../lib/prisma"
import { randomToken, sha256 } from "../../lib/crypto"
import { env } from "../../config/env"
import { sendMail } from "../../lib/mailer"

const BCRYPT_COST = 12
// Used to keep login timing uniform when the email does not exist.
const DUMMY_HASH = bcrypt.hashSync("timing-equaliser-not-a-password", BCRYPT_COST)

export const passwordSchema = z
  .string()
  .min(8, "Password must contain at least 8 characters")
  .max(72, "Password must be at most 72 characters")
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "Use at least one letter and one number")

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email").max(254))

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_COST)

export async function verifyPassword(user: Pick<User, "passwordHash"> | null, password: string) {
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH)
  return Boolean(user?.passwordHash) && ok
}

export async function createSession(
  userId: string,
  opts: { remember?: boolean; ip?: string | null; userAgent?: string | null },
) {
  const token = randomToken()
  const ttlMs = opts.remember
    ? env.SESSION_REMEMBER_TTL_DAYS * 24 * 3600 * 1000
    : env.SESSION_TTL_HOURS * 3600 * 1000
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + ttlMs),
      ip: opts.ip ?? null,
      userAgent: opts.userAgent?.slice(0, 300) ?? null,
    },
  })
  return { token, expiresAt: session.expiresAt }
}

export async function revokeAllSessions(userId: string, db: Db = prisma, exceptSessionId?: string) {
  await db.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  })
}

/**
 * Issues a single-use password token and emails the link. RESET tokens are short-lived;
 * SET_PASSWORD tokens (accounts the teacher creates) last 3 days.
 */
export async function issuePasswordToken(
  user: Pick<User, "id" | "email" | "name">,
  purpose: "RESET" | "SET_PASSWORD",
  db: Db = prisma,
) {
  const token = randomToken()
  const ttlMinutes = purpose === "RESET" ? env.PASSWORD_RESET_TTL_MINUTES : 3 * 24 * 60
  // Only the newest link works.
  await db.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  })
  await db.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(token),
      purpose,
      expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
    },
  })
  const link = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`
  const subject =
    purpose === "RESET" ? "Reset your password" : "Set up your SriKrishna Physics Academy account"
  const intro =
    purpose === "RESET"
      ? "We received a request to reset your password."
      : "Your teacher has created a student account for you."
  return {
    token,
    mail: {
      to: user.email,
      subject,
      text: `Hello ${user.name},\n\n${intro}\nUse this link to choose a password (valid for ${
        ttlMinutes >= 120 ? `${Math.round(ttlMinutes / 60)} hours` : `${ttlMinutes} minutes`
      }):\n\n${link}\n\nIf you did not expect this email, you can ignore it.`,
    },
  }
}

export async function sendPasswordTokenMail(
  user: Pick<User, "id" | "email" | "name">,
  purpose: "RESET" | "SET_PASSWORD",
) {
  const { mail } = await issuePasswordToken(user, purpose)
  await sendMail(mail)
}

/** Shape of `GET /auth/me` and the login response's `user`. */
export async function currentUser(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      student: {
        include: {
          enrollments: { where: { endedAt: null }, include: { batch: true }, take: 1 },
        },
      },
    },
  })
  const student = user.student
  const batch = student?.enrollments[0]?.batch
  const pending = user.status === "PENDING"
  const registration = pending
    ? await prisma.registration.findFirst({
        where: { userId, status: "PENDING" },
        include: { preferredBatch: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      })
    : null
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    role: user.role,
    status: user.status,
    lastLoginAt: user.lastLoginAt,
    redirectTo: user.role === "ADMIN" ? "/admin" : pending ? "/pending" : "/student",
    registration: registration
      ? {
          code: registration.code,
          schoolClass: registration.schoolClass,
          requestedSubjects: registration.requestedSubjects,
          preferredBatch: registration.preferredBatch?.name ?? null,
          notes: registration.notes,
          submittedAt: registration.createdAt,
        }
      : null,
    student: student
      ? {
          id: student.id,
          code: student.code,
          schoolClass: student.schoolClass,
          status: student.status,
          batch: batch ? { id: batch.id, code: batch.code, name: batch.name } : null,
        }
      : null,
  }
}
