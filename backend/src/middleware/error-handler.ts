import type { NextFunction, Request, Response } from "express"
import { Prisma } from "@prisma/client"
import { ApiError } from "../lib/errors"
import { isProduction } from "../config/env"

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ message: `Route ${req.method} ${req.path} not found.`, code: "NOT_FOUND" })
}

// Express identifies error handlers by arity, so `_next` must stay.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    res.status(err.status).json({ message: err.message, code: err.code, details: err.details })
    return
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      res.status(409).json({ message: "A record with these details already exists.", code: "CONFLICT" })
      return
    }
    if (err.code === "P2025") {
      res.status(404).json({ message: "Record not found.", code: "NOT_FOUND" })
      return
    }
    if (err.code === "P2034") {
      res.status(409).json({ message: "The record was changed by another request. Please retry.", code: "RETRY" })
      return
    }
  }
  const e = err as { type?: string; status?: number }
  if (e?.type === "entity.parse.failed") {
    res.status(400).json({ message: "Malformed JSON body.", code: "BAD_REQUEST" })
    return
  }
  if (e?.type === "entity.too.large") {
    res.status(413).json({ message: "Request body is too large.", code: "TOO_LARGE" })
    return
  }

  console.error(`[error] ${req.method} ${req.originalUrl}`, err)
  res.status(500).json({
    message: "Something went wrong. Please try again.",
    code: "INTERNAL",
    ...(isProduction ? {} : { debug: (err as Error)?.message }),
  })
}
