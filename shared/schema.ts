import { sql } from "drizzle-orm";
import { pgTable, text, serial, integer, boolean, timestamp, jsonb, varchar, real, numeric, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email").unique(),
  fullName: text("full_name"),
  role: varchar("role", { length: 20 }).notNull().default("adjuster"),
  title: text("title"),
  avatarUrl: text("avatar_url"),
  supabaseAuthId: varchar("supabase_auth_id", { length: 100 }).unique(),
  lastLoginAt: timestamp("last_login_at"),
  isActive: boolean("is_active").default(true),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  email: true,
  fullName: true,
  role: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const claims = pgTable(
  "claims",
  {
    id: serial("id").primaryKey(),
    claimNumber: varchar("claim_number", { length: 50 }).notNull(),
    insuredName: text("insured_name"),
    propertyAddress: text("property_address"),
    city: varchar("city", { length: 100 }),
    state: varchar("state", { length: 2 }),
    zip: varchar("zip", { length: 10 }),
    dateOfLoss: varchar("date_of_loss", { length: 20 }),
    perilType: varchar("peril_type", { length: 20 }),
    status: varchar("status", { length: 30 }).notNull().default("draft"),
    assignedTo: varchar("assigned_to").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    claimNumberUnique: uniqueIndex("claims_claim_number_unique").on(table.claimNumber),
    assignedToIdx: index("claims_assigned_to_idx").on(table.assignedTo),
    statusIdx: index("claims_status_idx").on(table.status),
  }),
);

export const documents = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    claimId: integer("claim_id").notNull().references(() => claims.id, { onDelete: "cascade" }),
    documentType: varchar("document_type", { length: 20 }).notNull(),
    fileName: text("file_name"),
    fileSize: integer("file_size"),
    storagePath: text("storage_path"),
    rawText: text("raw_text"),
    status: varchar("status", { length: 20 }).notNull().default("empty"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    claimDocumentUnique: uniqueIndex("documents_claim_document_unique").on(table.claimId, table.documentType),
  }),
);

export const extractions = pgTable(
  "extractions",
  {
    id: serial("id").primaryKey(),
    claimId: integer("claim_id").notNull().references(() => claims.id, { onDelete: "cascade" }),
    documentType: varchar("document_type", { length: 20 }).notNull(),
    extractedData: jsonb("extracted_data").notNull(),
    confidence: jsonb("confidence"),
    confirmedByUser: boolean("confirmed_by_user").default(false),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    claimExtractionUnique: uniqueIndex("extractions_claim_document_unique").on(table.claimId, table.documentType),
  }),
);

export const briefings = pgTable("briefings", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").notNull().references(() => claims.id, { onDelete: "cascade" }),
  propertyProfile: jsonb("property_profile"),
  coverageSnapshot: jsonb("coverage_snapshot"),
  perilAnalysis: jsonb("peril_analysis"),
  endorsementImpacts: jsonb("endorsement_impacts"),
  inspectionChecklist: jsonb("inspection_checklist"),
  dutiesAfterLoss: jsonb("duties_after_loss"),
  redFlags: jsonb("red_flags"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertClaimSchema = createInsertSchema(claims).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  createdAt: true,
});
export const insertExtractionSchema = createInsertSchema(extractions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertBriefingSchema = createInsertSchema(briefings).omit({
  id: true,
  createdAt: true,
});

export type Claim = typeof claims.$inferSelect;
export type InsertClaim = z.infer<typeof insertClaimSchema>;
export type Document = typeof documents.$inferSelect;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Extraction = typeof extractions.$inferSelect;
export type InsertExtraction = z.infer<typeof insertExtractionSchema>;
export type Briefing = typeof briefings.$inferSelect;
export type InsertBriefing = z.infer<typeof insertBriefingSchema>;

export const inspectionSessions = pgTable(
  "inspection_sessions",
  {
    id: serial("id").primaryKey(),
    claimId: integer("claim_id").notNull().references(() => claims.id, { onDelete: "cascade" }),
    inspectorId: varchar("inspector_id").references(() => users.id),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    currentPhase: integer("current_phase").default(1),
    currentRoomId: integer("current_room_id"),
    currentStructure: varchar("current_structure", { length: 100 }).default("Main Dwelling"),
    voiceSessionId: text("voice_session_id"),
    adjusterNotes: text("adjuster_notes"),
    startedAt: timestamp("started_at").defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (table) => ({
    claimIdIdx: index("inspection_sessions_claim_id_idx").on(table.claimId),
  }),
);

// ── Structures ─────────────────────────────────────────
// Top-level hierarchy entity: Main Dwelling, Detached Garage, Shed, Fence, etc.
// Every room MUST belong to a structure.
export const structures = pgTable(
  "structures",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull().references(() => inspectionSessions.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    structureType: varchar("structure_type", { length: 30 }).notNull().default("dwelling"),
    outline: jsonb("outline"),       // polygon vertices for footprint on sketch
    position: jsonb("position"),     // {x, y} placement origin on canvas
    sortOrder: integer("sort_order").default(0),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    sessionNameUnique: uniqueIndex("structures_session_name_unique").on(table.sessionId, table.name),
  }),
);

// ── L2: Parent Areas (Rooms / Elevations / Roof Facets) ─
// The primary geometric shape within a structure view.
export const inspectionRooms = pgTable(
  "inspection_rooms",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull().references(() => inspectionSessions.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    roomType: varchar("room_type", { length: 50 }),
    structure: varchar("structure", { length: 100 }).default("Main Dwelling"), // legacy text field
    structureId: integer("structure_id").references(() => structures.id, { onDelete: "set null" }),
    // L1 View Type: what "canvas" this area belongs to
    viewType: varchar("view_type", { length: 20 }).default("interior"),
      // interior, roof_plan, elevation, exterior_other
    // L2 Shape Type: geometric form of this area
    shapeType: varchar("shape_type", { length: 20 }).default("rectangle"),
      // rectangle, gable, hip, l_shape, custom
    // L3 Parent-child relationship for subrooms/attachments
    parentRoomId: integer("parent_room_id").references((): any => inspectionRooms.id, { onDelete: "set null" }),
    attachmentType: varchar("attachment_type", { length: 30 }),
      // null for top-level areas; for children:
      // extension, pop_out, bay_window, dormer, closet, pantry, island, alcove, garage_extension
    dimensions: jsonb("dimensions"),
      // {length, width, height} — for rooms: LxWxCeiling; for elevations: LxWallH; for roofs: LxW
    polygon: jsonb("polygon"),         // array of {x,y} wall vertices for sketch
    position: jsonb("position"),       // {x,y} placement on sketch canvas
    floor: integer("floor").default(1),
    // Facet label for roof slopes (F1, F2, F3 — auto-assigned)
    facetLabel: varchar("facet_label", { length: 10 }),
    // Roof pitch (e.g., "7/12", "10/12")
    pitch: varchar("pitch", { length: 10 }),
    status: varchar("status", { length: 20 }).notNull().default("not_started"),
    damageCount: integer("damage_count").default(0),
    photoCount: integer("photo_count").default(0),
    phase: integer("phase"),
    createdAt: timestamp("created_at").defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (table) => ({
    sessionIdIdx: index("inspection_rooms_session_id_idx").on(table.sessionId),
    structureIdIdx: index("inspection_rooms_structure_id_idx").on(table.structureId),
  }),
);

// ── L4: Deductions / Openings ──────────────────────────
// "Holes" in walls: doors, windows, missing walls, overhead doors.
// MUST belong to a specific wall of a specific room.
// Creates MISS_WALL entries in ESX export and deducts from wall SF calculations.
export const roomOpenings = pgTable("room_openings", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").references(() => inspectionSessions.id, { onDelete: "cascade" }),
  roomId: integer("room_id").notNull().references(() => inspectionRooms.id, { onDelete: "cascade" }),
  openingType: varchar("opening_type", { length: 30 }).notNull().default("door"),
    // openingType enum: "window" | "standard_door" | "overhead_door" | "missing_wall" | "pass_through" | "archway" | "cased_opening" | "door" | "sliding_door"
  wallIndex: integer("wall_index"),       // 0-based index into polygon edges (for sketch placement)
  wallDirection: varchar("wall_direction", { length: 20 }),
    // wallDirection enum: "north" | "south" | "east" | "west" | "front" | "rear" | "left" | "right"
  positionOnWall: real("position_on_wall").default(0.5), // 0.0=start, 1.0=end
  widthFt: real("width_ft"),              // opening width in feet
  heightFt: real("height_ft"),            // opening height in feet
  width: real("width"),                   // legacy alias for widthFt
  height: real("height"),                 // legacy alias for heightFt
  quantity: integer("quantity").notNull().default(1),
  label: varchar("label", { length: 50 }),
  opensInto: varchar("opens_into", { length: 100 }),
    // Room name (e.g., "Hallway", "Kitchen") or "E" for exterior
  goesToFloor: boolean("goes_to_floor").default(false),
    // true for garage doors / overhead doors that extend to floor level
  goesToCeiling: boolean("goes_to_ceiling").default(false),
    // true for pass-throughs that go to ceiling
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ── Room Adjacency (which rooms share walls) ────────────────
export const roomAdjacencies = pgTable("room_adjacencies", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => inspectionSessions.id, { onDelete: "cascade" }),
  roomIdA: integer("room_id_a").notNull().references(() => inspectionRooms.id, { onDelete: "cascade" }),
  roomIdB: integer("room_id_b").notNull().references(() => inspectionRooms.id, { onDelete: "cascade" }),
  // Which wall of Room A faces Room B
  wallDirectionA: varchar("wall_direction_a", { length: 20 }),
  // "north" | "south" | "east" | "west"
  // Which wall of Room B faces Room A (should be opposite of wallDirectionA)
  wallDirectionB: varchar("wall_direction_b", { length: 20 }),
  // Shared wall length in feet (may be partial — rooms don't have to be the same width)
  sharedWallLengthFt: real("shared_wall_length_ft"),
  // If there's an opening in this shared wall, reference the opening
  openingId: integer("opening_id").references(() => roomOpenings.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertRoomAdjacencySchema = createInsertSchema(roomAdjacencies).omit({
  id: true,
  createdAt: true,
});

export type RoomAdjacency = typeof roomAdjacencies.$inferSelect;
export type InsertRoomAdjacency = z.infer<typeof insertRoomAdjacencySchema>;

// ── L5: Sketch Annotations ─────────────────────────────
// Non-geometric metadata overlaid on sketch: damage counts, pitch, storm direction, facet labels
export const sketchAnnotations = pgTable("sketch_annotations", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").notNull().references(() => inspectionRooms.id, { onDelete: "cascade" }),
  annotationType: varchar("annotation_type", { length: 30 }).notNull(),
    // hail_count, wind_damage, pitch, storm_direction, facet_label, material_note, custom
  label: varchar("label", { length: 100 }).notNull(),
  value: varchar("value", { length: 50 }),         // "8", "7/12", "NW", etc.
  location: varchar("location", { length: 100 }),  // "Front Slope (F1)", "North Wall", "Global"
  position: jsonb("position"),                     // {x, y} placement on sketch canvas
  createdAt: timestamp("created_at").defaultNow(),
});

// ── Sketch Templates ───────────────────────────────────
// Pre-built room/shape polygons for drag-and-drop placement
export const sketchTemplates = pgTable("sketch_templates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  category: varchar("category", { length: 30 }).notNull(),
  description: text("description"),
  polygon: jsonb("polygon").notNull(),         // default polygon vertices
  defaultDimensions: jsonb("default_dimensions"),
  openings: jsonb("openings"),                 // default openings array
  roomType: varchar("room_type", { length: 50 }),
  thumbnailSvg: text("thumbnail_svg"),         // SVG preview for template picker
  isActive: boolean("is_active").default(true),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const damageObservations = pgTable(
  "damage_observations",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull().references(() => inspectionSessions.id, { onDelete: "cascade" }),
    roomId: integer("room_id").notNull().references(() => inspectionRooms.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    damageType: varchar("damage_type", { length: 50 }),
    severity: varchar("severity", { length: 20 }),
    location: text("location"),
    measurements: jsonb("measurements"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    sessionIdIdx: index("damage_observations_session_id_idx").on(table.sessionId),
    roomIdIdx: index("damage_observations_room_id_idx").on(table.roomId),
  }),
);

export const lineItems = pgTable(
  "line_items",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull().references(() => inspectionSessions.id, { onDelete: "cascade" }),
    roomId: integer("room_id").references(() => inspectionRooms.id, { onDelete: "set null" }),
    damageId: integer("damage_id").references(() => damageObservations.id, { onDelete: "set null" }),
    category: varchar("category", { length: 50 }).notNull(),
    action: varchar("action", { length: 30 }),
    description: text("description").notNull(),
    xactCode: varchar("xact_code", { length: 30 }),
    quantity: numeric("quantity", { precision: 12, scale: 2 }),
    unit: varchar("unit", { length: 20 }),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }),
    totalPrice: numeric("total_price", { precision: 12, scale: 2 }),
    depreciationType: varchar("depreciation_type", { length: 30 }).default("Recoverable"),
    depreciationRate: numeric("depreciation_rate", { precision: 5, scale: 2 }),
    wasteFactor: integer("waste_factor"),
    provenance: varchar("provenance", { length: 20 }).default("voice"),
    // ── Financial / Depreciation Columns ──────────────
    taxAmount: real("tax_amount").default(0),
    age: real("age"),                                   // Item age in years (e.g., 15.0 for a 15-year-old roof)
    lifeExpectancy: real("life_expectancy"),             // Expected useful life in years (e.g., 30.0 for architectural shingles)
    depreciationPercentage: real("depreciation_pct"),    // Computed or manual override: age/life × 100, capped at 100
    depreciationAmount: real("depreciation_amount"),     // Computed: RCV × depreciationPercentage / 100
    // Pro-Grade financial attributes
    coverageBucket: varchar("coverage_bucket", { length: 30 }).default("Coverage A"),
    qualityGrade: varchar("quality_grade", { length: 30 }),
    applyOAndP: boolean("apply_o_and_p").default(false),
    macroSource: varchar("macro_source", { length: 50 }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    sessionIdIdx: index("line_items_session_id_idx").on(table.sessionId),
    roomIdIdx: index("line_items_room_id_idx").on(table.roomId),
  }),
);

export const inspectionPhotos = pgTable(
  "inspection_photos",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull().references(() => inspectionSessions.id, { onDelete: "cascade" }),
    roomId: integer("room_id").references(() => inspectionRooms.id, { onDelete: "set null" }),
    damageId: integer("damage_id").references(() => damageObservations.id, { onDelete: "set null" }),
    storagePath: text("storage_path"),
    autoTag: varchar("auto_tag", { length: 50 }),
    caption: text("caption"),
    photoType: varchar("photo_type", { length: 30 }),
    annotations: jsonb("annotations"),
    analysis: jsonb("analysis"),
    matchesRequest: boolean("matches_request"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    sessionIdIdx: index("inspection_photos_session_id_idx").on(table.sessionId),
    roomIdIdx: index("inspection_photos_room_id_idx").on(table.roomId),
  }),
);

export const moistureReadings = pgTable("moisture_readings", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => inspectionSessions.id, { onDelete: "cascade" }),
  roomId: integer("room_id").notNull().references(() => inspectionRooms.id, { onDelete: "cascade" }),
  location: text("location"),
  reading: real("reading").notNull(),
  materialType: varchar("material_type", { length: 50 }),
  dryStandard: real("dry_standard"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ── Test Squares (Forensic Hail/Wind Assessment) ──────────────
// Logs 10x10 test square results for hail/wind damage claims
export const testSquares = pgTable("test_squares", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => inspectionSessions.id, { onDelete: "cascade" }),
  roomId: integer("room_id").references(() => inspectionRooms.id, { onDelete: "set null" }),
  hailHits: integer("hail_hits").notNull().default(0),
  windCreases: integer("wind_creases").default(0),
  pitch: varchar("pitch", { length: 10 }).notNull(),
  result: varchar("result", { length: 30 }).notNull().default("pass"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const voiceTranscripts = pgTable("voice_transcripts", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => inspectionSessions.id, { onDelete: "cascade" }),
  speaker: varchar("speaker", { length: 10 }).notNull(),
  content: text("content").notNull(),
  timestamp: timestamp("timestamp").defaultNow(),
});

export const supplementalClaims = pgTable("supplemental_claims", {
  id: serial("id").primaryKey(),
  originalSessionId: integer("original_session_id").notNull().references(() => inspectionSessions.id, { onDelete: "cascade" }),
  claimId: integer("claim_id").notNull().references(() => claims.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  status: varchar("status", { length: 20 }).default("draft"),
  newLineItems: jsonb("new_line_items"),
  removedLineItemIds: jsonb("removed_line_item_ids"),
  modifiedLineItems: jsonb("modified_line_items"),
  reviewNotes: text("review_notes"),
  createdAt: timestamp("created_at").defaultNow(),
  submittedAt: timestamp("submitted_at"),
  approvedAt: timestamp("approved_at"),
});

export const scopeLineItems = pgTable("scope_line_items", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 30 }).notNull().unique(),
  description: text("description").notNull(),
  unit: varchar("unit", { length: 10 }).notNull(),
  tradeCode: varchar("trade_code", { length: 10 }).notNull(),
  quantityFormula: varchar("quantity_formula", { length: 50 }),
  defaultWasteFactor: real("default_waste_factor").default(0),
  activityType: varchar("activity_type", { length: 20 }).default("install"),
  scopeConditions: jsonb("scope_conditions"),
  companionRules: jsonb("companion_rules"),
  sortOrder: integer("sort_order").default(0),
  // ── Financial behavior flags ──
  opEligibleDefault: boolean("op_eligible_default").default(true),
  // Whether items in this trade typically receive O&P. Carriers may override per-claim.
  isCodeUpgrade: boolean("is_code_upgrade").default(false),
  // Whether this item represents a building code upgrade (Ice & Water Barrier, GFCI, etc.)
  // Code upgrades are typically "Paid When Incurred" — not paid until work is completed.
  isActive: boolean("is_active").default(true),
});

export const regionalPriceSets = pgTable("regional_price_sets", {
  id: serial("id").primaryKey(),
  regionId: varchar("region_id", { length: 20 }).notNull(),
  regionName: text("region_name").notNull(),
  lineItemCode: varchar("line_item_code", { length: 30 }).notNull().references(() => scopeLineItems.code),
  materialCost: numeric("material_cost", { precision: 12, scale: 2 }).default("0"),
  laborCost: numeric("labor_cost", { precision: 12, scale: 2 }).default("0"),
  equipmentCost: numeric("equipment_cost", { precision: 12, scale: 2 }).default("0"),
  effectiveDate: varchar("effective_date", { length: 20 }),
  priceListVersion: varchar("price_list_version", { length: 20 }),
});

export const insertInspectionSessionSchema = createInsertSchema(inspectionSessions).omit({ id: true, startedAt: true, completedAt: true });
export const insertStructureSchema = createInsertSchema(structures).omit({ id: true, createdAt: true });
export const insertInspectionRoomSchema = createInsertSchema(inspectionRooms).omit({ id: true, createdAt: true, completedAt: true });
export const insertRoomOpeningSchema = createInsertSchema(roomOpenings).omit({ id: true, createdAt: true });
export const insertSketchAnnotationSchema = createInsertSchema(sketchAnnotations).omit({ id: true, createdAt: true });
export const insertSketchTemplateSchema = createInsertSchema(sketchTemplates).omit({ id: true, createdAt: true });
export const insertDamageObservationSchema = createInsertSchema(damageObservations).omit({ id: true, createdAt: true });
export const insertLineItemSchema = createInsertSchema(lineItems).omit({ id: true, createdAt: true });
export const insertInspectionPhotoSchema = createInsertSchema(inspectionPhotos).omit({ id: true, createdAt: true });
export const insertMoistureReadingSchema = createInsertSchema(moistureReadings).omit({ id: true, createdAt: true });
export const insertTestSquareSchema = createInsertSchema(testSquares).omit({ id: true, createdAt: true });
export const insertVoiceTranscriptSchema = createInsertSchema(voiceTranscripts).omit({ id: true, timestamp: true });

export type InspectionSession = typeof inspectionSessions.$inferSelect;
export type InsertInspectionSession = z.infer<typeof insertInspectionSessionSchema>;
export type Structure = typeof structures.$inferSelect;
export type InsertStructure = z.infer<typeof insertStructureSchema>;
export type InspectionRoom = typeof inspectionRooms.$inferSelect;
export type InsertInspectionRoom = z.infer<typeof insertInspectionRoomSchema>;
export type RoomOpening = typeof roomOpenings.$inferSelect;
export type InsertRoomOpening = z.infer<typeof insertRoomOpeningSchema>;
export type SketchAnnotation = typeof sketchAnnotations.$inferSelect;
export type InsertSketchAnnotation = z.infer<typeof insertSketchAnnotationSchema>;
export type SketchTemplate = typeof sketchTemplates.$inferSelect;
export type InsertSketchTemplate = z.infer<typeof insertSketchTemplateSchema>;
export type DamageObservation = typeof damageObservations.$inferSelect;
export type InsertDamageObservation = z.infer<typeof insertDamageObservationSchema>;
export type LineItem = typeof lineItems.$inferSelect;
export type InsertLineItem = z.infer<typeof insertLineItemSchema>;
export type InspectionPhoto = typeof inspectionPhotos.$inferSelect;
export type InsertInspectionPhoto = z.infer<typeof insertInspectionPhotoSchema>;
export type MoistureReading = typeof moistureReadings.$inferSelect;
export type InsertMoistureReading = z.infer<typeof insertMoistureReadingSchema>;
export type TestSquare = typeof testSquares.$inferSelect;
export type InsertTestSquare = z.infer<typeof insertTestSquareSchema>;
export type VoiceTranscript = typeof voiceTranscripts.$inferSelect;
export type InsertVoiceTranscript = z.infer<typeof insertVoiceTranscriptSchema>;

export const insertSupplementalClaimSchema = createInsertSchema(supplementalClaims).omit({
  id: true,
  createdAt: true,
  submittedAt: true,
  approvedAt: true,
});

export type SupplementalClaim = typeof supplementalClaims.$inferSelect;
export type InsertSupplementalClaim = z.infer<typeof insertSupplementalClaimSchema>;

// ── Inspection Flows (Peril-Specific Workflow Engine) ──────────────
// Dynamic, database-driven inspection workflows that replace the hardcoded 8-phase system.
// Each flow contains ordered steps with agent prompts, required tools, and completion criteria.
export type InspectionStep = {
  id: string;
  phaseName: string;
  agentPrompt: string;
  requiredTools: string[];
  completionCriteria: string;
};

export const inspectionFlows = pgTable("inspection_flows", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  perilType: varchar("peril_type", { length: 30 }).notNull(),
  description: text("description"),
  isDefault: boolean("is_default").default(false),
  isSystemDefault: boolean("is_system_default").default(false),
  steps: jsonb("steps").$type<InspectionStep[]>().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertInspectionFlowSchema = createInsertSchema(inspectionFlows).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertInspectionFlow = z.infer<typeof insertInspectionFlowSchema>;
export type InspectionFlow = typeof inspectionFlows.$inferSelect;

export const userSettings = pgTable("user_settings", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
  settings: jsonb("settings").notNull().default({}),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UserSettings = typeof userSettings.$inferSelect;

// ── Policy Coverage Rules ──────────────────────────
export const policyRules = pgTable("policy_rules", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").notNull().references(() => claims.id, { onDelete: "cascade" }),
  coverageType: varchar("coverage_type", { length: 20 }).notNull(),
  // coverageType enum: "Coverage A" | "Coverage B" | "Coverage C" | "Coverage D"
  policyLimit: real("policy_limit"),
  deductible: real("deductible"),
  applyRoofSchedule: boolean("apply_roof_schedule").default(false),
  // When true: roofing items under this coverage use Non-Recoverable depreciation regardless of depreciationType
  roofScheduleAge: real("roof_schedule_age"),
  // Age threshold in years — roofs older than this get roof schedule applied
  overheadPct: real("overhead_pct").default(10),
  profitPct: real("profit_pct").default(10),
  taxRate: real("tax_rate").default(8),
  // Tax rate as percentage (e.g., 8 for 8%)
  opExcludedTrades: jsonb("op_excluded_trades").default([]),
  // Array of trade codes excluded from O&P for this coverage.
  // Example: ["RFG", "EXT"] means Roofing and Exterior/Siding don't get O&P.
  // Empty array = all eligible trades get O&P (default behavior).
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPolicyRuleSchema = createInsertSchema(policyRules).omit({
  id: true,
  createdAt: true,
});

export type PolicyRule = typeof policyRules.$inferSelect;
export type InsertPolicyRule = z.infer<typeof insertPolicyRuleSchema>;

// ── Tax Rate Rules per Category ───────────────────
export const taxRules = pgTable("tax_rules", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").notNull().references(() => claims.id, { onDelete: "cascade" }),
  taxLabel: varchar("tax_label", { length: 50 }).notNull(),
  // e.g., "Material Sales Tax", "Cleaning Mtl Tax", "Cleaning Sales Tax"
  taxRate: real("tax_rate").notNull(),
  // Tax rate as percentage (e.g., 7.25 for 7.25%)
  appliesToCategories: jsonb("applies_to_categories").default([]),
  // Array of category strings this tax applies to.
  // Empty array = applies to all categories (default/fallback tax).
  // Example: ["Cleaning", "Mitigation"] or ["Roofing", "Siding", "Drywall"]
  appliesToCostType: varchar("applies_to_cost_type", { length: 20 }).default("material"),
  // "material" = tax on material costs only
  // "labor" = tax on labor costs only
  // "all" = tax on total price (material + labor + equipment)
  isDefault: boolean("is_default").default(false),
  // If true, this is the fallback tax for categories not matched by other rules
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTaxRuleSchema = createInsertSchema(taxRules).omit({
  id: true,
  createdAt: true,
});

export type TaxRule = typeof taxRules.$inferSelect;
export type InsertTaxRule = z.infer<typeof insertTaxRuleSchema>;

export const insertScopeLineItemSchema = createInsertSchema(scopeLineItems).omit({ id: true });
export const insertRegionalPriceSetSchema = createInsertSchema(regionalPriceSets).omit({ id: true });

export type ScopeLineItem = typeof scopeLineItems.$inferSelect;
export type InsertScopeLineItem = z.infer<typeof insertScopeLineItemSchema>;
export type RegionalPriceSet = typeof regionalPriceSets.$inferSelect;
export type InsertRegionalPriceSet = z.infer<typeof insertRegionalPriceSetSchema>;
