import type { NextFunction, Request, Response } from "express"
import type { AccountStatus, Role } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { sha256 } from "../lib/crypto"
import { ApiError, forbidden, notFound, unauthorized } from "../lib/errors"

export type AuthContext = {
  userId: string
  sessionId: string
  role: Role
  status: AccountStatus
  studentId: string | null
  email: string
  name: string
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext
    }
  }
}

const TOUCH_INTERVAL_MS = 5 * 60 * 1000

export const bearerToken = (req: Request) => {
  const header = req.get("authorization") ?? ""
  const [scheme, token] = header.split(" ")
  return scheme?.toLowerCase() === "bearer" && token ? token.trim() : null
}

/**
 * Resolves the bearer token to a live session. The account status is re-checked on every
 * request, so deactivating a user takes effect immediately even for existing tokens.
 *
 * Students awaiting approval (PENDING) may sign in, but only routes that opt in with
 * `authenticateAllowPending` (status + logout) accept them; everything else answers
 * 403 APPROVAL_PENDING.
 */
async function resolveSession(req: Request, allowPending: boolean) {
  const token = bearerToken(req)
  if (!token) throw unauthorized()

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { student: { select: { id: true, status: true } } } } },
  })
  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    throw unauthorized("Your session has expired. Please sign in again.")
  }
  const { user } = session
  if (user.status === "PENDING" && user.role === "STUDENT") {
    if (!allowPending) {
      throw new ApiError(403, "Your registration is awaiting teacher approval.", "APPROVAL_PENDING")
    }
  } else if (user.status !== "ACTIVE") {
    await prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    throw unauthorized("Your account is not active. Please contact your teacher.")
  }
  if (
    user.status === "ACTIVE" &&
    user.role === "STUDENT" &&
    (!user.student || user.student.status !== "ACTIVE")
  ) {
    throw unauthorized("Your student account is not active. Please contact your teacher.")
  }

  if (Date.now() - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
  }

  req.auth = {
    userId: user.id,
    sessionId: session.id,
    role: user.role,
    status: user.status,
    // A pending applicant has no student profile yet, so student-scoped access is impossible.
    studentId: user.status === "ACTIVE" ? (user.student?.id ?? null) : null,
    email: user.email,
    name: user.name,
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  await resolveSession(req, false)
  next()
}

/** Only for /auth/me and logout: lets a pending applicant see their status and sign out. */
export async function authenticateAllowPending(req: Request, _res: Response, next: NextFunction) {
  await resolveSession(req, true)
  next()
}

/** Role-based authorization. Must run after `authenticate`. */
export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw unauthorized()
    if (!roles.includes(req.auth.role)) throw forbidden()
    next()
  }

export const requireAdmin = requireRole("ADMIN")
export const requireStudent = requireRole("STUDENT")

export const isAdmin = (req: Request) => req.auth?.role === "ADMIN"

/**
 * Resource-level access check: admins may access any student's data; a student may only
 * access their own. Responds 404 (not 403) to avoid leaking which ids exist.
 */
export function assertCanAccessStudent(req: Request, studentId: string, what = "Resource") {
  if (!req.auth) throw unauthorized()
  if (req.auth.role === "ADMIN") return
  if (req.auth.role === "STUDENT" && req.auth.studentId === studentId) return
  throw notFound(what)
}

/** The current user's student id, for student-only routes. */
export function ownStudentId(req: Request) {
  if (!req.auth?.studentId) throw forbidden("Only students can do that.")
  return req.auth.studentId
}
