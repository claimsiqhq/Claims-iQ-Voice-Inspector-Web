import { Router } from "express";
import { emit } from "../events";
import { storage } from "../storage";
import { authenticateRequest } from "../auth";
import { logger } from "../logger";
import { param } from "../utils";
import { z } from "zod";

const supplementalUpdateSchema = z.object({
  reason: z.string().optional(),
  newLineItems: z.any().optional(),
  removedLineItemIds: z.any().optional(),
  modifiedLineItems: z.any().optional(),
  status: z.enum(["draft", "submitted", "approved", "rejected"]).optional(),
}).strict();

export function supplementalRouter() {
  const router = Router({ mergeParams: true });

  router.patch("/", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(param(req.params.id));
      const parsed = supplementalUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid update fields", errors: parsed.error.flatten() });
      }
      const supplemental = await storage.updateSupplemental(id, parsed.data);
      if (!supplemental) return res.status(404).json({ message: "Supplemental not found" });
      res.json(supplemental);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.post("/submit", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(param(req.params.id));
      const supplemental = await storage.submitSupplemental(id);
      if (!supplemental) return res.status(404).json({ message: "Supplemental not found" });
      emit({ type: "supplemental.submitted", supplementalId: id, sessionId: supplemental.originalSessionId, userId: req.user?.id });
      res.json(supplemental);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.post("/export/esx", authenticateRequest, async (req, res) => {
    try {
      const supplementalId = parseInt(param(req.params.id));
      const supplemental = await storage.getSupplemental(supplementalId);
      if (!supplemental) return res.status(404).json({ message: "Supplemental not found" });

      const session = await storage.getInspectionSession(supplemental.originalSessionId);
      if (!session) return res.status(404).json({ message: "Original session not found" });

      const claim = await storage.getClaim(supplemental.claimId);
      if (!claim) return res.status(404).json({ message: "Claim not found" });

      const rooms = await storage.getRooms(supplemental.originalSessionId);

      const newItems = (supplemental.newLineItems as any[]) || [];
      const modifiedItems = (supplemental.modifiedLineItems as any[]) || [];
      const removedIds = new Set((supplemental.removedLineItemIds as number[]) || []);

      const deltaLineItems = [
        ...newItems.map((item: any) => ({
          ...item,
          id: item.id || 0,
          sessionId: supplemental.originalSessionId,
          provenance: 'supplemental_new' as const,
        })),
        ...modifiedItems.map((item: any) => ({
          ...item,
          sessionId: supplemental.originalSessionId,
          provenance: 'supplemental_modified' as const,
        })),
      ];

      if (deltaLineItems.length === 0) {
        return res.status(400).json({
          message: "No new or modified line items in this supplemental — nothing to export",
        });
      }

      const { generateESXFromData } = await import("../esxGenerator");

      const esxBuffer = await generateESXFromData({
        claim,
        session,
        rooms,
        lineItems: deltaLineItems,
        isSupplemental: true,
        supplementalReason: supplemental.reason || 'Supplemental claim',
        removedItemIds: Array.from(removedIds),
      });

      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${claim.claimNumber || 'claim'}_supplemental_${supplementalId}.esx"`
      );
      res.send(esxBuffer);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return router;
}
