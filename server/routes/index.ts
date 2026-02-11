import type { Express } from "express";
import type { Server } from "http";
import { authRouter } from "./auth";
import { settingsRouter } from "./settings";
import { profileRouter } from "./profile";
import { registerLegacyRoutes } from "../routes.legacy";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // ─── Health (no auth) ───────────────────────────
  app.get("/health", (_req, res) => {
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || "unknown",
    });
  });

  app.get("/readiness", async (_req, res) => {
    const { storage } = await import("../storage");
    const checks: Record<string, { status: string; latencyMs?: number }> = {};
    try {
      const dbStart = Date.now();
      await storage.getClaims();
      checks.database = { status: "ready", latencyMs: Date.now() - dbStart };
    } catch {
      checks.database = { status: "not_ready" };
    }
    try {
      const { supabase } = await import("../supabase");
      const storageStart = Date.now();
      const { error } = await supabase.storage.listBuckets();
      checks.storage = error ? { status: "not_ready" } : { status: "ready", latencyMs: Date.now() - storageStart };
    } catch {
      checks.storage = { status: "not_ready" };
    }
    checks.openai = process.env.OPENAI_API_KEY ? { status: "configured" } : { status: "not_configured" };
    const allReady = Object.values(checks).every((c) => c.status === "ready" || c.status === "configured");
    res.status(allReady ? 200 : 503).json({
      status: allReady ? "ready" : "not_ready",
      timestamp: new Date().toISOString(),
      checks,
    });
  });

  // ─── Extracted domain routers ────────────────────
  app.use("/api/auth", authRouter());
  app.use("/api/settings", settingsRouter());
  app.use("/api", profileRouter());

  // ─── Legacy routes (to be extracted incrementally) ─
  await registerLegacyRoutes(app);

  return httpServer;
}
