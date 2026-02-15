import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  timestamp,
  boolean,
  real,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password"),
  email: text("email").unique(),
  fullName: text("full_name"),
  role: varchar("role", { length: 20 }).notNull().default("adjuster"),
  title: text("title"),
  avatarUrl: text("avatar_url"),
  supabaseAuthId: varchar("supabase_auth_id", { length: 100 }).unique(),
  lastLoginAt: timestamp("last_login_at"),
  isActive: boolean("is_active").default(true),
});

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
  claimId: integer("claim_id").notNull().references(() => claims.id, { onDelete: "cascade" }),
  documentType: varchar("document_type", { length: 30 }).notNull(),
  fileName: text("file_name"),
  storagePath: text("storage_path"),
  fileSize: integer("file_size"),
  status: varchar("status", { length: 20 }).default("uploaded"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const standalonePhotos = pgTable("standalone_photos", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  storagePath: text("storage_path"),
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  source: varchar("source", { length: 20 }).default("upload"),
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
  regionId: varchar("region_id", { length: 20 }).notNull(),
  regionName: text("region_name").notNull(),
  lineItemCode: varchar("line_item_code", { length: 30 })
    .notNull()
    .references(() => scopeLineItems.code),
  materialCost: real("material_cost").default(0),
  laborCost: real("labor_cost").default(0),
  equipmentCost: real("equipment_cost").default(0),
  effectiveDate: varchar("effective_date", { length: 20 }),
  priceListVersion: varchar("price_list_version", { length: 20 }),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Claim = typeof claims.$inferSelect;
export type InsertClaim = typeof claims.$inferInsert;
export type StandalonePhoto = typeof standalonePhotos.$inferSelect;
export type ScopeLineItem = typeof scopeLineItems.$inferSelect;
export type RegionalPriceSet = typeof regionalPriceSets.$inferSelect;
