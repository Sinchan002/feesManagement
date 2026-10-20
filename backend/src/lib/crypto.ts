import crypto from "node:crypto"

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url")
export const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex")
export const hmacSha256Hex = (secret: string, payload: string | Buffer) =>
  crypto.createHmac("sha256", secret).update(payload).digest("hex")

/** Constant-time comparison of two strings. */
export const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}
