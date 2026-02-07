import { sql } from "drizzle-orm";
import { pgTable, text, serial, integer, boolean, timestamp, jsonb, varchar, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const claims = pgTable("claims", {
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
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").notNull().references(() => claims.id),
  documentType: varchar("document_type", { length: 20 }).notNull(),
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  storagePath: text("storage_path"),
  rawText: text("raw_text"),
  status: varchar("status", { length: 20 }).notNull().default("empty"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const extractions = pgTable("extractions", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").notNull().references(() => claims.id),
  documentType: varchar("document_type", { length: 20 }).notNull(),
  extractedData: jsonb("extracted_data").notNull(),
  confidence: jsonb("confidence"),
  confirmedByUser: boolean("confirmed_by_user").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const briefings = pgTable("briefings", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").notNull().references(() => claims.id),
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

export const inspectionSessions = pgTable("inspection_sessions", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").notNull().references(() => claims.id),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  currentPhase: integer("current_phase").default(1),
  currentRoomId: integer("current_room_id"),
  currentStructure: varchar("current_structure", { length: 100 }).default("Main Dwelling"),
  voiceSessionId: text("voice_session_id"),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const inspectionRooms = pgTable("inspection_rooms", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => inspectionSessions.id),
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

export const damageObservations = pgTable("damage_observations", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => inspectionSessions.id),
  roomId: integer("room_id").notNull().references(() => inspectionRooms.id),
  description: text("description").notNull(),
  damageType: varchar("damage_type", { length: 50 }),
  severity: varchar("severity", { length: 20 }),
  location: text("location"),
  measurements: jsonb("measurements"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const lineItems = pgTable("line_items", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => inspectionSessions.id),
  roomId: integer("room_id").references(() => inspectionRooms.id),
  damageId: integer("damage_id").references(() => damageObservations.id),
  category: varchar("category", { length: 50 }).notNull(),
  action: varchar("action", { length: 30 }),
  description: text("description").notNull(),
  xactCode: varchar("xact_code", { length: 30 }),
  quantity: real("quantity"),
  unit: varchar("unit", { length: 20 }),
  unitPrice: real("unit_price"),
  totalPrice: real("total_price"),
  depreciationType: varchar("depreciation_type", { length: 30 }).default("Recoverable"),
  wasteFactor: integer("waste_factor"),
  provenance: varchar("provenance", { length: 20 }).default("voice"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const inspectionPhotos = pgTable("inspection_photos", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => inspectionSessions.id),
  roomId: integer("room_id").references(() => inspectionRooms.id),
  damageId: integer("damage_id").references(() => damageObservations.id),
  storagePath: text("storage_path"),
  autoTag: varchar("auto_tag", { length: 50 }),
  caption: text("caption"),
  photoType: varchar("photo_type", { length: 30 }),
  annotations: jsonb("annotations"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const moistureReadings = pgTable("moisture_readings", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => inspectionSessions.id),
  roomId: integer("room_id").notNull().references(() => inspectionRooms.id),
  location: text("location"),
  reading: real("reading").notNull(),
  materialType: varchar("material_type", { length: 50 }),
  dryStandard: real("dry_standard"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const voiceTranscripts = pgTable("voice_transcripts", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => inspectionSessions.id),
  speaker: varchar("speaker", { length: 10 }).notNull(),
  content: text("content").notNull(),
  timestamp: timestamp("timestamp").defaultNow(),
});

export const insertInspectionSessionSchema = createInsertSchema(inspectionSessions).omit({ id: true, startedAt: true, completedAt: true });
export const insertInspectionRoomSchema = createInsertSchema(inspectionRooms).omit({ id: true, createdAt: true, completedAt: true });
export const insertDamageObservationSchema = createInsertSchema(damageObservations).omit({ id: true, createdAt: true });
export const insertLineItemSchema = createInsertSchema(lineItems).omit({ id: true, createdAt: true });
export const insertInspectionPhotoSchema = createInsertSchema(inspectionPhotos).omit({ id: true, createdAt: true });
export const insertMoistureReadingSchema = createInsertSchema(moistureReadings).omit({ id: true, createdAt: true });
export const insertVoiceTranscriptSchema = createInsertSchema(voiceTranscripts).omit({ id: true, timestamp: true });

export type InspectionSession = typeof inspectionSessions.$inferSelect;
export type InsertInspectionSession = z.infer<typeof insertInspectionSessionSchema>;
export type InspectionRoom = typeof inspectionRooms.$inferSelect;
export type InsertInspectionRoom = z.infer<typeof insertInspectionRoomSchema>;
export type DamageObservation = typeof damageObservations.$inferSelect;
export type InsertDamageObservation = z.infer<typeof insertDamageObservationSchema>;
export type LineItem = typeof lineItems.$inferSelect;
export type InsertLineItem = z.infer<typeof insertLineItemSchema>;
export type InspectionPhoto = typeof inspectionPhotos.$inferSelect;
export type InsertInspectionPhoto = z.infer<typeof insertInspectionPhotoSchema>;
export type MoistureReading = typeof moistureReadings.$inferSelect;
export type InsertMoistureReading = z.infer<typeof insertMoistureReadingSchema>;
export type VoiceTranscript = typeof voiceTranscripts.$inferSelect;
export type InsertVoiceTranscript = z.infer<typeof insertVoiceTranscriptSchema>;
