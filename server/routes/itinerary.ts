import { Router } from "express";
import { authenticateRequest } from "../auth";
import { storage } from "../storage";
import { optimizeRoute, getDriveTimes } from "../routeOptimizer";
import { logger } from "../logger";
import { z } from "zod";

const optimizeBodySchema = z.object({
  date: z.string().min(1),
  startLatitude: z.number().optional(),
  startLongitude: z.number().optional(),
});

const scheduleBodySchema = z.object({
  claimId: z.number().int().positive(),
  date: z.string().min(1),
  timeSlot: z.string().optional(),
  priority: z.enum(["critical", "high", "normal", "low"]).optional(),
  estimatedDurationMin: z.number().int().positive().optional(),
});

export function itineraryRouter(): Router {
  const router = Router();

  router.get("/today", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      const today = new Date().toISOString().slice(0, 10);

      const dayClaims = await storage.getClaimsForDate(userId, today);
      const itinerary = await storage.getItinerary(userId, today);

      const driveTimes = getDriveTimes(dayClaims);

      const stops = dayClaims.map((claim, idx) => {
        const dt = driveTimes.find((d) => d.claimId === claim.id);
        return {
          claim,
          order: claim.routeOrder ?? idx + 1,
          driveTimeMin: dt?.driveTimeMin ?? 0,
          distanceKm: dt?.distanceKm ?? 0,
        };
      });

      res.json({
        date: today,
        stops,
        itinerary: itinerary ?? null,
        totalClaims: dayClaims.length,
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.get("/:date", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      const date = req.params.date as string;

      const dayClaims = await storage.getClaimsForDate(userId, date);
      const itinerary = await storage.getItinerary(userId, date);

      const driveTimes = getDriveTimes(dayClaims);

      const stops = dayClaims.map((claim, idx) => {
        const dt = driveTimes.find((d) => d.claimId === claim.id);
        return {
          claim,
          order: claim.routeOrder ?? idx + 1,
          driveTimeMin: dt?.driveTimeMin ?? 0,
          distanceKm: dt?.distanceKm ?? 0,
        };
      });

      res.json({
        date,
        stops,
        itinerary: itinerary ?? null,
        totalClaims: dayClaims.length,
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.post("/optimize", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      const parsed = optimizeBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.flatten().fieldErrors });
      }

      const { date, startLatitude, startLongitude } = parsed.data;
      const dayClaims = await storage.getClaimsForDate(userId, date);

      if (dayClaims.length === 0) {
        return res.json({ message: "No claims scheduled for this date", route: null });
      }

      const startLocation =
        startLatitude != null && startLongitude != null
          ? { latitude: startLatitude, longitude: startLongitude }
          : null;

      const route = optimizeRoute(dayClaims, startLocation);

      for (const stop of route.stops) {
        await storage.updateClaimRouteOrder(stop.claimId, stop.order);
      }

      const claimIds = route.stops.map((s) => s.claimId);
      const existing = await storage.getItinerary(userId, date);
      if (existing) {
        await storage.updateItinerary(existing.id, {
          claimIds,
          routeData: route as any,
          optimizedAt: new Date(),
        });
      } else {
        await storage.createItinerary({
          userId,
          date,
          claimIds,
          routeData: route as any,
          optimizedAt: new Date(),
        });
      }

      res.json({ route });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.post("/schedule", authenticateRequest, async (req, res) => {
    try {
      const parsed = scheduleBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.flatten().fieldErrors });
      }

      const { claimId, date, timeSlot, priority, estimatedDurationMin } = parsed.data;

      const claim = await storage.getClaim(claimId);
      if (!claim) {
        return res.status(404).json({ message: "Claim not found" });
      }
      if (claim.assignedTo !== req.user!.id && req.user!.role !== "admin" && req.user!.role !== "supervisor") {
        return res.status(403).json({ message: "Not authorized to schedule this claim" });
      }

      const updates: Record<string, any> = { scheduledDate: date };
      if (timeSlot) updates.scheduledTimeSlot = timeSlot;
      if (priority) updates.priority = priority;
      if (estimatedDurationMin) updates.estimatedDurationMin = estimatedDurationMin;

      const updated = await storage.updateClaimScheduling(claimId, updates);
      res.json(updated);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.post("/unschedule/:claimId", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(req.params.claimId as string, 10);
      if (isNaN(claimId)) {
        return res.status(400).json({ message: "Invalid claim ID" });
      }

      const claim = await storage.getClaim(claimId);
      if (!claim) {
        return res.status(404).json({ message: "Claim not found" });
      }
      if (claim.assignedTo !== req.user!.id && req.user!.role !== "admin" && req.user!.role !== "supervisor") {
        return res.status(403).json({ message: "Not authorized to unschedule this claim" });
      }

      const updated = await storage.updateClaimScheduling(claimId, {
        scheduledDate: null as any,
        scheduledTimeSlot: null as any,
      });
      await storage.updateClaimRouteOrder(claimId, 0);

      res.json(updated);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return router;
}
