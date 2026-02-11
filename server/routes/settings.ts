import { Router } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { authenticateRequest } from "../auth";
import { logger } from "../logger";
import { handleRouteError } from "../utils";

const settingsBodySchema = z.object({
  voiceModel: z.string().optional(),
  voiceSpeed: z.number().optional(),
  assistantVerbosity: z.enum(["concise", "normal", "detailed"]).optional(),
  pushToTalk: z.boolean().optional(),
  autoRecordOnRoomEntry: z.boolean().optional(),
  silenceDetectionSensitivity: z.enum(["low", "medium", "high"]).optional(),
  defaultRegion: z.string().optional(),
  defaultOverheadPercent: z.number().optional(),
  defaultProfitPercent: z.number().optional(),
  defaultTaxRate: z.number().optional(),
  defaultWasteFactor: z.number().optional(),
  measurementUnit: z.enum(["imperial", "metric"]).optional(),
  autoGenerateBriefing: z.boolean().optional(),
  requirePhotoVerification: z.boolean().optional(),
  photoQuality: z.enum(["low", "medium", "high"]).optional(),
  autoAnalyzePhotos: z.boolean().optional(),
  timestampWatermark: z.boolean().optional(),
  gpsTagging: z.boolean().optional(),
  companyName: z.string().optional(),
  adjusterLicenseNumber: z.string().optional(),
  includeTranscriptInExport: z.boolean().optional(),
  includePhotosInExport: z.boolean().optional(),
  exportFormat: z.enum(["esx", "pdf", "both"]).optional(),
  pushNotifications: z.boolean().optional(),
  soundEffects: z.boolean().optional(),
  claimStatusAlerts: z.boolean().optional(),
  inspectionReminders: z.boolean().optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
  compactMode: z.boolean().optional(),
  fontSize: z.enum(["small", "medium", "large"]).optional(),
  showPhaseNumbers: z.boolean().optional(),
}).strict();

export function settingsRouter(): Router {
  const router = Router();

  router.get("/", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      const settings = await storage.getUserSettings(userId);
      res.json(settings || {});
    } catch (error: unknown) {
      handleRouteError(res, error, "settings.get");
    }
  });

  router.put("/", authenticateRequest, async (req, res) => {
    try {
      const parsed = settingsBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid settings", errors: parsed.error.flatten().fieldErrors });
      }
      const userId = req.user!.id;
      const result = await storage.upsertUserSettings(userId, parsed.data);
      res.json(result.settings);
    } catch (error: unknown) {
      handleRouteError(res, error, "settings.put");
    }
  });

  return router;
}
