import type { Express } from "express";
import type { Server } from "http";
import { authRouter } from "./auth";
import { settingsRouter } from "./settings";
import { profileRouter } from "./profile";
import { adminRouter } from "./admin";
import { claimsRouter } from "./claims";
import { documentsRouter } from "./documents";
import { flowsRouter } from "./flows";
import { pricingRouter } from "./pricing";
import { supplementalRouter } from "./supplemental";
import { notificationsRouter } from "./notifications";
import { realtimeRouter } from "./realtime";
import { logsRouter } from "./logs";
import { galleryRouter } from "./gallery";
import { photolabRouter } from "./photolab";
import { registerInspectionRoutes } from "./inspection";

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

  app.get("/api/config", (_req, res) => {
    res.json({
      supabaseUrl: process.env.SUPABASE_URL || "",
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
    });
  });

  // ─── Extracted domain routers ────────────────────
  app.use("/api/auth", authRouter());
  app.use("/api/settings", settingsRouter());
  app.use("/api", profileRouter());
  app.use("/api/admin", adminRouter());
  app.use("/api/claims", claimsRouter());
  app.use("/api/documents", documentsRouter());
  app.use("/api/flows", flowsRouter());
  app.use("/api/pricing", pricingRouter());
  app.use("/api/supplemental/:id", supplementalRouter());
  app.use("/api/notifications", notificationsRouter());
  app.use("/api/realtime", realtimeRouter());
  app.use("/api/logs", logsRouter());
  app.use("/api/gallery", galleryRouter());
  app.use("/api/photolab", photolabRouter());

  // ─── Inspection routes (sessions, rooms, scope, photos, export, etc.) ─
  await registerInspectionRoutes(app);

  return httpServer;
}
