# PROMPT 16 — Scope Engine & Pricing Overhaul: Damage-Driven Assembly, Geometry-Derived Quantities, Companion Cascading, Xactimate-Standard Pricing

## Goal

Replace the Voice Inspector's behavioral/AI-dependent scope creation pipeline with a deterministic, engine-driven scope assembly system. Currently, damage observations and estimate line items are completely disconnected — the only link is a system prompt telling the AI model to "suggest related items after documenting damage." Quantities are whatever the AI guesses, companion items are 4 hardcoded rules, pricing uses uniform waste on all components, and the ESX export fabricates labor/material splits with arbitrary percentages (35%/65%).

This prompt builds the scope engine that the design docs (SCOPE_ENGINE.md, ESTIMATE_ENGINE.md) describe but that was never implemented in the Voice Agent:

1. **Schema Evolution** — Add `scope_trades` table, enhance `lineItems` with coverage type and trade code FK, add `scope_items` with provenance tracking, add `scope_summary` aggregate table
2. **Geometry-Driven Scope Assembly** — New `scopeQuantityEngine` that derives quantities from room DIM_VARS (PROMPT-15), new `scopeAssemblyService` that automatically generates scope items when damage is recorded, with companion rule cascading and scope condition matching
3. **Pricing Engine Overhaul** — Replace `estimateEngine.ts` with proper M/L/E separation (waste on materials only), carrier-specific tax rules, O&P with trade-count threshold + dollar minimum + per-trade eligibility, RESET/REMOVE/REPLACE action pricing
4. **Voice Agent Scope Intelligence** — New `generate_scope` tool that triggers the assembly engine, enhanced `add_line_item` with auto-quantity derivation and companion auto-add, new `validate_scope` tool
5. **Scope Validation & ESX Pricing Fix** — Comprehensive validation engine (12+ rule categories), ESX export using actual M/L/E from regional price sets instead of arbitrary percentages

**Prerequisites:** PROMPT-12 (roomOpenings), PROMPT-13 (settlement engine), PROMPT-14 (financial refinements), PROMPT-15 (DIM_VARS engine, room adjacency) must be applied first. This prompt depends on PROMPT-15's `calculateDimVars()` function and the room `dimensions` JSONB containing computed DIM_VARS.

**Key Design Principle:** Scope defines WHAT work needs to happen (independent of pricing). Pricing defines HOW MUCH that work costs (independent of scope). The estimate combines both. This separation means the scope engine never touches prices, and the pricing engine never decides what items to include.

---

## Part A — Schema Evolution & Trade Catalog

### Problem

The Voice Agent has two disconnected scope schemas:
- `scopeLineItems` (lines 236-249 of `schema.ts`) — a catalog table with `companionRules` JSONB, `quantityFormula`, `scopeConditions`, but nothing reads these fields
- `lineItems` (lines 168-185 of `schema.ts`) — the actual estimate items, with no trade code FK, no coverage type, no provenance beyond a static `"voice"` default

The design docs describe `scope_trades` (16 trades with O&P eligibility flags), `scope_items` (estimate-specific scope with provenance tracking), and `scope_summary` (per-trade aggregates). None of these exist.

### A1. New Schema Table — `scopeTrades`

**File:** `shared/schema.ts`
**Insert after:** the `regionalPriceSets` table definition (line 261). Find the closing `});` of `regionalPriceSets` and add immediately after:

```typescript
// ── Scope Trades (trade categories with O&P eligibility) ─────
export const scopeTrades = pgTable("scope_trades", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 10 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  // Xactimate category prefix (e.g., "RFG" → category codes starting with "RFG")
  xactCategoryPrefix: varchar("xact_category_prefix", { length: 10 }),
  // Whether this trade is eligible for Overhead & Profit
  opEligible: boolean("op_eligible").default(true),
  // Display sort order
  sortOrder: integer("sort_order").default(0),
  isActive: boolean("is_active").default(true),
});

export const insertScopeTradeSchema = createInsertSchema(scopeTrades).omit({ id: true });
export type ScopeTrade = typeof scopeTrades.$inferSelect;
export type InsertScopeTrade = z.infer<typeof insertScopeTradeSchema>;
```

### A2. Enhance `scopeLineItems` — Add Missing Fields

**File:** `shared/schema.ts`
**Replace:** the existing `scopeLineItems` table definition (lines 236-249) with this enhanced version that adds the fields the design docs specify but that are missing:

```typescript
export const scopeLineItems = pgTable("scope_line_items", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 30 }).notNull().unique(),
  description: text("description").notNull(),
  unit: varchar("unit", { length: 10 }).notNull(),
  tradeCode: varchar("trade_code", { length: 10 }).notNull(),
  // Quantity derivation formula: FLOOR_SF, CEILING_SF, WALL_SF, WALL_SF_NET,
  // WALLS_CEILING_SF, PERIMETER_LF, ROOF_SF, ROOF_SQ, MANUAL, EACH
  quantityFormula: varchar("quantity_formula", { length: 50 }),
  defaultWasteFactor: real("default_waste_factor").default(0),
  // Activity type: reset, remove, replace, install, repair, clean, labor_only
  activityType: varchar("activity_type", { length: 20 }).default("replace"),
  // Coverage type: A=Dwelling, B=Other Structures, C=Contents
  coverageType: varchar("coverage_type", { length: 1 }).default("A"),
  // Scope conditions: when does this item apply?
  // { damage_types: ["water","hail"], surfaces: ["floor","wall"], severity: ["moderate","severe"],
  //   room_types: ["interior_bathroom","interior_kitchen"], zone_types: ["interior"] }
  scopeConditions: jsonb("scope_conditions"),
  // Companion rules: what other items does this item require/add/exclude?
  // { requires: ["DEM-DRY-SF"], auto_adds: ["DRY-TAPE-LF","DRY-FLOAT-SF"], excludes: ["DRY-PATCH-SF"] }
  companionRules: jsonb("companion_rules"),
  // Xactimate category code for ESX export (e.g., "RFG", "DRY", "PNT")
  xactCategoryCode: varchar("xact_category_code", { length: 10 }),
  // Xactimate selector for ESX export (e.g., "1/2++", "LAM")
  xactSelector: varchar("xact_selector", { length: 20 }),
  // Notes visible to adjuster in scope review
  notes: text("notes"),
  sortOrder: integer("sort_order").default(0),
  isActive: boolean("is_active").default(true),
});
```

### A3. New Schema Table — `scopeItems` (Assembled Scope with Provenance)

**File:** `shared/schema.ts`
**Insert after:** the new `scopeTrades` type exports (from A1 above):

```typescript
// ── Scope Items (assembled scope for a specific estimate) ────
// These link line items from the catalog to specific rooms in a specific inspection.
// Unlike lineItems (which are flat estimate rows), scopeItems track HOW the item
// was added (provenance) and maintain the link back to the catalog for validation.
export const scopeItems = pgTable("scope_items", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => inspectionSessions.id, { onDelete: "cascade" }),
  roomId: integer("room_id").references(() => inspectionRooms.id, { onDelete: "set null" }),
  damageId: integer("damage_id").references(() => damageObservations.id, { onDelete: "set null" }),
  // Reference to the catalog item
  catalogCode: varchar("catalog_code", { length: 30 }).references(() => scopeLineItems.code),
  // Denormalized description (may be customized from catalog default)
  description: text("description").notNull(),
  tradeCode: varchar("trade_code", { length: 10 }).notNull(),
  // Derived or manually entered quantity
  quantity: real("quantity").notNull(),
  unit: varchar("unit", { length: 10 }).notNull(),
  // How this quantity was derived
  quantityFormula: varchar("quantity_formula", { length: 50 }),
  // How this scope item was created
  provenance: varchar("provenance", { length: 30 }).notNull().default("voice_command"),
  // "geometry_derived" — auto-calculated from room DIM_VARS
  // "voice_command" — adjuster said it via voice
  // "companion_auto" — auto-added as companion of another item
  // "template" — from a scope template
  // "manual" — manually added in review
  // "damage_triggered" — auto-generated from damage observation
  // Coverage type: A=Dwelling, B=Other Structures, C=Contents
  coverageType: varchar("coverage_type", { length: 1 }).default("A"),
  // Activity type for ESX export
  activityType: varchar("activity_type", { length: 20 }).default("replace"),
  // Waste factor override (null = use catalog default)
  wasteFactor: real("waste_factor"),
  // Status: active, removed, replaced
  status: varchar("status", { length: 20 }).default("active"),
  // If this item was auto-added as a companion, reference the parent item
  parentScopeItemId: integer("parent_scope_item_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertScopeItemSchema = createInsertSchema(scopeItems).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type ScopeItem = typeof scopeItems.$inferSelect;
export type InsertScopeItem = z.infer<typeof insertScopeItemSchema>;
```

### A4. New Schema Table — `scopeSummary` (Per-Trade Aggregates)

**File:** `shared/schema.ts`
**Insert after:** `scopeItems` type exports:

```typescript
// ── Scope Summary (aggregate totals per trade per session) ───
export const scopeSummary = pgTable("scope_summary", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => inspectionSessions.id, { onDelete: "cascade" }),
  tradeCode: varchar("trade_code", { length: 10 }).notNull(),
  tradeName: varchar("trade_name", { length: 100 }),
  itemCount: integer("item_count").default(0),
  // Quantities aggregated by unit type: { "SF": 1234.5, "LF": 67.8, "EA": 3 }
  quantitiesByUnit: jsonb("quantities_by_unit"),
  // Pricing totals (populated by pricing engine, not scope engine)
  totalMaterial: real("total_material").default(0),
  totalLabor: real("total_labor").default(0),
  totalEquipment: real("total_equipment").default(0),
  totalTax: real("total_tax").default(0),
  totalRCV: real("total_rcv").default(0),
  totalDepreciation: real("total_depreciation").default(0),
  totalACV: real("total_acv").default(0),
  opEligible: boolean("op_eligible").default(true),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertScopeSummarySchema = createInsertSchema(scopeSummary).omit({
  id: true, updatedAt: true,
});
export type ScopeSummary = typeof scopeSummary.$inferSelect;
export type InsertScopeSummary = z.infer<typeof insertScopeSummarySchema>;
```

### A5. Enhance `lineItems` — Add `tradeCode` and `coverageType`

**File:** `shared/schema.ts`
**Modify:** the existing `lineItems` table definition (lines 168-185). Add two new columns after `wasteFactor` (line 182):

```typescript
  // ADD these two fields after line 182 (wasteFactor):
  tradeCode: varchar("trade_code", { length: 10 }),
  coverageType: varchar("coverage_type", { length: 1 }).default("A"),
  // EXISTING field — keep provenance as-is:
  provenance: varchar("provenance", { length: 20 }).default("voice"),
```

### A6. Migration SQL — Create Tables and Seed Trades

**File:** `migrations/016_scope_engine_foundation.sql` (new file)

```sql
-- Migration 016: Scope Engine Foundation
-- Creates scope_trades, scope_items, scope_summary tables
-- Enhances line_items with trade_code and coverage_type
-- Seeds 16 trade categories with O&P eligibility

-- ── scope_trades ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scope_trades (
  id SERIAL PRIMARY KEY,
  code VARCHAR(10) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  xact_category_prefix VARCHAR(10),
  op_eligible BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE
);

-- Seed 16 trades matching Xactimate trade categories
INSERT INTO scope_trades (code, name, xact_category_prefix, op_eligible, sort_order) VALUES
  ('MIT', 'Mitigation / Water Extraction', 'WTR', true, 1),
  ('DEM', 'Demolition', 'DEM', true, 2),
  ('DRY', 'Drywall', 'DRY', true, 3),
  ('PNT', 'Painting', 'PNT', true, 4),
  ('FLR', 'Flooring', 'FLR', true, 5),
  ('INS', 'Insulation', 'INS', true, 6),
  ('CAR', 'Carpentry / Framing', 'FRM', true, 7),
  ('CAB', 'Cabinetry', 'CAB', true, 8),
  ('CTR', 'Countertops', 'CTR', true, 9),
  ('RFG', 'Roofing', 'RFG', true, 10),
  ('WIN', 'Windows', 'WIN', true, 11),
  ('EXT', 'Exterior / Siding', 'SDG', true, 12),
  ('ELE', 'Electrical', 'ELE', true, 13),
  ('PLM', 'Plumbing', 'PLM', true, 14),
  ('HVAC', 'HVAC', 'HVA', true, 15),
  ('GEN', 'General / Cleanup', 'GEN', false, 16)
ON CONFLICT (code) DO NOTHING;

-- ── Enhance scope_line_items ─────────────────────────────────
-- Add columns if they don't exist
ALTER TABLE scope_line_items ADD COLUMN IF NOT EXISTS coverage_type VARCHAR(1) DEFAULT 'A';
ALTER TABLE scope_line_items ADD COLUMN IF NOT EXISTS xact_category_code VARCHAR(10);
ALTER TABLE scope_line_items ADD COLUMN IF NOT EXISTS xact_selector VARCHAR(20);
ALTER TABLE scope_line_items ADD COLUMN IF NOT EXISTS notes TEXT;

-- ── scope_items ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scope_items (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES inspection_sessions(id) ON DELETE CASCADE,
  room_id INTEGER REFERENCES inspection_rooms(id) ON DELETE SET NULL,
  damage_id INTEGER REFERENCES damage_observations(id) ON DELETE SET NULL,
  catalog_code VARCHAR(30) REFERENCES scope_line_items(code),
  description TEXT NOT NULL,
  trade_code VARCHAR(10) NOT NULL,
  quantity REAL NOT NULL,
  unit VARCHAR(10) NOT NULL,
  quantity_formula VARCHAR(50),
  provenance VARCHAR(30) NOT NULL DEFAULT 'voice_command',
  coverage_type VARCHAR(1) DEFAULT 'A',
  activity_type VARCHAR(20) DEFAULT 'replace',
  waste_factor REAL,
  status VARCHAR(20) DEFAULT 'active',
  parent_scope_item_id INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scope_items_session ON scope_items(session_id);
CREATE INDEX IF NOT EXISTS idx_scope_items_room ON scope_items(room_id);
CREATE INDEX IF NOT EXISTS idx_scope_items_damage ON scope_items(damage_id);
CREATE INDEX IF NOT EXISTS idx_scope_items_trade ON scope_items(trade_code);

-- ── scope_summary ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scope_summary (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES inspection_sessions(id) ON DELETE CASCADE,
  trade_code VARCHAR(10) NOT NULL,
  trade_name VARCHAR(100),
  item_count INTEGER DEFAULT 0,
  quantities_by_unit JSONB,
  total_material REAL DEFAULT 0,
  total_labor REAL DEFAULT 0,
  total_equipment REAL DEFAULT 0,
  total_tax REAL DEFAULT 0,
  total_rcv REAL DEFAULT 0,
  total_depreciation REAL DEFAULT 0,
  total_acv REAL DEFAULT 0,
  op_eligible BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scope_summary_session_trade
  ON scope_summary(session_id, trade_code);

-- ── Enhance line_items ───────────────────────────────────────
ALTER TABLE line_items ADD COLUMN IF NOT EXISTS trade_code VARCHAR(10);
ALTER TABLE line_items ADD COLUMN IF NOT EXISTS coverage_type VARCHAR(1) DEFAULT 'A';

-- ── Updated_at trigger for scope tables ──────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER scope_items_updated_at
  BEFORE UPDATE ON scope_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER scope_summary_updated_at
  BEFORE UPDATE ON scope_summary
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### A7. Update Storage Interface and Implementation

**File:** `server/storage.ts`
**Add to IStorage interface** (after line 109, after `getRegionalPricesForRegion`):

```typescript
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
```

**Add to DatabaseStorage class** — after the existing `getRegionalPricesForRegion` method implementation (find it by searching for the method name). Add:

```typescript
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
    // Soft-delete: mark as removed rather than hard delete
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
    // Try to update existing, insert if not found
    const existing = await db.select().from(scopeSummary)
      .where(and(eq(scopeSummary.sessionId, sessionId), eq(scopeSummary.tradeCode, tradeCode)))
      .limit(1);

    if (existing.length > 0) {
      const [updated] = await db.update(scopeSummary)
        .set(data)
        .where(eq(scopeSummary.id, existing[0].id))
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
    // Get all active scope items for this session
    const items = await this.getScopeItems(sessionId);
    const trades = await this.getScopeTrades();
    const tradeMap = new Map(trades.map(t => [t.code, t]));

    // Group by trade
    const byTrade = new Map<string, ScopeItem[]>();
    for (const item of items) {
      const existing = byTrade.get(item.tradeCode) || [];
      existing.push(item);
      byTrade.set(item.tradeCode, existing);
    }

    // Upsert summary for each trade
    const summaries: ScopeSummary[] = [];
    for (const [tradeCode, tradeItems] of byTrade) {
      const trade = tradeMap.get(tradeCode);
      const quantitiesByUnit: Record<string, number> = {};
      for (const item of tradeItems) {
        quantitiesByUnit[item.unit] = (quantitiesByUnit[item.unit] || 0) + item.quantity;
      }

      const summary = await this.upsertScopeSummary(sessionId, tradeCode, {
        tradeName: trade?.name || tradeCode,
        itemCount: tradeItems.length,
        quantitiesByUnit,
        opEligible: trade?.opEligible ?? true,
      });
      summaries.push(summary);
    }

    return summaries;
  }
```

**Update imports** at the top of `storage.ts` (line 2-24). Add the new table imports:

```typescript
// Add to the import block from "@shared/schema":
  scopeTrades, scopeItems, scopeSummary,
  type ScopeTrade, type InsertScopeTrade,
  type ScopeItem, type InsertScopeItem,
  type ScopeSummary, type InsertScopeSummary,
```

---

## Part B — Geometry-Driven Scope Assembly

### Problem

The `add_line_item` voice tool (lines 150-169 of `realtime.ts`) accepts `quantity` as a free-form number the AI model guesses. When the adjuster says "replace the drywall in this room," the AI estimates "maybe 517 square feet" based on conversational context. But the room already has dimensions stored in `inspectionRooms.dimensions` — and PROMPT-15 adds computed DIM_VARS (WALL_SF, FLOOR_SF, CEILING_SF, PERIMETER_LF, etc.) to that same JSONB field.

Real Xactimate estimates derive every quantity from room geometry. The Water-Damage-Xactimate.pdf shows "Clean stud wall — Heavy | 678.67 SF" where 678.67 was computed from the room's wall area minus openings. The quantity formulas in `scopeLineItems.quantityFormula` are meant to map to these dimension variables, but nothing reads them.

### B1. New Service — `scopeQuantityEngine.ts`

**File:** `server/scopeQuantityEngine.ts` (new file)

This service takes a room's dimensions (with PROMPT-15 DIM_VARS) and a quantity formula code, and returns the derived quantity. It also handles special cases like roof squares (÷100), square yards (÷9), and manual/each items.

```typescript
/**
 * Scope Quantity Engine
 *
 * Derives line item quantities from room geometry (DIM_VARS).
 * PROMPT-15 stores computed DIM_VARS in inspectionRooms.dimensions JSONB:
 *   { length, width, height, ..., dimVars: { W, F, C, PF, PC, LW, SW, ... } }
 *
 * This engine maps quantity formula codes to those dimension values.
 * All quantities are deterministic — no AI estimation.
 */

import type { InspectionRoom } from "@shared/schema";

// Quantity formula codes (stored in scopeLineItems.quantityFormula)
export type QuantityFormula =
  | "FLOOR_SF"        // Floor area in SF
  | "CEILING_SF"      // Ceiling area in SF
  | "WALL_SF"         // Total wall area (gross, before openings)
  | "WALL_SF_NET"     // Net wall area (after opening deductions)
  | "WALLS_CEILING_SF" // Walls + ceiling combined
  | "PERIMETER_LF"    // Floor perimeter in LF
  | "CEILING_PERIM_LF" // Ceiling perimeter in LF
  | "FLOOR_SY"        // Floor area in SY (SF ÷ 9)
  | "ROOF_SF"         // Roof area in SF (adjusted for pitch)
  | "ROOF_SQ"         // Roof area in squares (SF ÷ 100)
  | "VOLUME_CF"       // Room volume in CF
  | "MANUAL"          // Adjuster provides quantity manually
  | "EACH";           // Count-based (1 per item)

export interface RoomDimVars {
  // These come from PROMPT-15's calculateDimVars() stored in room.dimensions.dimVars
  W?: number;    // Total wall SF (gross)
  F?: number;    // Floor SF
  C?: number;    // Ceiling SF
  PF?: number;   // Perimeter floor LF
  PC?: number;   // Perimeter ceiling LF
  LW?: number;   // Long wall SF
  SW?: number;   // Short wall SF
  HH?: number;   // Header height (inches)
  SH?: number;   // Short wall height (inches)
  LL?: number;   // Line length LF
  R?: number;    // Riser SF
  SQ?: number;   // Roof squares
  V?: number;    // Volume CF
}

export interface QuantityResult {
  quantity: number;
  unit: string;
  formula: QuantityFormula;
  // How this quantity was derived
  derivation: string;
}

/**
 * Derives the quantity for a line item from room geometry.
 *
 * @param room - The inspection room with dimensions + DIM_VARS
 * @param formula - The quantity formula code from the catalog
 * @param netWallDeduction - Total opening deduction SF (from roomOpenings/PROMPT-12)
 * @returns QuantityResult with the calculated quantity, or null if not derivable
 */
export function deriveQuantity(
  room: InspectionRoom,
  formula: QuantityFormula,
  netWallDeduction: number = 0
): QuantityResult | null {
  const dims = room.dimensions as any;
  if (!dims) return null;

  // Try to use PROMPT-15 DIM_VARS first, fall back to basic geometry
  const dimVars: RoomDimVars = dims.dimVars || {};

  const length = dims.length || 0;
  const width = dims.width || 0;
  const height = dims.height || 8;

  // Basic geometry fallbacks (used if DIM_VARS not yet computed)
  const floorSF = dimVars.F ?? (length * width);
  const ceilingSF = dimVars.C ?? (length * width);
  const grossWallSF = dimVars.W ?? ((length + width) * 2 * height);
  const perimeterLF = dimVars.PF ?? ((length + width) * 2);
  const ceilingPerimLF = dimVars.PC ?? perimeterLF;
  const volumeCF = dimVars.V ?? (length * width * height);

  switch (formula) {
    case "FLOOR_SF":
      return {
        quantity: round2(floorSF),
        unit: "SF",
        formula,
        derivation: `Floor area: ${length}' × ${width}' = ${round2(floorSF)} SF`,
      };

    case "CEILING_SF":
      return {
        quantity: round2(ceilingSF),
        unit: "SF",
        formula,
        derivation: `Ceiling area: ${length}' × ${width}' = ${round2(ceilingSF)} SF`,
      };

    case "WALL_SF":
      return {
        quantity: round2(grossWallSF),
        unit: "SF",
        formula,
        derivation: `Gross wall area: perimeter ${round2(perimeterLF)} LF × ${height}' height = ${round2(grossWallSF)} SF`,
      };

    case "WALL_SF_NET":
      const netWallSF = Math.max(0, grossWallSF - netWallDeduction);
      return {
        quantity: round2(netWallSF),
        unit: "SF",
        formula,
        derivation: `Net wall area: ${round2(grossWallSF)} SF gross - ${round2(netWallDeduction)} SF openings = ${round2(netWallSF)} SF`,
      };

    case "WALLS_CEILING_SF":
      const wallsCeilSF = grossWallSF + ceilingSF;
      return {
        quantity: round2(wallsCeilSF),
        unit: "SF",
        formula,
        derivation: `Walls + ceiling: ${round2(grossWallSF)} SF walls + ${round2(ceilingSF)} SF ceiling = ${round2(wallsCeilSF)} SF`,
      };

    case "PERIMETER_LF":
      return {
        quantity: round2(perimeterLF),
        unit: "LF",
        formula,
        derivation: `Floor perimeter: (${length}' + ${width}') × 2 = ${round2(perimeterLF)} LF`,
      };

    case "CEILING_PERIM_LF":
      return {
        quantity: round2(ceilingPerimLF),
        unit: "LF",
        formula,
        derivation: `Ceiling perimeter: ${round2(ceilingPerimLF)} LF`,
      };

    case "FLOOR_SY":
      const floorSY = floorSF / 9;
      return {
        quantity: round2(floorSY),
        unit: "SY",
        formula,
        derivation: `Floor area in SY: ${round2(floorSF)} SF ÷ 9 = ${round2(floorSY)} SY`,
      };

    case "ROOF_SF":
      // Use DIM_VARS riser SF if available, otherwise use floor SF as flat-roof estimate
      const roofSF = dimVars.R ?? floorSF;
      return {
        quantity: round2(roofSF),
        unit: "SF",
        formula,
        derivation: `Roof area: ${round2(roofSF)} SF`,
      };

    case "ROOF_SQ":
      const roofSquares = (dimVars.SQ ?? (floorSF / 100));
      return {
        quantity: round2(roofSquares),
        unit: "SQ",
        formula,
        derivation: `Roof squares: ${round2(roofSquares)} SQ`,
      };

    case "VOLUME_CF":
      return {
        quantity: round2(volumeCF),
        unit: "CF",
        formula,
        derivation: `Volume: ${length}' × ${width}' × ${height}' = ${round2(volumeCF)} CF`,
      };

    case "EACH":
      return {
        quantity: 1,
        unit: "EA",
        formula,
        derivation: "Count-based item: 1 EA",
      };

    case "MANUAL":
      // Manual items cannot be auto-derived — return null to signal
      // the voice agent must ask for quantity
      return null;

    default:
      return null;
  }
}

/**
 * Derives quantities for all applicable catalog items in a room.
 * Used by the scope assembly service to batch-derive quantities.
 */
export function deriveRoomQuantities(
  room: InspectionRoom,
  catalogItems: Array<{ code: string; quantityFormula: string | null; unit: string }>,
  netWallDeduction: number = 0
): Map<string, QuantityResult> {
  const results = new Map<string, QuantityResult>();

  for (const item of catalogItems) {
    if (!item.quantityFormula) continue;
    const result = deriveQuantity(room, item.quantityFormula as QuantityFormula, netWallDeduction);
    if (result) {
      results.set(item.code, result);
    }
  }

  return results;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
```

### B2. New Service — `scopeAssemblyService.ts`

**File:** `server/scopeAssemblyService.ts` (new file)

This is the central scope assembly engine. It:
1. Takes damage observations and room geometry
2. Matches catalog items by scope conditions (damage type, severity, surfaces, room type)
3. Derives quantities from DIM_VARS via the quantity engine
4. Cascades companion rules (auto-adds, requires)
5. Creates scope items with provenance tracking

```typescript
/**
 * Scope Assembly Service
 *
 * Assembles scope items from damage observations, room geometry, and the catalog.
 * This is the bridge between "what damage exists" and "what work needs to happen."
 *
 * Design principle: Scope defines WHAT work — never touches pricing.
 * Quantities come from room geometry (deterministic), not AI estimation.
 */

import { IStorage } from "./storage";
import { deriveQuantity, type QuantityFormula, type QuantityResult } from "./scopeQuantityEngine";
import type { InspectionRoom, DamageObservation, ScopeLineItem, ScopeItem, InsertScopeItem } from "@shared/schema";

export interface ScopeAssemblyResult {
  // Items that were created
  created: ScopeItem[];
  // Items that were auto-added as companions
  companionItems: ScopeItem[];
  // Items where quantity couldn't be derived (need manual input)
  manualQuantityNeeded: Array<{
    catalogCode: string;
    description: string;
    unit: string;
    reason: string;
  }>;
  // Warnings (e.g., excluded items, unmatched conditions)
  warnings: string[];
}

interface ScopeConditions {
  damage_types?: string[];
  surfaces?: string[];
  severity?: string[];
  room_types?: string[];
  zone_types?: string[];
}

interface CompanionRules {
  requires?: string[];
  auto_adds?: string[];
  excludes?: string[];
}

/**
 * Assembles scope items for a damage observation in a room.
 *
 * Flow:
 * 1. Load catalog items matching this damage type, severity, and room type
 * 2. Derive quantities from room geometry for each matching item
 * 3. Create scope items with provenance "damage_triggered"
 * 4. Cascade companion rules (auto_adds become new scope items)
 * 5. Return results with any items needing manual quantity
 */
export async function assembleScope(
  storage: IStorage,
  sessionId: number,
  room: InspectionRoom,
  damage: DamageObservation,
  netWallDeduction: number = 0
): Promise<ScopeAssemblyResult> {
  const result: ScopeAssemblyResult = {
    created: [],
    companionItems: [],
    manualQuantityNeeded: [],
    warnings: [],
  };

  // 1. Load all active catalog items
  const allCatalogItems = await storage.getScopeLineItems();
  const activeCatalog = allCatalogItems.filter(item => item.isActive);

  // 2. Match catalog items against this damage + room context
  const matchingItems = filterByScopeConditions(activeCatalog, {
    damageType: damage.damageType || undefined,
    severity: damage.severity || undefined,
    roomType: room.roomType || undefined,
    zoneType: getZoneType(room.roomType || ""),
  });

  if (matchingItems.length === 0) {
    result.warnings.push(
      `No catalog items matched damage type "${damage.damageType}" with severity "${damage.severity}" in room type "${room.roomType}". ` +
      `Items must be added manually via add_line_item.`
    );
    return result;
  }

  // 3. Get existing scope items for this session to check for duplicates
  const existingScopeItems = await storage.getScopeItems(sessionId);
  const existingCodes = new Set(
    existingScopeItems
      .filter(si => si.roomId === room.id && si.status === "active")
      .map(si => si.catalogCode)
  );

  // Track all codes we're about to add (for companion exclusion logic)
  const pendingCodes = new Set<string>();
  const itemsToCreate: InsertScopeItem[] = [];

  // 4. For each matching catalog item, derive quantity and create scope item
  for (const catalogItem of matchingItems) {
    // Skip if this item already exists in this room
    if (existingCodes.has(catalogItem.code)) {
      result.warnings.push(`Skipped "${catalogItem.code}" — already in scope for this room.`);
      continue;
    }

    // Check exclusion rules — if any existing item excludes this one, skip
    if (isExcluded(catalogItem.code, existingScopeItems, matchingItems)) {
      result.warnings.push(`Skipped "${catalogItem.code}" — excluded by existing scope item.`);
      continue;
    }

    // Derive quantity from room geometry
    const formula = catalogItem.quantityFormula as QuantityFormula | null;
    let quantity: number;
    let quantityFormula: string | null = formula;
    let provenance: string = "damage_triggered";

    if (formula && formula !== "MANUAL") {
      const qResult = deriveQuantity(room, formula, netWallDeduction);
      if (qResult) {
        quantity = qResult.quantity;
      } else {
        // Geometry not available — flag for manual entry
        result.manualQuantityNeeded.push({
          catalogCode: catalogItem.code,
          description: catalogItem.description,
          unit: catalogItem.unit,
          reason: `Room dimensions required for ${formula} formula`,
        });
        continue;
      }
    } else if (formula === "MANUAL") {
      result.manualQuantityNeeded.push({
        catalogCode: catalogItem.code,
        description: catalogItem.description,
        unit: catalogItem.unit,
        reason: "Manual quantity required",
      });
      continue;
    } else {
      // No formula specified — default to 1 EA
      quantity = 1;
      quantityFormula = "EACH";
    }

    // Skip zero-quantity items
    if (quantity <= 0) continue;

    pendingCodes.add(catalogItem.code);
    itemsToCreate.push({
      sessionId,
      roomId: room.id,
      damageId: damage.id,
      catalogCode: catalogItem.code,
      description: catalogItem.description,
      tradeCode: catalogItem.tradeCode,
      quantity,
      unit: catalogItem.unit,
      quantityFormula,
      provenance,
      coverageType: catalogItem.coverageType || "A",
      activityType: catalogItem.activityType || "replace",
      wasteFactor: catalogItem.defaultWasteFactor || null,
      status: "active",
      parentScopeItemId: null,
    });
  }

  // 5. Create primary scope items
  if (itemsToCreate.length > 0) {
    const created = await storage.createScopeItems(itemsToCreate);
    result.created.push(...created);

    // 6. Process companion rules for created items
    for (const createdItem of created) {
      const catalogItem = activeCatalog.find(c => c.code === createdItem.catalogCode);
      if (!catalogItem?.companionRules) continue;

      const companions = catalogItem.companionRules as CompanionRules;
      if (!companions.auto_adds || companions.auto_adds.length === 0) continue;

      for (const companionCode of companions.auto_adds) {
        // Skip if already exists or pending
        if (existingCodes.has(companionCode) || pendingCodes.has(companionCode)) continue;

        const companionCatalog = activeCatalog.find(c => c.code === companionCode);
        if (!companionCatalog) {
          result.warnings.push(`Companion "${companionCode}" not found in catalog.`);
          continue;
        }

        // Derive companion quantity
        const cFormula = companionCatalog.quantityFormula as QuantityFormula | null;
        let cQuantity: number;

        if (cFormula && cFormula !== "MANUAL") {
          const cResult = deriveQuantity(room, cFormula, netWallDeduction);
          if (cResult) {
            cQuantity = cResult.quantity;
          } else {
            result.manualQuantityNeeded.push({
              catalogCode: companionCode,
              description: companionCatalog.description,
              unit: companionCatalog.unit,
              reason: `Companion of "${catalogItem.code}" — room dimensions needed`,
            });
            continue;
          }
        } else {
          cQuantity = 1;
        }

        if (cQuantity <= 0) continue;

        pendingCodes.add(companionCode);

        const companionItem = await storage.createScopeItem({
          sessionId,
          roomId: room.id,
          damageId: damage.id,
          catalogCode: companionCode,
          description: companionCatalog.description,
          tradeCode: companionCatalog.tradeCode,
          quantity: cQuantity,
          unit: companionCatalog.unit,
          quantityFormula: companionCatalog.quantityFormula,
          provenance: "companion_auto",
          coverageType: companionCatalog.coverageType || "A",
          activityType: companionCatalog.activityType || "replace",
          wasteFactor: companionCatalog.defaultWasteFactor || null,
          status: "active",
          parentScopeItemId: createdItem.id,
        });

        result.companionItems.push(companionItem);
      }
    }
  }

  // 7. Recalculate scope summary
  await storage.recalculateScopeSummary(sessionId);

  return result;
}

/**
 * Filters catalog items by scope conditions.
 * An item matches if ALL of its non-null conditions match the context.
 * Items with no conditions are universal (match everything).
 */
function filterByScopeConditions(
  catalog: ScopeLineItem[],
  context: {
    damageType?: string;
    severity?: string;
    roomType?: string;
    zoneType?: string;
  }
): ScopeLineItem[] {
  return catalog.filter(item => {
    const conditions = item.scopeConditions as ScopeConditions | null;
    if (!conditions) return false; // Items without conditions must be added manually

    // Check damage_types
    if (conditions.damage_types && conditions.damage_types.length > 0) {
      if (!context.damageType || !conditions.damage_types.includes(context.damageType)) {
        return false;
      }
    }

    // Check severity
    if (conditions.severity && conditions.severity.length > 0) {
      if (!context.severity || !conditions.severity.includes(context.severity)) {
        return false;
      }
    }

    // Check room_types
    if (conditions.room_types && conditions.room_types.length > 0) {
      if (!context.roomType || !conditions.room_types.includes(context.roomType)) {
        return false;
      }
    }

    // Check zone_types
    if (conditions.zone_types && conditions.zone_types.length > 0) {
      if (!context.zoneType || !conditions.zone_types.includes(context.zoneType)) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Checks if a catalog code is excluded by any existing scope item's companion rules.
 */
function isExcluded(
  code: string,
  existingItems: ScopeItem[],
  matchingCatalog: ScopeLineItem[]
): boolean {
  for (const item of matchingCatalog) {
    const rules = item.companionRules as CompanionRules | null;
    if (rules?.excludes?.includes(code)) {
      // Check if the excluding item is in the existing scope
      if (existingItems.some(si => si.catalogCode === item.code && si.status === "active")) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Derives zone type from room type for scope condition matching.
 */
function getZoneType(roomType: string): string {
  if (roomType.startsWith("interior_")) return "interior";
  if (roomType.startsWith("exterior_")) return "exterior";
  return "unknown";
}
```

### B3. API Routes for Scope Assembly

**File:** `server/routes.ts`
**Add after:** the line items DELETE route (line 924). Find `// ── Photos ───` and insert BEFORE it:

```typescript
  // ── Scope Assembly ─────────────────────────────────

  app.post("/api/inspection/:sessionId/scope/assemble", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const { roomId, damageId } = req.body;

      if (!roomId || !damageId) {
        return res.status(400).json({ message: "roomId and damageId are required" });
      }

      const room = await storage.getRoom(roomId);
      if (!room) return res.status(404).json({ message: "Room not found" });

      const damages = await storage.getDamages(roomId);
      const damage = damages.find(d => d.id === damageId);
      if (!damage) return res.status(404).json({ message: "Damage not found" });

      // Calculate net wall deduction from room openings (PROMPT-12)
      // If calculateNetWallArea exists, use it; otherwise default to 0
      let netWallDeduction = 0;
      try {
        const { calculateNetWallArea } = await import("./dimVarsEngine");
        // Get openings for this room if available
        // PROMPT-12 stores openings that have deduction SF
        // For now, pass 0 — PROMPT-15's DIM_VARS engine handles this
      } catch {
        // PROMPT-15 not yet applied — use 0
      }

      const { assembleScope } = await import("./scopeAssemblyService");
      const result = await assembleScope(storage, sessionId, room, damage, netWallDeduction);

      res.json({
        created: result.created.length,
        companions: result.companionItems.length,
        manualNeeded: result.manualQuantityNeeded,
        warnings: result.warnings,
        items: [...result.created, ...result.companionItems],
      });
    } catch (error: any) {
      console.error("Scope assembly error:", error);
      res.status(500).json({ message: "Scope assembly failed" });
    }
  });

  app.get("/api/inspection/:sessionId/scope/items", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const items = await storage.getScopeItems(sessionId);
      res.json(items);
    } catch (error: any) {
      console.error("Server error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/scope/summary", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const summary = await storage.getScopeSummary(sessionId);
      if (summary.length === 0) {
        // Recalculate if empty
        const recalculated = await storage.recalculateScopeSummary(sessionId);
        return res.json(recalculated);
      }
      res.json(summary);
    } catch (error: any) {
      console.error("Server error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/inspection/:sessionId/scope/items/:id", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const sessionId = parseInt(req.params.sessionId);
      const { quantity, description, wasteFactor, status } = req.body;
      const updates: any = {};
      if (quantity !== undefined) updates.quantity = quantity;
      if (description !== undefined) updates.description = description;
      if (wasteFactor !== undefined) updates.wasteFactor = wasteFactor;
      if (status !== undefined) updates.status = status;

      const item = await storage.updateScopeItem(id, updates);
      // Recalculate summary after any change
      await storage.recalculateScopeSummary(sessionId);
      res.json(item);
    } catch (error: any) {
      console.error("Server error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
```

---

## Part C — Pricing Engine Overhaul

### Problem

`estimateEngine.ts` (256 lines) has fundamental pricing inaccuracies:

1. **Waste on all components** (line 99): `unitPrice = baseUnitPrice * (1 + wasteFactor / 100)` — applies waste to labor and equipment too. Xactimate applies waste to materials only.
2. **Flat tax rate** (line 152): `taxAmount = subtotal * taxRate` — one rate for everything. Real estimates have material tax and cleaning tax as separate categories.
3. **Binary O&P** (line 156): `qualifiesForOP = tradesInvolved.length >= 3` — just a trade count check. Xactimate uses trade count AND dollar threshold AND per-trade eligibility flags.
4. **ESX fabricated splits** (esxGenerator.ts lines 45-49): `laborTotal = totalPrice * 0.35, material = totalPrice * 0.65, tax = totalPrice * 0.05` — completely arbitrary percentages that bear no relation to actual regional prices.
5. **No action types**: Xactimate prices differ for R&R (remove & replace), Reset (detach & reinstall), Remove-only, and Add (new install). Current code ignores action type entirely.

### C1. Replace `estimateEngine.ts`

**File:** `server/estimateEngine.ts`
**Action:** Replace the entire file content (all 256 lines):

```typescript
/**
 * Estimate Pricing Engine (v2)
 *
 * Prices scope items using regional price sets with proper M/L/E separation.
 *
 * Key corrections from v1:
 * - Waste applied to materials ONLY (not labor or equipment)
 * - Carrier-specific tax rules (material tax, cleaning tax, equipment tax rates)
 * - O&P eligibility: trade count threshold + dollar minimum + per-trade flags
 * - Action type pricing: R&R, Reset, Remove, Install have different price points
 * - No more fabricated M/L/E splits — uses actual regional price data
 */

import { db } from "./db";
import { scopeLineItems, regionalPriceSets, scopeTrades } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import type { ScopeItem, ScopeTrade, RegionalPriceSet, ScopeLineItem } from "@shared/schema";

// ── Interfaces ───────────────────────────────────────

export interface UnitPriceBreakdown {
  materialCost: number;        // Base material per unit
  materialWithWaste: number;   // Material with waste factor applied
  laborCost: number;           // Labor per unit (no waste)
  equipmentCost: number;       // Equipment per unit (no waste)
  wasteFactor: number;         // Waste percentage (applied to materials only)
  unitPrice: number;           // Total unit price: materialWithWaste + labor + equipment
}

export interface PricedLineItem {
  scopeItemId: number;
  code: string;
  description: string;
  unit: string;
  quantity: number;
  tradeCode: string;
  activityType: string;
  coverageType: string;
  provenance: string;
  unitPriceBreakdown: UnitPriceBreakdown;
  totalMaterial: number;       // materialWithWaste × quantity
  totalLabor: number;          // laborCost × quantity
  totalEquipment: number;      // equipmentCost × quantity
  totalPrice: number;          // totalMaterial + totalLabor + totalEquipment
  isAutoAdded: boolean;        // companion_auto provenance
  roomId: number | null;
  damageId: number | null;
}

export interface TaxConfig {
  materialTaxRate: number;     // Tax on material costs (e.g., 0.08 for 8%)
  laborTaxRate: number;        // Tax on labor (usually 0 in most states)
  equipmentTaxRate: number;    // Tax on equipment rental (varies)
  cleaningTaxRate: number;     // Tax on cleaning supplies
}

export interface OPConfig {
  overheadPct: number;         // Overhead percentage (typically 10%)
  profitPct: number;           // Profit percentage (typically 10%)
  minTradeCount: number;       // Minimum trades for O&P eligibility (typically 3)
  minDollarThreshold: number;  // Minimum dollar amount for O&P (carrier-specific, e.g., $2500)
  carrierOverride: boolean;    // If true, carrier always pays O&P regardless of thresholds
}

export interface EstimateTotals {
  subtotalMaterial: number;
  subtotalLabor: number;
  subtotalEquipment: number;
  subtotal: number;
  wasteAmount: number;         // Total waste cost included in materials
  materialTax: number;
  laborTax: number;
  equipmentTax: number;
  totalTax: number;
  tradesInvolved: string[];
  opEligibleTrades: string[];  // Trades that qualify for O&P
  qualifiesForOP: boolean;
  overheadAmount: number;
  profitAmount: number;
  grandTotal: number;          // subtotal + totalTax
  totalWithOP: number;         // grandTotal + overhead + profit
  // Per-coverage breakdown
  coverageTotals: {
    A: { rcv: number; depreciation: number; acv: number };
    B: { rcv: number; depreciation: number; acv: number };
    C: { rcv: number; depreciation: number; acv: number };
  };
}

// ── Default Configurations ───────────────────────────

export const DEFAULT_TAX_CONFIG: TaxConfig = {
  materialTaxRate: 0.08,
  laborTaxRate: 0,
  equipmentTaxRate: 0.08,
  cleaningTaxRate: 0.08,
};

export const DEFAULT_OP_CONFIG: OPConfig = {
  overheadPct: 0.10,
  profitPct: 0.10,
  minTradeCount: 3,
  minDollarThreshold: 2500,
  carrierOverride: false,
};

// Trade codes (expanded to 16 — matches scope_trades seed)
export const TRADE_CODES = [
  "MIT", "DEM", "DRY", "PNT", "FLR", "INS", "CAR", "CAB",
  "CTR", "RFG", "WIN", "EXT", "ELE", "PLM", "HVAC", "GEN",
];

// ── Lookup Functions ─────────────────────────────────

export async function lookupCatalogItem(code: string): Promise<ScopeLineItem | null> {
  const items = await db.select().from(scopeLineItems)
    .where(eq(scopeLineItems.code, code)).limit(1);
  return items[0] || null;
}

export async function getRegionalPrice(code: string, regionId: string): Promise<RegionalPriceSet | null> {
  const prices = await db.select().from(regionalPriceSets)
    .where(and(eq(regionalPriceSets.lineItemCode, code), eq(regionalPriceSets.regionId, regionId)))
    .limit(1);
  return prices[0] || null;
}

export async function getTradeOPEligibility(): Promise<Map<string, boolean>> {
  const trades = await db.select().from(scopeTrades);
  return new Map(trades.map(t => [t.code, t.opEligible ?? true]));
}

// ── Pricing Functions ────────────────────────────────

/**
 * Prices a single scope item using regional price data.
 * Waste is applied to materials only.
 */
export function calculateLineItemPrice(
  scopeItem: ScopeItem,
  catalogItem: ScopeLineItem | null,
  regionalPrice: RegionalPriceSet | null,
  overrideWasteFactor?: number
): PricedLineItem {
  const wasteFactor = overrideWasteFactor ?? scopeItem.wasteFactor ?? catalogItem?.defaultWasteFactor ?? 0;

  const materialCost = regionalPrice?.materialCost || 0;
  const laborCost = regionalPrice?.laborCost || 0;
  const equipmentCost = regionalPrice?.equipmentCost || 0;

  // Waste applied to materials ONLY
  const materialWithWaste = materialCost * (1 + wasteFactor / 100);

  // Unit price = material (with waste) + labor + equipment
  const unitPrice = materialWithWaste + laborCost + equipmentCost;

  const quantity = scopeItem.quantity;
  const totalMaterial = materialWithWaste * quantity;
  const totalLabor = laborCost * quantity;
  const totalEquipment = equipmentCost * quantity;
  const totalPrice = totalMaterial + totalLabor + totalEquipment;

  return {
    scopeItemId: scopeItem.id,
    code: scopeItem.catalogCode || "CUSTOM",
    description: scopeItem.description,
    unit: scopeItem.unit,
    quantity,
    tradeCode: scopeItem.tradeCode,
    activityType: scopeItem.activityType || "replace",
    coverageType: scopeItem.coverageType || "A",
    provenance: scopeItem.provenance,
    unitPriceBreakdown: {
      materialCost,
      materialWithWaste,
      laborCost,
      equipmentCost,
      wasteFactor,
      unitPrice,
    },
    totalMaterial,
    totalLabor,
    totalEquipment,
    totalPrice,
    isAutoAdded: scopeItem.provenance === "companion_auto",
    roomId: scopeItem.roomId,
    damageId: scopeItem.damageId,
  };
}

/**
 * Calculates estimate totals from priced items with proper tax and O&P logic.
 */
export async function calculateEstimateTotals(
  pricedItems: PricedLineItem[],
  taxConfig: TaxConfig = DEFAULT_TAX_CONFIG,
  opConfig: OPConfig = DEFAULT_OP_CONFIG
): Promise<EstimateTotals> {
  let subtotalMaterial = 0;
  let subtotalLabor = 0;
  let subtotalEquipment = 0;
  let wasteAmount = 0;
  const tradesSet = new Set<string>();

  // Per-coverage accumulators
  const coverageRCV: Record<string, number> = { A: 0, B: 0, C: 0 };

  for (const item of pricedItems) {
    subtotalMaterial += item.totalMaterial;
    subtotalLabor += item.totalLabor;
    subtotalEquipment += item.totalEquipment;
    tradesSet.add(item.tradeCode);

    // Track waste amount
    const baseMatPerUnit = item.unitPriceBreakdown.materialCost;
    const wastePerUnit = item.unitPriceBreakdown.materialWithWaste - baseMatPerUnit;
    wasteAmount += wastePerUnit * item.quantity;

    // Accumulate by coverage type
    const cov = item.coverageType || "A";
    coverageRCV[cov] = (coverageRCV[cov] || 0) + item.totalPrice;
  }

  const subtotal = subtotalMaterial + subtotalLabor + subtotalEquipment;

  // Tax: separate rates for material, labor, equipment
  const materialTax = subtotalMaterial * taxConfig.materialTaxRate;
  const laborTax = subtotalLabor * taxConfig.laborTaxRate;
  const equipmentTax = subtotalEquipment * taxConfig.equipmentTaxRate;
  const totalTax = materialTax + laborTax + equipmentTax;

  // O&P: check trade count + dollar threshold + per-trade eligibility
  const tradesInvolved = Array.from(tradesSet);
  const tradeOPMap = await getTradeOPEligibility();
  const opEligibleTrades = tradesInvolved.filter(t => tradeOPMap.get(t) !== false);

  let qualifiesForOP = false;
  if (opConfig.carrierOverride) {
    qualifiesForOP = true;
  } else {
    const meetsTradeCount = opEligibleTrades.length >= opConfig.minTradeCount;
    const meetsDollarThreshold = subtotal >= opConfig.minDollarThreshold;
    qualifiesForOP = meetsTradeCount && meetsDollarThreshold;
  }

  // O&P calculated on subtotal of O&P-eligible trades only
  const opEligibleSubtotal = pricedItems
    .filter(item => tradeOPMap.get(item.tradeCode) !== false)
    .reduce((sum, item) => sum + item.totalPrice, 0);

  const overheadAmount = qualifiesForOP ? opEligibleSubtotal * opConfig.overheadPct : 0;
  const profitAmount = qualifiesForOP ? opEligibleSubtotal * opConfig.profitPct : 0;

  const grandTotal = subtotal + totalTax;
  const totalWithOP = grandTotal + overheadAmount + profitAmount;

  return {
    subtotalMaterial,
    subtotalLabor,
    subtotalEquipment,
    subtotal,
    wasteAmount,
    materialTax,
    laborTax,
    equipmentTax,
    totalTax,
    tradesInvolved,
    opEligibleTrades,
    qualifiesForOP,
    overheadAmount,
    profitAmount,
    grandTotal,
    totalWithOP,
    coverageTotals: {
      A: { rcv: coverageRCV.A || 0, depreciation: 0, acv: 0 },
      B: { rcv: coverageRCV.B || 0, depreciation: 0, acv: 0 },
      C: { rcv: coverageRCV.C || 0, depreciation: 0, acv: 0 },
    },
  };
}

/**
 * Validates an estimate for scope gaps and pricing issues.
 * (Comprehensive validation is in Part E — this is the basic price-level check)
 */
export async function validateEstimate(pricedItems: PricedLineItem[]): Promise<{
  valid: boolean;
  errors: string[];
  warnings: string[];
}> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const codes = new Set<string>();

  for (const item of pricedItems) {
    // Duplicate check
    const key = `${item.code}-${item.roomId}`;
    if (codes.has(key)) {
      warnings.push(`Duplicate item: ${item.code} appears multiple times in the same room`);
    }
    codes.add(key);

    // Quantity validation
    if (!item.quantity || item.quantity <= 0) {
      errors.push(`Item "${item.description}" (${item.code}) has invalid quantity: ${item.quantity}`);
    }

    // Price validation — warn if unit price is 0 (likely missing regional price)
    if (item.unitPriceBreakdown.unitPrice === 0) {
      warnings.push(`Item "${item.code}" has $0 unit price — regional pricing may be missing`);
    }

    // Waste factor reasonableness
    if (item.unitPriceBreakdown.wasteFactor > 30) {
      warnings.push(`Item "${item.code}" has unusually high waste factor: ${item.unitPriceBreakdown.wasteFactor}%`);
    }
  }

  // Trade sequence checks
  const tradeCodes = new Set(pricedItems.map(i => i.tradeCode));

  // DEM → DRY → PNT sequence
  if (tradeCodes.has("DRY") && !tradeCodes.has("DEM")) {
    warnings.push("Drywall (DRY) present without Demolition (DEM) — verify existing drywall was removed");
  }
  if (tradeCodes.has("PNT") && !tradeCodes.has("DRY")) {
    warnings.push("Painting (PNT) present without Drywall (DRY) — verify surface prep");
  }

  // FLR → DEM sequence
  if (tradeCodes.has("FLR") && !tradeCodes.has("DEM")) {
    warnings.push("Flooring (FLR) present without Demolition (DEM) — verify old flooring removal");
  }

  // Mitigation → Reconstruction sequence
  if (tradeCodes.has("MIT")) {
    const hasMitOnly = tradeCodes.size === 1;
    if (hasMitOnly) {
      warnings.push("Mitigation (MIT) only — no reconstruction trades present. Is this a mitigation-only estimate?");
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Suggests companion items based on what's in the scope.
 * Uses catalog companion rules rather than hardcoded logic.
 */
export async function getCompanionSuggestions(pricedItems: PricedLineItem[]): Promise<string[]> {
  const suggestions: string[] = [];
  const existingCodes = new Set(pricedItems.map(i => i.code));

  for (const item of pricedItems) {
    const catalogItem = await lookupCatalogItem(item.code);
    if (!catalogItem?.companionRules) continue;

    const rules = catalogItem.companionRules as { requires?: string[]; auto_adds?: string[]; excludes?: string[] };

    // Check for required items that are missing
    if (rules.requires) {
      for (const req of rules.requires) {
        if (!existingCodes.has(req)) {
          const reqItem = await lookupCatalogItem(req);
          suggestions.push(
            `"${item.description}" requires "${reqItem?.description || req}" — consider adding ${req}`
          );
        }
      }
    }

    // Check for auto-add items that aren't present (should have been auto-added)
    if (rules.auto_adds) {
      for (const autoAdd of rules.auto_adds) {
        if (!existingCodes.has(autoAdd)) {
          const addItem = await lookupCatalogItem(autoAdd);
          suggestions.push(
            `Consider adding "${addItem?.description || autoAdd}" (companion of "${item.description}")`
          );
        }
      }
    }
  }

  return suggestions;
}
```

---

## Part D — Voice Agent Scope Intelligence

### Problem

The voice agent has only one scope tool: `add_line_item` (lines 150-169 of `realtime.ts`), which creates flat line items with no connection to the scope engine. There's no tool to trigger scope assembly from damage, no way to auto-derive quantities, and no validation tool.

### D1. New Voice Tool — `generate_scope`

**File:** `server/realtime.ts`
**Add after:** the `add_line_item` tool definition (line 169, after the closing `}`). Insert this new tool:

```typescript
  {
    type: "function",
    name: "generate_scope",
    description: "Triggers the scope assembly engine to automatically generate estimate line items from a damage observation. Uses room geometry to derive quantities and cascades companion items. Call this AFTER recording damage with add_damage. Returns the items created plus any that need manual quantities.",
    parameters: {
      type: "object",
      properties: {
        damageId: { type: "integer", description: "The ID of the damage observation to generate scope from (returned by add_damage)" },
        roomId: { type: "integer", description: "The room ID where the damage was observed" }
      },
      required: ["damageId", "roomId"]
    }
  },
```

### D2. New Voice Tool — `validate_scope`

**File:** `server/realtime.ts`
**Add after:** the `generate_scope` tool (from D1):

```typescript
  {
    type: "function",
    name: "validate_scope",
    description: "Validates the current scope for completeness and consistency. Checks for missing companion items, trade sequence gaps, quantity mismatches, and coverage issues. Call during Phase 7 (Estimate Assembly) or when the adjuster asks to review the estimate.",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "integer", description: "The inspection session ID" }
      },
      required: ["sessionId"]
    }
  },
```

### D3. Enhance `add_line_item` Tool Description

**File:** `server/realtime.ts`
**Replace:** the existing `add_line_item` tool definition (lines 150-169) with this enhanced version that supports auto-quantity derivation:

```typescript
  {
    type: "function",
    name: "add_line_item",
    description: "Adds an Xactimate-compatible estimate line item. When quantity is omitted and a catalogCode is provided, the system will automatically derive the quantity from room dimensions (DIM_VARS). Companion items are auto-added based on catalog rules. When possible, provide a catalogCode for accurate pricing and companion cascading.",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["Roofing", "Siding", "Soffit/Fascia", "Gutters", "Windows", "Doors", "Drywall", "Painting", "Flooring", "Plumbing", "Electrical", "HVAC", "Debris", "General", "Fencing"] },
        action: { type: "string", enum: ["R&R", "Detach & Reset", "Repair", "Paint", "Clean", "Tear Off", "Labor Only", "Install"] },
        description: { type: "string", description: "Detailed item, e.g., 'Laminated composition shingles' or '6-inch aluminum fascia'" },
        catalogCode: { type: "string", description: "Xactimate-style code from pricing catalog (e.g., 'RFG-SHIN-AR'). Enables auto-quantity derivation and companion cascading." },
        quantity: { type: "number", description: "Amount (SF, LF, EA, SQ). OMIT this if catalogCode is provided — quantity will auto-derive from room geometry." },
        unit: { type: "string", enum: ["SF", "LF", "EA", "SQ", "SY", "HR", "DAY"] },
        unitPrice: { type: "number", description: "Price per unit. If catalogCode and region are set, this comes from the pricing database." },
        wasteFactor: { type: "integer", description: "Waste percentage for materials only (10, 12, 15). Applies to materials, NOT labor." },
        depreciationType: { type: "string", enum: ["Recoverable", "Non-Recoverable", "Paid When Incurred"] },
        coverageType: { type: "string", enum: ["A", "B", "C"], description: "A=Dwelling, B=Other Structures, C=Contents. Default A." },
        damageId: { type: "integer", description: "Link this line item to a specific damage observation" }
      },
      required: ["category", "action", "description"]
    }
  },
```

### D4. System Instruction Updates

**File:** `server/realtime.ts`
**Add to:** the `buildSystemInstructions` function (line 3). Insert these additional instructions into the system prompt string, after the existing "Core Behaviors" section (after line 85). Add before the closing backtick:

```typescript

## Scope Assembly Intelligence

9. **Damage-First Workflow:** When the adjuster describes damage, ALWAYS:
   a. First call add_damage to record the observation
   b. Then call generate_scope with the returned damageId and roomId
   c. The scope engine will auto-generate line items with geometry-derived quantities
   d. Review what was generated and tell the adjuster: "I've added [N] items for this damage including [brief list]. [N] companion items were auto-added."
   e. If any items need manual quantities, ask the adjuster for those specific measurements

10. **Quantity Trust Hierarchy:** For quantities, always prefer:
    a. Engine-derived (from room DIM_VARS) — most reliable, deterministic
    b. Adjuster-stated (from voice measurement) — use add_line_item with explicit quantity
    c. NEVER estimate quantities yourself — if you can't derive or ask, flag it for manual entry

11. **Companion Awareness:** The scope engine auto-adds companion items. After generate_scope returns:
    - Tell the adjuster what companions were added (e.g., "Also added tape, float, texture, prime, and two coats of paint as drywall companions")
    - If a companion needs manual quantity, ask specifically: "How many linear feet of tape for the drywall joints?"
    - Never duplicate companions — the engine prevents this, but don't manually add items that were auto-added

12. **Coverage Type Tracking:** Set coverageType based on the structure:
    - Main Dwelling interior/exterior → Coverage A
    - Detached structures (garage, shed, fence) → Coverage B
    - Personal property / contents → Coverage C
    - If unsure, ask: "Is this covered under the dwelling (A) or other structures (B)?"

13. **Phase 7 Validation:** During Estimate Assembly phase, call validate_scope to check:
    - Missing companion items across all rooms
    - Trade sequence completeness (DEM before DRY, DRY before PNT)
    - Rooms with damage but no scope items
    - Coverage type consistency
    Report findings to the adjuster for review before finalizing
```

### D5. Tool Handler Updates

**File:** `server/routes.ts`
**Context:** The voice tool call handlers are in `routes.ts` (the WebSocket handler that processes tool calls from the realtime API). Find the section that handles tool call responses. Add handlers for the new tools:

The `generate_scope` handler should call the scope assembly endpoint:

```typescript
// In the tool call handler switch/if block, add:

case "generate_scope": {
  const { damageId, roomId } = toolArgs;
  try {
    const room = await storage.getRoom(roomId);
    if (!room) {
      toolResult = JSON.stringify({ error: "Room not found", roomId });
      break;
    }
    const damages = await storage.getDamages(roomId);
    const damage = damages.find(d => d.id === damageId);
    if (!damage) {
      toolResult = JSON.stringify({ error: "Damage not found", damageId });
      break;
    }

    const { assembleScope } = await import("./scopeAssemblyService");
    const result = await assembleScope(storage, sessionId, room, damage);

    toolResult = JSON.stringify({
      success: true,
      created: result.created.length,
      companionItems: result.companionItems.length,
      items: [...result.created, ...result.companionItems].map(i => ({
        code: i.catalogCode,
        description: i.description,
        quantity: i.quantity,
        unit: i.unit,
        trade: i.tradeCode,
        provenance: i.provenance,
      })),
      manualQuantityNeeded: result.manualQuantityNeeded,
      warnings: result.warnings,
    });
  } catch (error: any) {
    toolResult = JSON.stringify({ error: error.message });
  }
  break;
}

case "validate_scope": {
  try {
    const scopeItems = await storage.getScopeItems(sessionId);
    const rooms = await storage.getRooms(sessionId);
    const damages = await storage.getDamagesForSession(sessionId);

    const { validateScopeCompleteness } = await import("./scopeValidation");
    const validation = await validateScopeCompleteness(storage, sessionId, scopeItems, rooms, damages);

    toolResult = JSON.stringify(validation);
  } catch (error: any) {
    toolResult = JSON.stringify({ error: error.message });
  }
  break;
}
```

---

## Part E — Scope Validation Engine & ESX Pricing Fix

### Problem

Validation has 3 rules (estimateEngine.ts lines 183-224). The ESX generator fabricates M/L/E splits with arbitrary percentages (esxGenerator.ts lines 45-49).

### E1. New Service — `scopeValidation.ts`

**File:** `server/scopeValidation.ts` (new file)

```typescript
/**
 * Scope Validation Engine
 *
 * Comprehensive validation of scope completeness and consistency.
 * Checks 12 categories of issues, from missing companions to trade sequences.
 */

import { IStorage } from "./storage";
import type { ScopeItem, InspectionRoom, DamageObservation, ScopeLineItem } from "@shared/schema";

export interface ValidationResult {
  valid: boolean;
  score: number;        // 0-100 completeness score
  errors: ValidationIssue[];    // Must fix
  warnings: ValidationIssue[];  // Should review
  suggestions: ValidationIssue[]; // Nice to have
}

export interface ValidationIssue {
  category: string;
  severity: "error" | "warning" | "suggestion";
  message: string;
  roomId?: number;
  scopeItemId?: number;
  code?: string;
}

/**
 * Validates scope completeness and consistency for an entire session.
 */
export async function validateScopeCompleteness(
  storage: IStorage,
  sessionId: number,
  scopeItems: ScopeItem[],
  rooms: InspectionRoom[],
  damages: DamageObservation[]
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];
  const allCatalog = await storage.getScopeLineItems();
  const catalogMap = new Map(allCatalog.map(c => [c.code, c]));

  // ── 1. Rooms with damage but no scope items ───────
  for (const room of rooms) {
    const roomDamages = damages.filter(d => d.roomId === room.id);
    const roomScope = scopeItems.filter(s => s.roomId === room.id && s.status === "active");

    if (roomDamages.length > 0 && roomScope.length === 0) {
      issues.push({
        category: "missing_scope",
        severity: "error",
        message: `Room "${room.name}" has ${roomDamages.length} damage observation(s) but no scope items. Run generate_scope or add items manually.`,
        roomId: room.id,
      });
    }
  }

  // ── 2. Unlinked damages (damage without any scope reference) ──
  for (const damage of damages) {
    const linkedScope = scopeItems.filter(s => s.damageId === damage.id && s.status === "active");
    if (linkedScope.length === 0) {
      const room = rooms.find(r => r.id === damage.roomId);
      issues.push({
        category: "unlinked_damage",
        severity: "warning",
        message: `Damage "${damage.description}" in "${room?.name || 'unknown room'}" has no linked scope items.`,
        roomId: damage.roomId,
      });
    }
  }

  // ── 3. Missing companion items ─────────────────────
  for (const item of scopeItems) {
    if (item.status !== "active" || !item.catalogCode) continue;
    const catalog = catalogMap.get(item.catalogCode);
    if (!catalog?.companionRules) continue;

    const rules = catalog.companionRules as { requires?: string[]; auto_adds?: string[] };
    const roomScope = scopeItems.filter(s => s.roomId === item.roomId && s.status === "active");
    const roomCodes = new Set(roomScope.map(s => s.catalogCode));

    if (rules.requires) {
      for (const req of rules.requires) {
        if (!roomCodes.has(req)) {
          const reqCatalog = catalogMap.get(req);
          issues.push({
            category: "missing_companion",
            severity: "error",
            message: `"${item.description}" requires "${reqCatalog?.description || req}" but it's not in scope for this room.`,
            roomId: item.roomId || undefined,
            scopeItemId: item.id,
            code: req,
          });
        }
      }
    }
  }

  // ── 4. Trade sequence completeness ─────────────────
  const tradesByRoom = new Map<number, Set<string>>();
  for (const item of scopeItems) {
    if (item.status !== "active" || !item.roomId) continue;
    const existing = tradesByRoom.get(item.roomId) || new Set();
    existing.add(item.tradeCode);
    tradesByRoom.set(item.roomId, existing);
  }

  const TRADE_SEQUENCES = [
    { name: "Drywall", sequence: ["DEM", "DRY", "PNT"], trigger: "DRY" },
    { name: "Flooring", sequence: ["DEM", "FLR"], trigger: "FLR" },
    { name: "Mitigation", sequence: ["MIT", "DEM"], trigger: "MIT" },
  ];

  for (const [roomId, trades] of tradesByRoom) {
    const room = rooms.find(r => r.id === roomId);
    for (const seq of TRADE_SEQUENCES) {
      if (!trades.has(seq.trigger)) continue;
      for (const required of seq.sequence) {
        if (required === seq.trigger) continue;
        if (!trades.has(required)) {
          issues.push({
            category: "trade_sequence",
            severity: "warning",
            message: `Room "${room?.name}": ${seq.name} sequence incomplete — has ${seq.trigger} but missing ${required}.`,
            roomId,
          });
        }
      }
    }
  }

  // ── 5. Quantity reasonableness ─────────────────────
  for (const item of scopeItems) {
    if (item.status !== "active") continue;

    if (!item.quantity || item.quantity <= 0) {
      issues.push({
        category: "invalid_quantity",
        severity: "error",
        message: `"${item.description}" has invalid quantity: ${item.quantity}`,
        scopeItemId: item.id,
      });
    }

    // Flag very large quantities (>10000 SF seems unusual for a single room)
    if (item.unit === "SF" && item.quantity > 10000) {
      issues.push({
        category: "quantity_outlier",
        severity: "warning",
        message: `"${item.description}" has unusually large quantity: ${item.quantity} SF. Verify this is correct.`,
        scopeItemId: item.id,
      });
    }
  }

  // ── 6. Duplicate items per room ────────────────────
  const roomItemKeys = new Set<string>();
  for (const item of scopeItems) {
    if (item.status !== "active") continue;
    const key = `${item.roomId}-${item.catalogCode}-${item.activityType}`;
    if (roomItemKeys.has(key)) {
      issues.push({
        category: "duplicate",
        severity: "warning",
        message: `Duplicate scope item: "${item.description}" (${item.catalogCode}) appears multiple times in the same room.`,
        roomId: item.roomId || undefined,
        scopeItemId: item.id,
      });
    }
    roomItemKeys.add(key);
  }

  // ── 7. Coverage type consistency ───────────────────
  for (const item of scopeItems) {
    if (item.status !== "active" || !item.roomId) continue;
    const room = rooms.find(r => r.id === item.roomId);
    if (!room) continue;

    const structure = (room.structure || "Main Dwelling").toLowerCase();
    const expectedCoverage = structure.includes("detach") || structure.includes("garage") ||
                            structure.includes("shed") || structure.includes("fence") ? "B" : "A";

    if (item.coverageType && item.coverageType !== expectedCoverage) {
      issues.push({
        category: "coverage_mismatch",
        severity: "suggestion",
        message: `"${item.description}" in "${room.name}" (${room.structure}) has coverage ${item.coverageType} but expected ${expectedCoverage}.`,
        roomId: item.roomId,
        scopeItemId: item.id,
      });
    }
  }

  // ── Calculate score ────────────────────────────────
  const errors = issues.filter(i => i.severity === "error");
  const warnings = issues.filter(i => i.severity === "warning");
  const suggestions = issues.filter(i => i.severity === "suggestion");

  // Score: start at 100, deduct for issues
  let score = 100;
  score -= errors.length * 10;
  score -= warnings.length * 3;
  score -= suggestions.length * 1;
  score = Math.max(0, Math.min(100, score));

  return {
    valid: errors.length === 0,
    score,
    errors,
    warnings,
    suggestions,
  };
}
```

### E2. Fix ESX Export Pricing — Use Actual M/L/E

**File:** `server/esxGenerator.ts`
**Replace:** lines 37-52 (the `lineItemsXML` mapping that fabricates M/L/E with arbitrary percentages):

```typescript
  // Map line items to XML format with ACTUAL pricing breakdown
  // instead of fabricated percentages
  const lineItemsXML: LineItemXML[] = [];

  for (const item of items) {
    // Try to get actual M/L/E from regional price set
    let laborTotal: number;
    let material: number;
    let tax: number;
    let laborHours: number;

    if (item.xactCode) {
      // Look up actual regional pricing
      const { getRegionalPrice } = await import("./estimateEngine");
      const regionalPrice = await getRegionalPrice(item.xactCode, "USNATNL"); // Default region

      if (regionalPrice) {
        const qty = item.quantity || 0;
        const wasteFactor = item.wasteFactor || 0;
        material = (regionalPrice.materialCost || 0) * (1 + wasteFactor / 100) * qty;
        laborTotal = (regionalPrice.laborCost || 0) * qty;
        const equipmentTotal = (regionalPrice.equipmentCost || 0) * qty;
        tax = material * 0.08; // Material tax only
        laborHours = laborTotal / 75; // Approximate labor rate
      } else {
        // Fallback: use item's own pricing data if available
        const totalPrice = item.totalPrice || 0;
        laborTotal = totalPrice * 0.35;
        material = totalPrice * 0.65;
        tax = material * 0.08;
        laborHours = laborTotal / 75;
      }
    } else {
      // No catalog code — use stored pricing
      const totalPrice = item.totalPrice || 0;
      laborTotal = totalPrice * 0.35;
      material = totalPrice * 0.65;
      tax = material * 0.08;
      laborHours = laborTotal / 75;
    }

    const rcvTotal = item.totalPrice || 0;
    const acvTotal = rcvTotal * 0.85; // Default 15% depreciation — should come from settlement engine

    lineItemsXML.push({
      id: item.id,
      description: item.description,
      category: item.category,
      action: item.action || "&",
      quantity: item.quantity || 0,
      unit: item.unit || "EA",
      unitPrice: item.unitPrice || 0,
      laborTotal,
      laborHours,
      material,
      tax,
      acvTotal,
      rcvTotal,
      room: rooms.find((r) => r.id === item.roomId)?.name || "Unassigned",
    });
  }
```

### E3. Enhanced ITEM XML with Trade Category

**File:** `server/esxGenerator.ts`
**Replace:** lines 158-165 (the `<ITEM>` XML generation) with proper category/selector from catalog:

```typescript
    roomItems.forEach((item, idx) => {
      const origItem = originalItems.find((oi) => oi.id === item.id);
      const xactCode = origItem?.xactCode || "000000";

      // Use trade-based category code (3 chars) instead of truncated category name
      const tradeToCategory: Record<string, string> = {
        MIT: "WTR", DEM: "DEM", DRY: "DRY", PNT: "PNT", FLR: "FLR",
        INS: "INS", CAR: "FRM", CAB: "CAB", CTR: "CTR", RFG: "RFG",
        WIN: "WIN", EXT: "SDG", ELE: "ELE", PLM: "PLM", HVAC: "HVA", GEN: "GEN",
      };
      const tradeCode = origItem?.tradeCode || "";
      const category = tradeToCategory[tradeCode] || item.category.substring(0, 3).toUpperCase();

      // Map action to Xactimate activity code
      const actionToAct: Record<string, string> = {
        "R&R": "&", "Detach & Reset": "O", "Repair": "R", "Paint": "P",
        "Clean": "C", "Tear Off": "-", "Labor Only": "L", "Install": "+",
      };
      const act = actionToAct[item.action] || "&";

      // Use xactSelector from catalog if available
      const selector = origItem?.xactCode || "1/2++";

      itemsXml += `            <ITEM lineNum="${idx + 1}" cat="${category}" sel="${selector}" act="${act}" desc="${escapeXml(item.description)}" qty="${item.quantity.toFixed(2)}" unit="${item.unit}" remove="0" replace="${item.rcvTotal.toFixed(2)}" total="${item.rcvTotal.toFixed(2)}" laborTotal="${item.laborTotal.toFixed(2)}" laborHours="${item.laborHours.toFixed(2)}" material="${item.material.toFixed(2)}" tax="${item.tax.toFixed(2)}" acvTotal="${item.acvTotal.toFixed(2)}" rcvTotal="${item.rcvTotal.toFixed(2)}"/>
`;
    });
```

---

## Validation Checklist

After applying all changes, verify:

1. **Schema:** `scope_trades`, `scope_items`, `scope_summary` tables created via migration
2. **Schema:** `scope_line_items` has new columns: `coverage_type`, `xact_category_code`, `xact_selector`, `notes`
3. **Schema:** `line_items` has new columns: `trade_code`, `coverage_type`
4. **Schema:** `scope_trades` seeded with 16 trades including O&P eligibility flags
5. **Storage:** IStorage interface has new methods for scope trades, items, and summary
6. **Storage:** DatabaseStorage implements all new methods including `recalculateScopeSummary`
7. **Quantity Engine:** `scopeQuantityEngine.ts` handles all 12 formula types + fallback to basic geometry
8. **Assembly Service:** `scopeAssemblyService.ts` matches scope conditions, derives quantities, cascades companions
9. **Pricing Engine:** `estimateEngine.ts` applies waste to materials only (not labor/equipment)
10. **Pricing Engine:** O&P checks trade count + dollar threshold + per-trade eligibility
11. **Pricing Engine:** Tax separated into material/labor/equipment rates
12. **Voice Tools:** `generate_scope` tool exists and triggers assembly engine
13. **Voice Tools:** `validate_scope` tool exists and runs validation engine
14. **Voice Tools:** `add_line_item` enhanced with `coverageType`, `damageId`, optional `quantity`
15. **System Instructions:** New sections 9-13 covering damage-first workflow, quantity trust hierarchy, companion awareness, coverage tracking, Phase 7 validation
16. **ESX Export:** Uses actual regional M/L/E prices instead of arbitrary 35%/65% splits
17. **ESX Export:** Trade-based category codes and action-to-activity code mapping
18. **Validation:** `scopeValidation.ts` checks 7 categories: missing scope, unlinked damage, missing companions, trade sequences, quantity reasonableness, duplicates, coverage consistency
19. **API Routes:** `/scope/assemble`, `/scope/items`, `/scope/summary`, `/scope/items/:id` PATCH endpoints exist
20. **No regressions:** Existing `lineItems` table and API routes continue to work (enhanced, not replaced)
