import { Router } from "express";
import { storage } from "../storage";
import { authenticateRequest } from "../auth";
import { logger } from "../logger";
import { insertAdjusterNotificationSchema } from "@shared/schema";

export function notificationsRouter() {
  const router = Router();

  router.get("/", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      const notifications: Array<{
        id: string;
        type: string;
        title: string;
        message: string;
        claimId?: number;
        timestamp: string;
        read: boolean;
      }> = [];

      const userClaims = await storage.getClaimsForUser(userId);
      const allClaims = req.user!.role === "admin" || req.user!.role === "supervisor"
        ? await storage.getClaims()
        : userClaims;

      for (const claim of allClaims.slice(0, 20)) {
        if (claim.status === "in_progress") {
          const activeSession = await storage.getActiveSessionForClaim(claim.id);
          if (activeSession) {
            notifications.push({
              id: `session-active-${activeSession.id}`,
              type: "inspection",
              title: "Inspection In Progress",
              message: `Claim ${claim.claimNumber} – ${claim.insuredName || "Unknown"} has an active inspection session.`,
              claimId: claim.id,
              timestamp: (activeSession.startedAt || claim.updatedAt || claim.createdAt || new Date()).toISOString(),
              read: false,
            });
          }
        }

        if (claim.status === "review") {
          notifications.push({
            id: `claim-review-${claim.id}`,
            type: "review",
            title: "Ready for Review",
            message: `Claim ${claim.claimNumber} – ${claim.insuredName || "Unknown"} is ready for review.`,
            claimId: claim.id,
            timestamp: (claim.updatedAt || claim.createdAt || new Date()).toISOString(),
            read: false,
          });
        }

        const hoursSinceUpdate = claim.updatedAt
          ? (Date.now() - new Date(claim.updatedAt).getTime()) / (1000 * 60 * 60)
          : Infinity;
        if (claim.status === "draft" && hoursSinceUpdate < 48) {
          notifications.push({
            id: `claim-new-${claim.id}`,
            type: "new_claim",
            title: "New Claim Created",
            message: `Claim ${claim.claimNumber} – ${claim.insuredName || "Unknown"} needs documents uploaded.`,
            claimId: claim.id,
            timestamp: (claim.createdAt || new Date()).toISOString(),
            read: false,
          });
        }
      }

      notifications.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      res.json(notifications.slice(0, 15));
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.post("/persistent", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      const parsed = insertAdjusterNotificationSchema.parse({
        ...req.body,
        userId,
      });
      const notification = await storage.createNotification(parsed);
      res.status(201).json(notification);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(400).json({ message: error.message || "Invalid request" });
    }
  });

  router.get("/persistent", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      const unreadOnly = req.query.unreadOnly === "true";
      const notifications = await storage.getNotifications(userId, unreadOnly);
      res.json(notifications);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.patch("/persistent/:id/read", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid notification id" });
      }
      const updated = await storage.markNotificationRead(id);
      if (!updated) {
        return res.status(404).json({ message: "Notification not found" });
      }
      if (updated.userId !== req.user!.id) {
        return res.status(403).json({ message: "Not authorized" });
      }
      res.json(updated);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.post("/persistent/mark-all-read", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      await storage.markAllNotificationsRead(userId);
      res.json({ success: true });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return router;
}
