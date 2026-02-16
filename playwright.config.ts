import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.SKIP_WEB_SERVER
    ? undefined
    : process.env.CI
      ? {
          command: "npm run build && npm run start",
          url: baseURL,
          reuseExistingServer: false,
          timeout: 120_000,
        }
      : {
          command: "npm run dev",
          url: baseURL,
          reuseExistingServer: true,
          timeout: 30_000,
        },
});
