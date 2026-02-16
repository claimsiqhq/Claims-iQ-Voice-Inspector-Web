# PROMPT 14 — Financial Engine Refinements: Granular O&P, Code Upgrades, Multi-Tax, Steep Charges

## Goal

Refine the settlement calculation engine from PROMPT-13 with four real-world financial nuances discovered from analysis of 20+ carrier estimates. These are targeted amendments — the core pipeline (RCV → O&P → Tax → Depreciation → ACV → Deductible → Net Claim) remains intact. Each part below modifies specific functions or adds small schema extensions to handle edge cases that production Xactimate estimates routinely contain.

**Prerequisites:** PROMPT-12 and PROMPT-13 must be applied first. This prompt modifies code that PROMPT-13 introduces.

---

## Part A — Granular Per-Trade O&P Eligibility

### Problem

PROMPT-13's `calculateSettlement` applies O&P uniformly to ALL trades when 3+ trades are involved. In reality, carriers selectively apply O&P per-trade. Example from Estimate 37: Painting and Floor Covering receive O&P, but Roofing and Siding do NOT — even though all four trades appear on the same claim. The carrier's logic: O&P rewards the GC for subcontractor coordination, so trades the GC doesn't actually sub out (e.g., the roofer IS the GC) don't get O&P.

### A1. Add `isCodeUpgrade` and O&P Default to `scopeLineItems` Catalog

**File:** `shared/schema.ts`
**Modify:** the `scopeLineItems` table definition (lines 236–249)

Add two new columns before `isActive` (before line 248):

```typescript
  opEligibleDefault: boolean("op_eligible_default").default(true),
  // Whether items in this trade typically receive O&P. Carriers may override per-claim.
  isCodeUpgrade: boolean("is_code_upgrade").default(false),
  // Whether this item represents a building code upgrade (Ice & Water Barrier, GFCI, etc.)
  // Code upgrades are typically "Paid When Incurred" — not paid until work is completed.
```

The full `scopeLineItems` table after this change:

```typescript
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
  // ── NEW: Financial behavior flags ──
  opEligibleDefault: boolean("op_eligible_default").default(true),
  isCodeUpgrade: boolean("is_code_upgrade").default(false),
  isActive: boolean("is_active").default(true),
});
```

### A2. Add Per-Trade O&P Override to `policyRules`

PROMPT-13 creates the `policyRules` table with global `overheadPct` and `profitPct`. We need a way to exclude specific trades from O&P at the claim level.

**File:** `shared/schema.ts`
**Modify:** the `policyRules` table (added by PROMPT-13)

Add a new column after `taxRate`:

```typescript
  opExcludedTrades: jsonb("op_excluded_trades").default([]),
  // Array of trade codes excluded from O&P for this coverage.
  // Example: ["RFG", "EXT"] means Roofing and Exterior/Siding don't get O&P.
  // Empty array = all eligible trades get O&P (default behavior).
```

### A3. Update `calculateSettlement` for Per-Trade O&P

**File:** `server/estimateEngine.ts`
**Modify:** the `calculateSettlement` function (added by PROMPT-13)

The input `policyRules` parameter shape needs an additional field:

```typescript
  policyRules: Array<{
    coverageType: string;
    policyLimit: number | null;
    deductible: number | null;
    applyRoofSchedule: boolean;
    overheadPct: number;
    profitPct: number;
    taxRate: number;
    opExcludedTrades: string[];    // ← NEW
  }>
```

In Step 2 (per-trade O&P calculation), **replace** the uniform O&P application block. The current code in PROMPT-13 is:

```typescript
  // ── Step 2: Calculate per-trade O&P ──
  const tradeSubtotals: TradeSubtotal[] = [];

  for (const [tradeCode, tradeItems] of tradeGroups) {
    const subtotal = tradeItems.reduce((sum, i) => sum + (i.totalPrice || 0), 0);

    // Use Coverage A rule for O&P rates (or first available rule)
    const firstCoverage = tradeItems[0]?.coverageBucket || "Coverage A";
    const rule = ruleMap.get(firstCoverage) || defaultRule;

    const overheadAmount = qualifiesForOP ? subtotal * (rule.overheadPct / 100) : 0;
    const profitAmount = qualifiesForOP ? subtotal * (rule.profitPct / 100) : 0;

    tradeSubtotals.push({
      tradeCode,
      subtotal: Math.round(subtotal * 100) / 100,
      overheadAmount: Math.round(overheadAmount * 100) / 100,
      profitAmount: Math.round(profitAmount * 100) / 100,
      tradeRCV: Math.round((subtotal + overheadAmount + profitAmount) * 100) / 100,
    });
  }
```

**Replace with:**

```typescript
  // ── Step 2: Calculate per-trade O&P (selective by trade) ──
  const tradeSubtotals: TradeSubtotal[] = [];

  // Build a merged set of excluded trades across all coverage rules
  const allExcludedTrades = new Set<string>();
  for (const rule of policyRules) {
    const excluded = (rule.opExcludedTrades || []) as string[];
    excluded.forEach(t => allExcludedTrades.add(t.toUpperCase()));
  }

  for (const [tradeCode, tradeItems] of tradeGroups) {
    const subtotal = tradeItems.reduce((sum, i) => sum + (i.totalPrice || 0), 0);

    // Use Coverage A rule for O&P rates (or first available rule)
    const firstCoverage = tradeItems[0]?.coverageBucket || "Coverage A";
    const rule = ruleMap.get(firstCoverage) || defaultRule;

    // Trade-level O&P eligibility check:
    // 1. Must have 3+ trades overall (qualifiesForOP)
    // 2. This specific trade must NOT be in the exclusion list
    const tradeIsEligible = qualifiesForOP && !allExcludedTrades.has(tradeCode.toUpperCase());

    const overheadAmount = tradeIsEligible ? subtotal * (rule.overheadPct / 100) : 0;
    const profitAmount = tradeIsEligible ? subtotal * (rule.profitPct / 100) : 0;

    tradeSubtotals.push({
      tradeCode,
      subtotal: Math.round(subtotal * 100) / 100,
      overheadAmount: Math.round(overheadAmount * 100) / 100,
      profitAmount: Math.round(profitAmount * 100) / 100,
      tradeRCV: Math.round((subtotal + overheadAmount + profitAmount) * 100) / 100,
    });
  }
```

### A4. Update `TradeSubtotal` Interface (Optional Enhancement)

**File:** `server/estimateEngine.ts`
**Modify:** the `TradeSubtotal` interface (added by PROMPT-13)

Add an `opEligible` field for transparency:

```typescript
export interface TradeSubtotal {
  tradeCode: string;
  subtotal: number;
  overheadAmount: number;
  profitAmount: number;
  tradeRCV: number;
  opEligible: boolean;             // ← NEW: whether this trade received O&P
}
```

Update the `tradeSubtotals.push(...)` call in Step 2 to include:

```typescript
      opEligible: tradeIsEligible,
```

### A5. Voice Agent O&P Awareness

**File:** `server/realtime.ts`
**Modify:** the `buildSystemInstructions` function

In the system instructions, after rule 11 (Roof Payment Schedule, added by PROMPT-13), add:

```typescript

12. **O&P Trade Eligibility:** Not all trades automatically receive Overhead & Profit, even when 3+ trades qualify the claim for O&P. Check the briefing for carrier-specific O&P rules. Common exclusions:
    - Roofing (RFG) — often excluded when the roofer IS the general contractor
    - Exterior/Siding (EXT) — sometimes excluded on roof-only claims
    If the adjuster mentions that certain trades won't get O&P, note this: "Understood — I'll exclude [trade] from O&P calculations. Currently [N] trades are eligible for O&P."
```

### A6. Update `defaultRule` in `calculateSettlement`

**File:** `server/estimateEngine.ts`
**Modify:** the `defaultRule` object inside `calculateSettlement` (added by PROMPT-13)

Add the new field to the default:

```typescript
  const defaultRule = {
    coverageType: "Coverage A",
    policyLimit: null,
    deductible: 0,
    applyRoofSchedule: false,
    overheadPct: 10,
    profitPct: 10,
    taxRate: 8,
    opExcludedTrades: [] as string[],    // ← NEW
  };
```

### A7. Update `getSettlementSummary` in Storage

**File:** `server/storage.ts`
**Modify:** the `getSettlementSummary` method (added by PROMPT-13)

In the `policyInput` mapping, add the new field:

```typescript
    const policyInput = rules.map(r => ({
      coverageType: r.coverageType,
      policyLimit: r.policyLimit,
      deductible: r.deductible,
      applyRoofSchedule: r.applyRoofSchedule || false,
      overheadPct: r.overheadPct || 10,
      profitPct: r.profitPct || 10,
      taxRate: r.taxRate || 8,
      opExcludedTrades: (r as any).opExcludedTrades || [],    // ← NEW
    }));
```

### A8. Update Policy Rule API Schema

**File:** `server/routes.ts`
**Modify:** the `policyRuleSchema` (added by PROMPT-13)

Add the new field:

```typescript
const policyRuleSchema = z.object({
  coverageType: z.enum(["Coverage A", "Coverage B", "Coverage C", "Coverage D"]),
  policyLimit: z.number().positive().nullable().optional(),
  deductible: z.number().nonnegative().nullable().optional(),
  applyRoofSchedule: z.boolean().optional(),
  roofScheduleAge: z.number().positive().nullable().optional(),
  overheadPct: z.number().nonnegative().default(10),
  profitPct: z.number().nonnegative().default(10),
  taxRate: z.number().nonnegative().default(8),
  opExcludedTrades: z.array(z.string()).default([]),    // ← NEW
});
```

---

## Part B — PWI Code Upgrade Auto-Recognition

### Problem

Items like Ice & Water Barrier, GFCI outlets, and arc-fault breakers are building code upgrades — they weren't present before the loss and are only required because current code mandates them during repair. Carriers classify these as "Paid When Incurred" (PWI): the insured gets $0 upfront for code upgrade items and only gets paid when the work is actually completed and receipts are submitted. PROMPT-13 handles the PWI bucket correctly in the calculation engine, but the voice agent has no way to know WHICH items are code upgrades.

### B1. Catalog Flag (Already Done in A1)

The `isCodeUpgrade` boolean was added to `scopeLineItems` in Part A1 above. This flag should be set to `true` for known code upgrade items in the catalog seed.

### B2. Seed Known Code Upgrade Items

When seeding the `scopeLineItems` catalog (from SEED-CATALOG.txt or via migration), set `isCodeUpgrade = true` for these common code upgrade items:

```sql
-- Code upgrade items — set isCodeUpgrade = true
UPDATE scope_line_items SET is_code_upgrade = true WHERE code IN (
  'RFG-ICE-SF',      -- Ice & Water Barrier / Shield
  'RFG-DRIPEDG-LF',  -- Drip Edge (when upgrading from none)
  'ELE-GFCI-EA',     -- GFCI Outlet
  'ELE-AFCI-EA',     -- Arc-Fault Circuit Interrupter
  'ELE-SMOKE-EA',    -- Hardwired Smoke Detector (when upgrading from battery)
  'PLM-SHUTOFF-EA',  -- Individual Shut-off Valve (code requirement)
  'INS-BATT-SF'      -- Insulation to current R-value (when upgrading from lower)
);
```

**Note:** These codes must exist in the catalog. If they don't, add them with the appropriate trade codes and the `isCodeUpgrade` flag set. The exact codes may vary — the important thing is the `isCodeUpgrade = true` flag on items that represent code-mandated upgrades.

### B3. Voice Agent Code Upgrade Intelligence

**File:** `server/realtime.ts`
**Modify:** the `buildSystemInstructions` function

After rule 12 (O&P Trade Eligibility from Part A5), add:

```typescript

13. **Code Upgrade Detection:** Some items are building code upgrades — they weren't present before the loss and are required only because current code mandates them. These are classified as "Paid When Incurred" (PWI):
    - Ice & Water Barrier/Shield — required by code on eaves, valleys, and penetrations. If the old roof didn't have it, it's a code upgrade.
    - GFCI outlets in kitchens/bathrooms — if existing outlets weren't GFCI, replacement with GFCI is a code upgrade.
    - Arc-fault breakers — if upgrading from standard breakers.
    - Hardwired smoke detectors — if upgrading from battery-only.
    When you detect a code upgrade item, automatically set depreciationType to "Paid When Incurred" and inform the adjuster: "Ice & Water Barrier is a code upgrade — I'm marking it as Paid When Incurred. The insured won't receive payment for this until the work is completed and receipts are submitted."
    If uncertain whether an item is a code upgrade, ask: "Was [item] present on the original roof/system, or is this being added to meet current building code?"
```

### B4. Auto-Tag in `add_line_item` Handler

In the session manager's `add_line_item` handler (in the realtime session manager, not routes.ts), add logic to auto-detect code upgrades when a catalog code is provided:

```typescript
case "add_line_item": {
  // ... existing room resolution and field extraction ...

  // Auto-detect code upgrade items from catalog
  let effectiveDepType = depreciationType || "Recoverable";
  if (catalogCode) {
    const catalogItem = await lookupCatalogItem(catalogCode);
    if (catalogItem?.isCodeUpgrade) {
      effectiveDepType = "Paid When Incurred";
      // The voice agent should have already informed the adjuster,
      // but this ensures the flag is set even if manually entered
    }
  }

  const item = await storage.createLineItem({
    // ... existing fields ...
    depreciationType: effectiveDepType,    // ← Uses auto-detected type
    // ... rest of fields ...
  });
}
```

---

## Part C — Multi-Tax Jurisdiction Support

### Problem

PROMPT-13 uses a single `taxRate` on `policyRules` and applies it uniformly to every line item. Real estimates often have multiple tax types on a single claim. Example from Estimate 48:
- Material Sales Tax: 7.25% — applies to material costs for most trades
- Cleaning Mtl Tax: 6.50% — applies to cleaning material costs specifically
- Cleaning Sales Tax: 8.00% — applies to cleaning labor/service costs

The tax type depends on the **category/trade** of the line item, not just the coverage bucket.

### C1. New `taxRules` Table

**File:** `shared/schema.ts`
**Insert after:** the `policyRules` table (added by PROMPT-13)

```typescript
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
```

### C2. IStorage Methods for Tax Rules

**File:** `server/storage.ts`

**Add imports** for the new table:

```typescript
import {
  // ... existing ...
  taxRules,
  type TaxRule, type InsertTaxRule,
} from "@shared/schema";
```

**Add to IStorage interface** (before closing `}`):

```typescript
  // ── Tax Rules ────────────────────────────────
  createTaxRule(data: InsertTaxRule): Promise<TaxRule>;
  getTaxRulesForClaim(claimId: number): Promise<TaxRule[]>;
  deleteTaxRule(id: number): Promise<void>;
```

**Implement in DatabaseStorage:**

```typescript
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
```

### C3. Tax Rule Resolution Helper

**File:** `server/estimateEngine.ts`
**Add** after `deriveCoverageBucket` (added by PROMPT-13):

```typescript
/**
 * Resolves the applicable tax rate for a line item based on its category
 * and the claim's tax rules. Falls back to the policy rule's flat taxRate
 * if no specific tax rules exist.
 *
 * @param category - The line item's category (e.g., "Roofing", "Cleaning")
 * @param taxRules - The claim's tax rules (from taxRules table)
 * @param fallbackRate - The flat rate from policyRules.taxRate (default 8%)
 * @returns The resolved tax rate as a percentage (e.g., 7.25)
 */
export function resolveTaxRate(
  category: string,
  taxRules: Array<{
    taxLabel: string;
    taxRate: number;
    appliesToCategories: string[];
    appliesToCostType: string;
    isDefault: boolean;
  }>,
  fallbackRate: number = 8
): { taxRate: number; taxLabel: string; costType: string } {
  if (!taxRules || taxRules.length === 0) {
    return { taxRate: fallbackRate, taxLabel: "Sales Tax", costType: "all" };
  }

  const catLower = (category || "").toLowerCase();

  // First: look for a category-specific match
  for (const rule of taxRules) {
    const categories = (rule.appliesToCategories || []) as string[];
    if (categories.length > 0) {
      const matches = categories.some(c => catLower.includes(c.toLowerCase()));
      if (matches) {
        return {
          taxRate: rule.taxRate,
          taxLabel: rule.taxLabel,
          costType: rule.appliesToCostType || "all",
        };
      }
    }
  }

  // Fallback: use the default tax rule if one exists
  const defaultRule = taxRules.find(r => r.isDefault);
  if (defaultRule) {
    return {
      taxRate: defaultRule.taxRate,
      taxLabel: defaultRule.taxLabel,
      costType: defaultRule.appliesToCostType || "all",
    };
  }

  // Ultimate fallback: flat rate from policy rule
  return { taxRate: fallbackRate, taxLabel: "Sales Tax", costType: "all" };
}
```

### C4. Update `calculateSettlement` Tax Step

**File:** `server/estimateEngine.ts`
**Modify:** the `calculateSettlement` function (added by PROMPT-13)

Add `taxRules` as an optional third parameter:

```typescript
export function calculateSettlement(
  items: Array<{ /* ... existing shape ... */ }>,
  policyRules: Array<{ /* ... existing shape with opExcludedTrades ... */ }>,
  taxRules: Array<{
    taxLabel: string;
    taxRate: number;
    appliesToCategories: string[];
    appliesToCostType: string;
    isDefault: boolean;
  }> = []                              // ← NEW optional parameter, defaults to empty
): SettlementSummary {
```

In Step 3 & 4 (per-item RCV, tax, depreciation), **replace** the tax calculation line. The current code from PROMPT-13 is:

```typescript
    // Tax on materials portion (applied to totalPrice + O&P share)
    const taxableBase = (item.totalPrice || 0) + itemOP;
    const taxAmount = Math.round(taxableBase * (rule.taxRate / 100) * 100) / 100;
```

**Replace with:**

```typescript
    // Tax — resolve per-category if tax rules exist, otherwise use flat policy rate
    const resolvedTax = resolveTaxRate(item.category, taxRules, rule.taxRate);
    const taxableBase = (item.totalPrice || 0) + itemOP;
    const taxAmount = Math.round(taxableBase * (resolvedTax.taxRate / 100) * 100) / 100;
```

### C5. Update `getSettlementSummary` to Pass Tax Rules

**File:** `server/storage.ts`
**Modify:** the `getSettlementSummary` method (added by PROMPT-13)

After fetching policy rules, also fetch tax rules and pass them through:

```typescript
  async getSettlementSummary(sessionId: number, claimId: number): Promise<SettlementSummary> {
    const items = await this.getLineItems(sessionId);
    const rooms = await this.getRooms(sessionId);
    const rules = await this.getPolicyRulesForClaim(claimId);
    const claimTaxRules = await this.getTaxRulesForClaim(claimId);    // ← NEW

    // ... existing room lookup and item mapping (unchanged) ...

    const policyInput = rules.map(r => ({
      // ... existing mapping with opExcludedTrades ...
    }));

    // Map tax rules for the engine
    const taxInput = claimTaxRules.map(t => ({
      taxLabel: t.taxLabel,
      taxRate: t.taxRate,
      appliesToCategories: (t.appliesToCategories || []) as string[],
      appliesToCostType: t.appliesToCostType || "all",
      isDefault: t.isDefault || false,
    }));

    const { calculateSettlement } = await import("./estimateEngine");
    return calculateSettlement(mapped, policyInput, taxInput);    // ← Pass tax rules
  }
```

### C6. Tax Rules API Endpoints

**File:** `server/routes.ts`

**Add validation schema:**

```typescript
const taxRuleSchema = z.object({
  taxLabel: z.string().min(1).max(50),
  taxRate: z.number().nonnegative(),
  appliesToCategories: z.array(z.string()).default([]),
  appliesToCostType: z.enum(["material", "labor", "all"]).default("all"),
  isDefault: z.boolean().default(false),
});
```

**Add REST endpoints** (after the policy rule endpoints from PROMPT-13):

```typescript
  // ── Tax Rules ──────────────────────────────────

  app.post("/api/claims/:claimId/tax-rules", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(req.params.claimId);
      const parsed = taxRuleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid tax rule data", errors: parsed.error.flatten().fieldErrors });
      }
      const rule = await storage.createTaxRule({ claimId, ...parsed.data });
      res.status(201).json(rule);
    } catch (error: any) {
      console.error("Server error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/claims/:claimId/tax-rules", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(req.params.claimId);
      const rules = await storage.getTaxRulesForClaim(claimId);
      res.json(rules);
    } catch (error: any) {
      console.error("Server error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/claims/:claimId/tax-rules/:ruleId", authenticateRequest, async (req, res) => {
    try {
      const ruleId = parseInt(req.params.ruleId);
      await storage.deleteTaxRule(ruleId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Server error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
```

### C7. Seed Default Tax Rule from Briefing

**Modify** the `ensurePolicyRules` function (added by PROMPT-13, Part F1) to also seed a default tax rule:

```typescript
async function ensurePolicyRules(claimId: number, storage: IStorage) {
  // ... existing policy rule seeding logic (unchanged) ...

  // Also seed a default tax rule if none exist
  const existingTax = await storage.getTaxRulesForClaim(claimId);
  if (existingTax.length === 0) {
    const briefing = await storage.getBriefing(claimId);
    const coverage = briefing?.coverageSnapshot as any;

    await storage.createTaxRule({
      claimId,
      taxLabel: "Sales Tax",
      taxRate: coverage?.taxRate || 8,
      appliesToCategories: [],
      appliesToCostType: "all",
      isDefault: true,
    });
  }

  return existing.length > 0 ? existing : created;
}
```

---

## Part D — Steep Charge by Roof Pitch

### Problem

Roofing steep charges are additional line items that compensate for the difficulty and safety equipment required to work on steep-pitch roofs. The charge varies by pitch range:
- **7/12 to 9/12**: Moderate steep charge (one code/rate)
- **10/12 to 12/12**: High steep charge (higher code/rate)
- **Below 7/12**: No steep charge

The voice agent already captures roof pitch in Phase 3 ("Note pitch, material, layers"), but it doesn't auto-suggest the correct steep charge line item.

### D1. Add Pitch Field to `inspectionRooms`

**File:** `shared/schema.ts`
**Modify:** the `inspectionRooms` table definition (lines 141–154)

Add a new column after `phase` (before line 152):

```typescript
  roofPitch: varchar("roof_pitch", { length: 10 }),
  // Roof pitch as "rise/run" notation, e.g., "7/12", "10/12"
  // Only populated for exterior_roof_slope room types
```

### D2. Update `create_room` Voice Tool

**File:** `server/realtime.ts`
**Modify:** the `create_room` tool in the `realtimeTools` array (lines 104–120)

Add the `roofPitch` parameter to the tool's `properties` object:

```typescript
        roofPitch: { type: "string", description: "Roof pitch as rise/run (e.g., '7/12', '10/12'). Only for roof slope rooms. Used to determine steep charge eligibility." }
```

### D3. Steep Charge Auto-Suggestion in System Instructions

**File:** `server/realtime.ts`
**Modify:** the `buildSystemInstructions` function

After rule 13 (Code Upgrade Detection from Part B3), add:

```typescript

14. **Steep Charge by Roof Pitch:** When creating a roof slope room, always capture the pitch. Steep charges apply as follows:
    - **Below 7/12:** No steep charge — standard roofing labor rates apply.
    - **7/12 to 9/12:** Moderate steep charge. Add a "Steep charge - roofing" line item for the slope's square footage. Typical code: RFG-STEEP-MOD.
    - **10/12 to 12/12:** High steep charge. Add an "Additional steep charge - roofing" line item. Typical code: RFG-STEEP-HIGH.
    - **Above 12/12:** Extreme pitch — may require specialty contractor. Note this and flag for supervisor review.
    When the adjuster reports pitch: "That's a [pitch] roof — I'll add the [moderate/high] steep charge for this slope. How many squares does this slope cover?"
    IMPORTANT: Steep charges are per-slope, not per-roof. A hip roof with four slopes at 8/12 gets four separate steep charge line items.
```

### D4. Update `create_room` Handler for Pitch

In the session manager's `create_room` handler, pass `roofPitch` through to storage:

```typescript
case "create_room": {
  const { name, roomType, structure, length, width, height, phase, roofPitch } = args;

  const room = await storage.createRoom({
    sessionId,
    name,
    roomType: roomType || null,
    structure: structure || session.currentStructure || "Main Dwelling",
    dimensions: (length || width || height)
      ? { length: length || 0, width: width || 0, height: height || 0 }
      : null,
    status: "in_progress",
    phase: phase || null,
    roofPitch: roofPitch || null,    // ← NEW
  });

  // ... existing session room update and response ...
}
```

### D5. Update Room Create API Schema

**File:** `server/routes.ts`
**Modify:** the `roomCreateSchema` (lines 47–53)

Add the new field:

```typescript
const roomCreateSchema = z.object({
  name: z.string().min(1).max(100),
  roomType: z.string().max(50).nullable().optional(),
  structure: z.string().max(100).nullable().optional(),
  dimensions: z.any().optional(),
  phase: z.number().int().positive().nullable().optional(),
  roofPitch: z.string().max(10).nullable().optional(),    // ← NEW
});
```

---

## Part E — Conversation Flow Examples

### E1. Granular O&P Conversation

```
Adjuster: "The carrier says O&P only applies to painting and floor covering, not roofing or siding."
Agent: "Got it — I'll exclude Roofing and Exterior from O&P calculations. Currently 4 trades are on this
        estimate. Painting and Floor Covering will receive 10% overhead and 10% profit. Roofing and Siding
        will not. Does that match the carrier's guidance?"
Adjuster: "Yes, that's right."
Agent: "Noted. This affects the settlement — the net O&P will be lower than a full 3-trade calculation.
        Moving on to the next room."
```

### E2. Code Upgrade Detection

```
Adjuster: "Add ice and water barrier for the eaves and valleys on this slope."
Agent: "Adding Ice & Water Barrier — that's a code upgrade since it wasn't on the original roof.
        I'm marking it as Paid When Incurred. The insured won't receive payment for this $816 item
        until the work is completed and receipts are submitted. Is that correct?"
Adjuster: "Yes, the old roof didn't have it."
Agent: "Confirmed. Added RFG-ICE-SF, 24 SF, Paid When Incurred. Moving on to ridge cap."
```

### E3. Steep Charge Flow

```
Agent: "What's the pitch on this slope?"
Adjuster: "It's a 9/12."
Agent: "That's a 9/12 — I'll add the moderate steep charge for this slope.
        How many squares does the south slope cover?"
Adjuster: "About 12 squares."
Agent: "Added steep charge for 12 squares on the South Slope at 9/12 pitch.
        Let's move to the West Slope."
```

### E4. Multi-Tax Jurisdiction

```
[During Phase 2 — Session Setup]
Agent: "I see from the briefing this property is in Cook County, Illinois. There may be multiple
        tax rates — material sales tax and cleaning tax can differ. Do you have the tax rates from
        the carrier's price list?"
Adjuster: "Material sales tax is 7.25%, cleaning material tax is 6.5%."
Agent: "Got it — I'll apply 7.25% to material items and 6.5% to cleaning-related materials.
        This will be reflected in the settlement breakdown."
```

---

## Verification Checklist

| # | Check | File |
|---|-------|------|
| 1 | `scopeLineItems` table has `opEligibleDefault` boolean column | `shared/schema.ts` |
| 2 | `scopeLineItems` table has `isCodeUpgrade` boolean column | `shared/schema.ts` |
| 3 | `policyRules` table has `opExcludedTrades` jsonb column | `shared/schema.ts` |
| 4 | `taxRules` table exists with all fields (taxLabel, taxRate, appliesToCategories, appliesToCostType, isDefault) | `shared/schema.ts` |
| 5 | `TaxRule` and `InsertTaxRule` types exported | `shared/schema.ts` |
| 6 | `inspectionRooms` table has `roofPitch` varchar column | `shared/schema.ts` |
| 7 | `TradeSubtotal` interface has `opEligible` boolean field | `server/estimateEngine.ts` |
| 8 | `calculateSettlement` checks `opExcludedTrades` per trade before applying O&P | `server/estimateEngine.ts` |
| 9 | `calculateSettlement` accepts optional `taxRules` third parameter | `server/estimateEngine.ts` |
| 10 | `resolveTaxRate` function exported | `server/estimateEngine.ts` |
| 11 | `IStorage` has 3 new tax rule methods (create, get, delete) | `server/storage.ts` |
| 12 | `DatabaseStorage` implements all 3 tax rule methods | `server/storage.ts` |
| 13 | `getSettlementSummary` fetches and passes tax rules to engine | `server/storage.ts` |
| 14 | `policyRuleSchema` includes `opExcludedTrades` | `server/routes.ts` |
| 15 | Tax rule REST endpoints (POST, GET, DELETE) exist | `server/routes.ts` |
| 16 | `roomCreateSchema` includes `roofPitch` | `server/routes.ts` |
| 17 | `create_room` voice tool has `roofPitch` parameter | `server/realtime.ts` |
| 18 | System instructions include O&P trade eligibility rule (12) | `server/realtime.ts` |
| 19 | System instructions include code upgrade detection rule (13) | `server/realtime.ts` |
| 20 | System instructions include steep charge by pitch rule (14) | `server/realtime.ts` |
| 21 | `add_line_item` handler auto-detects code upgrades via catalog | Session manager |
| 22 | `ensurePolicyRules` seeds default tax rule | Session start flow |
| 23 | Seed SQL sets `is_code_upgrade = true` for known code upgrade items | Database seed |

---

## Code References

| Ref | File | Line(s) | Content |
|-----|------|---------|---------|
| R1 | `shared/schema.ts` | 236–249 | Existing `scopeLineItems` table (add `opEligibleDefault`, `isCodeUpgrade` before `isActive`) |
| R2 | `shared/schema.ts` | 141–154 | Existing `inspectionRooms` table (add `roofPitch` after `phase`) |
| R3 | `shared/schema.ts` | PROMPT-13 | `policyRules` table (add `opExcludedTrades` after `taxRate`) |
| R4 | `shared/schema.ts` | After PROMPT-13 tables | Insert point for new `taxRules` table |
| R5 | `server/estimateEngine.ts` | PROMPT-13 | `TradeSubtotal` interface (add `opEligible` field) |
| R6 | `server/estimateEngine.ts` | PROMPT-13 | `calculateSettlement` Step 2 (replace uniform O&P with per-trade selective) |
| R7 | `server/estimateEngine.ts` | PROMPT-13, after `deriveCoverageBucket` | Insert point for `resolveTaxRate` function |
| R8 | `server/estimateEngine.ts` | PROMPT-13 | `calculateSettlement` Step 3 tax line (replace flat rate with `resolveTaxRate`) |
| R9 | `server/storage.ts` | 27–121 | IStorage interface (add tax rule methods) |
| R10 | `server/storage.ts` | PROMPT-13 | `getSettlementSummary` (add tax rule fetch and pass-through) |
| R11 | `server/realtime.ts` | 104–120 | `create_room` tool properties (add `roofPitch` param) |
| R12 | `server/realtime.ts` | 85 / PROMPT-13 | End of system instructions (add rules 12, 13, 14) |
| R13 | `server/routes.ts` | 47–53 | `roomCreateSchema` (add `roofPitch` field) |
| R14 | `server/routes.ts` | PROMPT-13 | `policyRuleSchema` (add `opExcludedTrades` field) |
| R15 | `server/routes.ts` | After PROMPT-13 endpoints | Insert point for tax rule endpoints |

---

## Summary

This prompt adds:
- **3 new columns** on `scopeLineItems` (`opEligibleDefault`, `isCodeUpgrade`, both booleans)
- **1 new column** on `policyRules` (`opExcludedTrades` jsonb array)
- **1 new column** on `inspectionRooms` (`roofPitch` varchar)
- **1 new table** (`taxRules`) with 7 columns
- **3 new IStorage methods** (createTaxRule, getTaxRulesForClaim, deleteTaxRule)
- **3 new REST endpoints** (POST/GET/DELETE tax rules)
- **1 new exported function** (`resolveTaxRate`)
- **1 modified function** (`calculateSettlement` — per-trade O&P exclusion + multi-tax resolution)
- **1 modified interface** (`TradeSubtotal` — `opEligible` field)
- **1 new voice tool parameter** (`roofPitch` on `create_room`)
- **3 new voice agent behavior rules** (O&P eligibility, code upgrade detection, steep charge by pitch)
- **1 modified handler** (`add_line_item` — auto-detect code upgrades from catalog)
- **1 catalog seed update** (mark known code upgrade items)

Total estimated diff: ~350 lines added, ~20 lines modified.
