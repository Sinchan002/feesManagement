import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../lib/prisma"
import { optionalText, parse, phoneSchema } from "../../lib/http"
import { badRequest, conflict, forbidden, unauthorized } from "../../lib/errors"
import { sha256 } from "../../lib/crypto"
import { actorFrom, audit } from "../../lib/audit"
import { nextRegistrationCode } from "../../lib/codes"
import { authenticate, authenticateAllowPending } from "../../middleware/auth"
import { loginLimiter, passwordResetLimiter, registrationLimiter } from "../../middleware/rate-limit"
import {
  createSession,
  currentUser,
  emailSchema,
  hashPassword,
  passwordSchema,
  revokeAllSessions,
  sendPasswordTokenMail,
  verifyPassword,
} from "./service"

export const authRouter = Router()

// The frontend form uses `className` / `preferenceNote`; both spellings are accepted.
const registerSchema = z
  .object({
    name: z.string().trim().min(2, "Enter your full name").max(120),
    email: emailSchema,
    phone: phoneSchema,
    schoolClass: z.string().trim().min(1).max(40).optional(),
    className: z.string().trim().min(1).max(40).optional(),
    requestedSubjects: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
    preferredBatchId: z.string().max(64).nullish(),
    notes: optionalText(500),
    preferenceNote: optionalText(500),
    password: passwordSchema,
  })
  .transform(({ className, preferenceNote, ...rest }) => ({
    ...rest,
    schoolClass: rest.schoolClass ?? className,
    notes: rest.notes ?? preferenceNote,
  }))
  .refine((d) => Boolean(d.schoolClass), { message: "Choose a class", path: ["schoolClass"] })

/** Public student registration. Creates a PENDING account + registration request. */
authRouter.post("/register", registrationLimiter, async (req, res) => {
  const input = parse(registerSchema, req.body)

  if (input.preferredBatchId) {
    const batch = await prisma.batch.findUnique({ where: { id: input.preferredBatchId } })
    if (!batch || batch.status !== "ACTIVE") throw badRequest("The preferred batch is not available.")
  }

  const existing = await prisma.user.findUnique({ where: { email: input.email } })
  if (existing && existing.status !== "REJECTED") {
    if (existing.status === "PENDING")
      throw conflict("A registration with this email is already awaiting review.")
    throw conflict("An account with this email already exists. Please sign in instead.")
  }

  const passwordHash = await hashPassword(input.password)
  const registration = await prisma.$transaction(async (tx) => {
    // A previously rejected applicant may apply again with the same email.
    const user = existing
      ? await tx.user.update({
          where: { id: existing.id },
          data: { name: input.name, phone: input.phone, passwordHash, status: "PENDING" },
        })
      : await tx.user.create({
          data: {
            email: input.email,
            name: input.name,
            phone: input.phone,
            passwordHash,
            role: "STUDENT",
            status: "PENDING",
          },
        })
    const reg = await tx.registration.create({
      data: {
        code: await nextRegistrationCode(tx),
        userId: user.id,
        name: input.name,
        email: input.email,
        phone: input.phone,
        schoolClass: input.schoolClass!,
        requestedSubjects: input.requestedSubjects,
        preferredBatchId: input.preferredBatchId ?? null,
        notes: input.notes,
      },
    })
    await audit(
      { id: user.id, role: "STUDENT", ip: req.ip },
      {
        action: "REGISTRATION_SUBMITTED",
        entityType: "Registration",
        entityId: reg.id,
        summary: `${input.name} submitted a registration for ${input.schoolClass}`,
      },
      tx,
    )
    return reg
  })

  res.status(201).json({
    data: { id: registration.id, code: registration.code, status: registration.status },
    message: "Registration received. Your teacher will review it and allocate a batch.",
  })
})

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password").max(200),
  remember: z.boolean().optional().default(false),
})

authRouter.post("/login", loginLimiter, async (req, res) => {
  const { email, password, remember } = parse(loginSchema, req.body)
  const user = await prisma.user.findUnique({ where: { email }, include: { student: true } })

  if (!(await verifyPassword(user, password)) || !user) {
    throw unauthorized("Incorrect email or password.")
  }
  // Status is only revealed after the password is proven, to avoid account enumeration.
  // PENDING applicants may sign in, but their session only reaches /auth/me and logout.
  if (user.status === "REJECTED") throw forbidden("Your registration was not approved. Please contact the academy.")
  if (
    user.status === "DEACTIVATED" ||
    (user.status === "ACTIVE" && user.role === "STUDENT" && user.student?.status !== "ACTIVE")
  ) {
    throw forbidden("Your account has been deactivated. Please contact your teacher.")
  }

  const session = await createSession(user.id, { remember, ip: req.ip, userAgent: req.get("user-agent") })
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  await audit(
    { id: user.id, role: user.role, ip: req.ip },
    { action: "LOGIN", entityType: "User", entityId: user.id, summary: `${user.name} signed in` },
  )
  res.json({ data: { token: session.token, expiresAt: session.expiresAt, user: await currentUser(user.id) } })
})

authRouter.post("/logout", authenticateAllowPending, async (req, res) => {
  await prisma.session.update({ where: { id: req.auth!.sessionId }, data: { revokedAt: new Date() } })
  res.json({ data: { success: true } })
})

/** Sign out of every device. */
authRouter.post("/logout-all", authenticateAllowPending, async (req, res) => {
  await revokeAllSessions(req.auth!.userId)
  res.json({ data: { success: true } })
})

authRouter.get("/me", authenticateAllowPending, async (req, res) => {
  res.json({ data: await currentUser(req.auth!.userId) })
})

const forgotSchema = z.object({ email: emailSchema })

/** Always responds the same way so it cannot be used to discover registered emails. */
authRouter.post("/forgot-password", passwordResetLimiter, async (req, res) => {
  const { email } = parse(forgotSchema, req.body)
  const user = await prisma.user.findUnique({ where: { email } })
  if (user && (user.status === "ACTIVE" || user.status === "PENDING")) {
    await sendPasswordTokenMail(user, "RESET")
    await audit(
      { id: user.id, role: user.role, ip: req.ip },
      { action: "PASSWORD_RESET_REQUESTED", entityType: "User", entityId: user.id, summary: `Password reset requested for ${user.email}` },
    )
  }
  res.json({ data: { success: true }, message: "If that email is registered, a reset link has been sent." })
})

const resetSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
})

authRouter.post("/reset-password", passwordResetLimiter, async (req, res) => {
  const { token, password } = parse(resetSchema, req.body)
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  })
  if (!record || record.usedAt || record.expiresAt <= new Date() || !["ACTIVE", "PENDING"].includes(record.user.status)) {
    throw badRequest("This reset link is invalid or has expired. Please request a new one.")
  }
  const passwordHash = await hashPassword(password)
  await prisma.$transaction(async (tx) => {
    // Conditional update makes the token strictly single-use under concurrency.
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    })
    if (claimed.count === 0) throw badRequest("This reset link has already been used.")
    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash, passwordChangedAt: new Date() },
    })
    await revokeAllSessions(record.userId, tx)
    await audit(
      { id: record.userId, role: record.user.role, ip: req.ip },
      { action: "PASSWORD_RESET", entityType: "User", entityId: record.userId, summary: `Password ${record.purpose === "RESET" ? "reset" : "set"} for ${record.user.email}` },
      tx,
    )
  })
  res.json({ data: { success: true }, message: "Your password has been updated. Please sign in." })
})

const changeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
})

authRouter.post("/change-password", authenticate, async (req, res) => {
  const { currentPassword, newPassword } = parse(changeSchema, req.body)
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } })
  if (!(await verifyPassword(user, currentPassword))) throw badRequest("Your current password is incorrect.")
  if (currentPassword === newPassword) throw badRequest("Choose a password you have not just used.")

  const passwordHash = await hashPassword(newPassword)
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt: new Date() } })
    await revokeAllSessions(user.id, tx, req.auth!.sessionId) // keep this device signed in
    await audit(actorFrom(req), { action: "PASSWORD_CHANGED", entityType: "User", entityId: user.id, summary: `${user.name} changed their password` }, tx)
  })
  res.json({ data: { success: true } })
})
