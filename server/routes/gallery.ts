import { Router } from "express";
import { db } from "../db";
import { claims, inspectionSessions, inspectionPhotos, inspectionRooms, structures } from "@shared/schema";
import { eq, desc, inArray } from "drizzle-orm";
import { authenticateRequest } from "../auth";
import { isPrivilegedRole } from "../authorization";
import { logger } from "../logger";

export function galleryRouter() {
  const router = Router();

  router.get("/photos", authenticateRequest, async (req, res) => {
    try {
      const claimRows = isPrivilegedRole(req.user?.role)
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

      if (claimRows.length === 0) return res.json([]);

      const claimIds = claimRows.map(c => c.id);
      const sessions = await db.select({ id: inspectionSessions.id, claimId: inspectionSessions.claimId })
        .from(inspectionSessions)
        .where(inArray(inspectionSessions.claimId, claimIds));

      if (sessions.length === 0) return res.json([]);

      const sessionIds = sessions.map(s => s.id);
      const photos = await db.select().from(inspectionPhotos)
        .where(inArray(inspectionPhotos.sessionId, sessionIds))
        .orderBy(desc(inspectionPhotos.createdAt));

      const sessionClaimMap = new Map(sessions.map(s => [s.id, s.claimId]));
      const claimMap = new Map(claimRows.map(c => [c.id, c]));

      const photosByClaimId = new Map<number, any[]>();
      for (const photo of photos) {
        const claimId = sessionClaimMap.get(photo.sessionId);
        if (claimId == null) continue;
        if (!photosByClaimId.has(claimId)) photosByClaimId.set(claimId, []);
        photosByClaimId.get(claimId)!.push({ ...photo, signedUrl: null });
      }

      const result: any[] = [];
      for (const [claimId, claimPhotos] of photosByClaimId) {
        const claim = claimMap.get(claimId);
        if (claim && claimPhotos.length > 0) {
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
      const claimRows = isPrivilegedRole(req.user?.role)
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

      if (claimRows.length === 0) return res.json([]);

      const claimIds = claimRows.map(c => c.id);
      const allSessions = await db.select({ id: inspectionSessions.id, claimId: inspectionSessions.claimId })
        .from(inspectionSessions)
        .where(inArray(inspectionSessions.claimId, claimIds));

      if (allSessions.length === 0) return res.json([]);

      const sessionIds = allSessions.map(s => s.id);
      const allStructures = await db.select().from(structures)
        .where(inArray(structures.sessionId, sessionIds));

      if (allStructures.length === 0) return res.json([]);

      const structureIds = allStructures.map(s => s.id);
      const allRooms = await db.select().from(inspectionRooms)
        .where(inArray(inspectionRooms.structureId, structureIds));

      const roomsByStructId = new Map<number, any[]>();
      for (const r of allRooms) {
        if (!roomsByStructId.has(r.structureId)) roomsByStructId.set(r.structureId, []);
        roomsByStructId.get(r.structureId)!.push({
          id: r.id, name: r.name, roomType: r.roomType, viewType: r.viewType,
          shapeType: r.shapeType, dimensions: r.dimensions, status: r.status, position: r.position,
        });
      }

      const sessionClaimMap = new Map(allSessions.map(s => [s.id, s.claimId]));
      const claimMap = new Map(claimRows.map(c => [c.id, c]));
      const firstSessionByClaim = new Map<number, number>();
      for (const s of allSessions) {
        if (!firstSessionByClaim.has(s.claimId)) firstSessionByClaim.set(s.claimId, s.id);
      }

      const structsByClaimId = new Map<number, any[]>();
      for (const struct of allStructures) {
        const claimId = sessionClaimMap.get(struct.sessionId);
        if (claimId == null) continue;
        if (!structsByClaimId.has(claimId)) structsByClaimId.set(claimId, []);
        structsByClaimId.get(claimId)!.push({
          ...struct,
          rooms: roomsByStructId.get(struct.id) || [],
        });
      }

      const result: any[] = [];
      for (const [claimId, claimStructures] of structsByClaimId) {
        const claim = claimMap.get(claimId);
        if (claim && claimStructures.length > 0) {
          result.push({
            claimId: claim.id,
            claimNumber: claim.claimNumber,
            insuredName: claim.insuredName,
            propertyAddress: claim.propertyAddress,
            sessionId: firstSessionByClaim.get(claimId),
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
