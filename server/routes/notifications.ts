import { Router } from "express";
import { storage } from "../storage";
import { authenticateRequest } from "../auth";
import { logger } from "../logger";

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

  return router;
}
