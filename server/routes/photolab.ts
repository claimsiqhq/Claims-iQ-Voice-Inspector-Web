import { Router } from "express";
import { db } from "../db";
import { standalonePhotos, claims } from "@shared/schema";
import { eq, desc, and, or } from "drizzle-orm";
import { supabase, PHOTOS_BUCKET } from "../supabase";
import { authenticateRequest } from "../auth";
import { analyzePhotoDamage } from "../openai";
import { logger } from "../logger";
import { z } from "zod";

const uploadSchema = z.object({
  imageData: z.string().min(1),
  fileName: z.string().min(1),
});

const attachSchema = z.object({
  claimId: z.number().int().positive(),
});

const notesSchema = z.object({
  notes: z.string().nullable(),
});

function paramId(req: any): number {
  return parseInt(String(req.params.id));
}

export function photolabRouter() {
  const router = Router();

  router.get("/photos", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      const photos = await db.select().from(standalonePhotos)
        .where(eq(standalonePhotos.userId, userId))
        .orderBy(desc(standalonePhotos.createdAt));

      const photosWithUrls = await Promise.all(
        photos.map(async (photo) => {
          let signedUrl = null;
          if (photo.storagePath) {
            const { data } = await supabase.storage
              .from(PHOTOS_BUCKET)
              .createSignedUrl(photo.storagePath, 3600);
            if (data?.signedUrl) signedUrl = data.signedUrl;
          }
          return { ...photo, signedUrl };
        })
      );

      res.json(photosWithUrls);
    } catch (error: any) {
      logger.apiError("GET", "/api/photolab/photos", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.post("/upload", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      const parsed = uploadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "imageData and fileName are required" });
      }
      const { imageData, fileName } = parsed.data;

      const base64Match = imageData.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!base64Match) {
        return res.status(400).json({ message: "Invalid image data format" });
      }

      const ext = base64Match[1] === "jpeg" ? "jpg" : base64Match[1];
      const buffer = Buffer.from(base64Match[2], "base64");
      const contentType = `image/${base64Match[1]}`;
      const storagePath = `standalone/${userId}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(PHOTOS_BUCKET)
        .upload(storagePath, buffer, {
          contentType,
          upsert: false,
        });

      if (uploadError) {
        logger.error("PhotoLab", "Upload failed", uploadError);
        return res.status(500).json({ message: "Failed to upload photo" });
      }

      const [photo] = await db.insert(standalonePhotos).values({
        userId,
        storagePath,
        fileName: fileName || `photo_${Date.now()}.${ext}`,
        fileSize: buffer.length,
        source: "upload",
        analysisStatus: "pending",
      }).returning();

      const { data: urlData } = await supabase.storage
        .from(PHOTOS_BUCKET)
        .createSignedUrl(storagePath, 3600);

      res.json({ ...photo, signedUrl: urlData?.signedUrl || null });
    } catch (error: any) {
      logger.apiError("POST", "/api/photolab/upload", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.post("/photos/:id/analyze", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      const photoId = paramId(req);

      const [photo] = await db.select().from(standalonePhotos)
        .where(and(eq(standalonePhotos.id, photoId), eq(standalonePhotos.userId, userId)));

      if (!photo) {
        return res.status(404).json({ message: "Photo not found" });
      }

      await db.update(standalonePhotos)
        .set({ analysisStatus: "analyzing" })
        .where(eq(standalonePhotos.id, photoId));

      const { data: urlData } = await supabase.storage
        .from(PHOTOS_BUCKET)
        .createSignedUrl(photo.storagePath, 3600);

      if (!urlData?.signedUrl) {
        await db.update(standalonePhotos)
          .set({ analysisStatus: "failed" })
          .where(eq(standalonePhotos.id, photoId));
        return res.status(500).json({ message: "Could not generate image URL" });
      }

      const analysis = await analyzePhotoDamage(urlData.signedUrl);

      const [updated] = await db.update(standalonePhotos)
        .set({
          analysisStatus: "complete",
          analysis: analysis as any,
          annotations: analysis.damageDetections as any,
          severityScore: analysis.overallSeverity,
          damageTypes: analysis.damageTypes as any,
          suggestedRepairs: analysis.suggestedRepairs as any,
        })
        .where(eq(standalonePhotos.id, photoId))
        .returning();

      res.json({ ...updated, signedUrl: urlData.signedUrl });
    } catch (error: any) {
      logger.apiError("POST", `/api/photolab/photos/${String(req.params.id)}/analyze`, error);

      await db.update(standalonePhotos)
        .set({ analysisStatus: "failed" })
        .where(eq(standalonePhotos.id, paramId(req)))
        .catch(() => {});

      res.status(500).json({ message: error.message || "Analysis failed" });
    }
  });

  router.patch("/photos/:id/attach", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      const userRole = req.user!.role;
      const photoId = paramId(req);
      const parsed = attachSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "claimId is required and must be a positive integer" });
      }
      const { claimId } = parsed.data;

      const claimQuery = userRole === "admin"
        ? eq(claims.id, claimId)
        : and(eq(claims.id, claimId), or(eq(claims.assignedTo, userId), eq(claims.assignedTo, null as any)));
      const [claim] = await db.select({ id: claims.id }).from(claims).where(claimQuery);

      if (!claim) {
        return res.status(403).json({ message: "Claim not found or not authorized" });
      }

      const [updated] = await db.update(standalonePhotos)
        .set({ claimId })
        .where(and(eq(standalonePhotos.id, photoId), eq(standalonePhotos.userId, userId)))
        .returning();

      if (!updated) {
        return res.status(404).json({ message: "Photo not found" });
      }

      res.json(updated);
    } catch (error: any) {
      logger.apiError("PATCH", `/api/photolab/photos/${String(req.params.id)}/attach`, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.patch("/photos/:id/detach", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      const photoId = paramId(req);

      const [updated] = await db.update(standalonePhotos)
        .set({ claimId: null })
        .where(and(eq(standalonePhotos.id, photoId), eq(standalonePhotos.userId, userId)))
        .returning();

      if (!updated) {
        return res.status(404).json({ message: "Photo not found" });
      }

      res.json(updated);
    } catch (error: any) {
      logger.apiError("PATCH", `/api/photolab/photos/${String(req.params.id)}/detach`, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.delete("/photos/:id", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      const photoId = paramId(req);

      const [photo] = await db.select().from(standalonePhotos)
        .where(and(eq(standalonePhotos.id, photoId), eq(standalonePhotos.userId, userId)));

      if (!photo) {
        return res.status(404).json({ message: "Photo not found" });
      }

      if (photo.storagePath) {
        await supabase.storage.from(PHOTOS_BUCKET).remove([photo.storagePath]);
      }

      await db.delete(standalonePhotos).where(eq(standalonePhotos.id, photoId));

      res.json({ success: true });
    } catch (error: any) {
      logger.apiError("DELETE", `/api/photolab/photos/${String(req.params.id)}`, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.patch("/photos/:id/notes", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      const photoId = paramId(req);
      const parsed = notesSchema.safeParse(req.body);
      const notes = parsed.success ? parsed.data.notes : null;

      const [updated] = await db.update(standalonePhotos)
        .set({ notes })
        .where(and(eq(standalonePhotos.id, photoId), eq(standalonePhotos.userId, userId)))
        .returning();

      if (!updated) {
        return res.status(404).json({ message: "Photo not found" });
      }

      res.json(updated);
    } catch (error: any) {
      logger.apiError("PATCH", `/api/photolab/photos/${String(req.params.id)}/notes`, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return router;
}
