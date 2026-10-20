import { defineConfig } from "vitest/config"

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://tuition:tuition@localhost:5433/tuition_test?schema=public"

export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DATABASE_URL,
      PAYMENT_PROVIDER: "mock",
      MOCK_PAYMENT_SECRET: "test-mock-secret",
      SCHEDULER_ENABLED: "false",
      SMTP_HOST: "",
      APP_URL: "http://localhost:8443",
    },
    globalSetup: "./tests/global-setup.ts",
    setupFiles: ["./tests/setup-clock.ts"],
    fileParallelism: false, // tests share one database
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
})
