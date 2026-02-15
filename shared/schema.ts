import { sql } from "drizzle-orm";
import { pgTable, text, serial, integer, boolean, timestamp, jsonb, varchar, real } from "drizzle-orm/pg-core";
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
  assignedTo: varchar("assigned_to").references(() => users.id),
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
  isActive: boolean("is_active").default(true),
});

export const regionalPriceSets = pgTable("regional_price_sets", {
  id: serial("id").primaryKey(),
  regionId: varchar("region_id", { length: 50 }).notNull(),
  regionName: text("region_name").notNull(),
  lineItemCode: varchar("line_item_code", { length: 30 }).notNull().references(() => scopeLineItems.code),
  materialCost: real("material_cost").default(0),
  laborCost: real("labor_cost").default(0),
  equipmentCost: real("equipment_cost").default(0),
  effectiveDate: varchar("effective_date", { length: 20 }),
  priceListVersion: varchar("price_list_version", { length: 20 }),
});

export const standalonePhotos = pgTable("standalone_photos", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id),
  storagePath: text("storage_path"),
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  source: varchar("source", { length: 30 }).default("upload"),
  analysisStatus: varchar("analysis_status", { length: 20 }).default("pending"),
  notes: text("notes"),
  claimId: integer("claim_id").references(() => claims.id),
  analysis: jsonb("analysis"),
  annotations: jsonb("annotations"),
  severityScore: real("severity_score"),
  damageTypes: jsonb("damage_types"),
  suggestedRepairs: jsonb("suggested_repairs"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertClaimSchema = createInsertSchema(claims).omit({ id: true, createdAt: true, updatedAt: true });
export const insertDocumentSchema = createInsertSchema(documents).omit({ id: true, createdAt: true });
export const insertExtractionSchema = createInsertSchema(extractions).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBriefingSchema = createInsertSchema(briefings).omit({ id: true, createdAt: true });

export type Claim = typeof claims.$inferSelect;
export type InsertClaim = z.infer<typeof insertClaimSchema>;
export type Document = typeof documents.$inferSelect;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Extraction = typeof extractions.$inferSelect;
export type InsertExtraction = z.infer<typeof insertExtractionSchema>;
export type Briefing = typeof briefings.$inferSelect;
export type InsertBriefing = z.infer<typeof insertBriefingSchema>;
export type ScopeLineItem = typeof scopeLineItems.$inferSelect;
export type RegionalPriceSet = typeof regionalPriceSets.$inferSelect;
export type StandalonePhoto = typeof standalonePhotos.$inferSelect;
