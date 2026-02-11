import { Router } from "express";
import { storage } from "../storage";
import { authenticateRequest } from "../auth";
import { logger } from "../logger";
import { z } from "zod";
import { param } from "../utils";

const flowBodySchema = z.object({
  name: z.string().min(1),
  perilType: z.string().min(1),
  description: z.string().optional(),
  isDefault: z.boolean().optional(),
  steps: z.array(z.object({
    id: z.string(),
    phaseName: z.string(),
    agentPrompt: z.string(),
    requiredTools: z.array(z.string()),
    completionCriteria: z.string(),
  })),
});

export function flowsRouter() {
  const router = Router();

  router.post("/seed", authenticateRequest, async (req, res) => {
    try {
      const { seedInspectionFlows } = await import("../seed-flows");
      const count = await seedInspectionFlows();
      res.json({ message: `Inspection flows seeded/updated. ${count} new flows created.` });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.get("/", authenticateRequest, async (req, res) => {
    try {
      const { perilType } = req.query;
      let flows = await storage.getInspectionFlows(req.user!.id);
      if (perilType && typeof perilType === "string") {
        flows = flows.filter(f => f.perilType === perilType);
      }
      res.json(flows);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.get("/:id", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(param(req.params.id));
      const flow = await storage.getInspectionFlow(id);
      if (!flow) return res.status(404).json({ message: "Flow not found" });
      res.json(flow);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.post("/", authenticateRequest, async (req, res) => {
    try {
      const parsed = flowBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid flow data", errors: parsed.error.issues });
      }
      const flow = await storage.createInspectionFlow({
        ...parsed.data,
        userId: req.user!.id,
        isSystemDefault: false,
      });
      res.status(201).json(flow);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.put("/:id", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(param(req.params.id));
      const existing = await storage.getInspectionFlow(id);
      if (!existing) return res.status(404).json({ message: "Flow not found" });

      if (existing.isSystemDefault && existing.userId !== req.user!.id) {
        return res.status(403).json({ message: "Cannot edit system default flows. Clone it first." });
      }

      const parsed = flowBodySchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid flow data", errors: parsed.error.issues });
      }

      const flow = await storage.updateInspectionFlow(id, parsed.data);
      res.json(flow);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.delete("/:id", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(param(req.params.id));
      const existing = await storage.getInspectionFlow(id);
      if (!existing) return res.status(404).json({ message: "Flow not found" });
      if (existing.isSystemDefault) {
        return res.status(403).json({ message: "Cannot delete system default flows" });
      }
      if (existing.userId !== req.user!.id) {
        return res.status(403).json({ message: "Cannot delete flows owned by other users" });
      }
      await storage.deleteInspectionFlow(id);
      res.json({ success: true });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.post("/:id/clone", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(param(req.params.id));
      const source = await storage.getInspectionFlow(id);
      if (!source) return res.status(404).json({ message: "Flow not found" });

      const cloneName = req.body.name || `${source.name} (Custom)`;
      const flow = await storage.createInspectionFlow({
        name: cloneName,
        perilType: source.perilType,
        description: source.description,
        isDefault: false,
        isSystemDefault: false,
        userId: req.user!.id,
        steps: source.steps as any,
      });
      res.status(201).json(flow);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return router;
}
