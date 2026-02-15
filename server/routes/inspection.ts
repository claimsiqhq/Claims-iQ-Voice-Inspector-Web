import { Router } from "express";
import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import { authenticateRequest } from "../auth";
import { z } from "zod";
import {
  pgTable, serial, varchar, text, integer, timestamp, real, jsonb,
} from "drizzle-orm/pg-core";
import { claims } from "@shared/schema";

// These tables exist in the DB already (from the web app prompts)
// We define them inline to avoid breaking shared/schema.ts
const inspectionSessions = pgTable("inspection_sessions", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").notNull(),
  inspectorId: varchar("inspector_id"),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  currentPhase: integer("current_phase").default(1),
  currentRoomId: integer("current_room_id"),
  currentStructure: varchar("current_structure", { length: 100 }).default("Main Dwelling"),
  voiceSessionId: text("voice_session_id"),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

const inspectionRooms = pgTable("inspection_rooms", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  roomType: varchar("room_type", { length: 50 }),
  structure: varchar("structure", { length: 100 }).default("Main Dwelling"),
  dimensions: jsonb("dimensions"),
  status: varchar("status", { length: 20 }).notNull().default("not_started"),
  damageCount: integer("damage_count").default(0),
  photoCount: integer("photo_count").default(0),
  phase: integer("phase"),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

const damageObservations = pgTable("damage_observations", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  roomId: integer("room_id").notNull(),
  description: text("description").notNull(),
  damageType: varchar("damage_type", { length: 50 }),
  severity: varchar("severity", { length: 20 }),
  location: text("location"),
  measurements: jsonb("measurements"),
  createdAt: timestamp("created_at").defaultNow(),
});

const lineItems = pgTable("line_items", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  roomId: integer("room_id"),
  damageId: integer("damage_id"),
  category: varchar("category", { length: 50 }).notNull(),
  action: varchar("action", { length: 30 }),
  description: text("description").notNull(),
  xactCode: varchar("xact_code", { length: 30 }),
  quantity: real("quantity"),
  unit: varchar("unit", { length: 20 }),
  unitPrice: real("unit_price"),
  totalPrice: real("total_price"),
  provenance: varchar("provenance", { length: 20 }).default("manual"),
  createdAt: timestamp("created_at").defaultNow(),
});

const roomCreateSchema = z.object({
  name: z.string().min(1),
  roomType: z.string().optional(),
  structure: z.string().optional(),
  dimensions: z.object({ length: z.number(), width: z.number(), height: z.number().optional() }).optional(),
  phase: z.number().optional(),
});

const damageCreateSchema = z.object({
  description: z.string().min(1),
  damageType: z.string().optional(),
  severity: z.string().optional(),
  location: z.string().optional(),
  measurements: z.any().optional(),
});

const lineItemCreateSchema = z.object({
  roomId: z.number().optional().nullable(),
  damageId: z.number().optional().nullable(),
  description: z.string().min(1),
  category: z.string().default("General"),
  action: z.string().optional(),
  xactCode: z.string().optional(),
  quantity: z.number().optional(),
  unit: z.string().optional(),
  unitPrice: z.number().optional(),
});

export function inspectionRouter() {
  const router = Router();

  // Get active session for claim
  router.get("/claims/:claimId/inspection/active", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(String(req.params.claimId));
      const [session] = await db.select().from(inspectionSessions)
        .where(and(eq(inspectionSessions.claimId, claimId), eq(inspectionSessions.status, "active")))
        .limit(1);
      if (!session) return res.status(404).json({ message: "No active session" });
      res.json(session);
    } catch (err) {
      console.error("get active session error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Start inspection session
  router.post("/claims/:claimId/inspection/start", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(String(req.params.claimId));
      const userId = req.user!.id;

      // Check for existing active session
      const [existing] = await db.select().from(inspectionSessions)
        .where(and(eq(inspectionSessions.claimId, claimId), eq(inspectionSessions.status, "active")))
        .limit(1);
      if (existing) return res.json(existing);

      const [session] = await db.insert(inspectionSessions).values({
        claimId,
        inspectorId: userId,
        status: "active",
        currentPhase: 1,
      }).returning();

      // Update claim status
      await db.update(claims).set({ status: "inspection_in_progress" }).where(eq(claims.id, claimId));

      res.json(session);
    } catch (err) {
      console.error("start session error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get rooms for session
  router.get("/inspection/:sessionId/rooms", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(String(req.params.sessionId));
      const rooms = await db.select().from(inspectionRooms)
        .where(eq(inspectionRooms.sessionId, sessionId))
        .orderBy(inspectionRooms.createdAt);
      res.json(rooms);
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Create room
  router.post("/inspection/:sessionId/rooms", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(String(req.params.sessionId));
      const parsed = roomCreateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid room data" });

      const [room] = await db.insert(inspectionRooms).values({
        sessionId,
        name: parsed.data.name,
        roomType: parsed.data.roomType || "interior",
        structure: parsed.data.structure || "Main Dwelling",
        dimensions: parsed.data.dimensions as any,
        phase: parsed.data.phase,
        status: "in_progress",
      }).returning();

      res.json(room);
    } catch (err) {
      console.error("create room error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get damages for session
  router.get("/inspection/:sessionId/damages", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(String(req.params.sessionId));
      const damages = await db.select().from(damageObservations)
        .where(eq(damageObservations.sessionId, sessionId))
        .orderBy(damageObservations.createdAt);
      res.json(damages);
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Create damage
  router.post("/inspection/:sessionId/rooms/:roomId/damages", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(String(req.params.sessionId));
      const roomId = parseInt(String(req.params.roomId));
      const parsed = damageCreateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid damage data" });

      const [damage] = await db.insert(damageObservations).values({
        sessionId,
        roomId,
        description: parsed.data.description,
        damageType: parsed.data.damageType,
        severity: parsed.data.severity,
        location: parsed.data.location,
        measurements: parsed.data.measurements as any,
      }).returning();

      // Increment damage count
      const [room] = await db.select().from(inspectionRooms).where(eq(inspectionRooms.id, roomId)).limit(1);
      if (room) {
        await db.update(inspectionRooms).set({ damageCount: (room.damageCount || 0) + 1 }).where(eq(inspectionRooms.id, roomId));
      }

      // Auto-generate scope line items from damage
      let generatedItems: any[] = [];
      try {
        const { generateScopeFromDamage } = await import("../scopeGenerator");
        const roomDims = room?.dimensions as any;
        const generated = await generateScopeFromDamage(
          parsed.data.damageType || "other",
          parsed.data.severity || "moderate",
          roomDims ? { length: roomDims.length || 12, width: roomDims.width || 10, height: roomDims.height || 8 } : null,
        );

        for (const li of generated) {
          const [inserted] = await db.insert(lineItems).values({
            sessionId,
            roomId,
            damageId: damage.id,
            description: li.description,
            category: li.category,
            action: li.action,
            xactCode: li.xactCode,
            quantity: li.quantity,
            unit: li.unit,
            unitPrice: li.unitPrice,
            totalPrice: li.totalPrice,
            provenance: "auto",
          }).returning();
          generatedItems.push(inserted);
        }
      } catch (err) {
        console.error("auto-scope generation error (non-fatal):", err);
      }

      res.json({ damage, generatedLineItems: generatedItems });
    } catch (err) {
      console.error("create damage error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get line items for session
  router.get("/inspection/:sessionId/line-items", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(String(req.params.sessionId));
      const items = await db.select().from(lineItems)
        .where(eq(lineItems.sessionId, sessionId))
        .orderBy(lineItems.createdAt);
      res.json(items);
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Create line item
  router.post("/inspection/:sessionId/line-items", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(String(req.params.sessionId));
      const parsed = lineItemCreateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid line item data" });

      const unitPrice = parsed.data.unitPrice || 0;
      const quantity = parsed.data.quantity || 1;

      const [item] = await db.insert(lineItems).values({
        sessionId,
        roomId: parsed.data.roomId || null,
        damageId: parsed.data.damageId || null,
        description: parsed.data.description,
        category: parsed.data.category,
        action: parsed.data.action,
        xactCode: parsed.data.xactCode,
        quantity,
        unit: parsed.data.unit,
        unitPrice,
        totalPrice: unitPrice * quantity,
        provenance: "manual",
      }).returning();

      res.json(item);
    } catch (err) {
      console.error("create line item error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Profile update
  router.patch("/profile", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { fullName, title } = req.body;
      const { users } = await import("@shared/schema");
      const [updated] = await db.update(users).set({
        ...(fullName !== undefined ? { fullName } : {}),
        ...(title !== undefined ? { title } : {}),
      }).where(eq(users.id, userId)).returning();
      if (!updated) return res.status(404).json({ message: "User not found" });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return router;
}
