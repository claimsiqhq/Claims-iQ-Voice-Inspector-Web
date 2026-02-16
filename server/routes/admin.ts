import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { storage } from "../storage";
import { db } from "../db";
import { lineItems, damageObservations } from "@shared/schema";
import { authenticateRequest, requireRole } from "../auth";
import { logger } from "../logger";

export function adminRouter(): Router {
  const router = Router();

  router.get("/users", authenticateRequest, requireRole("supervisor", "admin"), async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const allClaims = await storage.getClaims();
      const activeClaimCounts = new Map<string, number>();
      for (const claim of allClaims) {
        if (claim.assignedTo && claim.status !== "completed" && claim.status !== "closed") {
          activeClaimCounts.set(claim.assignedTo, (activeClaimCounts.get(claim.assignedTo) || 0) + 1);
        }
      }
      const teamMembers = allUsers
        .filter((u) => u.role === "adjuster" || u.role === "supervisor")
        .map((u) => ({
          id: u.id,
          fullName: u.fullName || u.username,
          email: u.email,
          role: u.role,
          activeClaims: activeClaimCounts.get(u.id) || 0,
        }));
      res.json(teamMembers);
    } catch (error: unknown) {
      logger.apiError(req.method, req.path, error as Error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.post("/claims/assign", authenticateRequest, requireRole("supervisor", "admin"), async (req, res) => {
    try {
      const { claimId, userId } = req.body;
      if (!claimId || !userId) {
        return res.status(400).json({ message: "claimId and userId required" });
      }
      const claim = await storage.updateClaimFields(claimId, { assignedTo: userId });
      res.json(claim);
    } catch (error: unknown) {
      logger.apiError(req.method, req.path, error as Error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.get("/dashboard", authenticateRequest, requireRole("supervisor", "admin"), async (req, res) => {
    try {
      const allClaims = await storage.getClaims();
      const sessions = await Promise.all(
        allClaims.map((c) => storage.getActiveSessionForClaim(c.id))
      );
      const activeSessions = sessions.filter((s) => s !== undefined).length;

      let totalEstimateValue = 0;
      const completedSessions = sessions.filter(Boolean);
      for (const session of completedSessions) {
        if (session) {
          const summary = await storage.getEstimateSummary(session.id);
          totalEstimateValue += summary.totalRCV;
        }
      }

      let avgInspectionTime = 0;
      const completedWithTimes = completedSessions.filter(
        (s) => s && s.completedAt && s.startedAt
      );
      if (completedWithTimes.length > 0) {
        const totalMinutes = completedWithTimes.reduce((sum, s) => {
          const start = new Date(s!.startedAt!).getTime();
          const end = new Date(s!.completedAt!).getTime();
          return sum + (end - start) / 60000;
        }, 0);
        avgInspectionTime = Math.round(totalMinutes / completedWithTimes.length);
      }

      const autoScopeRows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(lineItems)
        .where(eq(lineItems.provenance, "auto_scope"));
      const damageRows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(damageObservations);
      const catalogMatchRows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(lineItems)
        .where(sql`${lineItems.xactCode} IS NOT NULL AND ${lineItems.xactCode} != ''`);
      const totalLineRows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(lineItems);

      const autoScopeCount = autoScopeRows[0]?.count ?? 0;
      const damageCount = damageRows[0]?.count ?? 0;
      const catalogMatchCount = catalogMatchRows[0]?.count ?? 0;
      const totalLineCount = totalLineRows[0]?.count ?? 1;

      let avgCompletenessScore = 0;
      const activeSessionList = sessions.filter((s) => s !== undefined).map((s) => s!);
      if (activeSessionList.length > 0) {
        const scores = await Promise.all(
          activeSessionList.map(async (session) => {
            const rooms = await storage.getRooms(session.id);
            const items = await storage.getLineItems(session.id);
            const photos = await storage.getPhotos(session.id);
            const damages = await storage.getDamagesForSession(session.id);
            const overviewCount = photos.filter((p: { photoType?: string }) => p.photoType === "overview").length;
            let passed = 0;
            if (overviewCount >= 4) passed++;
            if (rooms.length > 0) passed++;
            if (damages.length > 0) passed++;
            if (items.length > 0) passed++;
            return Math.round((passed / 4) * 100);
          })
        );
        avgCompletenessScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      }

      res.json({
        totalClaims: allClaims.length,
        activeSessions,
        avgInspectionTime,
        totalEstimateValue,
        autoScopeItemsCreated: autoScopeCount,
        avgAutoScopePerDamage: damageCount > 0 ? autoScopeCount / damageCount : 0,
        catalogMatchRate: totalLineCount > 0 ? (catalogMatchCount / totalLineCount) * 100 : 0,
        avgCompletenessScore: Math.round(avgCompletenessScore),
      });
    } catch (error: unknown) {
      logger.apiError(req.method, req.path, error as Error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.get("/active-sessions", authenticateRequest, requireRole("supervisor", "admin"), async (req, res) => {
    try {
      const allSessions = [];
      const allClaims = await storage.getClaims();
      for (const claim of allClaims) {
        const session = await storage.getActiveSessionForClaim(claim.id);
        if (session) {
          const inspector = session.inspectorId ? await storage.getUser(session.inspectorId) : null;
          let completenessScore = 0;
          try {
            const rooms = await storage.getRooms(session.id);
            const items = await storage.getLineItems(session.id);
            const photos = await storage.getPhotos(session.id);
            const damages = await storage.getDamagesForSession(session.id);
            const overviewCount = photos.filter((p: { photoType?: string }) => p.photoType === "overview").length;
            let passed = 0;
            if (overviewCount >= 4) passed++;
            if (rooms.length > 0) passed++;
            if (damages.length > 0) passed++;
            if (items.length > 0) passed++;
            completenessScore = Math.round((passed / 4) * 100);
          } catch {
            /* non-blocking */
          }
          allSessions.push({
            id: session.id,
            claimNumber: claim.claimNumber,
            claimId: claim.id,
            adjusterName: inspector?.fullName || "Unknown",
            currentPhase: session.currentPhase,
            status: session.status,
            startedAt: session.startedAt,
            completenessScore,
          });
        }
      }
      res.json(allSessions);
    } catch (error: unknown) {
      logger.apiError(req.method, req.path, error as Error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return router;
}
