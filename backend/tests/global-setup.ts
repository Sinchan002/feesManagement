import { execSync } from "node:child_process"
import { TEST_DATABASE_URL } from "../vitest.config"

/**
 * Bring the dedicated test database up to the latest migration (non-destructive).
 * Individual tests truncate tables via `resetDb()`.
 */
export default function setup() {
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  })
}
