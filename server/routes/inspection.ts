import type { Express } from "express";
import { emit } from "../events";
import { storage } from "../storage";
import { param, decodeBase64Payload, MAX_PHOTO_BYTES } from "../utils";
import { generateESXFile } from "../esxGenerator";
import { reviewEstimate } from "../aiReview";
import { supabase, PHOTOS_BUCKET } from "../supabase";
import { authenticateRequest } from "../auth";
import { lookupCatalogItem, getRegionalPrice, calculateDimVars, type RoomDimensions, type OpeningData } from "../estimateEngine";
import { z } from "zod";
import { logger } from "../logger";
import { assembleScope } from "../scopeAssemblyService";
import { handleWaterDamageProtocol } from "../waterProtocol";
import { deriveQuantity, type QuantityFormula } from "../scopeQuantityEngine";
import { calculateDepreciation, lookupLifeExpectancy } from "../depreciationEngine";
import { calculateItemDepreciation } from "../estimateEngine";

const sessionUpdateSchema = z.object({
  currentPhase: z.number().int().positive().optional(),
  completedPhases: z.array(z.number().int().positive()).optional(),
  activeFlowId: z.number().int().positive().nullable().optional(),
  currentStepIndex: z.number().int().min(0).optional(),
  currentRoomId: z.number().int().positive().nullable().optional(),
  currentStructure: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  adjusterNotes: z.string().nullable().optional(),
});

const structureUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  structureType: z.string().max(30).optional(),
}).strict();

const structureCreateSchema = z.object({
  name: z.string().min(1).max(100),
  structureType: z.string().max(30).optional().default("dwelling"),
    // dwelling, garage, shed, fence, carport, pool, other
});

const roomCreateSchema = z.object({
  name: z.string().min(1).max(100),
  roomType: z.string().max(50).nullable().optional(),
  structure: z.string().max(100).nullable().optional(),     // legacy
  structureId: z.number().int().positive().nullable().optional(),
  viewType: z.enum(["interior", "roof_plan", "elevation", "exterior_other"]).optional(),
  shapeType: z.enum(["rectangle", "gable", "hip", "l_shape", "custom"]).optional(),
  parentRoomId: z.number().int().positive().nullable().optional(),
  attachmentType: z.string().max(30).nullable().optional(),
  dimensions: z.any().optional(),
  polygon: z.any().optional(),
  position: z.any().optional(),
  floor: z.number().int().positive().optional(),
  facetLabel: z.string().max(10).nullable().optional(),
  pitch: z.string().max(10).nullable().optional(),
  roofPitch: z.string().max(10).nullable().optional(),
  phase: z.number().int().positive().nullable().optional(),
});

const roomOpeningCreateSchema = z.object({
  openingType: z.enum(["door", "window", "standard_door", "overhead_door", "missing_wall", "pass_through", "archway", "cased_opening", "sliding_door", "french_door"]),
  wallIndex: z.number().int().nonnegative().optional(),
  wallDirection: z.enum(["north", "south", "east", "west", "front", "rear", "left", "right"]).nullable().optional(),
  positionOnWall: z.number().min(0).max(1).optional(),
  widthFt: z.number().positive().optional(),
  heightFt: z.number().positive().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  quantity: z.number().int().positive().default(1),
  label: z.string().max(50).nullable().optional(),
  opensInto: z.string().max(100).nullable().optional(),
  goesToFloor: z.boolean().optional(),
  goesToCeiling: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

const openingCreateSchema = z.object({
  roomId: z.number().int().positive(),
  openingType: z.enum(["window", "standard_door", "overhead_door", "missing_wall", "pass_through", "archway", "cased_opening", "door", "sliding_door", "french_door"]),
  wallDirection: z.enum(["north", "south", "east", "west", "front", "rear", "left", "right"]).nullable().optional(),
  wallIndex: z.number().int().nonnegative().nullable().optional(),
  positionOnWall: z.number().min(0).max(1).optional(),
  widthFt: z.number().positive(),
  heightFt: z.number().positive(),
  quantity: z.number().int().positive().default(1),
  opensInto: z.string().max(100).nullable().optional(),
  goesToFloor: z.boolean().optional(),
  goesToCeiling: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

const sketchAnnotationCreateSchema = z.object({
  annotationType: z.enum(["hail_count", "wind_damage", "damage", "pitch", "storm_direction", "facet_label", "material_note", "custom"]),
  label: z.string().min(1).max(100),
  value: z.string().max(50).nullable().optional(),
  location: z.string().max(100).nullable().optional(),
  position: z.any().optional(),
});

const sketchAnnotationUpdateSchema = z.object({
  annotationType: z.enum(["hail_count", "wind_damage", "damage", "pitch", "storm_direction", "facet_label", "material_note", "custom"]).optional(),
  label: z.string().min(1).max(100).optional(),
  value: z.string().max(50).nullable().optional(),
  location: z.string().max(100).nullable().optional(),
  position: z.any().optional(),
});

const openingUpdateSchema = z.object({
  wallDirection: z.enum(["north", "south", "east", "west", "front", "rear", "left", "right"]).nullable().optional(),
  wallIndex: z.number().int().nonnegative().nullable().optional(),
  positionOnWall: z.number().min(0).max(1).optional(),
  widthFt: z.number().positive().optional(),
  heightFt: z.number().positive().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  quantity: z.number().int().positive().optional(),
  label: z.string().max(50).nullable().optional(),
  openingType: z.enum(["door", "window", "standard_door", "overhead_door", "missing_wall", "pass_through", "archway", "cased_opening", "sliding_door", "french_door"]).optional(),
});

const lineItemCreateSchema = z.object({
  roomId: z.number().int().positive().nullable().optional(),
  damageId: z.number().int().positive().nullable().optional(),
  category: z.string().min(1).max(50),
  action: z.string().max(30).nullable().optional(),
  description: z.string().min(1),
  xactCode: z.string().max(30).nullable().optional(),
  quantity: z.number().positive().optional(),
  unit: z.string().max(20).nullable().optional(),
  unitPrice: z.number().nonnegative().optional(),
  depreciationType: z.string().max(30).nullable().optional(),
  depreciationRate: z.number().min(0).max(100).nullable().optional(),
  wasteFactor: z.number().int().nonnegative().optional(),
  coverageBucket: z.string().max(30).optional(),
  qualityGrade: z.string().max(30).nullable().optional(),
  applyOAndP: z.boolean().optional(),
  macroSource: z.string().max(50).nullable().optional(),
  // ── Financial / Depreciation fields ──
  age: z.number().nonnegative().nullable().optional(),
  lifeExpectancy: z.number().positive().nullable().optional(),
  depreciationPercentage: z.number().min(0).max(100).nullable().optional(),
});

const testSquareCreateSchema = z.object({
  roomId: z.number().int().positive().nullable().optional(),
  hailHits: z.number().int().nonnegative(),
  windCreases: z.number().int().nonnegative().optional(),
  pitch: z.string().min(1).max(10),
  result: z.enum(["pass", "fail", "brittle_test_failure"]).optional(),
  notes: z.string().nullable().optional(),
});

const smartMacroSchema = z.object({
  macroType: z.enum(["roof_replacement_laminated", "roof_replacement_3tab", "interior_paint_walls_ceiling", "water_mitigation_dryout"]),
  severity: z.enum(["average", "heavy", "premium"]).optional(),
  wasteFactor: z.number().nonnegative().optional(),
  roomId: z.number().int().positive().nullable().optional(),
});

const checkRelatedItemsSchema = z.object({
  primaryCategory: z.enum(["Cabinetry", "Roofing", "Drywall", "Siding", "Flooring", "Plumbing", "Electrical", "Windows", "Doors"]),
  actionTaken: z.string().optional(),
});

const adjacencyCreateSchema = z.object({
  roomIdA: z.number().int().positive(),
  roomIdB: z.number().int().positive(),
  wallDirectionA: z.string().max(20).nullable().optional(),
  wallDirectionB: z.string().max(20).nullable().optional(),
  sharedWallLengthFt: z.number().positive().nullable().optional(),
  openingId: z.number().int().positive().nullable().optional(),
});

export async function registerInspectionRoutes(app: Express): Promise<void> {
  app.get("/api/inspection/:sessionId", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const session = await storage.getInspectionSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });
      const rooms = await storage.getRooms(sessionId);
      const allLineItems = await storage.getLineItems(sessionId);
      const photos = await storage.getPhotos(sessionId);
      const estimate = await storage.getEstimateSummary(sessionId);
      res.json({ session, rooms, lineItemCount: allLineItems.length, photoCount: photos.length, estimate });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/inspection/:sessionId", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const parsed = sessionUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid session update", errors: parsed.error.flatten().fieldErrors });
      }
      const updates = parsed.data;
      const session = await storage.updateSession(sessionId, updates);
      res.json(session);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/inspection/:sessionId/complete", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const session = await storage.completeSession(sessionId);
      if (session) {
        await storage.updateClaimStatus(session.claimId, "inspection_complete");
        emit({ type: "inspection.completed", sessionId, claimId: session.claimId, userId: req.user?.id });
      }
      res.json(session);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/validate-phase", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const session = await storage.getInspectionSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });
      const claim = await storage.getClaim(session.claimId);
      const currentPhase = req.query.phase ? parseInt(req.query.phase as string) : (session.currentPhase || 1);
      const { validatePhaseTransition } = await import("../phaseValidation");
      const validation = await validatePhaseTransition(
        storage,
        sessionId,
        currentPhase,
        claim?.perilType || undefined
      );
      res.json({
        currentPhase,
        nextPhase: currentPhase + 1,
        ...validation,
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Structures (L1 Hierarchy) ─────────────────────

  app.post("/api/inspection/:sessionId/structures", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const parsed = structureCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid structure data", errors: parsed.error.flatten().fieldErrors });
      }
      // Check for duplicate name in session
      const existing = await storage.getStructureByName(sessionId, parsed.data.name);
      if (existing) {
        return res.json(existing); // idempotent — return existing
      }
      const structure = await storage.createStructure({
        sessionId,
        name: parsed.data.name,
        structureType: parsed.data.structureType || "dwelling",
      });
      res.status(201).json(structure);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/structures", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const structs = await storage.getStructures(sessionId);
      res.json(structs);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/inspection/:sessionId/structures/:structureId", authenticateRequest, async (req, res) => {
    try {
      const structureId = parseInt(param(req.params.structureId));
      const parsed = structureUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid structure update", errors: parsed.error.flatten().fieldErrors });
      }
      const structure = await storage.updateStructure(structureId, parsed.data);
      res.json(structure);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/inspection/:sessionId/structures/:structureId", authenticateRequest, async (req, res) => {
    try {
      const structureId = parseInt(param(req.params.structureId));
      const cascade = req.query.cascade === "true" || req.query.cascade === "1";
      await storage.deleteStructure(structureId, cascade);
      res.status(204).send();
    } catch (error: any) {
      if (error?.message?.includes("Cannot delete structure")) {
        return res.status(400).json({ message: error.message });
      }
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Inspection Hierarchy (full tree for voice agent) ──

  app.get("/api/inspection/:sessionId/hierarchy", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const hierarchy = await storage.getInspectionHierarchy(sessionId);
      res.json(hierarchy);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Rooms (L2/L3 Hierarchy) ─────────────────────────

  app.post("/api/inspection/:sessionId/rooms", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const parsed = roomCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid room data", errors: parsed.error.flatten().fieldErrors });
      }
      const { name, roomType, structure, structureId, viewType, shapeType,
              parentRoomId, attachmentType, dimensions, polygon, position,
              floor, facetLabel, pitch, phase } = parsed.data;
      const structureName = structure || "Main Dwelling";

      // Resolve structureId: use provided ID, or auto-create from legacy structure string
      let resolvedStructureId = structureId || null;
      if (!resolvedStructureId && structure) {
        let existingStruct = await storage.getStructureByName(sessionId, structure);
        if (!existingStruct) {
          const sType = structure.toLowerCase().includes("garage") ? "garage"
            : structure.toLowerCase().includes("shed") ? "shed"
            : structure.toLowerCase().includes("fence") ? "fence"
            : "dwelling";
          existingStruct = await storage.createStructure({
            sessionId,
            name: structure,
            structureType: sType,
          });
        }
        resolvedStructureId = existingStruct.id;
      }

      // Validate parentRoomId if provided (L3 subroom)
      if (parentRoomId) {
        const parentRoom = await storage.getRoom(parentRoomId);
        if (!parentRoom || parentRoom.sessionId !== sessionId) {
          return res.status(400).json({ message: "Invalid parentRoomId: parent room not found in this session" });
        }
      }

      // Check for duplicate: elevation rooms update dimensions, others return existing
      const isElevation = roomType && roomType.startsWith("exterior_elevation_");
      if (isElevation) {
        const existingRooms = await storage.getRooms(sessionId);
        const duplicate = existingRooms.find(
          (r) => r.roomType === roomType && (r.structure || "Main Dwelling") === structureName
        );
        if (duplicate) {
          if (dimensions) {
            const updated = await storage.updateRoom(duplicate.id, { dimensions, status: "in_progress" });
            if (updated) {
              await storage.updateSessionRoom(sessionId, updated.id);
              return res.status(200).json(updated);
            }
          }
          await storage.updateSessionRoom(sessionId, duplicate.id);
          return res.status(200).json(duplicate);
        }
      } else {
        const existingRoom = await storage.getRoomByName(sessionId, name);
        if (existingRoom) {
          return res.json(existingRoom); // idempotent
        }
      }


      const room = await storage.createRoom({
        sessionId,
        name,
        roomType: roomType || null,
        structure: structureName,
        structureId: resolvedStructureId,
        viewType: viewType || "interior",
        shapeType: shapeType || "rectangle",
        parentRoomId: parentRoomId || null,
        attachmentType: attachmentType || null,
        dimensions: dimensions || null,
        polygon: polygon || null,
        position: position || null,
        floor: floor || 1,
        facetLabel: facetLabel || null,
        pitch: pitch || null,
        status: "in_progress",
        phase: phase || null,
      });
      await storage.updateSessionRoom(sessionId, room.id);
      emit({ type: "inspection.roomCreated", sessionId, claimId: (await storage.getInspectionSession(sessionId))?.claimId, userId: req.user?.id, meta: { roomId: room.id } });

      // Return enriched response with hierarchy context
      const siblings = resolvedStructureId
        ? (await storage.getRoomsForStructure(resolvedStructureId)).filter(r => r.id !== room.id && !r.parentRoomId)
        : [];

      res.status(201).json({
        ...room,
        _context: {
          structureName: structure || "Main Dwelling",
          structureId: resolvedStructureId,
          siblingRooms: siblings.map(s => ({ id: s.id, name: s.name, status: s.status })),
          isSubArea: !!parentRoomId,
          parentRoomName: parentRoomId ? (await storage.getRoom(parentRoomId))?.name : null,
        },
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/rooms", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const [rooms, damages] = await Promise.all([
        storage.getRooms(sessionId),
        storage.getDamagesForSession(sessionId),
      ]);
      const damageCountByRoom = new Map<number, number>();
      for (const d of damages) {
        damageCountByRoom.set(d.roomId, (damageCountByRoom.get(d.roomId) || 0) + 1);
      }
      const enriched = rooms.map(r => ({
        ...r,
        damageCount: damageCountByRoom.get(r.id) || r.damageCount || 0,
      }));
      res.json(enriched);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/inspection/:sessionId/rooms/:roomId", authenticateRequest, async (req, res) => {
    try {
      const roomId = parseInt(param(req.params.roomId));
      const { status, name, dimensions, roomType, viewType, shapeType, position } = req.body;
      const updates: any = {};
      if (status !== undefined) updates.status = status;
      if (name !== undefined) updates.name = name;
      if (dimensions !== undefined) updates.dimensions = dimensions;
      if (roomType !== undefined) updates.roomType = roomType;
      if (viewType !== undefined) updates.viewType = viewType;
      if (shapeType !== undefined) updates.shapeType = shapeType;
      if (position !== undefined) updates.position = position;
      const room = await storage.updateRoom(roomId, updates);
      res.json(room);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/inspection/:sessionId/rooms/:roomId", authenticateRequest, async (req, res) => {
    try {
      const roomId = parseInt(param(req.params.roomId));
      await storage.deleteRoom(roomId);
      res.json({ success: true });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/inspection/:sessionId/rooms/:roomId/complete", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const roomId = parseInt(param(req.params.roomId));
      const room = await storage.completeRoom(roomId);
      emit({ type: "inspection.roomCompleted", sessionId, userId: req.user?.id, meta: { roomId } });
      res.json(room);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // Save room geometry (polygon + position from sketch canvas)
  app.patch("/api/inspection/:sessionId/rooms/:roomId/geometry", authenticateRequest, async (req, res) => {
    try {
      const roomId = parseInt(param(req.params.roomId));
      const { polygon, position } = req.body;
      const room = await storage.updateRoomGeometry(roomId, polygon, position);
      res.json(room);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Room Openings (L4: Deductions) ─────────────────

  app.post("/api/inspection/:sessionId/rooms/:roomId/openings", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const roomId = parseInt(param(req.params.roomId));
      const parsed = roomOpeningCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid opening data", errors: parsed.error.flatten().fieldErrors });
      }
      const data = parsed.data;
      // Resolve widthFt/heightFt from legacy width/height if needed
      const widthFt = data.widthFt || data.width || null;
      const heightFt = data.heightFt || data.height || null;
      // Auto-set goesToFloor for overhead doors
      const goesToFloor = data.openingType === "overhead_door" ? true : (data.goesToFloor || false);
      const opening = await storage.createOpening({
        sessionId,
        roomId,
        openingType: data.openingType,
        wallIndex: data.wallIndex ?? null,
        wallDirection: data.wallDirection || null,
        positionOnWall: data.positionOnWall,
        widthFt,
        heightFt,
        width: widthFt,
        height: heightFt,
        quantity: data.quantity || 1,
        label: data.label || null,
        opensInto: data.opensInto || null,
        goesToFloor,
        goesToCeiling: data.goesToCeiling || false,
        notes: data.notes || null,
      });
      res.status(201).json(opening);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/rooms/:roomId/openings", authenticateRequest, async (req, res) => {
    try {
      const roomId = parseInt(param(req.params.roomId));
      const openings = await storage.getRoomOpenings(roomId);
      res.json(openings);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/inspection/:sessionId/rooms/:roomId/openings/:openingId", authenticateRequest, async (req, res) => {
    try {
      const openingId = parseInt(param(req.params.openingId));
      const opening = await storage.getOpening(openingId);
      if (!opening) return res.status(404).json({ error: "Opening not found" });

      const parsed = openingUpdateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid update data", errors: parsed.error.flatten().fieldErrors });

      const updated = await storage.updateOpening(openingId, parsed.data);
      res.json(updated);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/inspection/:sessionId/rooms/:roomId/openings/:openingId", authenticateRequest, async (req, res) => {
    try {
      const openingId = parseInt(param(req.params.openingId));
      await storage.deleteOpening(openingId);
      res.json({ success: true });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Wall Openings (session-level endpoints) ──────────────────

  app.post("/api/inspection/:sessionId/openings", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const parsed = openingCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid opening data", errors: parsed.error.flatten().fieldErrors });
      }
      const data = parsed.data;
      // Auto-set goesToFloor for overhead doors
      const goesToFloor = data.openingType === "overhead_door" ? true : (data.goesToFloor || false);
      const opening = await storage.createOpening({
        sessionId,
        roomId: data.roomId,
        openingType: data.openingType,
        wallDirection: data.wallDirection || null,
        wallIndex: data.wallIndex ?? null,
        positionOnWall: data.positionOnWall,
        widthFt: data.widthFt,
        heightFt: data.heightFt,
        width: data.widthFt,
        height: data.heightFt,
        quantity: data.quantity || 1,
        opensInto: data.opensInto || null,
        goesToFloor,
        goesToCeiling: data.goesToCeiling || false,
        notes: data.notes || null,
      });
      res.status(201).json(opening);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/openings", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const openings = await storage.getOpeningsForSession(sessionId);
      res.json(openings);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/inspection/:sessionId/openings/:openingId", authenticateRequest, async (req, res) => {
    try {
      const openingId = parseInt(param(req.params.openingId));
      await storage.deleteOpening(openingId);
      res.status(204).send();
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Room Adjacency Endpoints ──────────────────────
  app.get("/api/sessions/:sessionId/adjacencies", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const adjacencies = await storage.getAdjacenciesForSession(sessionId);
      res.json(adjacencies);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/rooms/:roomId/adjacencies", authenticateRequest, async (req, res) => {
    try {
      const roomId = parseInt(param(req.params.roomId));
      const adjacencies = await storage.getAdjacentRooms(roomId);
      res.json(adjacencies);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/sessions/:sessionId/adjacencies", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const parsed = adjacencyCreateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const roomA = await storage.getRoom(parsed.data.roomIdA);
      const roomB = await storage.getRoom(parsed.data.roomIdB);
      if (!roomA || roomA.sessionId !== sessionId) return res.status(404).json({ error: "Room A not found in session" });
      if (!roomB || roomB.sessionId !== sessionId) return res.status(404).json({ error: "Room B not found in session" });
      if (parsed.data.roomIdA === parsed.data.roomIdB) return res.status(400).json({ error: "A room cannot be adjacent to itself" });

      const adjacency = await storage.createAdjacency({ ...parsed.data, sessionId });
      res.status(201).json(adjacency);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/adjacencies/:id", authenticateRequest, async (req, res) => {
    try {
      await storage.deleteAdjacency(parseInt(param(req.params.id)));
      res.status(204).send();
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Update Room Dimensions (for DIM_VARS recalculation) ──
  app.patch("/api/rooms/:roomId/dimensions", authenticateRequest, async (req, res) => {
    try {
      const roomId = parseInt(param(req.params.roomId));
      const room = await storage.getRoom(roomId);
      if (!room) return res.status(404).json({ error: "Room not found" });

      const existingDims = (room.dimensions as Record<string, any>) || {};
      const merged = { ...existingDims, ...req.body };

      // Recalculate DIM_VARS when length/width/height are present
      const dims = merged as RoomDimensions;
      if (dims.length && dims.width) {
        const openings = await storage.getOpeningsForRoom(roomId);
        const openingData: OpeningData[] = openings.map((o) => ({
          openingType: o.openingType,
          widthFt: o.widthFt ?? o.width ?? 0,
          heightFt: o.heightFt ?? o.height ?? 0,
          quantity: o.quantity ?? 1,
          opensInto: o.opensInto ?? null,
          goesToFloor: o.goesToFloor ?? false,
          goesToCeiling: o.goesToCeiling ?? false,
        }));
        const { beforeMW, afterMW } = calculateDimVars(dims, openingData);
        merged.dimVars = afterMW;
        merged.dimVarsBeforeMW = beforeMW;
      }

      const updated = await storage.updateRoomDimensions(roomId, merged);

      // Auto-rescope: re-derive quantities for existing scope items and line items
      let rescopedItems = 0;
      if (dims.length && dims.width) {
        try {
          const updatedRoom = await storage.getRoom(roomId);
          if (updatedRoom) {
            const openings = await storage.getOpeningsForRoom(roomId);
            const netDeduction = openings.reduce((sum, o) =>
              ((o.widthFt ?? o.width ?? 0) * (o.heightFt ?? o.height ?? 0) * (o.quantity ?? 1)) + sum, 0);

            // Re-derive scope item quantities
            const roomScopeItems = await storage.getScopeItemsForRoom(roomId);
            for (const si of roomScopeItems) {
              if (si.status !== "active" || !si.catalogCode) continue;
              const formula = si.quantityFormula;
              if (!formula || formula === "MANUAL" || formula === "EACH") continue;

              const qResult = deriveQuantity(updatedRoom, formula as QuantityFormula, netDeduction);
              if (qResult && qResult.quantity > 0) {
                await storage.updateScopeItem(si.id, { quantity: qResult.quantity });
              }
            }

            // Re-derive line item quantities
            const roomLineItems = await storage.getLineItemsForRoom(roomId);
            for (const li of roomLineItems) {
              if (!li.xactCode || li.provenance === "manual") continue;
              const catalogItem = await storage.getScopeLineItemByCode(li.xactCode);
              if (!catalogItem?.quantityFormula || catalogItem.quantityFormula === "MANUAL" || catalogItem.quantityFormula === "EACH") continue;

              const qResult = deriveQuantity(updatedRoom, catalogItem.quantityFormula as QuantityFormula, netDeduction);
              if (qResult && qResult.quantity > 0) {
                const unitPrice = parseFloat(String(li.unitPrice) || "0");
                const waste = li.wasteFactor || 0;
                const totalPrice = qResult.quantity * unitPrice * (1 + waste / 100);
                await storage.updateLineItem(li.id, {
                  quantity: String(qResult.quantity),
                  totalPrice: String(totalPrice.toFixed(2)),
                } as any);
                rescopedItems++;
              }
            }
          }
        } catch (rescopeErr) {
          logger.warn("DimUpdate", `Auto-rescope after dimension update failed for room ${roomId}`, rescopeErr as Error);
        }
      }

      res.json({ ...updated, rescopedItems });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Sketch Annotations (L5: Metadata overlays) ──────

  app.post("/api/inspection/:sessionId/rooms/:roomId/annotations", authenticateRequest, async (req, res) => {
    try {
      const roomId = parseInt(param(req.params.roomId));
      const parsed = sketchAnnotationCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid annotation data", errors: parsed.error.flatten().fieldErrors });
      }
      const annotation = await storage.createSketchAnnotation({ roomId, ...parsed.data });
      res.status(201).json(annotation);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/rooms/:roomId/annotations", authenticateRequest, async (req, res) => {
    try {
      const roomId = parseInt(param(req.params.roomId));
      const annotations = await storage.getSketchAnnotations(roomId);
      res.json(annotations);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/inspection/:sessionId/annotations/:annotationId", authenticateRequest, async (req, res) => {
    try {
      const annotationId = parseInt(param(req.params.annotationId));
      const annotation = await storage.getSketchAnnotation(annotationId);
      if (!annotation) return res.status(404).json({ message: "Annotation not found" });

      const parsed = sketchAnnotationUpdateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid update data", errors: parsed.error.flatten().fieldErrors });

      const updated = await storage.updateSketchAnnotation(annotationId, parsed.data);
      res.json(updated);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/inspection/:sessionId/annotations/:annotationId", authenticateRequest, async (req, res) => {
    try {
      const annotationId = parseInt(param(req.params.annotationId));
      await storage.deleteSketchAnnotation(annotationId);
      res.json({ success: true });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Sketch Templates ────────────────────────────────

  app.get("/api/sketch-templates", authenticateRequest, async (req, res) => {
    try {
      const category = req.query.category as string | undefined;
      const templates = await storage.getSketchTemplates(category);
      res.json(templates);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Damage Observations ──────────────────────────

  app.post("/api/inspection/:sessionId/damages", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const { roomId, description, damageType, severity, location, measurements } = req.body;
      if (!roomId || !description) {
        return res.status(400).json({ message: "roomId and description are required" });
      }
      const damage = await storage.createDamage({
        sessionId,
        roomId,
        description,
        damageType: damageType || null,
        severity: severity || null,
        location: location || null,
        measurements: measurements || null,
      });
      await storage.incrementRoomDamageCount(roomId);
      emit({ type: "inspection.damageAdded", sessionId, userId: req.user?.id, meta: { roomId, damageId: damage.id } });

      // Auto-trigger scope assembly
      let autoScope: Record<string, unknown> | null = null;
      try {
        const room = await storage.getRoom(roomId);
        if (room) {
          const { assembleScope } = await import("../scopeAssemblyService");
          const result = await assembleScope(storage, sessionId, room, damage);
          const itemsCreated = result.created.length + result.companionItems.length;
          const items: Array<{ code: string; description: string; quantity: number; unit: string; unitPrice?: number; totalPrice?: number; source: string }> = [];

          async function lookupPrice(catalogCode: string, activityType: string | null): Promise<number> {
            const act = activityType || "install";
            let rp = await storage.getRegionalPrice(catalogCode, "FLFM8X_NOV22", act);
            if (!rp) rp = await storage.getRegionalPrice(catalogCode, "US_NATIONAL", act);
            if (!rp) return 0;
            return (Number(rp.materialCost) || 0) + (Number(rp.laborCost) || 0) + (Number(rp.equipmentCost) || 0);
          }

          // Derive quantities using the catalog's quantityFormula via scopeQuantityEngine
          // (scope items already have derived quantities from assembleScope v5)
          const allScopeItems = [...result.created, ...result.companionItems];
          for (const si of allScopeItems) {
            const actType = si.activityType || "install";
            const up = await lookupPrice(si.catalogCode, actType);
            // Use the quantity already derived by assembleScope (via scopeQuantityEngine)
            // which uses the catalog's quantityFormula field for accurate derivation
            const qty = parseFloat((si.quantity || 1).toFixed(2));
            const total = up * qty * (1 + (Number(si.wasteFactor) || 0) / 100);

            const lineItem = await storage.createLineItem({
              sessionId,
              roomId: si.roomId,
              damageId: si.damageId,
              category: si.tradeCode,
              action: si.activityType || "replace",
              description: si.description,
              xactCode: si.catalogCode,
              quantity: String(qty),
              unit: si.unit || "EA",
              unitPrice: String(up.toFixed(2)),
              totalPrice: String(total.toFixed(2)),
              tradeCode: si.tradeCode,
              coverageType: si.coverageType || "A",
              provenance: "auto_scope",
              wasteFactor: si.wasteFactor ? Math.round(si.wasteFactor) : null,
              applyOAndP: false,
            });

            items.push({
              code: si.catalogCode,
              description: si.description,
              quantity: qty,
              unit: si.unit || "EA",
              unitPrice: up,
              totalPrice: total,
              source: result.created.includes(si) ? "auto_scope" : "companion",
            });
          }
          const roomDims = room.dimensions as Record<string, unknown> | null;
          const dimensionsAvailable = !!(roomDims && (roomDims.length as number) > 0 && (roomDims.width as number) > 0);
          autoScope = {
            itemsCreated,
            itemsGenerated: itemsCreated,
            items,
            companionItems: result.companionItems.length,
            manualQuantityNeeded: result.manualQuantityNeeded,
            warnings: result.warnings,
            dimensionsAvailable,
            dimensionWarning: !dimensionsAvailable
              ? "Room dimensions not set — quantities default to 1. Provide dimensions with update_room_dimensions for accurate quantities."
              : undefined,
          };
        }
      } catch (scopeErr) {
        logger.apiError(req.method, req.path, scopeErr as Error);
      }

      res.status(201).json({ damage, autoScope });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/damages", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const roomId = req.query.roomId ? parseInt(req.query.roomId as string) : undefined;
      const damages = roomId
        ? await storage.getDamages(roomId)
        : await storage.getDamagesForSession(sessionId);
      res.json(damages);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/inspection/:sessionId/water-classification", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const { waterSource, affectedArea, visibleContamination, standingWaterStart, standingWaterEnd, notes } = req.body;
      if (!waterSource || visibleContamination === undefined) {
        return res.status(400).json({ message: "waterSource and visibleContamination are required" });
      }
      const result = await handleWaterDamageProtocol(sessionId, {
        waterSource,
        affectedArea: affectedArea ? Number(affectedArea) : undefined,
        visibleContamination: Boolean(visibleContamination),
        standingWaterStart: standingWaterStart ? new Date(standingWaterStart) : undefined,
        standingWaterEnd: standingWaterEnd ? new Date(standingWaterEnd) : undefined,
        notes,
      });
      res.json(result);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Line Items ───────────────────────────────────

  app.post("/api/inspection/:sessionId/line-items", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const parsed = lineItemCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid line item data", errors: parsed.error.flatten().fieldErrors });
      }
      const { roomId, damageId, category, action, description, xactCode, quantity, unit, unitPrice, depreciationType, wasteFactor, coverageBucket, qualityGrade, applyOAndP, macroSource, age, lifeExpectancy, depreciationPercentage } = parsed.data;
      let wf = wasteFactor ?? 0;
      const qty = quantity || 1;
      let up = unitPrice || 0;
      let finalDescription = description;
      let finalUnit = unit || null;
      let catalogMatch = false;

      // PROMPT-18 Part E: If xactCode provided, look up catalog pricing
      if (xactCode) {
        const catalogItem = await storage.getScopeLineItemByCode(xactCode);
        if (catalogItem) {
          catalogMatch = true;
          finalDescription = description || catalogItem.description || xactCode;
          finalUnit = unit || catalogItem.unit;
          wf = wasteFactor ?? Math.round((catalogItem.defaultWasteFactor ?? 0));

          let regionalPrice = await storage.getRegionalPrice(xactCode, "FLFM8X_NOV22", "install");
          if (!regionalPrice) regionalPrice = await storage.getRegionalPrice(xactCode, "US_NATIONAL", "install");
          if (regionalPrice) {
            const baseCost =
              (Number(regionalPrice.materialCost) || 0) +
              (Number(regionalPrice.laborCost) || 0) +
              (Number(regionalPrice.equipmentCost) || 0);
            up = baseCost;
          }
        }
      }

      let totalPrice = Math.round(qty * up * (1 + wf / 100) * 100) / 100;
      if (applyOAndP) {
        totalPrice = Math.round(totalPrice * 1.20 * 100) / 100; // 10% overhead + 10% profit (additive)
      }

      const depreciation = calculateDepreciation({
        totalPrice,
        age: age || null,
        lifeExpectancy: lifeExpectancy || null,
        category,
        description: finalDescription,
        depreciationType: depreciationType || "Recoverable",
      });

      const item = await storage.createLineItem({
        sessionId,
        roomId: roomId || null,
        damageId: damageId || null,
        category,
        action: action || null,
        description: finalDescription,
        xactCode: xactCode || null,
        quantity: qty,
        unit: finalUnit,
        unitPrice: up,
        totalPrice,
        depreciationType: depreciationType || "Recoverable",
        wasteFactor: wf,
        coverageBucket: coverageBucket || "Coverage A",
        qualityGrade: qualityGrade || null,
        applyOAndP: applyOAndP || false,
        macroSource: macroSource || null,
        age: age || null,
        lifeExpectancy: depreciation.lifeExpectancy || null,
        depreciationPercentage: depreciationPercentage ?? depreciation.depreciationPercentage,
        depreciationAmount: depreciation.depreciationAmount,
      } as any);
      emit({ type: "inspection.lineItemAdded", sessionId, userId: req.user?.id, meta: { lineItemId: item.id } });
      res.status(201).json({ ...item, catalogMatch });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/line-items", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const items = await storage.getLineItems(sessionId);
      res.json(items);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/estimate-summary", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const summary = await storage.getEstimateSummary(sessionId);
      res.json(summary);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/inspection/:sessionId/line-items/:id", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(param(req.params.id));
      const allowedFields = z.object({
        category: z.string().optional(),
        action: z.string().optional(),
        description: z.string().optional(),
        xactCode: z.string().optional(),
        quantity: z.number().optional(),
        unit: z.string().optional(),
        unitPrice: z.number().optional(),
        totalPrice: z.number().optional(),
        depreciationType: z.string().optional(),
        depreciationRate: z.number().min(0).max(100).nullable().optional(),
        wasteFactor: z.number().optional(),
        roomId: z.number().optional(),
        damageId: z.number().optional(),
        coverageBucket: z.string().optional(),
        qualityGrade: z.string().optional(),
        applyOAndP: z.boolean().optional(),
        macroSource: z.string().optional(),
        age: z.number().nullable().optional(),
        lifeExpectancy: z.number().nullable().optional(),
      }).strict();
      const parsed = allowedFields.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid update fields", errors: parsed.error.flatten() });
      }

      const updates: any = { ...parsed.data };

      if (updates.age !== undefined || updates.lifeExpectancy !== undefined || updates.quantity !== undefined || updates.unitPrice !== undefined) {
        const existing = await storage.getLineItemById(id);
        if (existing) {
          const effectivePrice = updates.totalPrice ?? Number(existing.totalPrice) ?? 0;
          const depreciation = calculateDepreciation({
            totalPrice: effectivePrice,
            age: updates.age !== undefined ? updates.age : (existing.age ?? null),
            lifeExpectancy: updates.lifeExpectancy !== undefined ? updates.lifeExpectancy : (existing.lifeExpectancy ?? null),
            category: updates.category || existing.category,
            description: updates.description || existing.description,
            depreciationType: updates.depreciationType || existing.depreciationType || "Recoverable",
          });
          updates.lifeExpectancy = depreciation.lifeExpectancy || updates.lifeExpectancy || existing.lifeExpectancy;
          updates.depreciationPercentage = depreciation.depreciationPercentage;
          updates.depreciationAmount = depreciation.depreciationAmount;
        }
      }

      const item = await storage.updateLineItem(id, updates);
      if (item?.sessionId) emit({ type: "inspection.lineItemUpdated", sessionId: item.sessionId, userId: req.user?.id, meta: { lineItemId: id } });
      res.json(item);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/inspection/:sessionId/line-items/:id", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(param(req.params.id));
      const sessionId = parseInt(param(req.params.sessionId));
      await storage.deleteLineItem(id);
      emit({ type: "inspection.lineItemDeleted", sessionId, userId: req.user?.id, meta: { lineItemId: id } });
      res.status(204).send();
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Smart Macros ─────────────────────────────────

  const SMART_MACRO_BUNDLES: Record<string, Array<{ category: string; action: string; description: string; xactCode: string; unit: string; defaultWaste: number; depreciationType: string }>> = {
    roof_replacement_laminated: [
      { category: "Roofing", action: "Tear Off", description: "Remove composition shingles - laminated", xactCode: "RFG-TEAR-LM", unit: "SQ", defaultWaste: 0, depreciationType: "Recoverable" },
      { category: "Roofing", action: "Install", description: "Laminated composition shingles (architectural)", xactCode: "RFG-SHIN-AR", unit: "SQ", defaultWaste: 10, depreciationType: "Recoverable" },
      { category: "Roofing", action: "Install", description: "Roofing felt - 15 lb.", xactCode: "RFG-FELT-15", unit: "SQ", defaultWaste: 10, depreciationType: "Recoverable" },
      { category: "Roofing", action: "Install", description: "Ice & water barrier", xactCode: "RFG-ICE-WB", unit: "SQ", defaultWaste: 5, depreciationType: "Recoverable" },
      { category: "Roofing", action: "R&R", description: "Drip edge - aluminum", xactCode: "RFG-DRIP-AL", unit: "LF", defaultWaste: 5, depreciationType: "Recoverable" },
      { category: "Roofing", action: "Install", description: "Ridge vent - aluminum", xactCode: "RFG-RIDGE-V", unit: "LF", defaultWaste: 0, depreciationType: "Recoverable" },
    ],
    roof_replacement_3tab: [
      { category: "Roofing", action: "Tear Off", description: "Remove composition shingles - 3 tab", xactCode: "RFG-TEAR-3T", unit: "SQ", defaultWaste: 0, depreciationType: "Recoverable" },
      { category: "Roofing", action: "Install", description: "3-tab composition shingles", xactCode: "RFG-SHIN-3T", unit: "SQ", defaultWaste: 10, depreciationType: "Recoverable" },
      { category: "Roofing", action: "Install", description: "Roofing felt - 15 lb.", xactCode: "RFG-FELT-15", unit: "SQ", defaultWaste: 10, depreciationType: "Recoverable" },
      { category: "Roofing", action: "Install", description: "Ice & water barrier", xactCode: "RFG-ICE-WB", unit: "SQ", defaultWaste: 5, depreciationType: "Recoverable" },
      { category: "Roofing", action: "R&R", description: "Drip edge - aluminum", xactCode: "RFG-DRIP-AL", unit: "LF", defaultWaste: 5, depreciationType: "Recoverable" },
      { category: "Roofing", action: "Install", description: "Ridge vent - aluminum", xactCode: "RFG-RIDGE-V", unit: "LF", defaultWaste: 0, depreciationType: "Recoverable" },
    ],
    interior_paint_walls_ceiling: [
      { category: "Painting", action: "Paint", description: "Seal/prime then paint walls - 2 coats", xactCode: "PTG-WALL-2C", unit: "SF", defaultWaste: 0, depreciationType: "Recoverable" },
      { category: "Painting", action: "Paint", description: "Seal/prime then paint ceiling - 2 coats", xactCode: "PTG-CEIL-2C", unit: "SF", defaultWaste: 0, depreciationType: "Recoverable" },
      { category: "Painting", action: "Paint", description: "Paint baseboard trim", xactCode: "PTG-TRIM-BS", unit: "LF", defaultWaste: 0, depreciationType: "Recoverable" },
      { category: "Painting", action: "Paint", description: "Paint door/window casing trim", xactCode: "PTG-TRIM-CS", unit: "LF", defaultWaste: 0, depreciationType: "Recoverable" },
    ],
    water_mitigation_dryout: [
      { category: "General", action: "Labor Only", description: "Water extraction - wet vacuum", xactCode: "WTR-EXTR-WV", unit: "SF", defaultWaste: 0, depreciationType: "Paid When Incurred" },
      { category: "General", action: "Install", description: "Dehumidifier setup and monitoring", xactCode: "WTR-DEHU-SM", unit: "DAY", defaultWaste: 0, depreciationType: "Paid When Incurred" },
      { category: "General", action: "Install", description: "Air mover / fan placement", xactCode: "WTR-AIRM-PL", unit: "DAY", defaultWaste: 0, depreciationType: "Paid When Incurred" },
      { category: "General", action: "Labor Only", description: "Moisture monitoring and documentation", xactCode: "WTR-MONI-DC", unit: "HR", defaultWaste: 0, depreciationType: "Paid When Incurred" },
      { category: "General", action: "Clean", description: "Anti-microbial treatment", xactCode: "WTR-ANTI-MC", unit: "SF", defaultWaste: 0, depreciationType: "Paid When Incurred" },
    ],
  };

  app.post("/api/inspection/:sessionId/smart-macro", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const parsed = smartMacroSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid smart macro data", errors: parsed.error.flatten().fieldErrors });
      }
      const { macroType, severity, wasteFactor, roomId } = parsed.data;
      const bundle = SMART_MACRO_BUNDLES[macroType];
      if (!bundle) {
        return res.status(400).json({ message: `Unknown macro type: ${macroType}` });
      }

      const createdItems = [];
      for (const template of bundle) {
        const wf = wasteFactor ?? template.defaultWaste;

        // Look up catalog price for this line item
        let unitPrice = 0;
        let totalPrice = 0;
        const catalogItem = await lookupCatalogItem(template.xactCode);
        if (catalogItem) {
          let regionalPrice = await getRegionalPrice(template.xactCode, "FLFM8X_NOV22", "install");
          if (!regionalPrice) regionalPrice = await getRegionalPrice(template.xactCode, "US_NATIONAL", "install");
          if (regionalPrice) {
            const materialCost = regionalPrice.materialCost || 0;
            const laborCost = regionalPrice.laborCost || 0;
            const equipmentCost = regionalPrice.equipmentCost || 0;
            unitPrice = Math.round((materialCost * (1 + wf / 100) + laborCost + equipmentCost) * 100) / 100;
            totalPrice = unitPrice; // quantity is 1
          }
        }

        const item = await storage.createLineItem({
          sessionId,
          roomId: roomId || null,
          damageId: null,
          category: template.category,
          action: template.action,
          description: severity === "premium" ? `${template.description} - Premium Grade` : template.description,
          xactCode: template.xactCode,
          quantity: 1,
          unit: template.unit,
          unitPrice,
          totalPrice,
          depreciationType: template.depreciationType,
          wasteFactor: wf,
          coverageBucket: "Dwelling",
          qualityGrade: severity === "premium" ? "High Grade" : severity === "heavy" ? "Standard" : null,
          applyOAndP: false,
          macroSource: macroType,
        });
        createdItems.push(item);
      }

      res.status(201).json({
        macroType,
        itemCount: createdItems.length,
        items: createdItems,
        message: `Applied ${macroType} bundle: ${createdItems.length} line items created.`,
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Related Items (Waterfall Logic) ────────────

  const RELATED_ITEMS_MAP: Record<string, Record<string, string[]>> = {
    Cabinetry: {
      default: ["Detach/Reset Plumbing (angle stops, P-trap, supply lines)", "Disconnect/Reconnect Electrical (disposal, dishwasher)", "Countertop Detach & Reset", "Backsplash R&R if adhered to cabinet"],
      "Remove Vanity": ["Detach/Reset Plumbing (angle stops, P-trap, supply lines)", "Disconnect faucet and drain assembly", "Mirror removal if mounted to vanity"],
      "R&R Kitchen Cabinets": ["Detach/Reset Plumbing (angle stops, P-trap, supply lines)", "Disconnect/Reconnect Electrical (disposal, dishwasher)", "Countertop Detach & Reset", "Backsplash R&R", "Appliance pullout and reset"],
    },
    Roofing: {
      default: ["Drip edge R&R", "Ice & water barrier at eaves/valleys", "Pipe jack/roof boot replacement", "Step flashing at wall intersections", "Ridge cap shingles", "Satellite dish detach & reset"],
      "Tear Off Shingles": ["Felt/underlayment replacement", "Valley metal re-flash", "Pipe jack/boot replacement", "Drip edge inspection/replacement", "Starter strip shingles"],
    },
    Drywall: {
      default: ["Texture matching (knock-down, orange peel, smooth)", "Prime and paint to match (2 coats minimum)", "Baseboard R&R if removing lower drywall", "Outlet/switch plate removal and reset"],
      "R&R Drywall": ["Texture matching (knock-down, orange peel, smooth)", "Prime and paint to match (2 coats minimum)", "Baseboard R&R if removing lower drywall", "Outlet/switch plate removal and reset", "Insulation replacement behind drywall"],
    },
    Siding: {
      default: ["House wrap / moisture barrier behind siding", "J-channel and trim pieces", "Light fixture detach & reset", "Hose bib detach & reset", "Address numbers/mailbox detach & reset"],
    },
    Flooring: {
      default: ["Baseboard/shoe mold R&R", "Transition strips at doorways", "Furniture move-out and move-back", "Subfloor inspection/replacement if water damage", "Underlayment/padding replacement"],
    },
    Plumbing: {
      default: ["Access panel creation if behind wall", "Drywall repair after access", "Fixture detach & reset"],
    },
    Electrical: {
      default: ["Permit fees if code requires", "Outlet/switch upgrade to current code", "GFCI protection if near water source"],
    },
    Windows: {
      default: ["Interior casing/trim R&R", "Exterior trim/J-channel", "Flashing and sealant", "Window screen R&R", "Blinds/window treatment detach & reset"],
    },
    Doors: {
      default: ["Door hardware R&R (hinges, handle, deadbolt)", "Weatherstripping replacement", "Threshold R&R", "Door casing/trim R&R", "Lockset re-key if exterior door"],
    },
  };

  app.post("/api/inspection/:sessionId/check-related-items", authenticateRequest, async (req, res) => {
    try {
      const parsed = checkRelatedItemsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.flatten().fieldErrors });
      }
      const { primaryCategory, actionTaken } = parsed.data;
      const categoryMap = RELATED_ITEMS_MAP[primaryCategory];
      if (!categoryMap) {
        return res.json({ suggestions: [], message: "No related items found for this category." });
      }

      const suggestions = (actionTaken && categoryMap[actionTaken])
        ? categoryMap[actionTaken]
        : categoryMap.default || [];

      res.json({
        primaryCategory,
        actionTaken: actionTaken || null,
        suggestions,
        message: suggestions.length > 0
          ? `Check for: ${suggestions.join("; ")}`
          : "No additional items suggested for this action.",
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Test Squares ────────────────────────────────

  app.post("/api/inspection/:sessionId/test-squares", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const parsed = testSquareCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid test square data", errors: parsed.error.flatten().fieldErrors });
      }
      const { roomId, hailHits, windCreases, pitch, result, notes } = parsed.data;

      const testSquare = await storage.createTestSquare({
        sessionId,
        roomId: roomId || null,
        hailHits,
        windCreases: windCreases || 0,
        pitch,
        result: result || (hailHits >= 8 ? "fail" : "pass"),
        notes: notes || null,
      });

      // Determine steep charge applicability
      const pitchParts = pitch.split("/");
      const pitchRise = parseInt(pitchParts[0]) || 0;
      const steepCharge = pitchRise > 7;

      res.status(201).json({
        ...testSquare,
        _analysis: {
          steepCharge,
          steepChargeNote: steepCharge ? `Pitch ${pitch} exceeds 7/12 — steep charge applies to labor.` : null,
          recommendation: hailHits >= 8
            ? "Test square FAILS — sufficient damage for full slope replacement."
            : hailHits >= 4
              ? "Borderline — consider additional test squares on this facet."
              : "Test square passes — damage below replacement threshold.",
        },
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/test-squares", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const roomId = req.query.roomId ? parseInt(req.query.roomId as string) : undefined;
      const squares = roomId
        ? await storage.getTestSquaresForRoom(roomId)
        : await storage.getTestSquares(sessionId);
      res.json(squares);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Scope Assembly ─────────────────────────────────

  app.post("/api/inspection/:sessionId/scope/assemble", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const { roomId, damageId } = req.body;

      if (!roomId || !damageId) {
        return res.status(400).json({ message: "roomId and damageId are required" });
      }

      const room = await storage.getRoom(roomId);
      if (!room) return res.status(404).json({ message: "Room not found" });

      const damages = await storage.getDamages(roomId);
      const damage = damages.find(d => d.id === damageId);
      if (!damage) return res.status(404).json({ message: "Damage not found" });

      const { assembleScope } = await import("../scopeAssemblyService");
      const result = await assembleScope(storage, sessionId, room, damage);

      res.json({
        created: result.created.length,
        companions: result.companionItems.length,
        manualNeeded: result.manualQuantityNeeded,
        warnings: result.warnings,
        items: [...result.created, ...result.companionItems],
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Scope assembly failed" });
    }
  });

  app.post("/api/inspection/:sessionId/scope/apply-template", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const { roomId, templateName, includeAutoOnly = true } = req.body;

      const session = await storage.getInspectionSession(sessionId);
      if (!session) return res.status(404).json({ error: "Session not found" });

      const claim = await storage.getClaim(session.claimId);
      if (!claim) return res.status(404).json({ error: "Claim not found" });

      const room = await storage.getRoom(roomId);
      if (!room) return res.status(404).json({ error: "Room not found" });

      const { getMatchingTemplates } = await import("../perilTemplates");
      const { lookupCatalogItem } = await import("../estimateEngine");
      const { deriveQuantity } = await import("../scopeQuantityEngine");

      const perilType = (claim.perilType || "water").toLowerCase().replace(/_/g, " ").split(" ")[0] || "water";
      const roomType = room.roomType || "interior_bedroom";

      const templates = getMatchingTemplates(perilType, roomType);
      const template = templateName
        ? templates.find((t: { name: string }) => t.name === templateName)
        : templates[0];

      if (!template) {
        return res.status(404).json({
          error: "No matching template found",
          availableTemplates: templates.map((t: { name: string }) => t.name),
        });
      }

      const appliedItems: unknown[] = [];
      const suggestedItems: unknown[] = [];

      for (const templateItem of template.items) {
        if (includeAutoOnly && !templateItem.autoInclude) {
          suggestedItems.push({ catalogCode: templateItem.catalogCode, perilNotes: templateItem.perilNotes });
          continue;
        }

        const catalogItem = await lookupCatalogItem(templateItem.catalogCode);
        if (!catalogItem) continue;

        const formula = (catalogItem.quantityFormula || "MANUAL") as import("../scopeQuantityEngine").QuantityFormula;
        const qResult = formula !== "MANUAL" ? deriveQuantity(room, formula) : null;
        const quantity = (qResult?.quantity ?? 1) * (templateItem.quantityMultiplier || 1);

        if (quantity <= 0) continue;

        const scopeItem = await storage.createScopeItem({
          sessionId,
          roomId,
          damageId: null,
          catalogCode: templateItem.catalogCode,
          description: catalogItem.description,
          tradeCode: catalogItem.tradeCode,
          quantity,
          unit: catalogItem.unit,
          quantityFormula: catalogItem.quantityFormula,
          provenance: "template",
          coverageType: (catalogItem.coverageType as string) || "A",
          activityType: (catalogItem.activityType as string) || "replace",
          wasteFactor: catalogItem.defaultWasteFactor ?? null,
          status: "active",
          parentScopeItemId: null,
        });

        appliedItems.push({
          ...scopeItem,
          perilNotes: templateItem.perilNotes,
          needsManualQuantity: !qResult || qResult.quantity === 0,
        });
      }

      await storage.recalculateScopeSummary(sessionId);

      res.json({
        templateName: template.name,
        appliedCount: appliedItems.length,
        appliedItems,
        suggestedItems,
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ error: "Template application failed" });
    }
  });

  app.get("/api/inspection/:sessionId/scope/items", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const items = await storage.getScopeItems(sessionId);
      res.json(items);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/scope/summary", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      let summary = await storage.getScopeSummary(sessionId);
      if (summary.length === 0) {
        summary = await storage.recalculateScopeSummary(sessionId);
      }
      res.json(summary);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/inspection/:sessionId/scope/items/:id", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(param(req.params.id));
      const sessionId = parseInt(param(req.params.sessionId));
      const { quantity, description, wasteFactor, status } = req.body;
      const updates: Record<string, unknown> = {};
      if (quantity !== undefined) updates.quantity = quantity;
      if (description !== undefined) updates.description = description;
      if (wasteFactor !== undefined) updates.wasteFactor = wasteFactor;
      if (status !== undefined) updates.status = status;

      const item = await storage.updateScopeItem(id, updates as any);
      if (item) await storage.recalculateScopeSummary(sessionId);
      res.json(item);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/scope/validate", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const [scopeItems, rooms, damages] = await Promise.all([
        storage.getScopeItems(sessionId),
        storage.getRooms(sessionId),
        storage.getDamagesForSession(sessionId),
      ]);
      const { validateScopeCompleteness } = await import("../scopeValidation");
      const validation = await validateScopeCompleteness(storage, sessionId, scopeItems, rooms, damages);
      res.json(validation);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/inspection/:sessionId/scope/auto-scope-room", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const { roomId } = req.body;
      if (!roomId || typeof roomId !== "number") {
        return res.status(400).json({ message: "roomId is required and must be a number" });
      }

      const room = await storage.getRoom(roomId);
      if (!room) return res.status(404).json({ message: "Room not found" });

      let damages = (await storage.getDamagesForSession(sessionId)).filter(d => d.roomId === roomId);

      if (damages.length === 0) {
        const genericDamage = await storage.createDamage({
          sessionId,
          roomId,
          damageType: "general_damage",
          severity: "moderate",
          description: "Auto-scope: general room assessment",
          location: null,
        });
        damages = [genericDamage];
      }

      let totalCreated = 0;
      const allWarnings: string[] = [];
      const createdLineItems: any[] = [];

      for (const damage of damages) {
        const result = await assembleScope(storage, sessionId, room, damage);
        totalCreated += result.created.length + result.companionItems.length;
        allWarnings.push(...result.warnings);

        const allScopeItems = [...result.created, ...result.companionItems];
        for (const scopeItem of allScopeItems) {
          const scopeActType = scopeItem.activityType || "install";
          let price = await storage.getRegionalPrice(scopeItem.catalogCode, "FLFM8X_NOV22", scopeActType);
          if (!price) price = await storage.getRegionalPrice(scopeItem.catalogCode, "US_NATIONAL", scopeActType);
          const materialCost = price ? parseFloat(price.materialCost as string || "0") : 0;
          const laborCost = price ? parseFloat(price.laborCost as string || "0") : 0;
          const equipmentCost = price ? parseFloat(price.equipmentCost as string || "0") : 0;
          const unitPrice = materialCost + laborCost + equipmentCost;
          const totalPrice = unitPrice * scopeItem.quantity;

          const lineItem = await storage.createLineItem({
            sessionId,
            roomId: scopeItem.roomId,
            damageId: scopeItem.damageId,
            category: scopeItem.tradeCode,
            action: scopeItem.activityType || "replace",
            description: scopeItem.description,
            xactCode: scopeItem.catalogCode,
            quantity: String(scopeItem.quantity),
            unit: scopeItem.unit,
            unitPrice: String(unitPrice),
            totalPrice: String(totalPrice),
            tradeCode: scopeItem.tradeCode,
            coverageType: scopeItem.coverageType || "A",
            provenance: "auto_scope",
            wasteFactor: scopeItem.wasteFactor ? Math.round(scopeItem.wasteFactor) : null,
            applyOAndP: false,
          });
          createdLineItems.push(lineItem);
        }
      }

      res.json({ created: totalCreated, warnings: allWarnings, lineItems: createdLineItems });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/inspection/:sessionId/scope/rescope", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));

      const rooms = await storage.getRooms(sessionId);
      if (rooms.length === 0) {
        return res.status(400).json({ message: "No rooms found for this session" });
      }

      const allDamages = await storage.getDamagesForSession(sessionId);
      if (allDamages.length === 0) {
        return res.status(400).json({ message: "No damage observations found for this session" });
      }

      let totalCreated = 0;
      const allWarnings: string[] = [];
      const createdLineItems: any[] = [];

      for (const room of rooms) {
        const roomDamages = allDamages.filter(d => d.roomId === room.id);
        if (roomDamages.length === 0) continue;

        for (const damage of roomDamages) {
          const result = await assembleScope(storage, sessionId, room, damage);
          totalCreated += result.created.length + result.companionItems.length;
          allWarnings.push(...result.warnings);

          const allScopeItems = [...result.created, ...result.companionItems];
          for (const scopeItem of allScopeItems) {
            const actType = scopeItem.activityType || "install";
            let price = await storage.getRegionalPrice(scopeItem.catalogCode, "FLFM8X_NOV22", actType);
            if (!price) price = await storage.getRegionalPrice(scopeItem.catalogCode, "US_NATIONAL", actType);
            const materialCost = price ? parseFloat(price.materialCost as string || "0") : 0;
            const laborCost = price ? parseFloat(price.laborCost as string || "0") : 0;
            const equipmentCost = price ? parseFloat(price.equipmentCost as string || "0") : 0;
            const unitPrice = materialCost + laborCost + equipmentCost;
            const totalPrice = unitPrice * scopeItem.quantity;

            const lineItem = await storage.createLineItem({
              sessionId,
              roomId: scopeItem.roomId,
              damageId: scopeItem.damageId,
              category: scopeItem.tradeCode,
              action: scopeItem.activityType || "replace",
              description: scopeItem.description,
              xactCode: scopeItem.catalogCode,
              quantity: String(scopeItem.quantity),
              unit: scopeItem.unit,
              unitPrice: String(unitPrice),
              totalPrice: String(totalPrice),
              tradeCode: scopeItem.tradeCode,
              coverageType: scopeItem.coverageType || "A",
              provenance: "auto_scope",
              wasteFactor: scopeItem.wasteFactor ? Math.round(scopeItem.wasteFactor) : null,
              applyOAndP: false,
            });
            createdLineItems.push(lineItem);
          }
        }
      }

      res.json({
        created: totalCreated,
        rooms: rooms.length,
        damages: allDamages.length,
        lineItems: createdLineItems.length,
        warnings: allWarnings,
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/line-items/by-room", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const allLineItems = await storage.getLineItems(sessionId);

      const byRoom: Record<string, { items: any[]; total: number; count: number }> = {};
      let grandTotal = 0;

      for (const item of allLineItems) {
        const key = String(item.roomId || "unassigned");
        if (!byRoom[key]) {
          byRoom[key] = { items: [], total: 0, count: 0 };
        }
        byRoom[key].items.push(item);
        byRoom[key].count += 1;
        const itemTotal = parseFloat(item.totalPrice as string || "0");
        byRoom[key].total += itemTotal;
        grandTotal += itemTotal;
      }

      for (const key of Object.keys(byRoom)) {
        byRoom[key].total = Math.round(byRoom[key].total * 100) / 100;
      }
      grandTotal = Math.round(grandTotal * 100) / 100;

      res.json({ byRoom, grandTotal });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Photos ───────────────────────────────────────

  app.post("/api/inspection/:sessionId/photos", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const { roomId, damageId, imageBase64, autoTag, caption, photoType } = req.body;
      if (!imageBase64) {
        return res.status(400).json({ message: "imageBase64 is required" });
      }
      if (!imageBase64.startsWith("data:image/")) {
        return res.status(400).json({ message: "Only image uploads are supported" });
      }

      const { buffer: fileBuffer, wasTruncated } = decodeBase64Payload(imageBase64, MAX_PHOTO_BYTES);
      if (wasTruncated) {
        return res.status(413).json({ message: "Image exceeds max upload size (10MB)" });
      }
      // Detect content type from data URI prefix
      const mimeMatch = imageBase64.match(/^data:(image\/\w+);/);
      const contentType = mimeMatch ? mimeMatch[1] : "image/jpeg";
      const ext = contentType === "image/png" ? ".png" : contentType === "image/webp" ? ".webp" : ".jpg";

      const rawTag = autoTag || `photo_${Date.now()}`;
      const tag = rawTag
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "_")
        .replace(/-+/g, "-")
        .substring(0, 60) || `photo_${Date.now()}`;
      const storagePath = `inspections/${sessionId}/${tag}${ext}`;

      const { error } = await supabase.storage
        .from(PHOTOS_BUCKET)
        .upload(storagePath, fileBuffer, {
          contentType,
          upsert: true,
        });

      if (error) {
        logger.error("PhotoUpload", "Photo upload failed", error);
        return res.status(502).json({ message: "Photo upload failed" });
      }

      const photo = await storage.createPhoto({
        sessionId,
        roomId: roomId || null,
        damageId: damageId || null,
        storagePath,
        autoTag: tag,
        caption: caption || null,
        photoType: photoType || null,
      });

      if (roomId) {
        await storage.incrementRoomPhotoCount(roomId);
      }
      emit({ type: "inspection.photoUploaded", sessionId, userId: req.user?.id, meta: { photoId: photo.id } });

      res.status(201).json({ photoId: photo.id, storagePath: photo.storagePath });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/photos", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const photos = await storage.getPhotos(sessionId);
      const photosWithUrls = await Promise.all(photos.map(async (photo) => {
        let signedUrl = null;
        if (photo.storagePath) {
          const { data } = await supabase.storage
            .from(PHOTOS_BUCKET)
            .createSignedUrl(photo.storagePath, 3600);
          if (data?.signedUrl) signedUrl = data.signedUrl;
        }
        return { ...photo, signedUrl };
      }));
      res.json(photosWithUrls);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // DELETE /api/inspection/:sessionId/photos/:photoId
  app.delete("/api/inspection/:sessionId/photos/:photoId", authenticateRequest, async (req, res) => {
    try {
      const photoId = parseInt(param(req.params.photoId));
      if (isNaN(photoId)) {
        return res.status(400).json({ message: "Invalid photoId" });
      }
      const deleted = await storage.deletePhoto(photoId);
      if (!deleted) return res.status(404).json({ message: "Photo not found" });

      if (deleted.storagePath) {
        await supabase.storage.from(PHOTOS_BUCKET).remove([deleted.storagePath]);
      }

      if (deleted.roomId) {
        const room = await storage.getRoom(deleted.roomId);
        if (room && (room.photoCount || 0) > 0) {
          await storage.updateRoom(deleted.roomId, { photoCount: (room.photoCount || 1) - 1 });
        }
      }

      res.json({ success: true });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // POST /api/inspection/:sessionId/photos/:photoId/analyze
  app.post("/api/inspection/:sessionId/photos/:photoId/analyze", authenticateRequest, async (req, res) => {
    try {
      const photoId = parseInt(param(req.params.photoId));
      if (isNaN(photoId)) {
        return res.status(400).json({ message: "Invalid photoId" });
      }
      const { imageBase64, expectedLabel, expectedPhotoType } = req.body;

      if (!imageBase64) {
        return res.status(400).json({ message: "imageBase64 is required" });
      }

      // Call GPT-4o Vision to analyze the photo
      const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4.1",
          messages: [
            {
              role: "system",
              content: `You are an insurance property inspection photo analyst. Analyze this photo and provide:
1. A brief description of what you see (1-2 sentences)
2. Any visible damage (type, severity, location in frame)
3. Whether this photo matches the expected capture: "${expectedLabel}" (type: ${expectedPhotoType})
4. Photo quality assessment (lighting, focus, framing)
Respond in JSON format:
{
  "description": "string",
  "damageVisible": [{ "type": "string", "severity": "string", "notes": "string" }],
  "matchesExpected": true/false,
  "matchConfidence": 0.0-1.0,
  "matchExplanation": "string",
  "qualityScore": 1-5,
  "qualityNotes": "string"
}`
            },
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: {
                    url: imageBase64,
                    detail: "high"
                  }
                },
                {
                  type: "text",
                  text: `This photo was requested as: "${expectedLabel}" (type: ${expectedPhotoType}). Analyze it.`
                }
              ]
            }
          ],
          max_tokens: 500,
          response_format: { type: "json_object" },
        }),
      });

      if (!openaiRes.ok) {
        const errBody = await openaiRes.text();
        logger.error("VisionAPI", "Vision API error", { errBody });
        // Return a graceful fallback — don't block the workflow
        const fallbackAnalysis = {
          description: "Photo captured successfully. AI analysis unavailable.",
          damageVisible: [],
          matchesExpected: true,
          matchConfidence: 0.5,
          matchExplanation: "Analysis unavailable — assuming match.",
          qualityScore: 3,
          qualityNotes: "Unable to assess",
        };
        // Still save the fallback analysis
        await storage.updatePhoto(photoId, {
          analysis: fallbackAnalysis,
          matchesRequest: true,
        });
        return res.json(fallbackAnalysis);
      }

      const visionData = await openaiRes.json();
      const analysisText = visionData.choices?.[0]?.message?.content || "{}";

      let analysis: any;
      try {
        analysis = JSON.parse(analysisText);
      } catch {
        analysis = {
          description: analysisText,
          damageVisible: [],
          matchesExpected: true,
          matchConfidence: 0.5,
          matchExplanation: "Parse error — raw response stored.",
          qualityScore: 3,
          qualityNotes: "",
        };
      }

      // Update the photo record with analysis
      await storage.updatePhoto(photoId, {
        analysis,
        matchesRequest: analysis.matchesExpected ?? true,
      });

      // Process photo analysis for damage suggestions (PROMPT-18 Part B)
      let damageSuggestions: Array<{ description: string; damageType: string; severity: string; notes: string; confidence: number }> = [];
      const sessionId = parseInt(param(req.params.sessionId));
      const photo = await storage.getPhoto(photoId);
      if (photo?.roomId && analysis.damageVisible && analysis.damageVisible.length > 0) {
        try {
          const { processPhotoAnalysis } = await import("../photoScopeBridge");
          damageSuggestions = processPhotoAnalysis(analysis, sessionId, photo.roomId);
        } catch (err) {
          logger.apiError(req.method, req.path, err as Error);
        }
      }

      res.json({
        ...analysis,
        damageSuggestions,
      });
    } catch (error: any) {
      logger.error("PhotoAnalysis", "Photo analysis error", error);
      // Don't block the workflow on analysis failure
      res.json({
        description: "Photo captured. Analysis failed.",
        damageVisible: [],
        matchesExpected: true,
        matchConfidence: 0.5,
        matchExplanation: "Analysis error — photo saved without analysis.",
        qualityScore: 3,
        qualityNotes: error.message,
      });
    }
  });

  // ── Moisture Readings ─────────────────────────────

  app.post("/api/inspection/:sessionId/moisture", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const { roomId, location, reading, materialType, dryStandard } = req.body;
      if (!roomId || reading === undefined) {
        return res.status(400).json({ message: "roomId and reading are required" });
      }
      const entry = await storage.createMoistureReading({
        sessionId,
        roomId,
        location: location || null,
        reading,
        materialType: materialType || null,
        dryStandard: dryStandard || null,
      });
      res.status(201).json(entry);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/moisture", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const roomId = req.query.roomId ? parseInt(req.query.roomId as string) : undefined;
      const readings = roomId
        ? await storage.getMoistureReadings(roomId)
        : await storage.getMoistureReadingsForSession(sessionId);
      res.json(readings);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Transcript ────────────────────────────────────

  app.post("/api/inspection/:sessionId/transcript", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const { speaker, content } = req.body;
      if (!speaker || !content) {
        return res.status(400).json({ message: "speaker and content are required" });
      }
      const entry = await storage.addTranscript({ sessionId, speaker, content });
      res.status(201).json(entry);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/transcript", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const transcript = await storage.getTranscript(sessionId);
      res.json(transcript);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Completeness Check ────────────────────────────

  app.get("/api/inspection/:sessionId/completeness", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const session = await storage.getInspectionSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });

      const claim = await storage.getClaim(session.claimId);
      const rooms = await storage.getRooms(sessionId);
      const allLineItems = await storage.getLineItems(sessionId);
      const allPhotos = await storage.getPhotos(sessionId);
      const allDamages = await storage.getDamagesForSession(sessionId);
      const moistureReadings = await storage.getMoistureReadingsForSession(sessionId);

      const perilType = claim?.perilType || "unknown";
      const currentPhase = (session as any).currentPhase || 1;
      const totalPhases = 8;

      const roomsWithDocs = rooms.filter(r => {
        const hasDamage = allDamages.some(d => d.roomId === r.id);
        const hasLineItem = allLineItems.some(li => li.roomId === r.id);
        return hasDamage || hasLineItem;
      });

      const checklist: Array<{ item: string; satisfied: boolean; evidence?: string }> = [];

      checklist.push({
        item: "At least one room/area documented",
        satisfied: rooms.length > 0,
        evidence: `${rooms.length} rooms created`,
      });
      checklist.push({
        item: "Rooms have damages or line items",
        satisfied: roomsWithDocs.length > 0,
        evidence: roomsWithDocs.length > 0 ? `${roomsWithDocs.length} rooms with documentation` : undefined,
      });
      checklist.push({
        item: "Damage observations recorded",
        satisfied: allDamages.length > 0,
        evidence: `${allDamages.length} damage observations`,
      });
      checklist.push({
        item: "Line items in estimate",
        satisfied: allLineItems.length > 0,
        evidence: `${allLineItems.length} line items`,
      });
      checklist.push({
        item: "Inspection photos taken",
        satisfied: allPhotos.length > 0,
        evidence: `${allPhotos.length} photos`,
      });

      if (perilType === "water") {
        checklist.push({
          item: "Moisture readings recorded",
          satisfied: moistureReadings.length > 0,
          evidence: `${moistureReadings.length} moisture readings`,
        });
      }

      if (perilType === "hail" || perilType === "wind") {
        const elevationRooms = rooms.filter(r =>
          r.roomType?.startsWith("exterior_elevation_") ||
          r.viewType === "elevation" ||
          /front|rear|left|right/i.test(r.name)
        );
        checklist.push({
          item: "Elevations documented",
          satisfied: elevationRooms.length > 0,
          evidence: elevationRooms.length > 0
            ? `${elevationRooms.length} elevations: ${elevationRooms.map(r => r.name).join(", ")}`
            : undefined,
        });
      }

      const completedRooms = rooms.filter(r => r.status === "complete").length;
      const totalRooms = rooms.length;

      const completedPhases = currentPhase - 1;
      const phaseProgress = completedPhases / totalPhases;
      const phaseComponent = phaseProgress * 50;

      const roomRatio = totalRooms > 0 ? completedRooms / totalRooms : 0;
      const roomComponent = roomRatio * 30;

      let docScore = 0;
      if (totalRooms > 0) {
        const avgDamagesPerRoom = allDamages.length / totalRooms;
        const avgItemsPerRoom = allLineItems.length / totalRooms;
        const avgPhotosPerRoom = allPhotos.length / totalRooms;
        const damageDepth = Math.min(avgDamagesPerRoom / 2, 1);
        const itemDepth = Math.min(avgItemsPerRoom / 5, 1);
        const photoDepth = Math.min(avgPhotosPerRoom / 2, 1);
        docScore = ((damageDepth * 0.3) + (itemDepth * 0.4) + (photoDepth * 0.3));
        if (perilType === "water" && moistureReadings.length > 0) {
          docScore = Math.min(docScore + 0.1, 1);
        }
      }
      const docComponent = docScore * 20;

      const rawScore = phaseComponent + roomComponent + docComponent;

      const phaseCap = ((currentPhase / totalPhases) * 100) + 15;
      const completenessScore = Math.min(Math.round(rawScore), Math.round(phaseCap));

      const scopeGaps: Array<{ room: string; issue: string }> = [];
      for (const room of rooms) {
        const roomDamages = allDamages.filter(d => d.roomId === room.id);
        const roomItems = allLineItems.filter(li => li.roomId === room.id);
        if (roomDamages.length > 0 && roomItems.length === 0) {
          scopeGaps.push({
            room: room.name,
            issue: `${roomDamages.length} damage observation(s) but no line items`,
          });
        }
      }

      const missingPhotos: Array<{ room: string; issue: string }> = [];
      for (const room of rooms) {
        const roomDamages = allDamages.filter(d => d.roomId === room.id);
        const roomPhotos = allPhotos.filter(p => p.roomId === room.id);
        if (roomDamages.length > 0 && roomPhotos.length === 0) {
          missingPhotos.push({
            room: room.name,
            issue: `${roomDamages.length} damage(s) documented but no photos`,
          });
        }
      }

      res.json({
        completenessScore,
        checklist,
        scopeGaps,
        missingPhotos,
        summary: {
          totalRooms: rooms.length,
          completedRooms,
          totalDamages: allDamages.length,
          totalLineItems: allLineItems.length,
          totalPhotos: allPhotos.length,
          totalMoistureReadings: moistureReadings.length,
        },
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Xactimate-Style Estimate by Room ────────────────

  app.get("/api/inspection/:sessionId/estimate-by-room", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const items = await storage.getLineItems(sessionId);
      const rooms = await storage.getRooms(sessionId);

      const session = await storage.getInspectionSession(sessionId);
      const claimId = session?.claimId;

      let propertyAge: number | null = null;
      let applyRoofSchedule = false;
      let roofScheduleAge: number | null = null;
      let roofDepPct: number | null = null;

      if (claimId) {
        const briefing = await storage.getBriefing(claimId);
        const pp = briefing?.propertyProfile as any;
        if (pp?.yearBuilt) {
          propertyAge = new Date().getFullYear() - pp.yearBuilt;
        }

        const rules = await storage.getPolicyRulesForClaim(claimId);
        for (const rule of rules) {
          if (rule.applyRoofSchedule) {
            applyRoofSchedule = true;
            roofScheduleAge = rule.roofScheduleAge != null ? Number(rule.roofScheduleAge) : null;
          }
        }

        if (applyRoofSchedule && roofScheduleAge != null && propertyAge != null && propertyAge >= roofScheduleAge) {
          roofDepPct = 75;
        }
      }

      const ROOFING_CATEGORIES = ["roofing", "roof"];
      const isRoofingCategory = (cat: string) => {
        const lower = (cat || "").toLowerCase();
        return ROOFING_CATEGORIES.some(r => lower.includes(r));
      };

      const assignedRoomIds = new Set(rooms.map(r => r.id));
      const unassignedItems = items.filter(i => !i.roomId || !assignedRoomIds.has(i.roomId));

      const allRoomEntries = [
        ...rooms.map(room => ({ room, items: items.filter(i => i.roomId === room.id) })),
        ...(unassignedItems.length > 0 ? [{ room: null as any, items: unassignedItems }] : []),
      ];

      const roomSections = allRoomEntries.map(({ room, items: roomItems }) => {
        const d = room?.dimensions as any;
        const length = d?.length || 0;
        const width = d?.width || 0;
        const height = d?.height || 8;
        const floorArea = length * width;
        const perimeter = 2 * (length + width);
        const wallArea = perimeter * height;
        const ceilingArea = floorArea;

        const measurements = (room && floorArea > 0) ? {
          sfWalls: parseFloat(wallArea.toFixed(2)),
          sfCeiling: parseFloat(ceilingArea.toFixed(2)),
          sfWallsAndCeiling: parseFloat((wallArea + ceilingArea).toFixed(2)),
          sfFloor: parseFloat(floorArea.toFixed(2)),
          syFlooring: parseFloat((floorArea / 9).toFixed(2)),
          lfFloorPerimeter: parseFloat(perimeter.toFixed(2)),
          lfCeilPerimeter: parseFloat(perimeter.toFixed(2)),
        } : null;

        const enrichedItems = roomItems.map((item, idx) => {
          const rcv = Number(item.totalPrice) || 0;
          const tax = Number(item.taxAmount) || 0;
          const category = item.category || "";
          const description = item.description || "";
          const isRoofing = isRoofingCategory(category);
          const catLower = category.toLowerCase();
          const isLabor = catLower === "dem" || catLower === "mit" || catLower === "gen";
          const actionLower = (item.action || "").toLowerCase();
          const descLower = description.toLowerCase();
          const isRemovalAction = actionLower === "remove" || actionLower === "tear out" || actionLower === "demolition" || actionLower === "d&r";
          const isRemovalItem = isRemovalAction || descLower.startsWith("remove ") || descLower.startsWith("tear off ") || descLower.startsWith("tear out ") || descLower.includes("extraction") || descLower.includes("monitoring");

          let itemAge = item.age != null ? Number(item.age) : null;
          if (itemAge == null && propertyAge != null && !isLabor && !isRemovalItem) {
            itemAge = propertyAge;
          }

          let itemLife = item.lifeExpectancy != null ? Number(item.lifeExpectancy) : null;
          if ((itemLife == null || itemLife === 0) && !isLabor && !isRemovalItem) {
            const lookedUp = lookupLifeExpectancy(category, description);
            if (lookedUp > 0) itemLife = lookedUp;
          }

          let depPctOverride = Number(item.depreciationPercentage) || null;
          if ((depPctOverride == null || depPctOverride === 0) && isRoofing && roofDepPct != null) {
            depPctOverride = roofDepPct;
          }

          let baseDepType = item.depreciationType || "Recoverable";

          const depResult = calculateItemDepreciation(
            rcv,
            itemAge,
            itemLife,
            depPctOverride,
            baseDepType,
            applyRoofSchedule,
            isRoofing
          );

          return {
            lineNumber: idx + 1,
            id: item.id,
            description,
            category,
            quantity: Number(item.quantity) || 0,
            unit: item.unit,
            action: item.action,
            xactCode: item.xactCode,
            unitPrice: Number(item.unitPrice) || 0,
            totalPrice: rcv,
            taxAmount: tax,
            depreciationAmount: depResult.depreciationAmount,
            depreciationType: depResult.effectiveDepType,
            depreciationPercentage: depResult.depreciationPercentage,
            acv: depResult.acv,
            age: itemAge,
            lifeExpectancy: itemLife,
            provenance: item.provenance,
          };
        });

        const roomTotal = enrichedItems.reduce((s, i) => s + i.totalPrice, 0);
        const roomTotalDep = enrichedItems.reduce((s, i) => s + i.depreciationAmount, 0);
        const roomTotalRecoverableDep = enrichedItems
          .filter(i => i.depreciationType === "Recoverable")
          .reduce((s, i) => s + i.depreciationAmount, 0);
        const roomTotalNonRecoverableDep = enrichedItems
          .filter(i => i.depreciationType === "Non-Recoverable")
          .reduce((s, i) => s + i.depreciationAmount, 0);

        return {
          id: room?.id || -1,
          name: room?.name || "Unassigned",
          roomType: room?.roomType || null,
          structure: room?.structure || "Main Dwelling",
          dimensions: { length, width, height },
          measurements,
          items: enrichedItems,
          subtotal: parseFloat(roomTotal.toFixed(2)),
          totalTax: parseFloat(enrichedItems.reduce((s, i) => s + i.taxAmount, 0).toFixed(2)),
          totalDepreciation: parseFloat(roomTotalDep.toFixed(2)),
          totalRecoverableDepreciation: parseFloat(roomTotalRecoverableDep.toFixed(2)),
          totalNonRecoverableDepreciation: parseFloat(roomTotalNonRecoverableDep.toFixed(2)),
          totalACV: parseFloat((roomTotal - roomTotalDep).toFixed(2)),
          status: room?.status || null,
          damageCount: room?.damageCount || 0,
          photoCount: room?.photoCount || 0,
        };
      });

      const grandTotal = roomSections.reduce((s, r) => s + r.subtotal, 0);
      const grandTax = roomSections.reduce((s, r) => s + (r.totalTax || 0), 0);
      const grandDepreciation = roomSections.reduce((s, r) => s + (r.totalDepreciation || 0), 0);
      const grandRecoverableDepreciation = roomSections.reduce((s, r) => s + (r.totalRecoverableDepreciation || 0), 0);
      const grandNonRecoverableDepreciation = roomSections.reduce((s, r) => s + (r.totalNonRecoverableDepreciation || 0), 0);
      const grandACV = grandTotal - grandDepreciation;

      res.json({
        rooms: roomSections,
        grandTotal: parseFloat(grandTotal.toFixed(2)),
        grandTax: parseFloat(grandTax.toFixed(2)),
        grandDepreciation: parseFloat(grandDepreciation.toFixed(2)),
        grandRecoverableDepreciation: parseFloat(grandRecoverableDepreciation.toFixed(2)),
        grandNonRecoverableDepreciation: parseFloat(grandNonRecoverableDepreciation.toFixed(2)),
        grandACV: parseFloat(grandACV.toFixed(2)),
        totalLineItems: items.length,
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Grouped Estimate ────────────────────────────────

  app.get("/api/inspection/:sessionId/estimate-grouped", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const items = await storage.getLineItems(sessionId);
      const rooms = await storage.getRooms(sessionId);

      const hierarchy: Record<string, Record<string, any[]>> = {};

      for (const item of items) {
        const category = item.category || "General";
        const room = rooms.find(r => r.id === item.roomId);
        const roomName = room ? room.name : "Unassigned";

        if (!hierarchy[category]) hierarchy[category] = {};
        if (!hierarchy[category][roomName]) hierarchy[category][roomName] = [];
        hierarchy[category][roomName].push(item);
      }

      const categories = Object.entries(hierarchy).map(([category, roomGroups]) => {
        const roomEntries = Object.entries(roomGroups).map(([roomName, roomItems]) => ({
          roomName,
          items: roomItems,
          subtotal: roomItems.reduce((s: number, i: any) => s + (Number(i.totalPrice) || 0), 0),
        }));
        return {
          category,
          rooms: roomEntries,
          subtotal: roomEntries.reduce((s, r) => s + r.subtotal, 0),
        };
      });

      const estimateSummary = await storage.getEstimateSummary(sessionId);

      res.json({ categories, ...estimateSummary });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Photos Grouped by Room ──────────────────────────

  app.get("/api/inspection/:sessionId/photos-grouped", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const photos = await storage.getPhotos(sessionId);
      const rooms = await storage.getRooms(sessionId);

      const photosWithUrls = await Promise.all(photos.map(async (photo) => {
        let signedUrl = null;
        if (photo.storagePath) {
          const { data } = await supabase.storage
            .from(PHOTOS_BUCKET)
            .createSignedUrl(photo.storagePath, 3600);
          if (data?.signedUrl) signedUrl = data.signedUrl;
        }
        return { ...photo, signedUrl };
      }));

      const grouped: Record<string, any[]> = {};
      for (const photo of photosWithUrls) {
        const room = rooms.find(r => r.id === photo.roomId);
        const roomName = room ? room.name : "General";
        if (!grouped[roomName]) grouped[roomName] = [];
        grouped[roomName].push(photo);
      }

      res.json({
        groups: Object.entries(grouped).map(([roomName, roomPhotos]) => ({
          roomName,
          photos: roomPhotos,
          count: roomPhotos.length,
        })),
        totalPhotos: photosWithUrls.length,
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Export Validation ───────────────────────────────

  app.post("/api/inspection/:sessionId/export/validate", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const session = await storage.getInspectionSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });

      const rooms = await storage.getRooms(sessionId);
      const items = await storage.getLineItems(sessionId);
      const photos = await storage.getPhotos(sessionId);

      const warnings: string[] = [];
      const blockers: string[] = [];

      if (items.length === 0) warnings.push("No line items in estimate");
      if (photos.length === 0) warnings.push("No photos captured");
      if (rooms.filter(r => r.status === "complete").length === 0) {
        warnings.push("No rooms marked as complete");
      }

      const missingQty = items.filter(i => !i.quantity || i.quantity <= 0);
      if (missingQty.length > 0) {
        warnings.push(`${missingQty.length} line item(s) missing quantity`);
      }

      res.json({
        canExport: blockers.length === 0,
        blockers,
        warnings,
        summary: {
          lineItemCount: items.length,
          photoCount: photos.length,
          roomCount: rooms.length,
          completedRooms: rooms.filter(r => r.status === "complete").length,
        },
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── ESX Export (Xactimate-compatible ZIP) ────────────

  app.post("/api/inspection/:sessionId/export/esx", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const session = await storage.getInspectionSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });

      const claim = await storage.getClaim(session.claimId);
      const esxBuffer = await generateESXFile(sessionId, storage);

      const fileName = `${claim?.claimNumber || "estimate"}_export.esx`;
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.send(esxBuffer);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── AI Estimate Review ──────────────────────────────

  app.post("/api/inspection/:sessionId/review/ai", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const review = await reviewEstimate(sessionId, storage);
      res.json(review);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── PDF Export Data ─────────────────────────────────

  app.post("/api/inspection/:sessionId/export/pdf", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const session = await storage.getInspectionSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });

      // Load user export preferences
      const userSettings = await storage.getUserSettings(req.user!.id);
      const exportPrefs = (userSettings?.settings as Record<string, any>) || {};

      const claim = await storage.getClaim(session.claimId);
      const rooms = await storage.getRooms(sessionId);
      const items = await storage.getLineItems(sessionId);
      const photos = exportPrefs.includePhotosInExport !== false ? await storage.getPhotos(sessionId) : [];
      const damages = await storage.getDamagesForSession(sessionId);
      const moisture = await storage.getMoistureReadingsForSession(sessionId);
      const estimate = await storage.getEstimateSummary(sessionId);
      const transcript = exportPrefs.includeTranscriptInExport ? await storage.getTranscript(sessionId) : [];

      // Import the PDF generator
      const { generateInspectionPDF } = await import("../pdfGenerator");

      // Build categories from line items
      const categoryMap = new Map<string, typeof items>();
      for (const item of items) {
        const cat = item.category || "General";
        if (!categoryMap.has(cat)) categoryMap.set(cat, []);
        categoryMap.get(cat)!.push(item);
      }
      const categories = Array.from(categoryMap.entries()).map(([category, catItems]) => ({
        category,
        subtotal: catItems.reduce((sum, i) => sum + (Number(i.totalPrice) || 0), 0),
        items: catItems,
      }));

      // Build room-grouped estimate with depreciation (same logic as estimate-by-room endpoint)
      let propertyAge: number | null = null;
      let applyRoofSchedule = false;
      let roofScheduleAge: number | null = null;
      let roofDepPct: number | null = null;
      let briefingData: any = null;

      if (session.claimId) {
        const briefing = await storage.getBriefing(session.claimId);
        briefingData = briefing;
        const pp = briefing?.propertyProfile as any;
        if (pp?.yearBuilt) {
          propertyAge = new Date().getFullYear() - pp.yearBuilt;
        }
        const rules = await storage.getPolicyRulesForClaim(session.claimId);
        for (const rule of rules) {
          if (rule.applyRoofSchedule) {
            applyRoofSchedule = true;
            roofScheduleAge = rule.roofScheduleAge != null ? Number(rule.roofScheduleAge) : null;
          }
        }
        if (applyRoofSchedule && roofScheduleAge != null && propertyAge != null && propertyAge >= roofScheduleAge) {
          roofDepPct = 75;
        }
      }

      const ROOFING_CATS_PDF = ["roofing", "roof"];
      const isRoofCatPdf = (cat: string) => {
        const lower = (cat || "").toLowerCase();
        return ROOFING_CATS_PDF.some(r => lower.includes(r));
      };

      const assignedRoomIdsPdf = new Set(rooms.map(r => r.id));
      const unassignedItemsPdf = items.filter(i => !i.roomId || !assignedRoomIdsPdf.has(i.roomId));
      const allRoomEntriesPdf = [
        ...rooms.map(room => ({ room, items: items.filter(i => i.roomId === room.id) })),
        ...(unassignedItemsPdf.length > 0 ? [{ room: null as any, items: unassignedItemsPdf }] : []),
      ];

      let globalLineNum = 0;
      const roomSectionsPdf = allRoomEntriesPdf.map(({ room, items: roomItems }) => {
        const enrichedItems = roomItems.map((item) => {
          globalLineNum++;
          const rcv = Number(item.totalPrice) || 0;
          const tax = Number(item.taxAmount) || 0;
          const category = item.category || "";
          const description = item.description || "";
          const isRoofing = isRoofCatPdf(category);
          const catLower = category.toLowerCase();
          const isLabor = catLower === "dem" || catLower === "mit" || catLower === "gen";
          const actionLower = (item.action || "").toLowerCase();
          const descLower = description.toLowerCase();
          const isRemovalItem = actionLower === "remove" || actionLower === "tear out" || actionLower === "demolition" || actionLower === "d&r"
            || descLower.startsWith("remove ") || descLower.startsWith("tear off ") || descLower.startsWith("tear out ")
            || descLower.includes("extraction") || descLower.includes("monitoring");

          let itemAge = item.age != null ? Number(item.age) : null;
          if (itemAge == null && propertyAge != null && !isLabor && !isRemovalItem) {
            itemAge = propertyAge;
          }
          let itemLife = item.lifeExpectancy != null ? Number(item.lifeExpectancy) : null;
          if ((itemLife == null || itemLife === 0) && !isLabor && !isRemovalItem) {
            const lookedUp = lookupLifeExpectancy(category, description);
            if (lookedUp > 0) itemLife = lookedUp;
          }
          let depPctOverride = Number(item.depreciationPercentage) || null;
          if ((depPctOverride == null || depPctOverride === 0) && isRoofing && roofDepPct != null) {
            depPctOverride = roofDepPct;
          }
          let baseDepType = item.depreciationType || "Recoverable";
          const depResult = calculateItemDepreciation(rcv, itemAge, itemLife, depPctOverride, baseDepType, applyRoofSchedule, isRoofing);

          return {
            lineNumber: globalLineNum,
            description,
            category,
            quantity: Number(item.quantity) || 0,
            unit: item.unit,
            unitPrice: Number(item.unitPrice) || 0,
            totalPrice: rcv,
            taxAmount: tax,
            depreciationAmount: depResult.depreciationAmount,
            depreciationType: depResult.effectiveDepType,
            depreciationPercentage: depResult.depreciationPercentage,
            acv: depResult.acv,
            age: itemAge,
            lifeExpectancy: itemLife,
            action: item.action,
            provenance: item.provenance,
          };
        });

        const roomTotal = enrichedItems.reduce((s, i) => s + i.totalPrice, 0);
        const roomTotalDep = enrichedItems.reduce((s, i) => s + i.depreciationAmount, 0);
        const roomTotalRecDep = enrichedItems.filter(i => i.depreciationType === "Recoverable").reduce((s, i) => s + i.depreciationAmount, 0);
        const roomTotalNonRecDep = enrichedItems.filter(i => i.depreciationType === "Non-Recoverable").reduce((s, i) => s + i.depreciationAmount, 0);

        return {
          id: room?.id || -1,
          name: room?.name || "Unassigned",
          structure: room?.structure || "Main Dwelling",
          items: enrichedItems,
          subtotal: parseFloat(roomTotal.toFixed(2)),
          totalTax: parseFloat(enrichedItems.reduce((s, i) => s + i.taxAmount, 0).toFixed(2)),
          totalDepreciation: parseFloat(roomTotalDep.toFixed(2)),
          totalRecoverableDepreciation: parseFloat(roomTotalRecDep.toFixed(2)),
          totalNonRecoverableDepreciation: parseFloat(roomTotalNonRecDep.toFixed(2)),
          totalACV: parseFloat((roomTotal - roomTotalDep).toFixed(2)),
        };
      });

      const grandTotalPdf = roomSectionsPdf.reduce((s, r) => s + r.subtotal, 0);
      const grandTaxPdf = roomSectionsPdf.reduce((s, r) => s + (r.totalTax || 0), 0);
      const grandDepPdf = roomSectionsPdf.reduce((s, r) => s + (r.totalDepreciation || 0), 0);
      const grandRecDepPdf = roomSectionsPdf.reduce((s, r) => s + (r.totalRecoverableDepreciation || 0), 0);
      const grandNonRecDepPdf = roomSectionsPdf.reduce((s, r) => s + (r.totalNonRecoverableDepreciation || 0), 0);
      const grandACVPdf = grandTotalPdf - grandDepPdf;

      // Build the data object for PDF generation
      const pdfData = {
        claim: claim || null,
        session,
        rooms,
        damages,
        lineItems: items,
        photos,
        moistureReadings: moisture,
        estimate: {
          totalRCV: Number(estimate?.totalRCV) || 0,
          totalDepreciation: Number(estimate?.totalDepreciation) || 0,
          totalACV: Number(estimate?.totalACV) || 0,
          recoverableDepreciation: Number(estimate?.recoverableDepreciation) || 0,
          nonRecoverableDepreciation: Number(estimate?.nonRecoverableDepreciation) || 0,
          overheadAmount: Number(estimate?.overheadAmount) || 0,
          profitAmount: Number(estimate?.profitAmount) || 0,
          qualifiesForOP: estimate?.qualifiesForOP || false,
          deductible: Number(estimate?.deductible) || 0,
          netClaim: Number(estimate?.netClaim) || 0,
          itemCount: items.length,
          categories,
        },
        roomEstimate: {
          rooms: roomSectionsPdf,
          grandTotal: parseFloat(grandTotalPdf.toFixed(2)),
          grandTax: parseFloat(grandTaxPdf.toFixed(2)),
          grandDepreciation: parseFloat(grandDepPdf.toFixed(2)),
          grandRecoverableDepreciation: parseFloat(grandRecDepPdf.toFixed(2)),
          grandNonRecoverableDepreciation: parseFloat(grandNonRecDepPdf.toFixed(2)),
          grandACV: parseFloat(grandACVPdf.toFixed(2)),
          totalLineItems: items.length,
        },
        briefing: briefingData ? {
          coverageSnapshot: (briefingData.coverageSnapshot as any) || {},
          propertyProfile: (briefingData.propertyProfile as any) || {},
        } : undefined,
        inspectorName: (await storage.getUser(req.user!.id))?.fullName || 'Claims IQ Agent',
        transcript,
        companyName: exportPrefs.companyName || 'Claims IQ',
        adjusterLicense: exportPrefs.adjusterLicenseNumber || '',
      };

      // Generate the PDF buffer
      const pdfBuffer = await generateInspectionPDF(pdfData);

      // Send as attachment
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${claim?.claimNumber || "inspection"}_report.pdf"`
      );
      res.send(pdfBuffer);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Photo Report Export (PDF) ────────────────────────

  app.post("/api/inspection/:sessionId/export/photo-report/pdf", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const session = await storage.getInspectionSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });

      const claim = await storage.getClaim(session.claimId);
      const rooms = await storage.getRooms(sessionId);
      const photos = await storage.getPhotos(sessionId);

      const userSettings = await storage.getUserSettings(req.user!.id);
      const exportPrefs = (userSettings?.settings as Record<string, any>) || {};
      const inspectorName = (await storage.getUser(req.user!.id))?.fullName || "Claims IQ Agent";

      const { generatePhotoReportPDF } = await import("../photoReportGenerator");

      const pdfBuffer = await generatePhotoReportPDF({
        claim: claim || null,
        session,
        rooms,
        photos,
        inspectorName,
        companyName: exportPrefs.companyName || "Claims IQ",
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${claim?.claimNumber || "inspection"}_photo_report.pdf"`
      );
      res.send(pdfBuffer);
    } catch (error: any) {
      logger.error("PhotoReportPDF", "Photo report PDF error", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Photo Report Export (DOCX) ───────────────────────

  app.post("/api/inspection/:sessionId/export/photo-report/docx", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const session = await storage.getInspectionSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });

      const claim = await storage.getClaim(session.claimId);
      const rooms = await storage.getRooms(sessionId);
      const photos = await storage.getPhotos(sessionId);

      const userSettings = await storage.getUserSettings(req.user!.id);
      const exportPrefs = (userSettings?.settings as Record<string, any>) || {};
      const inspectorName = (await storage.getUser(req.user!.id))?.fullName || "Claims IQ Agent";

      const { generatePhotoReportDOCX } = await import("../photoReportGenerator");

      const docxBuffer = await generatePhotoReportDOCX({
        claim: claim || null,
        session,
        rooms,
        photos,
        inspectorName,
        companyName: exportPrefs.companyName || "Claims IQ",
      });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${claim?.claimNumber || "inspection"}_photo_report.docx"`
      );
      res.send(docxBuffer);
    } catch (error: any) {
      logger.error("PhotoReportDOCX", "Photo report DOCX error", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Photo Annotations Endpoint ──────────────────────

  app.put("/api/inspection/:sessionId/photos/:photoId/annotations", authenticateRequest, async (req, res) => {
    try {
      const photoId = parseInt(param(req.params.photoId));
      const { shapes, annotatedImageBase64 } = req.body;

      if (!shapes || !Array.isArray(shapes)) {
        return res.status(400).json({ message: "shapes array is required" });
      }

      // Save annotation data to the photo record
      const updatedPhoto = await storage.updatePhoto(photoId, {
        annotations: shapes,
      });

      res.json({ success: true, photo: updatedPhoto });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Session Status Update ───────────────────────────

  app.patch("/api/inspection/:sessionId/status", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const { status } = req.body;
      const validStatuses = ["active", "review", "exported", "submitted", "approved", "completed"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
      }
      const session = await storage.updateSessionStatus(sessionId, status);
      if (!session) return res.status(404).json({ message: "Session not found" });
      res.json(session);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Supplemental Claims (inspection session) ───────

  app.post("/api/inspection/:sessionId/supplemental", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const { reason, newLineItems, removedLineItemIds, modifiedLineItems } = req.body;

      const session = await storage.getInspectionSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });

      const supplemental = await storage.createSupplementalClaim({
        originalSessionId: sessionId,
        claimId: session.claimId,
        reason,
        newLineItems,
        removedLineItemIds,
        modifiedLineItems,
        status: "draft",
      });
      emit({ type: "supplemental.created", supplementalId: supplemental.id, sessionId, userId: req.user?.id });

      res.json(supplemental);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/supplementals", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const supplementals = await storage.getSupplementalsForSession(sessionId);
      res.json(supplementals);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

}
