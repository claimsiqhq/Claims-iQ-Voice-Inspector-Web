import { db } from "./db";
import {
  claims, documents, extractions, briefings,
  inspectionSessions, inspectionRooms, damageObservations,
  lineItems, inspectionPhotos, moistureReadings, voiceTranscripts,
  supplementalClaims, structures, roomOpenings, sketchAnnotations, sketchTemplates,
  type Claim, type InsertClaim,
  type Document, type InsertDocument,
  type Extraction, type InsertExtraction,
  type Briefing, type InsertBriefing,
  type User, type InsertUser, users,
  type InspectionSession, type InsertInspectionSession,
  type Structure, type InsertStructure,
  type InspectionRoom, type InsertInspectionRoom,
  type RoomOpening, type InsertRoomOpening,
  type SketchAnnotation, type InsertSketchAnnotation,
  type SketchTemplate, type InsertSketchTemplate,
  type DamageObservation, type InsertDamageObservation,
  type LineItem, type InsertLineItem,
  type InspectionPhoto, type InsertInspectionPhoto,
  type MoistureReading, type InsertMoistureReading,
  type VoiceTranscript, type InsertVoiceTranscript,
  type SupplementalClaim, type InsertSupplementalClaim,
  scopeLineItems, regionalPriceSets,
  type ScopeLineItem, type InsertScopeLineItem,
  type RegionalPriceSet, type InsertRegionalPriceSet,
  userSettings, type UserSettings,
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserBySupabaseId(supabaseAuthId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  syncSupabaseUser(supabaseAuthId: string, email: string, fullName: string): Promise<User>;
  updateUserLastLogin(userId: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;

  createClaim(data: InsertClaim): Promise<Claim>;
  getClaimsForUser(userId: string): Promise<Claim[]>;
  getClaims(): Promise<Claim[]>;
  getClaim(id: number): Promise<Claim | undefined>;
  deleteClaim(id: number): Promise<boolean>;
  deleteAllClaims(): Promise<number>;
  updateClaimStatus(id: number, status: string): Promise<Claim | undefined>;
  updateClaimFields(id: number, fields: Partial<Pick<Claim, 'insuredName' | 'propertyAddress' | 'city' | 'state' | 'zip' | 'dateOfLoss' | 'perilType' | 'assignedTo'>>): Promise<Claim | undefined>;

  getAllDocuments(): Promise<Document[]>;
  getDocumentById(id: number): Promise<Document | undefined>;
  createDocument(data: InsertDocument): Promise<Document>;
  getDocuments(claimId: number): Promise<Document[]>;
  getDocument(claimId: number, documentType: string): Promise<Document | undefined>;
  updateDocumentStatus(id: number, status: string, rawText?: string): Promise<Document | undefined>;
  updateDocumentStoragePath(id: number, storagePath: string, fileName: string, fileSize: number): Promise<Document | undefined>;
  updateDocumentError(id: number, errorMessage: string): Promise<Document | undefined>;

  createExtraction(data: InsertExtraction): Promise<Extraction>;
  getExtractions(claimId: number): Promise<Extraction[]>;
  getExtraction(claimId: number, documentType: string): Promise<Extraction | undefined>;
  updateExtraction(id: number, extractedData: any): Promise<Extraction | undefined>;
  confirmExtraction(id: number): Promise<Extraction | undefined>;

  createBriefing(data: InsertBriefing): Promise<Briefing>;
  getBriefing(claimId: number): Promise<Briefing | undefined>;

  createInspectionSession(claimId: number): Promise<InspectionSession>;
  getInspectionSession(sessionId: number): Promise<InspectionSession | undefined>;
  getInspectionSessionsForClaim(claimId: number): Promise<InspectionSession[]>;
  getActiveSessionForClaim(claimId: number): Promise<InspectionSession | undefined>;
  getLatestSessionForClaim(claimId: number): Promise<InspectionSession | undefined>;
  updateSessionPhase(sessionId: number, phase: number): Promise<InspectionSession | undefined>;
  updateSessionRoom(sessionId: number, roomId: number): Promise<InspectionSession | undefined>;
  updateSessionStatus(sessionId: number, status: string): Promise<InspectionSession | undefined>;
  updateSession(sessionId: number, updates: Partial<InspectionSession>): Promise<InspectionSession | undefined>;
  completeSession(sessionId: number): Promise<InspectionSession | undefined>;

  // Structures (hierarchy top-level)
  createStructure(data: InsertStructure): Promise<Structure>;
  getStructures(sessionId: number): Promise<Structure[]>;
  getStructure(structureId: number): Promise<Structure | undefined>;
  getStructureByName(sessionId: number, name: string): Promise<Structure | undefined>;
  updateStructure(structureId: number, updates: Partial<Structure>): Promise<Structure | undefined>;

  createRoom(data: InsertInspectionRoom): Promise<InspectionRoom>;
  getRooms(sessionId: number): Promise<InspectionRoom[]>;
  getRoomsForStructure(structureId: number): Promise<InspectionRoom[]>;
  getChildRooms(parentRoomId: number): Promise<InspectionRoom[]>;
  getRoom(roomId: number): Promise<InspectionRoom | undefined>;
  getRoomByName(sessionId: number, name: string): Promise<InspectionRoom | undefined>;
  updateRoom(roomId: number, updates: Partial<InsertInspectionRoom>): Promise<InspectionRoom | undefined>;
  updateRoomStatus(roomId: number, status: string): Promise<InspectionRoom | undefined>;
  updateRoomGeometry(roomId: number, polygon: any, position: any): Promise<InspectionRoom | undefined>;
  completeRoom(roomId: number): Promise<InspectionRoom | undefined>;
  incrementRoomDamageCount(roomId: number): Promise<InspectionRoom | undefined>;
  incrementRoomPhotoCount(roomId: number): Promise<InspectionRoom | undefined>;

  // Room openings (doors, windows)
  createRoomOpening(data: InsertRoomOpening): Promise<RoomOpening>;
  getRoomOpenings(roomId: number): Promise<RoomOpening[]>;
  deleteRoomOpening(id: number): Promise<void>;

  // Sketch annotations (L5: damage counts, pitch, storm direction per facet)
  createSketchAnnotation(data: InsertSketchAnnotation): Promise<SketchAnnotation>;
  getSketchAnnotations(roomId: number): Promise<SketchAnnotation[]>;
  getSketchAnnotationsForSession(sessionId: number): Promise<SketchAnnotation[]>;
  deleteSketchAnnotation(id: number): Promise<void>;

  // Sketch templates
  getSketchTemplates(category?: string): Promise<SketchTemplate[]>;
  getSketchTemplate(id: number): Promise<SketchTemplate | undefined>;

  // Hierarchical inspection state (for voice agent context)
  getInspectionHierarchy(sessionId: number): Promise<{
    structures: Array<Structure & {
      rooms: Array<InspectionRoom & {
        subAreas: InspectionRoom[];
        damages: DamageObservation[];
        lineItemCount: number;
        photoCount: number;
      }>;
    }>;
  }>;

  createDamage(data: InsertDamageObservation): Promise<DamageObservation>;
  getDamages(roomId: number): Promise<DamageObservation[]>;
  getDamagesForSession(sessionId: number): Promise<DamageObservation[]>;

  createLineItem(data: InsertLineItem): Promise<LineItem>;
  getLineItems(sessionId: number): Promise<LineItem[]>;
  getLineItemsForRoom(roomId: number): Promise<LineItem[]>;
  getEstimateSummary(sessionId: number): Promise<{ totalRCV: number; totalDepreciation: number; totalACV: number; itemCount: number }>;
  updateLineItem(id: number, updates: Partial<LineItem>): Promise<LineItem | undefined>;
  deleteLineItem(id: number): Promise<void>;

  createPhoto(data: InsertInspectionPhoto): Promise<InspectionPhoto>;
  getPhotos(sessionId: number): Promise<InspectionPhoto[]>;
  getPhotosForRoom(roomId: number): Promise<InspectionPhoto[]>;
  updatePhoto(id: number, updates: Partial<InspectionPhoto>): Promise<InspectionPhoto | undefined>;

  createMoistureReading(data: InsertMoistureReading): Promise<MoistureReading>;
  getMoistureReadings(roomId: number): Promise<MoistureReading[]>;
  getMoistureReadingsForSession(sessionId: number): Promise<MoistureReading[]>;

  addTranscript(data: InsertVoiceTranscript): Promise<VoiceTranscript>;
  getTranscript(sessionId: number): Promise<VoiceTranscript[]>;

  getScopeLineItems(): Promise<ScopeLineItem[]>;
  getScopeLineItemByCode(code: string): Promise<ScopeLineItem | undefined>;
  getScopeLineItemsByTrade(tradeCode: string): Promise<ScopeLineItem[]>;
  getRegionalPrice(lineItemCode: string, regionId: string): Promise<RegionalPriceSet | undefined>;
  getRegionalPricesForRegion(regionId: string): Promise<RegionalPriceSet[]>;

  createSupplementalClaim(data: InsertSupplementalClaim): Promise<SupplementalClaim>;
  getSupplementalsForSession(sessionId: number): Promise<SupplementalClaim[]>;
  getSupplemental(id: number): Promise<SupplementalClaim | undefined>;
  updateSupplemental(id: number, updates: Partial<SupplementalClaim>): Promise<SupplementalClaim | undefined>;
  submitSupplemental(id: number): Promise<SupplementalClaim | undefined>;
  approveSupplemental(id: number): Promise<SupplementalClaim | undefined>;

  updateUserProfile(userId: string, updates: { fullName?: string }): Promise<User | undefined>;
  getUserSettings(userId: string): Promise<Record<string, any> | null>;
  upsertUserSettings(userId: string, settings: Record<string, any>): Promise<UserSettings>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getUserBySupabaseId(supabaseAuthId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.supabaseAuthId, supabaseAuthId));
    return user;
  }

  async syncSupabaseUser(supabaseAuthId: string, email: string, fullName: string): Promise<User> {
    const existing = await this.getUserBySupabaseId(supabaseAuthId);
    if (existing) {
      const [updated] = await db
        .update(users)
        .set({ lastLoginAt: new Date() })
        .where(eq(users.id, existing.id))
        .returning();
      return updated;
    }
    const [newUser] = await db
      .insert(users)
      .values({
        username: email.split("@")[0] + "_" + Date.now(),
        password: "disabled",
        email,
        fullName,
        supabaseAuthId,
        role: "adjuster",
        lastLoginAt: new Date(),
      })
      .returning();
    return newUser;
  }

  async updateUserLastLogin(userId: string): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(users.fullName);
  }

  async getClaimsForUser(userId: string): Promise<Claim[]> {
    return db
      .select()
      .from(claims)
      .where(eq(claims.assignedTo, userId))
      .orderBy(desc(claims.createdAt));
  }

  async createClaim(data: InsertClaim): Promise<Claim> {
    const [claim] = await db.insert(claims).values(data).returning();
    return claim;
  }

  async getClaims(): Promise<Claim[]> {
    return db.select().from(claims).orderBy(desc(claims.createdAt));
  }

  async getClaim(id: number): Promise<Claim | undefined> {
    const [claim] = await db.select().from(claims).where(eq(claims.id, id));
    return claim;
  }

  async deleteClaim(id: number): Promise<boolean> {
    const [deleted] = await db.delete(claims).where(eq(claims.id, id)).returning();
    return !!deleted;
  }

  async deleteAllClaims(): Promise<number> {
    const deleted = await db.delete(claims).returning();
    return deleted.length;
  }

  async updateClaimStatus(id: number, status: string): Promise<Claim | undefined> {
    const [claim] = await db
      .update(claims)
      .set({ status, updatedAt: new Date() })
      .where(eq(claims.id, id))
      .returning();
    return claim;
  }

  async updateClaimFields(id: number, fields: Partial<Pick<Claim, 'insuredName' | 'propertyAddress' | 'city' | 'state' | 'zip' | 'dateOfLoss' | 'perilType' | 'assignedTo'>>): Promise<Claim | undefined> {
    const [claim] = await db
      .update(claims)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(claims.id, id))
      .returning();
    return claim;
  }

  async createDocument(data: InsertDocument): Promise<Document> {
    const [doc] = await db.insert(documents).values(data).returning();
    return doc;
  }

  async getAllDocuments(): Promise<Document[]> {
    return db.select().from(documents);
  }

  async getDocumentById(id: number): Promise<Document | undefined> {
    const [doc] = await db.select().from(documents).where(eq(documents.id, id));
    return doc;
  }

  async getDocuments(claimId: number): Promise<Document[]> {
    return db.select().from(documents).where(eq(documents.claimId, claimId));
  }

  async getDocument(claimId: number, documentType: string): Promise<Document | undefined> {
    const [doc] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.claimId, claimId), eq(documents.documentType, documentType)));
    return doc;
  }

  async updateDocumentStatus(id: number, status: string, rawText?: string): Promise<Document | undefined> {
    const update: any = { status };
    if (rawText !== undefined) update.rawText = rawText;
    const [doc] = await db.update(documents).set(update).where(eq(documents.id, id)).returning();
    return doc;
  }

  async updateDocumentStoragePath(id: number, storagePath: string, fileName: string, fileSize: number): Promise<Document | undefined> {
    const [doc] = await db
      .update(documents)
      .set({ storagePath, fileName, fileSize })
      .where(eq(documents.id, id))
      .returning();
    return doc;
  }

  async updateDocumentError(id: number, errorMessage: string): Promise<Document | undefined> {
    const [doc] = await db
      .update(documents)
      .set({ status: "error", errorMessage })
      .where(eq(documents.id, id))
      .returning();
    return doc;
  }

  async createExtraction(data: InsertExtraction): Promise<Extraction> {
    const [ext] = await db.insert(extractions).values(data).returning();
    return ext;
  }

  async getExtractions(claimId: number): Promise<Extraction[]> {
    return db.select().from(extractions).where(eq(extractions.claimId, claimId));
  }

  async getExtraction(claimId: number, documentType: string): Promise<Extraction | undefined> {
    const [ext] = await db
      .select()
      .from(extractions)
      .where(and(eq(extractions.claimId, claimId), eq(extractions.documentType, documentType)));
    return ext;
  }

  async updateExtraction(id: number, extractedData: any): Promise<Extraction | undefined> {
    const [ext] = await db
      .update(extractions)
      .set({ extractedData, updatedAt: new Date() })
      .where(eq(extractions.id, id))
      .returning();
    return ext;
  }

  async confirmExtraction(id: number): Promise<Extraction | undefined> {
    const [ext] = await db
      .update(extractions)
      .set({ confirmedByUser: true, updatedAt: new Date() })
      .where(eq(extractions.id, id))
      .returning();
    return ext;
  }

  async createBriefing(data: InsertBriefing): Promise<Briefing> {
    const [briefing] = await db.insert(briefings).values(data).returning();
    return briefing;
  }

  async getBriefing(claimId: number): Promise<Briefing | undefined> {
    const [briefing] = await db.select().from(briefings).where(eq(briefings.claimId, claimId));
    return briefing;
  }

  async createInspectionSession(claimId: number): Promise<InspectionSession> {
    const [session] = await db.insert(inspectionSessions).values({ claimId }).returning();
    return session;
  }

  async getInspectionSession(sessionId: number): Promise<InspectionSession | undefined> {
    const [session] = await db.select().from(inspectionSessions).where(eq(inspectionSessions.id, sessionId));
    return session;
  }

  async getInspectionSessionsForClaim(claimId: number): Promise<InspectionSession[]> {
    return db.select().from(inspectionSessions).where(eq(inspectionSessions.claimId, claimId));
  }

  async getActiveSessionForClaim(claimId: number): Promise<InspectionSession | undefined> {
    const [session] = await db.select().from(inspectionSessions)
      .where(and(eq(inspectionSessions.claimId, claimId), eq(inspectionSessions.status, "active")));
    return session;
  }

  async getLatestSessionForClaim(claimId: number): Promise<InspectionSession | undefined> {
    const [session] = await db.select().from(inspectionSessions)
      .where(eq(inspectionSessions.claimId, claimId))
      .orderBy(desc(inspectionSessions.id))
      .limit(1);
    return session;
  }

  async updateSessionPhase(sessionId: number, phase: number): Promise<InspectionSession | undefined> {
    const [session] = await db.update(inspectionSessions).set({ currentPhase: phase }).where(eq(inspectionSessions.id, sessionId)).returning();
    return session;
  }

  async updateSessionRoom(sessionId: number, roomId: number): Promise<InspectionSession | undefined> {
    const [session] = await db.update(inspectionSessions).set({ currentRoomId: roomId }).where(eq(inspectionSessions.id, sessionId)).returning();
    return session;
  }

  async updateSessionStatus(sessionId: number, status: string): Promise<InspectionSession | undefined> {
    const [session] = await db.update(inspectionSessions).set({ status }).where(eq(inspectionSessions.id, sessionId)).returning();
    return session;
  }

  async updateSession(sessionId: number, updates: Partial<InspectionSession>): Promise<InspectionSession | undefined> {
    const [session] = await db.update(inspectionSessions).set(updates).where(eq(inspectionSessions.id, sessionId)).returning();
    return session;
  }

  async completeSession(sessionId: number): Promise<InspectionSession | undefined> {
    const [session] = await db.update(inspectionSessions)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(inspectionSessions.id, sessionId)).returning();
    return session;
  }

  // ── Structures ───────────────────────────────────────

  async createStructure(data: InsertStructure): Promise<Structure> {
    const [structure] = await db.insert(structures).values(data).returning();
    return structure;
  }

  async getStructures(sessionId: number): Promise<Structure[]> {
    return db.select().from(structures).where(eq(structures.sessionId, sessionId)).orderBy(structures.sortOrder);
  }

  async getStructure(structureId: number): Promise<Structure | undefined> {
    const [structure] = await db.select().from(structures).where(eq(structures.id, structureId));
    return structure;
  }

  async getStructureByName(sessionId: number, name: string): Promise<Structure | undefined> {
    const [structure] = await db.select().from(structures)
      .where(and(eq(structures.sessionId, sessionId), eq(structures.name, name)));
    return structure;
  }

  async updateStructure(structureId: number, updates: Partial<Structure>): Promise<Structure | undefined> {
    const [structure] = await db.update(structures).set(updates).where(eq(structures.id, structureId)).returning();
    return structure;
  }

  // ── Rooms ──────────────────────────────────────────

  async createRoom(data: InsertInspectionRoom): Promise<InspectionRoom> {
    const [room] = await db.insert(inspectionRooms).values(data).returning();
    return room;
  }

  async getRooms(sessionId: number): Promise<InspectionRoom[]> {
    return db.select().from(inspectionRooms).where(eq(inspectionRooms.sessionId, sessionId)).orderBy(inspectionRooms.createdAt);
  }

  async getRoomsForStructure(structureId: number): Promise<InspectionRoom[]> {
    return db.select().from(inspectionRooms)
      .where(eq(inspectionRooms.structureId, structureId))
      .orderBy(inspectionRooms.createdAt);
  }

  async getChildRooms(parentRoomId: number): Promise<InspectionRoom[]> {
    return db.select().from(inspectionRooms)
      .where(eq(inspectionRooms.parentRoomId, parentRoomId))
      .orderBy(inspectionRooms.createdAt);
  }

  async getRoom(roomId: number): Promise<InspectionRoom | undefined> {
    const [room] = await db.select().from(inspectionRooms).where(eq(inspectionRooms.id, roomId));
    return room;
  }

  async getRoomByName(sessionId: number, name: string): Promise<InspectionRoom | undefined> {
    const [room] = await db.select().from(inspectionRooms)
      .where(and(eq(inspectionRooms.sessionId, sessionId), eq(inspectionRooms.name, name)));
    return room;
  }

  async updateRoom(roomId: number, updates: Partial<InsertInspectionRoom>): Promise<InspectionRoom | undefined> {
    const [room] = await db.update(inspectionRooms).set(updates).where(eq(inspectionRooms.id, roomId)).returning();
    return room;
  }

  async updateRoomStatus(roomId: number, status: string): Promise<InspectionRoom | undefined> {
    const [room] = await db.update(inspectionRooms).set({ status }).where(eq(inspectionRooms.id, roomId)).returning();
    return room;
  }

  async updateRoomGeometry(roomId: number, polygon: any, position: any): Promise<InspectionRoom | undefined> {
    const [room] = await db.update(inspectionRooms).set({ polygon, position }).where(eq(inspectionRooms.id, roomId)).returning();
    return room;
  }

  async completeRoom(roomId: number): Promise<InspectionRoom | undefined> {
    const [room] = await db.update(inspectionRooms)
      .set({ status: "complete", completedAt: new Date() })
      .where(eq(inspectionRooms.id, roomId)).returning();
    return room;
  }

  async incrementRoomDamageCount(roomId: number): Promise<InspectionRoom | undefined> {
    const [room] = await db.update(inspectionRooms)
      .set({ damageCount: sql`${inspectionRooms.damageCount} + 1` })
      .where(eq(inspectionRooms.id, roomId)).returning();
    return room;
  }

  async incrementRoomPhotoCount(roomId: number): Promise<InspectionRoom | undefined> {
    const [room] = await db.update(inspectionRooms)
      .set({ photoCount: sql`${inspectionRooms.photoCount} + 1` })
      .where(eq(inspectionRooms.id, roomId)).returning();
    return room;
  }

  // ── Room Openings (L4: Deductions) ─────────────────

  async createRoomOpening(data: InsertRoomOpening): Promise<RoomOpening> {
    const [opening] = await db.insert(roomOpenings).values(data).returning();
    return opening;
  }

  async getRoomOpenings(roomId: number): Promise<RoomOpening[]> {
    return db.select().from(roomOpenings).where(eq(roomOpenings.roomId, roomId));
  }

  async deleteRoomOpening(id: number): Promise<void> {
    await db.delete(roomOpenings).where(eq(roomOpenings.id, id));
  }

  // ── Sketch Annotations (L5: Metadata) ──────────────

  async createSketchAnnotation(data: InsertSketchAnnotation): Promise<SketchAnnotation> {
    const [annotation] = await db.insert(sketchAnnotations).values(data).returning();
    return annotation;
  }

  async getSketchAnnotations(roomId: number): Promise<SketchAnnotation[]> {
    return db.select().from(sketchAnnotations).where(eq(sketchAnnotations.roomId, roomId));
  }

  async getSketchAnnotationsForSession(sessionId: number): Promise<SketchAnnotation[]> {
    const rooms = await this.getRooms(sessionId);
    const roomIds = rooms.map(r => r.id);
    if (roomIds.length === 0) return [];
    const allAnnotations: SketchAnnotation[] = [];
    for (const roomId of roomIds) {
      const annotations = await this.getSketchAnnotations(roomId);
      allAnnotations.push(...annotations);
    }
    return allAnnotations;
  }

  async deleteSketchAnnotation(id: number): Promise<void> {
    await db.delete(sketchAnnotations).where(eq(sketchAnnotations.id, id));
  }

  // ── Sketch Templates ──────────────────────────────

  async getSketchTemplates(category?: string): Promise<SketchTemplate[]> {
    if (category) {
      return db.select().from(sketchTemplates)
        .where(and(eq(sketchTemplates.category, category), eq(sketchTemplates.isActive, true)))
        .orderBy(sketchTemplates.sortOrder);
    }
    return db.select().from(sketchTemplates)
      .where(eq(sketchTemplates.isActive, true))
      .orderBy(sketchTemplates.sortOrder);
  }

  async getSketchTemplate(id: number): Promise<SketchTemplate | undefined> {
    const [template] = await db.select().from(sketchTemplates).where(eq(sketchTemplates.id, id));
    return template;
  }

  // ── Hierarchical Inspection State ──────────────────
  // Returns the full 5-level hierarchy for the voice agent context

  async getInspectionHierarchy(sessionId: number): Promise<{
    structures: Array<Structure & {
      rooms: Array<InspectionRoom & {
        subAreas: InspectionRoom[];
        damages: DamageObservation[];
        lineItemCount: number;
        photoCount: number;
        openings: RoomOpening[];
        annotations: SketchAnnotation[];
      }>;
    }>;
  }> {
    const allStructures = await this.getStructures(sessionId);
    const allRooms = await this.getRooms(sessionId);
    const allDamages = await this.getDamagesForSession(sessionId);
    const allLineItems = await this.getLineItems(sessionId);
    const allPhotos = await this.getPhotos(sessionId);

    // Build room lookup maps
    const damagesByRoom = new Map<number, DamageObservation[]>();
    for (const d of allDamages) {
      const arr = damagesByRoom.get(d.roomId) || [];
      arr.push(d);
      damagesByRoom.set(d.roomId, arr);
    }

    const lineItemCountByRoom = new Map<number, number>();
    for (const li of allLineItems) {
      if (li.roomId) lineItemCountByRoom.set(li.roomId, (lineItemCountByRoom.get(li.roomId) || 0) + 1);
    }

    const photoCountByRoom = new Map<number, number>();
    for (const p of allPhotos) {
      if (p.roomId) photoCountByRoom.set(p.roomId, (photoCountByRoom.get(p.roomId) || 0) + 1);
    }

    // Separate top-level rooms from sub-areas
    const topLevelRooms = allRooms.filter(r => !r.parentRoomId);
    const childRooms = allRooms.filter(r => r.parentRoomId);

    const result = [];
    for (const struct of allStructures) {
      const structRooms = topLevelRooms.filter(r => r.structureId === struct.id);
      const enrichedRooms = [];

      for (const room of structRooms) {
        const openings = await this.getRoomOpenings(room.id);
        const annotations = await this.getSketchAnnotations(room.id);
        const subAreas = childRooms.filter(c => c.parentRoomId === room.id);

        enrichedRooms.push({
          ...room,
          subAreas,
          damages: damagesByRoom.get(room.id) || [],
          lineItemCount: lineItemCountByRoom.get(room.id) || 0,
          photoCount: photoCountByRoom.get(room.id) || 0,
          openings,
          annotations,
        });
      }

      result.push({ ...struct, rooms: enrichedRooms });
    }

    return { structures: result };
  }

  async createDamage(data: InsertDamageObservation): Promise<DamageObservation> {
    const [damage] = await db.insert(damageObservations).values(data).returning();
    return damage;
  }

  async getDamages(roomId: number): Promise<DamageObservation[]> {
    return db.select().from(damageObservations).where(eq(damageObservations.roomId, roomId));
  }

  async getDamagesForSession(sessionId: number): Promise<DamageObservation[]> {
    return db.select().from(damageObservations).where(eq(damageObservations.sessionId, sessionId));
  }

  async createLineItem(data: InsertLineItem): Promise<LineItem> {
    const [item] = await db.insert(lineItems).values(data).returning();
    return item;
  }

  async getLineItems(sessionId: number): Promise<LineItem[]> {
    return db.select().from(lineItems).where(eq(lineItems.sessionId, sessionId)).orderBy(lineItems.createdAt);
  }

  async getLineItemsForRoom(roomId: number): Promise<LineItem[]> {
    return db.select().from(lineItems).where(eq(lineItems.roomId, roomId));
  }

  async getEstimateSummary(sessionId: number): Promise<{ totalRCV: number; totalDepreciation: number; totalACV: number; itemCount: number }> {
    const items = await this.getLineItems(sessionId);
    const totalRCV = items.reduce((sum, i) => sum + (i.totalPrice || 0), 0);

    const categoryDepreciationRates: Record<string, number> = {
      roofing: 0.20,
      siding: 0.15,
      gutters: 0.12,
      interior: 0.10,
      painting: 0.08,
      flooring: 0.15,
      plumbing: 0.12,
      electrical: 0.10,
      drywall: 0.08,
      windows: 0.18,
      fencing: 0.15,
    };
    const defaultRate = 0.12;

    let totalDepreciation = 0;
    for (const item of items) {
      const cat = (item.category || "").toLowerCase();
      const rate = categoryDepreciationRates[cat] ?? defaultRate;
      totalDepreciation += (item.totalPrice || 0) * rate;
    }

    const totalACV = totalRCV - totalDepreciation;
    return { totalRCV, totalDepreciation, totalACV, itemCount: items.length };
  }

  async updateLineItem(id: number, updates: Partial<LineItem>): Promise<LineItem | undefined> {
    const [item] = await db.update(lineItems).set(updates).where(eq(lineItems.id, id)).returning();
    return item;
  }

  async deleteLineItem(id: number): Promise<void> {
    await db.delete(lineItems).where(eq(lineItems.id, id));
  }

  async createPhoto(data: InsertInspectionPhoto): Promise<InspectionPhoto> {
    const [photo] = await db.insert(inspectionPhotos).values(data).returning();
    return photo;
  }

  async getPhotos(sessionId: number): Promise<InspectionPhoto[]> {
    return db.select().from(inspectionPhotos).where(eq(inspectionPhotos.sessionId, sessionId));
  }

  async getPhotosForRoom(roomId: number): Promise<InspectionPhoto[]> {
    return db.select().from(inspectionPhotos).where(eq(inspectionPhotos.roomId, roomId));
  }

  async updatePhoto(id: number, updates: Partial<InspectionPhoto>): Promise<InspectionPhoto | undefined> {
    const [photo] = await db.update(inspectionPhotos).set(updates).where(eq(inspectionPhotos.id, id)).returning();
    return photo;
  }

  async createMoistureReading(data: InsertMoistureReading): Promise<MoistureReading> {
    const [reading] = await db.insert(moistureReadings).values(data).returning();
    return reading;
  }

  async getMoistureReadings(roomId: number): Promise<MoistureReading[]> {
    return db.select().from(moistureReadings).where(eq(moistureReadings.roomId, roomId));
  }

  async getMoistureReadingsForSession(sessionId: number): Promise<MoistureReading[]> {
    return db.select().from(moistureReadings).where(eq(moistureReadings.sessionId, sessionId));
  }

  async addTranscript(data: InsertVoiceTranscript): Promise<VoiceTranscript> {
    const [entry] = await db.insert(voiceTranscripts).values(data).returning();
    return entry;
  }

  async getTranscript(sessionId: number): Promise<VoiceTranscript[]> {
    return db.select().from(voiceTranscripts).where(eq(voiceTranscripts.sessionId, sessionId)).orderBy(voiceTranscripts.timestamp);
  }

  async getScopeLineItems(): Promise<ScopeLineItem[]> {
    return db.select().from(scopeLineItems).where(eq(scopeLineItems.isActive, true)).orderBy(scopeLineItems.sortOrder);
  }

  async getScopeLineItemByCode(code: string): Promise<ScopeLineItem | undefined> {
    const [item] = await db.select().from(scopeLineItems).where(eq(scopeLineItems.code, code)).limit(1);
    return item;
  }

  async getScopeLineItemsByTrade(tradeCode: string): Promise<ScopeLineItem[]> {
    return db.select().from(scopeLineItems)
      .where(and(eq(scopeLineItems.tradeCode, tradeCode), eq(scopeLineItems.isActive, true)))
      .orderBy(scopeLineItems.sortOrder);
  }

  async getRegionalPrice(lineItemCode: string, regionId: string): Promise<RegionalPriceSet | undefined> {
    const [price] = await db.select().from(regionalPriceSets)
      .where(and(eq(regionalPriceSets.lineItemCode, lineItemCode), eq(regionalPriceSets.regionId, regionId)))
      .limit(1);
    return price;
  }

  async getRegionalPricesForRegion(regionId: string): Promise<RegionalPriceSet[]> {
    return db.select().from(regionalPriceSets).where(eq(regionalPriceSets.regionId, regionId));
  }

  async createSupplementalClaim(data: InsertSupplementalClaim): Promise<SupplementalClaim> {
    const [claim] = await db.insert(supplementalClaims).values(data).returning();
    return claim;
  }

  async getSupplementalsForSession(sessionId: number): Promise<SupplementalClaim[]> {
    return db.select().from(supplementalClaims).where(eq(supplementalClaims.originalSessionId, sessionId)).orderBy(desc(supplementalClaims.createdAt));
  }

  async getSupplemental(id: number): Promise<SupplementalClaim | undefined> {
    const [claim] = await db.select().from(supplementalClaims).where(eq(supplementalClaims.id, id));
    return claim;
  }

  async updateSupplemental(id: number, updates: Partial<SupplementalClaim>): Promise<SupplementalClaim | undefined> {
    const [claim] = await db.update(supplementalClaims).set(updates).where(eq(supplementalClaims.id, id)).returning();
    return claim;
  }

  async submitSupplemental(id: number): Promise<SupplementalClaim | undefined> {
    const [claim] = await db.update(supplementalClaims).set({ status: "submitted", submittedAt: new Date() }).where(eq(supplementalClaims.id, id)).returning();
    return claim;
  }

  async approveSupplemental(id: number): Promise<SupplementalClaim | undefined> {
    const [claim] = await db.update(supplementalClaims).set({ status: "approved", approvedAt: new Date() }).where(eq(supplementalClaims.id, id)).returning();
    return claim;
  }

  async updateUserProfile(userId: string, updates: { fullName?: string }): Promise<User | undefined> {
    const [user] = await db.update(users).set(updates).where(eq(users.id, userId)).returning();
    return user;
  }

  async getUserSettings(userId: string): Promise<Record<string, any> | null> {
    const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
    return row ? (row.settings as Record<string, any>) : null;
  }

  async upsertUserSettings(userId: string, settings: Record<string, any>): Promise<UserSettings> {
    const [row] = await db
      .insert(userSettings)
      .values({ userId, settings, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: { settings, updatedAt: new Date() },
      })
      .returning();
    return row;
  }
}

export const storage = new DatabaseStorage();
