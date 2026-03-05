import { Router } from "express";
import { storage } from "../storage";
import { authenticateRequest } from "../auth";
import { computeUrgency, generateSlaNotifications, type UrgencyScore } from "../slaEngine";
import type { Claim } from "@shared/schema";

export function mydayRouter() {
  const router = Router();

  router.get("/today", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;

      const today = new Date().toISOString().split("T")[0];

      const scheduledClaims = await storage.getClaimsForDate(userId, today);

      const allClaims = await storage.getClaimsForUser(userId);
      const activeClaims = allClaims.filter(
        (c) => !["completed", "closed", "cancelled"].includes(c.status.toLowerCase())
      );

      const claimsWithUrgency = scheduledClaims.map((claim) => {
        const urgency = computeUrgency(claim);
        return {
          ...claim,
          urgency: {
            score: urgency.score,
            priority: urgency.priority,
            hoursRemaining: claim.slaDeadline
              ? Math.max(0, (new Date(claim.slaDeadline).getTime() - Date.now()) / 3600000)
              : null,
            isOverdue: claim.slaDeadline
              ? new Date(claim.slaDeadline).getTime() < Date.now()
              : false,
          },
        };
      });

      const itinerary = await storage.getItinerary(userId, today);

      const completedToday = scheduledClaims.filter(
        (c) => c.status.toLowerCase() === "completed"
      ).length;

      const slaWarnings = activeClaims.filter((c) => {
        if (!c.slaDeadline) return false;
        const hoursRemaining =
          (new Date(c.slaDeadline).getTime() - Date.now()) / 3600000;
        return hoursRemaining < 24 && hoursRemaining > 0;
      });

      const overdueCount = activeClaims.filter((c) => {
        if (!c.slaDeadline) return false;
        return new Date(c.slaDeadline).getTime() < Date.now();
      }).length;

      await generateSlaNotifications(userId);
      const notifications = await storage.getNotifications(userId, true);

      let ms365Status = { connected: false, email: null as string | null };
      try {
        const token = await storage.getMs365Token(userId);
        ms365Status.connected = !!token;
      } catch {}

      res.json({
        date: today,
        claims: claimsWithUrgency,
        itinerary: itinerary || null,
        stats: {
          totalScheduled: scheduledClaims.length,
          completed: completedToday,
          remaining: scheduledClaims.length - completedToday,
          totalActive: activeClaims.length,
          slaWarnings: slaWarnings.length,
          overdue: overdueCount,
        },
        unreadNotifications: notifications.length,
        ms365: ms365Status,
      });
    } catch (err: any) {
      logger.apiError("GET", "/api/myday/today", err);
      res.status(500).json({ error: "Failed to load My Day data" });
    }
  });

  router.get("/stats", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;

      const allClaims = await storage.getClaimsForUser(userId);
      const today = new Date().toISOString().split("T")[0];
      const scheduledToday = allClaims.filter((c) => c.scheduledDate === today);

      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const weekStartStr = weekStart.toISOString().split("T")[0];

      const thisWeek = allClaims.filter((c) => {
        if (!c.scheduledDate) return false;
        return c.scheduledDate >= weekStartStr && c.scheduledDate <= today;
      });

      res.json({
        today: {
          scheduled: scheduledToday.length,
          completed: scheduledToday.filter((c) => c.status === "completed").length,
          inProgress: scheduledToday.filter((c) => c.status === "inspecting").length,
        },
        week: {
          total: thisWeek.length,
          completed: thisWeek.filter((c) => c.status === "completed").length,
        },
        overall: {
          total: allClaims.length,
          active: allClaims.filter(
            (c) => !["completed", "closed", "cancelled"].includes(c.status.toLowerCase())
          ).length,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load stats" });
    }
  });

  router.get("/claims-for-date/:date", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;

      const { date } = req.params;
      const claims = await storage.getClaimsForDate(userId, date);

      const claimsWithUrgency = claims.map((claim) => {
        const urgency = computeUrgency(claim);
        return {
          ...claim,
          urgency: {
            score: urgency.score,
            priority: urgency.priority,
            hoursRemaining: claim.slaDeadline
              ? Math.max(0, (new Date(claim.slaDeadline).getTime() - Date.now()) / 3600000)
              : null,
            isOverdue: claim.slaDeadline
              ? new Date(claim.slaDeadline).getTime() < Date.now()
              : false,
          },
        };
      });

      res.json(claimsWithUrgency);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load claims for date" });
    }
  });

  router.get("/week/:startDate", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;

      const { startDate } = req.params;
      const start = new Date(startDate);
      const days: Array<{ date: string; claims: any[] }> = [];

      for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split("T")[0];
        const claims = await storage.getClaimsForDate(userId, dateStr);
        days.push({
          date: dateStr,
          claims: claims.map((c) => ({
            id: c.id,
            claimNumber: c.claimNumber,
            insuredName: c.insuredName,
            scheduledTimeSlot: c.scheduledTimeSlot,
            priority: c.priority,
            status: c.status,
            estimatedDurationMin: c.estimatedDurationMin,
            propertyAddress: c.propertyAddress,
            city: c.city,
          })),
        });
      }

      res.json({ startDate, days });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load week view" });
    }
  });

  return router;
}
