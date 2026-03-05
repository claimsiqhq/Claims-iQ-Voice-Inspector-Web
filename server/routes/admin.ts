import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { storage } from "../storage";
import { db } from "../db";
import { lineItems, damageObservations } from "@shared/schema";
import { authenticateRequest, requireRole } from "../auth";
import { logger } from "../logger";

const assignClaimSchema = z.object({
  claimId: z.number().int().positive(),
  userId: z.string().min(1),
});

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
      const parsed = assignClaimSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten().fieldErrors });
      }
      const { claimId, userId } = parsed.data;
      const targetUser = await storage.getUser(userId);
      if (!targetUser) {
        return res.status(404).json({ message: "Target user not found" });
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
      const [allClaims, allActiveSessions] = await Promise.all([
        storage.getClaims(),
        storage.getAllActiveSessions(),
      ]);

      const activeSessions = allActiveSessions.length;
      const sessionIds = allActiveSessions.map((s) => s.id);

      const [estimateSummaries, allRooms, allItems, allPhotos, allDamages] = await Promise.all([
        storage.getEstimateSummaryBatch(sessionIds),
        storage.getRoomsBySessionIds(sessionIds),
        storage.getLineItemsBySessionIds(sessionIds),
        storage.getPhotosBySessionIds(sessionIds),
        storage.getDamagesBySessionIds(sessionIds),
      ]);

      let totalEstimateValue = 0;
      for (const summary of estimateSummaries.values()) {
        totalEstimateValue += summary.totalRCV;
      }

      let avgInspectionTime = 0;
      const completedWithTimes = allActiveSessions.filter(
        (s) => s.completedAt && s.startedAt
      );
      if (completedWithTimes.length > 0) {
        const totalMinutes = completedWithTimes.reduce((sum, s) => {
          const start = new Date(s.startedAt!).getTime();
          const end = new Date(s.completedAt!).getTime();
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

      const roomsBySession = new Map<number, typeof allRooms>();
      for (const room of allRooms) {
        const arr = roomsBySession.get(room.sessionId) || [];
        arr.push(room);
        roomsBySession.set(room.sessionId, arr);
      }
      const itemsBySession = new Map<number, typeof allItems>();
      for (const item of allItems) {
        const arr = itemsBySession.get(item.sessionId) || [];
        arr.push(item);
        itemsBySession.set(item.sessionId, arr);
      }
      const photosBySession = new Map<number, typeof allPhotos>();
      for (const photo of allPhotos) {
        const arr = photosBySession.get(photo.sessionId) || [];
        arr.push(photo);
        photosBySession.set(photo.sessionId, arr);
      }
      const damagesBySession = new Map<number, typeof allDamages>();
      for (const damage of allDamages) {
        const arr = damagesBySession.get(damage.sessionId) || [];
        arr.push(damage);
        damagesBySession.set(damage.sessionId, arr);
      }

      let avgCompletenessScore = 0;
      if (allActiveSessions.length > 0) {
        let totalScore = 0;
        for (const session of allActiveSessions) {
          const rooms = roomsBySession.get(session.id) || [];
          const items = itemsBySession.get(session.id) || [];
          const photos = photosBySession.get(session.id) || [];
          const damages = damagesBySession.get(session.id) || [];
          const overviewCount = photos.filter((p) => p.photoType === "overview").length;
          let passed = 0;
          if (overviewCount >= 4) passed++;
          if (rooms.length > 0) passed++;
          if (damages.length > 0) passed++;
          if (items.length > 0) passed++;
          totalScore += Math.round((passed / 4) * 100);
        }
        avgCompletenessScore = totalScore / allActiveSessions.length;
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
      const [allClaims, activeSessionsList] = await Promise.all([
        storage.getClaims(),
        storage.getAllActiveSessions(),
      ]);

      if (activeSessionsList.length === 0) {
        return res.json([]);
      }

      const sessionIds = activeSessionsList.map((s) => s.id);
      const inspectorIds = [...new Set(activeSessionsList.map((s) => s.inspectorId).filter(Boolean))] as string[];

      const [allRooms, allItems, allPhotos, allDamages, inspectors] = await Promise.all([
        storage.getRoomsBySessionIds(sessionIds),
        storage.getLineItemsBySessionIds(sessionIds),
        storage.getPhotosBySessionIds(sessionIds),
        storage.getDamagesBySessionIds(sessionIds),
        storage.getUsersByIds(inspectorIds),
      ]);

      const claimsMap = new Map(allClaims.map((c) => [c.id, c]));
      const inspectorMap = new Map(inspectors.map((u) => [u.id, u]));

      const roomsBySession = new Map<number, typeof allRooms>();
      for (const room of allRooms) {
        const arr = roomsBySession.get(room.sessionId) || [];
        arr.push(room);
        roomsBySession.set(room.sessionId, arr);
      }
      const itemsBySession = new Map<number, typeof allItems>();
      for (const item of allItems) {
        const arr = itemsBySession.get(item.sessionId) || [];
        arr.push(item);
        itemsBySession.set(item.sessionId, arr);
      }
      const photosBySession = new Map<number, typeof allPhotos>();
      for (const photo of allPhotos) {
        const arr = photosBySession.get(photo.sessionId) || [];
        arr.push(photo);
        photosBySession.set(photo.sessionId, arr);
      }
      const damagesBySession = new Map<number, typeof allDamages>();
      for (const damage of allDamages) {
        const arr = damagesBySession.get(damage.sessionId) || [];
        arr.push(damage);
        damagesBySession.set(damage.sessionId, arr);
      }

      const result = activeSessionsList.map((session) => {
        const claim = claimsMap.get(session.claimId);
        const inspector = session.inspectorId ? inspectorMap.get(session.inspectorId) : null;
        const rooms = roomsBySession.get(session.id) || [];
        const items = itemsBySession.get(session.id) || [];
        const photos = photosBySession.get(session.id) || [];
        const damages = damagesBySession.get(session.id) || [];
        const overviewCount = photos.filter((p) => p.photoType === "overview").length;
        let passed = 0;
        if (overviewCount >= 4) passed++;
        if (rooms.length > 0) passed++;
        if (damages.length > 0) passed++;
        if (items.length > 0) passed++;
        return {
          id: session.id,
          claimNumber: claim?.claimNumber || "Unknown",
          claimId: session.claimId,
          adjusterName: inspector?.fullName || "Unknown",
          currentPhase: session.currentPhase,
          status: session.status,
          startedAt: session.startedAt,
          completenessScore: Math.round((passed / 4) * 100),
        };
      });

      res.json(result);
    } catch (error: unknown) {
      logger.apiError(req.method, req.path, error as Error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return router;
}
