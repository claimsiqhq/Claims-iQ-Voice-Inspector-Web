import { db } from "./db";
import {
  claims, documents, extractions, briefings,
  inspectionSessions, inspectionRooms, damageObservations,
  lineItems, inspectionPhotos, moistureReadings, voiceTranscripts,
  supplementalClaims, structures, roomOpenings, sketchAnnotations, sketchTemplates,
  testSquares,
  policyRules,
  taxRules,
  type Claim, type InsertClaim,
  type Document, type InsertDocument,
  type Extraction, type InsertExtraction,
  type Briefing, type InsertBriefing,
  type User, type InsertUser, users,
  type InspectionSession, type InsertInspectionSession,
  type Structure, type InsertStructure,
  type InspectionRoom, type InsertInspectionRoom,
  type RoomOpening, type InsertRoomOpening,
  roomAdjacencies, type RoomAdjacency, type InsertRoomAdjacency,
  type SketchAnnotation, type InsertSketchAnnotation,
  type SketchTemplate, type InsertSketchTemplate,
  type DamageObservation, type InsertDamageObservation,
  type LineItem, type InsertLineItem,
  type InspectionPhoto, type InsertInspectionPhoto,
  type MoistureReading, type InsertMoistureReading,
  type TestSquare, type InsertTestSquare,
  type VoiceTranscript, type InsertVoiceTranscript,
  type SupplementalClaim, type InsertSupplementalClaim,
  type PolicyRule, type InsertPolicyRule,
  type TaxRule, type InsertTaxRule,
  scopeLineItems, regionalPriceSets,
  scopeTrades, scopeItems, scopeSummary,
  type ScopeLineItem, type InsertScopeLineItem,
  type RegionalPriceSet, type InsertRegionalPriceSet,
  type ScopeTrade, type InsertScopeTrade,
  type ScopeItem, type InsertScopeItem,
  type ScopeSummary, type InsertScopeSummary,
  userSettings, type UserSettings,
  inspectionFlows, type InspectionFlow, type InsertInspectionFlow,
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByEmailOrUsername(identifier: string): Promise<User | undefined>;
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
  updateBriefing(claimId: number, data: Partial<InsertBriefing>): Promise<Briefing | undefined>;

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
  deleteStructure(structureId: number): Promise<void>;

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
  deleteRoom(roomId: number): Promise<void>;

  // Room openings (doors, windows)
  createRoomOpening(data: InsertRoomOpening): Promise<RoomOpening>;
  getRoomOpenings(roomId: number): Promise<RoomOpening[]>;
  deleteRoomOpening(id: number): Promise<void>;

  // ── Wall Openings (enhanced CRUD with session-level queries) ──
  createOpening(data: InsertRoomOpening): Promise<RoomOpening>;
  getOpening(id: number): Promise<RoomOpening | undefined>;
  getOpeningsForRoom(roomId: number): Promise<RoomOpening[]>;
  getOpeningsForSession(sessionId: number): Promise<RoomOpening[]>;
  updateOpening(id: number, updates: Partial<Pick<RoomOpening, "wallDirection" | "wallIndex" | "positionOnWall" | "widthFt" | "heightFt" | "width" | "height" | "quantity" | "label" | "openingType">>): Promise<RoomOpening | undefined>;
  deleteOpening(id: number): Promise<void>;

  // ── Room Adjacency ──────────────────────────
  createAdjacency(data: InsertRoomAdjacency): Promise<RoomAdjacency>;
  getAdjacenciesForRoom(roomId: number): Promise<RoomAdjacency[]>;
  getAdjacenciesForSession(sessionId: number): Promise<RoomAdjacency[]>;
  deleteAdjacency(id: number): Promise<void>;
  getAdjacentRooms(roomId: number): Promise<Array<{ adjacency: RoomAdjacency; room: InspectionRoom }>>;
  // Update room dimensions (specifically the jsonb `dimensions` column)
  updateRoomDimensions(roomId: number, dimensions: Record<string, any>): Promise<InspectionRoom | undefined>;

  // Sketch annotations (L5: damage counts, pitch, storm direction per facet)
  createSketchAnnotation(data: InsertSketchAnnotation): Promise<SketchAnnotation>;
  getSketchAnnotation(id: number): Promise<SketchAnnotation | undefined>;
  getSketchAnnotations(roomId: number): Promise<SketchAnnotation[]>;
  getSketchAnnotationsForSession(sessionId: number): Promise<SketchAnnotation[]>;
  updateSketchAnnotation(id: number, updates: Partial<Pick<SketchAnnotation, "annotationType" | "label" | "value" | "location" | "position">>): Promise<SketchAnnotation | undefined>;
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
  getLineItemById(id: number): Promise<LineItem | undefined>;
  getLineItems(sessionId: number): Promise<LineItem[]>;
  getLineItemsForRoom(roomId: number): Promise<LineItem[]>;
  getEstimateSummary(sessionId: number): Promise<{ totalRCV: number; totalDepreciation: number; totalACV: number; itemCount: number }>;
  updateLineItem(id: number, updates: Partial<LineItem>): Promise<LineItem | undefined>;
  deleteLineItem(id: number): Promise<void>;

  createPhoto(data: InsertInspectionPhoto): Promise<InspectionPhoto>;
  getPhoto(id: number): Promise<InspectionPhoto | undefined>;
  getPhotos(sessionId: number): Promise<InspectionPhoto[]>;
  getPhotosForRoom(roomId: number): Promise<InspectionPhoto[]>;
  updatePhoto(id: number, updates: Partial<InspectionPhoto>): Promise<InspectionPhoto | undefined>;
  deletePhoto(id: number): Promise<InspectionPhoto | undefined>;

  createMoistureReading(data: InsertMoistureReading): Promise<MoistureReading>;
  getMoistureReadings(roomId: number): Promise<MoistureReading[]>;
  getMoistureReadingsForSession(sessionId: number): Promise<MoistureReading[]>;

  // Test squares (forensic hail/wind documentation)
  createTestSquare(data: InsertTestSquare): Promise<TestSquare>;
  getTestSquares(sessionId: number): Promise<TestSquare[]>;
  getTestSquaresForRoom(roomId: number): Promise<TestSquare[]>;

  addTranscript(data: InsertVoiceTranscript): Promise<VoiceTranscript>;
  getTranscript(sessionId: number): Promise<VoiceTranscript[]>;

  getScopeLineItems(): Promise<ScopeLineItem[]>;
  getScopeLineItemByCode(code: string): Promise<ScopeLineItem | undefined>;
  getScopeLineItemsByTrade(tradeCode: string): Promise<ScopeLineItem[]>;
  getRegionalPrice(lineItemCode: string, regionId: string, activityType?: string): Promise<RegionalPriceSet | undefined>;
  getRegionalPricesForCode(lineItemCode: string, regionId: string): Promise<RegionalPriceSet[]>;
  getRegionalPricesForRegion(regionId: string): Promise<RegionalPriceSet[]>;

  // ── Scope Trades ─────────────────────────────────
  getScopeTrades(): Promise<ScopeTrade[]>;
  getScopeTradeByCode(code: string): Promise<ScopeTrade | undefined>;

  // ── Scope Items ──────────────────────────────────
  createScopeItem(data: InsertScopeItem): Promise<ScopeItem>;
  createScopeItems(data: InsertScopeItem[]): Promise<ScopeItem[]>;
  getScopeItems(sessionId: number): Promise<ScopeItem[]>;
  getScopeItemsForRoom(roomId: number): Promise<ScopeItem[]>;
  getScopeItemsForDamage(damageId: number): Promise<ScopeItem[]>;
  updateScopeItem(id: number, updates: Partial<ScopeItem>): Promise<ScopeItem | undefined>;
  deleteScopeItem(id: number): Promise<void>;
  getActiveScopeItemCount(sessionId: number): Promise<number>;

  // ── Scope Summary ────────────────────────────────
  upsertScopeSummary(sessionId: number, tradeCode: string, data: Partial<InsertScopeSummary>): Promise<ScopeSummary>;
  getScopeSummary(sessionId: number): Promise<ScopeSummary[]>;
  recalculateScopeSummary(sessionId: number): Promise<ScopeSummary[]>;

  createSupplementalClaim(data: InsertSupplementalClaim): Promise<SupplementalClaim>;
  getSupplementalsForSession(sessionId: number): Promise<SupplementalClaim[]>;
  getSupplemental(id: number): Promise<SupplementalClaim | undefined>;
  updateSupplemental(id: number, updates: Partial<SupplementalClaim>): Promise<SupplementalClaim | undefined>;
  submitSupplemental(id: number): Promise<SupplementalClaim | undefined>;
  approveSupplemental(id: number): Promise<SupplementalClaim | undefined>;

  updateUserProfile(userId: string, updates: { fullName?: string; title?: string; avatarUrl?: string }): Promise<User | undefined>;
  getUserSettings(userId: string): Promise<Record<string, any> | null>;
  upsertUserSettings(userId: string, settings: Record<string, any>): Promise<UserSettings>;

  // Inspection Flows
  createInspectionFlow(data: InsertInspectionFlow): Promise<InspectionFlow>;
  getInspectionFlows(userId?: string): Promise<InspectionFlow[]>;
  getInspectionFlow(id: number): Promise<InspectionFlow | undefined>;
  getDefaultFlowForPeril(perilType: string, userId?: string): Promise<InspectionFlow | undefined>;
  updateInspectionFlow(id: number, updates: Partial<InsertInspectionFlow>): Promise<InspectionFlow | undefined>;
  deleteInspectionFlow(id: number): Promise<boolean>;

  // ── Policy Rules ──────────────────────────
  createPolicyRule(data: InsertPolicyRule): Promise<PolicyRule>;
  getPolicyRulesForClaim(claimId: number): Promise<PolicyRule[]>;
  getPolicyRule(claimId: number, coverageType: string): Promise<PolicyRule | undefined>;
  updatePolicyRule(id: number, updates: Partial<PolicyRule>): Promise<PolicyRule | undefined>;

  // ── Tax Rules ────────────────────────────────
  createTaxRule(data: InsertTaxRule): Promise<TaxRule>;
  getTaxRulesForClaim(claimId: number): Promise<TaxRule[]>;
  deleteTaxRule(id: number): Promise<void>;

  // ── Settlement Summary ──────────────────────────
  getSettlementSummary(sessionId: number, claimId: number): Promise<any>;
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

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByEmailOrUsername(identifier: string): Promise<User | undefined> {
    if (identifier.includes("@")) {
      return this.getUserByEmail(identifier);
    }
    return this.getUserByUsername(identifier);
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

  async updateBriefing(claimId: number, data: Partial<InsertBriefing>): Promise<Briefing | undefined> {
    const [briefing] = await db
      .update(briefings)
      .set(data)
      .where(eq(briefings.claimId, claimId))
      .returning();
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

  async deleteStructure(structureId: number): Promise<void> {
    const rooms = await this.getRoomsForStructure(structureId);
    if (rooms.length > 0) {
      throw new Error("Cannot delete structure that has rooms. Delete or move the rooms first.");
    }
    await db.delete(structures).where(eq(structures.id, structureId));
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

  async deleteRoom(roomId: number): Promise<void> {
    const childRooms = await db.select({ id: inspectionRooms.id }).from(inspectionRooms)
      .where(eq(inspectionRooms.parentRoomId, roomId));
    const childIds = childRooms.map(c => c.id);
    for (const childId of childIds) {
      await db.delete(roomOpenings).where(eq(roomOpenings.roomId, childId));
      await db.delete(sketchAnnotations).where(eq(sketchAnnotations.roomId, childId));
    }
    if (childIds.length > 0) {
      await db.delete(inspectionRooms).where(eq(inspectionRooms.parentRoomId, roomId));
    }
    await db.delete(roomOpenings).where(eq(roomOpenings.roomId, roomId));
    await db.delete(sketchAnnotations).where(eq(sketchAnnotations.roomId, roomId));
    await db.delete(inspectionRooms).where(eq(inspectionRooms.id, roomId));
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

  // ── Wall Openings (enhanced CRUD with session-level queries) ──

  async createOpening(data: InsertRoomOpening): Promise<RoomOpening> {
    const [opening] = await db.insert(roomOpenings).values(data).returning();
    return opening;
  }

  async getOpening(id: number): Promise<RoomOpening | undefined> {
    const [opening] = await db.select().from(roomOpenings).where(eq(roomOpenings.id, id));
    return opening;
  }

  async updateOpening(id: number, updates: Partial<Pick<RoomOpening, "wallDirection" | "wallIndex" | "positionOnWall" | "widthFt" | "heightFt" | "width" | "height" | "quantity" | "label" | "openingType">>): Promise<RoomOpening | undefined> {
    const [updated] = await db.update(roomOpenings).set(updates as any).where(eq(roomOpenings.id, id)).returning();
    return updated;
  }

  async getOpeningsForRoom(roomId: number): Promise<RoomOpening[]> {
    return db.select().from(roomOpenings).where(eq(roomOpenings.roomId, roomId));
  }

  async getOpeningsForSession(sessionId: number): Promise<RoomOpening[]> {
    return db.select().from(roomOpenings).where(eq(roomOpenings.sessionId, sessionId));
  }

  async deleteOpening(id: number): Promise<void> {
    await db.delete(roomOpenings).where(eq(roomOpenings.id, id));
  }

  async createAdjacency(data: InsertRoomAdjacency): Promise<RoomAdjacency> {
    const [adjacency] = await db.insert(roomAdjacencies).values(data).returning();
    return adjacency;
  }

  async getAdjacenciesForRoom(roomId: number): Promise<RoomAdjacency[]> {
    return db.select().from(roomAdjacencies)
      .where(
        sql`${roomAdjacencies.roomIdA} = ${roomId} OR ${roomAdjacencies.roomIdB} = ${roomId}`
      );
  }

  async getAdjacenciesForSession(sessionId: number): Promise<RoomAdjacency[]> {
    return db.select().from(roomAdjacencies)
      .where(eq(roomAdjacencies.sessionId, sessionId));
  }

  async deleteAdjacency(id: number): Promise<void> {
    await db.delete(roomAdjacencies).where(eq(roomAdjacencies.id, id));
  }

  async getAdjacentRooms(roomId: number): Promise<Array<{ adjacency: RoomAdjacency; room: InspectionRoom }>> {
    const adjacencies = await this.getAdjacenciesForRoom(roomId);
    const results: Array<{ adjacency: RoomAdjacency; room: InspectionRoom }> = [];
    for (const adj of adjacencies) {
      const otherRoomId = adj.roomIdA === roomId ? adj.roomIdB : adj.roomIdA;
      const room = await this.getRoom(otherRoomId);
      if (room) results.push({ adjacency: adj, room });
    }
    return results;
  }

  async updateRoomDimensions(roomId: number, dimensions: Record<string, any>): Promise<InspectionRoom | undefined> {
    const [updated] = await db.update(inspectionRooms)
      .set({ dimensions })
      .where(eq(inspectionRooms.id, roomId))
      .returning();
    return updated;
  }

  // ── Sketch Annotations (L5: Metadata) ──────────────

  async createSketchAnnotation(data: InsertSketchAnnotation): Promise<SketchAnnotation> {
    const [annotation] = await db.insert(sketchAnnotations).values(data).returning();
    return annotation;
  }

  async getSketchAnnotation(id: number): Promise<SketchAnnotation | undefined> {
    const [annotation] = await db.select().from(sketchAnnotations).where(eq(sketchAnnotations.id, id));
    return annotation;
  }

  async updateSketchAnnotation(id: number, updates: Partial<Pick<SketchAnnotation, "annotationType" | "label" | "value" | "location" | "position">>): Promise<SketchAnnotation | undefined> {
    const [updated] = await db.update(sketchAnnotations).set(updates as any).where(eq(sketchAnnotations.id, id)).returning();
    return updated;
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
      const structRooms = topLevelRooms.filter(r =>
        r.structureId === struct.id ||
        (!r.structureId && (r.structure || "Main Dwelling") === struct.name)
      );
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

  async getLineItemById(id: number): Promise<LineItem | undefined> {
    const [item] = await db.select().from(lineItems).where(eq(lineItems.id, id)).limit(1);
    return item;
  }

  async getLineItems(sessionId: number): Promise<LineItem[]> {
    return db.select().from(lineItems).where(eq(lineItems.sessionId, sessionId)).orderBy(lineItems.createdAt);
  }

  async getLineItemsForRoom(roomId: number): Promise<LineItem[]> {
    return db.select().from(lineItems).where(eq(lineItems.roomId, roomId));
  }

  async getEstimateSummary(sessionId: number): Promise<{ totalRCV: number; totalDepreciation: number; totalACV: number; itemCount: number; subtotalMaterial: number; subtotalLabor: number; subtotalEquipment: number }> {
    const items = await this.getLineItems(sessionId);
    const totalRCV = items.reduce((sum, i) => sum + (Number(i.totalPrice) || 0), 0);

    let totalDepreciation = 0;
    for (const item of items) {
      if (item.depreciationAmount != null && Number(item.depreciationAmount) > 0) {
        totalDepreciation += Number(item.depreciationAmount);
      }
    }

    const totalACV = totalRCV - totalDepreciation;
    return { totalRCV, totalDepreciation, totalACV, itemCount: items.length, subtotalMaterial: 0, subtotalLabor: 0, subtotalEquipment: 0 };
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

  async getPhoto(id: number): Promise<InspectionPhoto | undefined> {
    const [photo] = await db.select().from(inspectionPhotos).where(eq(inspectionPhotos.id, id)).limit(1);
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

  async deletePhoto(id: number): Promise<InspectionPhoto | undefined> {
    const [photo] = await db.delete(inspectionPhotos).where(eq(inspectionPhotos.id, id)).returning();
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

  async createTestSquare(data: InsertTestSquare): Promise<TestSquare> {
    const [sq] = await db.insert(testSquares).values(data).returning();
    return sq;
  }

  async getTestSquares(sessionId: number): Promise<TestSquare[]> {
    return db.select().from(testSquares).where(eq(testSquares.sessionId, sessionId));
  }

  async getTestSquaresForRoom(roomId: number): Promise<TestSquare[]> {
    return db.select().from(testSquares).where(eq(testSquares.roomId, roomId));
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

  async getRegionalPrice(lineItemCode: string, regionId: string, activityType?: string): Promise<RegionalPriceSet | undefined> {
    const rows = await db.select().from(regionalPriceSets)
      .where(and(eq(regionalPriceSets.lineItemCode, lineItemCode), eq(regionalPriceSets.regionId, regionId)));

    if (rows.length === 0) return undefined;
    if (rows.length === 1) return rows[0];

    if (activityType) {
      const match = rows.find(r => r.activityType === activityType);
      if (match) return match;
    }

    const install = rows.find(r => r.activityType === "install");
    if (install) return install;

    return rows[0];
  }

  async getRegionalPricesForCode(lineItemCode: string, regionId: string): Promise<RegionalPriceSet[]> {
    return db.select().from(regionalPriceSets)
      .where(and(eq(regionalPriceSets.lineItemCode, lineItemCode), eq(regionalPriceSets.regionId, regionId)));
  }

  async getRegionalPricesForRegion(regionId: string): Promise<RegionalPriceSet[]> {
    return db.select().from(regionalPriceSets).where(eq(regionalPriceSets.regionId, regionId));
  }

  // ── Scope Trades ─────────────────────────────────

  async getScopeTrades(): Promise<ScopeTrade[]> {
    return db.select().from(scopeTrades).where(eq(scopeTrades.isActive, true)).orderBy(scopeTrades.sortOrder);
  }

  async getScopeTradeByCode(code: string): Promise<ScopeTrade | undefined> {
    const [trade] = await db.select().from(scopeTrades).where(eq(scopeTrades.code, code)).limit(1);
    return trade;
  }

  // ── Scope Items ──────────────────────────────────

  async createScopeItem(data: InsertScopeItem): Promise<ScopeItem> {
    const [item] = await db.insert(scopeItems).values(data).returning();
    return item;
  }

  async createScopeItems(data: InsertScopeItem[]): Promise<ScopeItem[]> {
    if (data.length === 0) return [];
    return db.insert(scopeItems).values(data).returning();
  }

  async getScopeItems(sessionId: number): Promise<ScopeItem[]> {
    return db.select().from(scopeItems)
      .where(and(eq(scopeItems.sessionId, sessionId), eq(scopeItems.status, "active")))
      .orderBy(scopeItems.tradeCode, scopeItems.createdAt);
  }

  async getScopeItemsForRoom(roomId: number): Promise<ScopeItem[]> {
    return db.select().from(scopeItems)
      .where(and(eq(scopeItems.roomId, roomId), eq(scopeItems.status, "active")));
  }

  async getScopeItemsForDamage(damageId: number): Promise<ScopeItem[]> {
    return db.select().from(scopeItems)
      .where(and(eq(scopeItems.damageId, damageId), eq(scopeItems.status, "active")));
  }

  async updateScopeItem(id: number, updates: Partial<ScopeItem>): Promise<ScopeItem | undefined> {
    const [item] = await db.update(scopeItems).set(updates).where(eq(scopeItems.id, id)).returning();
    return item;
  }

  async deleteScopeItem(id: number): Promise<void> {
    await db.update(scopeItems).set({ status: "removed" }).where(eq(scopeItems.id, id));
  }

  async getActiveScopeItemCount(sessionId: number): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(scopeItems)
      .where(and(eq(scopeItems.sessionId, sessionId), eq(scopeItems.status, "active")));
    return result[0]?.count || 0;
  }

  // ── Scope Summary ────────────────────────────────

  async upsertScopeSummary(
    sessionId: number,
    tradeCode: string,
    data: Partial<InsertScopeSummary>
  ): Promise<ScopeSummary> {
    const [existing] = await db.select().from(scopeSummary)
      .where(and(eq(scopeSummary.sessionId, sessionId), eq(scopeSummary.tradeCode, tradeCode)))
      .limit(1);

    if (existing) {
      const [updated] = await db.update(scopeSummary)
        .set(data)
        .where(eq(scopeSummary.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(scopeSummary)
      .values({ sessionId, tradeCode, ...data })
      .returning();
    return created;
  }

  async getScopeSummary(sessionId: number): Promise<ScopeSummary[]> {
    return db.select().from(scopeSummary)
      .where(eq(scopeSummary.sessionId, sessionId))
      .orderBy(scopeSummary.tradeCode);
  }

  async recalculateScopeSummary(sessionId: number): Promise<ScopeSummary[]> {
    const items = await this.getScopeItems(sessionId);
    const trades = await this.getScopeTrades();
    const tradeMap = new Map(trades.map(t => [t.code, t.name]));

    const byTrade = new Map<string, ScopeItem[]>();
    for (const item of items) {
      const existing = byTrade.get(item.tradeCode) || [];
      existing.push(item);
      byTrade.set(item.tradeCode, existing);
    }

    const summaries: ScopeSummary[] = [];
    for (const [tradeCode, tradeItems] of byTrade) {
      const tradeName = tradeMap.get(tradeCode);
      const quantitiesByUnit: Record<string, number> = {};
      for (const item of tradeItems) {
        quantitiesByUnit[item.unit] = (quantitiesByUnit[item.unit] || 0) + item.quantity;
      }

      const summary = await this.upsertScopeSummary(sessionId, tradeCode, {
        tradeName: tradeName || tradeCode,
        itemCount: tradeItems.length,
        quantitiesByUnit,
        opEligible: trades.find(t => t.code === tradeCode)?.opEligible ?? true,
      });
      summaries.push(summary);
    }

    return summaries;
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

  async updateUserProfile(userId: string, updates: { fullName?: string; title?: string; avatarUrl?: string }): Promise<User | undefined> {
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

  // ── Inspection Flows ──────────────────────────────

  async createInspectionFlow(data: InsertInspectionFlow): Promise<InspectionFlow> {
    const [flow] = await db.insert(inspectionFlows).values(data).returning();
    return flow;
  }

  async getInspectionFlows(userId?: string): Promise<InspectionFlow[]> {
    // Return system defaults + user's custom flows
    if (userId) {
      return db.select().from(inspectionFlows)
        .where(
          sql`${inspectionFlows.isSystemDefault} = true OR ${inspectionFlows.userId} = ${userId}`
        )
        .orderBy(inspectionFlows.perilType, inspectionFlows.name);
    }
    return db.select().from(inspectionFlows)
      .where(eq(inspectionFlows.isSystemDefault, true))
      .orderBy(inspectionFlows.perilType, inspectionFlows.name);
  }

  async getInspectionFlow(id: number): Promise<InspectionFlow | undefined> {
    const [flow] = await db.select().from(inspectionFlows).where(eq(inspectionFlows.id, id));
    return flow;
  }

  async getDefaultFlowForPeril(perilType: string, userId?: string): Promise<InspectionFlow | undefined> {
    // First try user's default for this peril
    if (userId) {
      const [userFlow] = await db.select().from(inspectionFlows)
        .where(
          and(
            eq(inspectionFlows.userId, userId),
            eq(inspectionFlows.perilType, perilType),
            eq(inspectionFlows.isDefault, true),
          )
        )
        .limit(1);
      if (userFlow) return userFlow;
    }
    // Fall back to system default for this peril
    const [systemFlow] = await db.select().from(inspectionFlows)
      .where(
        and(
          eq(inspectionFlows.isSystemDefault, true),
          eq(inspectionFlows.perilType, perilType),
          eq(inspectionFlows.isDefault, true),
        )
      )
      .limit(1);
    if (systemFlow) return systemFlow;
    // Fall back to "General" system default
    const [generalFlow] = await db.select().from(inspectionFlows)
      .where(
        and(
          eq(inspectionFlows.isSystemDefault, true),
          eq(inspectionFlows.perilType, "General"),
          eq(inspectionFlows.isDefault, true),
        )
      )
      .limit(1);
    return generalFlow;
  }

  async updateInspectionFlow(id: number, updates: Partial<InsertInspectionFlow>): Promise<InspectionFlow | undefined> {
    const [flow] = await db.update(inspectionFlows)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(inspectionFlows.id, id))
      .returning();
    return flow;
  }

  async deleteInspectionFlow(id: number): Promise<boolean> {
    const [deleted] = await db.delete(inspectionFlows).where(eq(inspectionFlows.id, id)).returning();
    return !!deleted;
  }

  // ── Policy Rules ──────────────────────────

  async createPolicyRule(data: InsertPolicyRule): Promise<PolicyRule> {
    const [rule] = await db.insert(policyRules).values(data).returning();
    return rule;
  }

  async getPolicyRulesForClaim(claimId: number): Promise<PolicyRule[]> {
    return db.select().from(policyRules).where(eq(policyRules.claimId, claimId));
  }

  async getPolicyRule(claimId: number, coverageType: string): Promise<PolicyRule | undefined> {
    const [rule] = await db.select().from(policyRules)
      .where(and(eq(policyRules.claimId, claimId), eq(policyRules.coverageType, coverageType)));
    return rule;
  }

  async updatePolicyRule(id: number, updates: Partial<PolicyRule>): Promise<PolicyRule | undefined> {
    const [rule] = await db.update(policyRules).set(updates).where(eq(policyRules.id, id)).returning();
    return rule;
  }

  // ── Tax Rules ──────────────────────────

  async createTaxRule(data: InsertTaxRule): Promise<TaxRule> {
    const [rule] = await db.insert(taxRules).values(data).returning();
    return rule;
  }

  async getTaxRulesForClaim(claimId: number): Promise<TaxRule[]> {
    return db.select().from(taxRules).where(eq(taxRules.claimId, claimId));
  }

  async deleteTaxRule(id: number): Promise<void> {
    await db.delete(taxRules).where(eq(taxRules.id, id));
  }

  // ── Settlement Summary ──────────────────────────

  async getSettlementSummary(sessionId: number, claimId: number): Promise<any> {
    const items = await this.getLineItems(sessionId);
    const rooms = await this.getRooms(sessionId);
    const rules = await this.getPolicyRulesForClaim(claimId);
    const claimTaxRules = await this.getTaxRulesForClaim(claimId);

    // Build a room lookup for structure resolution
    const roomLookup = new Map(rooms.map(r => [r.id, r]));

    // Map line items to the shape calculateSettlement expects
    const mapped = items.map(item => {
      const room = item.roomId ? roomLookup.get(item.roomId) : null;
      return {
        id: item.id,
        description: item.description,
        category: item.category,
        tradeCode: (item.xactCode || item.category || "GEN").substring(0, 3).toUpperCase(),
        quantity: Number(item.quantity) || 0,
        unitPrice: Number(item.unitPrice) || 0,
        totalPrice: Number(item.totalPrice) || 0,
        age: (item as any).age || null,
        lifeExpectancy: (item as any).lifeExpectancy || null,
        depreciationPercentage: (item as any).depreciationPercentage || null,
        depreciationType: item.depreciationType || "Recoverable",
        coverageBucket: (item as any).coverageBucket || "Coverage A",
        structure: room?.structure || null,
      };
    });

    const policyInput = rules.map(r => ({
      coverageType: r.coverageType,
      policyLimit: r.policyLimit,
      deductible: r.deductible,
      applyRoofSchedule: r.applyRoofSchedule || false,
      overheadPct: r.overheadPct || 10,
      profitPct: r.profitPct || 10,
      taxRate: r.taxRate || 8,
      opExcludedTrades: (r as any).opExcludedTrades || [],
    }));

    const taxRulesByCategory = taxRulesToCategoryFormat(
      claimTaxRules.map(t => ({
        taxRate: t.taxRate,
        appliesToCategories: (t.appliesToCategories || []) as string[],
        appliesToCostType: t.appliesToCostType || "all",
      }))
    );

    const { resolveSettlementRules } = await import("./settlementRules");
    const claim = await this.getClaim(claimId);
    const baseRules = await resolveSettlementRules(
      String(claimId),
      (claim as { carrierCode?: string })?.carrierCode ?? null
    );

    const {
      getPolicyOverridesAndLimits,
      taxRulesToCategoryFormat,
      calculateSettlement,
    } = await import("./estimateEngine");
    const { overrides, limits } = getPolicyOverridesAndLimits(policyInput);
    const settlementRules = { ...baseRules, ...overrides };

    return calculateSettlement(mapped, settlementRules, limits, taxRulesByCategory);
  }
}

export const storage = new DatabaseStorage();
