import { test, expect } from "@playwright/test";

/**
 * E2E smoke tests.
 * Run with: npm run test:e2e
 * With server already running: SKIP_WEB_SERVER=1 npm run test:e2e
 *
 * API tests use request (no browser). Browser tests require Chromium (libglib, etc).
 * In minimal CI environments, only API tests may run; browser tests are skipped if Chromium fails.
 */
test.describe("Smoke tests", () => {
  test("health endpoint returns 200", async ({ request }) => {
    const res = await request.get("/health");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty("status", "healthy");
    expect(body).toHaveProperty("timestamp");
  });

  test("readiness endpoint returns 200 or 503", async ({ request }) => {
    const res = await request.get("/readiness");
    // 200 when ready, 503 when not (e.g. missing DB)
    expect([200, 503]).toContain(res.status());
    const body = await res.json();
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("checks");
  });

  test("api-docs returns 200", async ({ request }) => {
    const res = await request.get("/api-docs/");
    expect(res.ok()).toBeTruthy();
  });

  test("app root returns 200", async ({ request }) => {
    const res = await request.get("/");
    expect(res?.status()).toBeLessThan(400);
  });
});
