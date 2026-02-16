import { Router } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { authenticateRequest } from "../auth";
import { supabase, PHOTOS_BUCKET } from "../supabase";
import { logger } from "../logger";
import { handleRouteError } from "../utils";

const profileUpdateSchema = z.object({
  fullName: z.string().min(1).max(100).optional(),
  title: z.string().max(100).optional(),
  avatarUrl: z.string().url().max(2000).optional(),
}).strict();

const avatarUploadSchema = z.object({
  base64Data: z.string().min(1),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

export function profileRouter(): Router {
  const router = Router();

  router.patch("/profile", authenticateRequest, async (req, res) => {
    try {
      const parsed = profileUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid profile data", errors: parsed.error.flatten().fieldErrors });
      }
      if (Object.keys(parsed.data).length === 0) {
        return res.status(400).json({ message: "No fields to update" });
      }
      const userId = req.user!.id;
      const updated = await storage.updateUserProfile(userId, parsed.data);
      if (!updated) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json({
        id: updated.id,
        fullName: updated.fullName,
        email: updated.email,
        role: updated.role,
        title: updated.title,
        avatarUrl: updated.avatarUrl,
      });
    } catch (error: unknown) {
      handleRouteError(res, error, "profile.patch");
    }
  });

  router.post("/profile/avatar", authenticateRequest, async (req, res) => {
    try {
      const parsed = avatarUploadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid avatar data" });
      }
      const userId = req.user!.id;
      const ext = parsed.data.mimeType === "image/png" ? "png" : parsed.data.mimeType === "image/webp" ? "webp" : "jpg";
      const storagePath = `avatars/${userId}/avatar.${ext}`;
      const fileBuffer = Buffer.from(parsed.data.base64Data, "base64");

      if (fileBuffer.length > 5 * 1024 * 1024) {
        return res.status(413).json({ message: "Avatar must be under 5MB" });
      }

      const { error } = await supabase.storage
        .from(PHOTOS_BUCKET)
        .upload(storagePath, fileBuffer, {
          contentType: parsed.data.mimeType,
          upsert: true,
        });
      if (error) throw new Error(`Avatar upload failed: ${error.message}`);

      const { data: signedUrlData, error: signError } = await supabase.storage
        .from(PHOTOS_BUCKET)
        .createSignedUrl(storagePath, 60 * 60 * 24 * 365);
      if (signError) throw new Error(`Failed to create signed URL: ${signError.message}`);

      const avatarUrl = signedUrlData.signedUrl;
      const updated = await storage.updateUserProfile(userId, { avatarUrl });
      res.json({
        id: updated!.id,
        fullName: updated!.fullName,
        email: updated!.email,
        role: updated!.role,
        title: updated!.title,
        avatarUrl: updated!.avatarUrl,
      });
    } catch (error: unknown) {
      logger.apiError(req.method, req.path, error as Error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return router;
}
