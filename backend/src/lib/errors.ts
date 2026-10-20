export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "ERROR",
    public details?: unknown,
  ) {
    super(message)
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, message, "BAD_REQUEST", details)
export const unauthorized = (message = "Please sign in to continue.") =>
  new ApiError(401, message, "UNAUTHENTICATED")
export const forbidden = (message = "You do not have permission to do that.") =>
  new ApiError(403, message, "FORBIDDEN")
export const notFound = (what = "Resource") => new ApiError(404, `${what} not found.`, "NOT_FOUND")
export const conflict = (message: string, details?: unknown) =>
  new ApiError(409, message, "CONFLICT", details)
