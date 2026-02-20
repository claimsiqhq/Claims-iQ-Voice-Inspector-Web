import { Router } from "express";
import { db } from "../db";
import { claims, inspectionSessions, inspectionPhotos, inspectionRooms, structures } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { supabase, PHOTOS_BUCKET } from "../supabase";
import { authenticateRequest } from "../auth";
import { isPrivilegedRole } from "../authorization";
import { logger } from "../logger";

export function galleryRouter() {
  const router = Router();

  router.get("/photos", authenticateRequest, async (req, res) => {
    try {
      const claimsToInclude = isPrivilegedRole(req.user?.role)
        ? await db.select({
            id: claims.id,
            claimNumber: claims.claimNumber,
            insuredName: claims.insuredName,
            propertyAddress: claims.propertyAddress,
          }).from(claims).orderBy(desc(claims.id))
        : await db.select({
            id: claims.id,
            claimNumber: claims.claimNumber,
            insuredName: claims.insuredName,
            propertyAddress: claims.propertyAddress,
          }).from(claims).where(eq(claims.assignedTo, req.user!.id)).orderBy(desc(claims.id));

      const allClaims = claimsToInclude;
      const result: any[] = [];
      for (const claim of allClaims) {
        const sessions = await db.select({ id: inspectionSessions.id })
          .from(inspectionSessions)
          .where(eq(inspectionSessions.claimId, claim.id));

        let claimPhotos: any[] = [];
        for (const session of sessions) {
          const photos = await db.select().from(inspectionPhotos)
            .where(eq(inspectionPhotos.sessionId, session.id))
            .orderBy(desc(inspectionPhotos.createdAt));

          for (const photo of photos) {
            let signedUrl = null;
            if (photo.storagePath) {
              const { data } = await supabase.storage
                .from(PHOTOS_BUCKET)
                .createSignedUrl(photo.storagePath, 3600);
              if (data?.signedUrl) signedUrl = data.signedUrl;
            }
            claimPhotos.push({ ...photo, signedUrl });
          }
        }

        if (claimPhotos.length > 0) {
          result.push({
            claimId: claim.id,
            claimNumber: claim.claimNumber,
            insuredName: claim.insuredName,
            propertyAddress: claim.propertyAddress,
            photos: claimPhotos,
          });
        }
      }
      res.json(result);
    } catch (error: any) {
      logger.apiError("GET", "/api/gallery/photos", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.get("/sketches", authenticateRequest, async (req, res) => {
    try {
      const allClaims = isPrivilegedRole(req.user?.role)
        ? await db.select({
        id: claims.id,
        claimNumber: claims.claimNumber,
        insuredName: claims.insuredName,
        propertyAddress: claims.propertyAddress,
        }).from(claims).orderBy(desc(claims.id))
        : await db.select({
            id: claims.id,
            claimNumber: claims.claimNumber,
            insuredName: claims.insuredName,
            propertyAddress: claims.propertyAddress,
          }).from(claims).where(eq(claims.assignedTo, req.user!.id)).orderBy(desc(claims.id));

      const result: any[] = [];
      for (const claim of allClaims) {
        const sessions = await db.select({ id: inspectionSessions.id })
          .from(inspectionSessions)
          .where(eq(inspectionSessions.claimId, claim.id));

        if (sessions.length === 0) continue;

        let claimStructures: any[] = [];
        for (const session of sessions) {
          const sessionStructures = await db.select().from(structures)
            .where(eq(structures.sessionId, session.id));

          for (const struct of sessionStructures) {
            const rooms = await db.select().from(inspectionRooms)
              .where(eq(inspectionRooms.structureId, struct.id));
            claimStructures.push({
              ...struct,
              rooms: rooms.map(r => ({
                id: r.id,
                name: r.name,
                roomType: r.roomType,
                viewType: r.viewType,
                shapeType: r.shapeType,
                dimensions: r.dimensions,
                status: r.status,
                position: r.position,
              })),
            });
          }
        }

        if (claimStructures.length > 0) {
          result.push({
            claimId: claim.id,
            claimNumber: claim.claimNumber,
            insuredName: claim.insuredName,
            propertyAddress: claim.propertyAddress,
            sessionId: sessions[0].id,
            structures: claimStructures,
          });
        }
      }
      res.json(result);
    } catch (error: any) {
      logger.apiError("GET", "/api/gallery/sketches", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return router;
}
