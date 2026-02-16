# PROMPT 13 — ACV / RCV Settlement Engine & Coverage Logic

## Goal

Build the financial calculation spine that transforms raw line items into a proper insurance settlement breakdown: RCV → O&P → Tax → Depreciation → ACV → Deductible → Net Claim. This mirrors the exact math Xactimate produces, with per-item depreciation tracking, per-trade O&P application, coverage bucket separation, and policy limit enforcement.

Currently the codebase has a simple `calculateEstimateTotals` function that computes material/labor/equipment subtotals with global tax and flat O&P. This prompt replaces that with an Xactimate-accurate pipeline and adds the data model to support per-item depreciation and policy-level rules.

---

## Part A — Schema Changes

### A1. Expand `line_items` Table

**File:** `shared/schema.ts`
**Modify:** the `lineItems` table definition (lines 168–185)

Add these new columns **before** the `createdAt` column (before line 184):

```typescript
  // ── Financial / Depreciation Columns ──────────────
  taxAmount: real("tax_amount").default(0),
  age: real("age"),                                   // Item age in years (e.g., 15.0 for a 15-year-old roof)
  lifeExpectancy: real("life_expectancy"),             // Expected useful life in years (e.g., 30.0 for architectural shingles)
  depreciationPercentage: real("depreciation_pct"),    // Computed or manual override: age/life × 100, capped at 100
  depreciationAmount: real("depreciation_amount"),     // Computed: RCV × depreciationPercentage / 100
  coverageBucket: varchar("coverage_bucket", { length: 20 }).default("Coverage A"),
  // coverageBucket enum: "Coverage A" (dwelling), "Coverage B" (other structures), "Coverage C" (contents)
```

The existing `depreciationType` column (line 181) remains unchanged — it already stores `"Recoverable" | "Non-Recoverable" | "Paid When Incurred"`.

The full `lineItems` table after this change:

```typescript
export const lineItems = pgTable("line_items", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => inspectionSessions.id, { onDelete: "cascade" }),
  roomId: integer("room_id").references(() => inspectionRooms.id, { onDelete: "set null" }),
  damageId: integer("damage_id").references(() => damageObservations.id, { onDelete: "set null" }),
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
  // ── NEW: Financial / Depreciation ──
  taxAmount: real("tax_amount").default(0),
  age: real("age"),
  lifeExpectancy: real("life_expectancy"),
  depreciationPercentage: real("depreciation_pct"),
  depreciationAmount: real("depreciation_amount"),
  coverageBucket: varchar("coverage_bucket", { length: 20 }).default("Coverage A"),
  createdAt: timestamp("created_at").defaultNow(),
});
```

### A2. New `policyRules` Table

**File:** `shared/schema.ts`
**Insert after:** the new `roomOpenings` table from PROMPT-12 (or after `userSettings` if PROMPT-12 hasn't been applied yet)

```typescript
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
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPolicyRuleSchema = createInsertSchema(policyRules).omit({
  id: true,
  createdAt: true,
});

export type PolicyRule = typeof policyRules.$inferSelect;
export type InsertPolicyRule = z.infer<typeof insertPolicyRuleSchema>;
```

### A3. IStorage Interface Updates

**File:** `server/storage.ts`

**Add imports** for the new table and types:

```typescript
import {
  // ... existing ...
  policyRules,
  type PolicyRule, type InsertPolicyRule,
} from "@shared/schema";
```

**Add to IStorage interface** (before closing `}`):

```typescript
  // ── Policy Rules ──────────────────────────
  createPolicyRule(data: InsertPolicyRule): Promise<PolicyRule>;
  getPolicyRulesForClaim(claimId: number): Promise<PolicyRule[]>;
  getPolicyRule(claimId: number, coverageType: string): Promise<PolicyRule | undefined>;
  updatePolicyRule(id: number, updates: Partial<PolicyRule>): Promise<PolicyRule | undefined>;
```

**Implement in DatabaseStorage:**

```typescript
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
```

### A4. API Endpoints for Policy Rules

**File:** `server/routes.ts`

**Add validation schema** (after the existing `openingCreateSchema` or after `roomCreateSchema`):

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
});
```

**Add REST endpoints** (after the existing claim endpoints section):

```typescript
  // ── Policy Rules ───────────────────────────────

  app.post("/api/claims/:claimId/policy-rules", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(req.params.claimId);
      const parsed = policyRuleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid policy rule data", errors: parsed.error.flatten().fieldErrors });
      }
      const rule = await storage.createPolicyRule({ claimId, ...parsed.data });
      res.status(201).json(rule);
    } catch (error: any) {
      console.error("Server error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/claims/:claimId/policy-rules", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(req.params.claimId);
      const rules = await storage.getPolicyRulesForClaim(claimId);
      res.json(rules);
    } catch (error: any) {
      console.error("Server error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/claims/:claimId/policy-rules/:ruleId", authenticateRequest, async (req, res) => {
    try {
      const ruleId = parseInt(req.params.ruleId);
      const rule = await storage.updatePolicyRule(ruleId, req.body);
      res.json(rule);
    } catch (error: any) {
      console.error("Server error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
```

---

## Part B — The Settlement Calculation Engine

### B1. New Interfaces

**File:** `server/estimateEngine.ts`

**Add these interfaces** after the existing `EstimateTotals` interface (after line 36):

```typescript
// ── Settlement Engine Types ──────────────────────────

export interface DepreciatedLineItem {
  id: number;
  description: string;
  category: string;
  tradeCode: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  taxAmount: number;
  rcv: number;                        // totalPrice + taxAmount
  age: number | null;
  lifeExpectancy: number | null;
  depreciationPercentage: number;     // age/life × 100, capped at 100
  depreciationAmount: number;         // rcv × depPct / 100
  acv: number;                        // rcv - depreciationAmount
  depreciationType: string;           // "Recoverable" | "Non-Recoverable" | "Paid When Incurred"
  coverageBucket: string;             // "Coverage A" | "Coverage B" | "Coverage C"
}

export interface TradeSubtotal {
  tradeCode: string;
  subtotal: number;                   // Sum of totalPrice for this trade (before tax)
  overheadAmount: number;
  profitAmount: number;
  tradeRCV: number;                   // subtotal + overhead + profit + tax
}

export interface CoverageSummary {
  coverageType: string;
  totalRCV: number;
  totalRecoverableDepreciation: number;
  totalNonRecoverableDepreciation: number;
  totalDepreciation: number;
  totalACV: number;
  deductible: number;
  policyLimit: number | null;
  netClaim: number;
  overLimitDeduction: number;
  itemCount: number;
}

export interface SettlementSummary {
  // Per-coverage breakdown
  coverages: CoverageSummary[];

  // Grand totals across all coverages
  grandTotalRCV: number;
  grandTotalDepreciation: number;
  grandTotalRecoverableDep: number;
  grandTotalNonRecoverableDep: number;
  grandTotalACV: number;
  grandTotalDeductible: number;
  grandTotalOverLimit: number;
  grandNetClaim: number;              // The check amount

  // O&P detail
  totalOverhead: number;
  totalProfit: number;
  qualifiesForOP: boolean;
  tradesInvolved: string[];

  // Per-trade subtotals
  tradeSubtotals: TradeSubtotal[];

  // Itemized depreciation detail
  depreciatedItems: DepreciatedLineItem[];
}
```

### B2. Coverage Bucket Auto-Derivation

**Add this helper function** after the TRADE_CODES array:

```typescript
/**
 * Auto-derives coverage bucket from a room's structure name.
 * "Main Dwelling" → Coverage A, "Detached Garage" → Coverage B, etc.
 * Returns the override if explicitly set on the line item.
 */
export function deriveCoverageBucket(
  structure: string | null | undefined,
  explicitBucket: string | null | undefined
): string {
  // Explicit override takes priority
  if (explicitBucket && explicitBucket !== "Coverage A") {
    return explicitBucket;
  }

  const s = (structure || "").toLowerCase().trim();

  // Coverage B — Other Structures
  if (
    s.includes("detached") ||
    s.includes("shed") ||
    s.includes("fence") ||
    s.includes("gazebo") ||
    s.includes("pool") ||
    s.includes("barn") ||
    s.includes("carport") ||
    s.includes("pergola")
  ) {
    return "Coverage B";
  }

  // Coverage C — Contents / Personal Property
  if (s.includes("contents") || s.includes("personal property")) {
    return "Coverage C";
  }

  // Default: Coverage A — Dwelling
  return "Coverage A";
}
```

### B3. Per-Item Depreciation Calculator

**Add this function:**

```typescript
/**
 * Calculates depreciation for a single line item.
 *
 * Logic:
 * 1. If age and lifeExpectancy are provided: depPct = min(age/life × 100, 100)
 * 2. If depreciationPercentage is provided (manual override): use that directly
 * 3. If neither: depPct = 0 (no depreciation)
 * 4. If depreciationType is "Paid When Incurred": ACV = 0 (deferred until work done)
 * 5. If applyRoofSchedule is true AND item is roofing: force Non-Recoverable
 */
export function calculateItemDepreciation(
  rcv: number,
  age: number | null,
  lifeExpectancy: number | null,
  depreciationPercentageOverride: number | null,
  depreciationType: string,
  applyRoofSchedule: boolean = false,
  isRoofingItem: boolean = false
): {
  depreciationPercentage: number;
  depreciationAmount: number;
  acv: number;
  effectiveDepType: string;    // May be overridden by roof schedule
} {
  // Determine depreciation percentage
  let depPct: number;
  if (depreciationPercentageOverride != null && depreciationPercentageOverride > 0) {
    depPct = Math.min(depreciationPercentageOverride, 100);
  } else if (age != null && lifeExpectancy != null && lifeExpectancy > 0) {
    depPct = Math.min((age / lifeExpectancy) * 100, 100);
  } else {
    depPct = 0;
  }

  // Determine effective depreciation type
  let effectiveDepType = depreciationType || "Recoverable";
  if (applyRoofSchedule && isRoofingItem) {
    effectiveDepType = "Non-Recoverable";
  }

  // Calculate amounts
  const depreciationAmount = rcv * (depPct / 100);

  // Paid When Incurred: RCV is counted, but ACV is $0 until work is performed
  const acv = effectiveDepType === "Paid When Incurred"
    ? 0
    : rcv - depreciationAmount;

  return {
    depreciationPercentage: Math.round(depPct * 100) / 100,
    depreciationAmount: Math.round(depreciationAmount * 100) / 100,
    acv: Math.round(Math.max(0, acv) * 100) / 100,
    effectiveDepType,
  };
}
```

### B4. The Full Settlement Calculator

**Replace** the existing `calculateEstimateTotals` function (lines 124–178) with:

```typescript
/**
 * Calculates the full settlement summary from line items and policy rules.
 *
 * ORDER OF OPERATIONS (matches Xactimate):
 * 1. Group items by trade code
 * 2. For each trade: subtotal, then apply O&P (overhead + profit)
 * 3. Per-item: add tax → gives RCV
 * 4. Per-item: calculate depreciation from age/life → gives ACV
 * 5. Group by coverage bucket
 * 6. Per-coverage: sum ACV, subtract deductible → Net Claim
 * 7. Check policy limits → Over Limit Deduction
 * 8. Grand totals across all coverages → The Check Amount
 */
export function calculateSettlement(
  items: Array<{
    id: number;
    description: string;
    category: string;
    tradeCode: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    age: number | null;
    lifeExpectancy: number | null;
    depreciationPercentage: number | null;
    depreciationType: string;
    coverageBucket: string;
    structure: string | null;
  }>,
  policyRules: Array<{
    coverageType: string;
    policyLimit: number | null;
    deductible: number | null;
    applyRoofSchedule: boolean;
    overheadPct: number;
    profitPct: number;
    taxRate: number;
  }>
): SettlementSummary {
  // Default policy rule if none provided
  const defaultRule = {
    coverageType: "Coverage A",
    policyLimit: null,
    deductible: 0,
    applyRoofSchedule: false,
    overheadPct: 10,
    profitPct: 10,
    taxRate: 8,
  };

  const ruleMap = new Map(policyRules.map(r => [r.coverageType, r]));

  // ── Step 1: Group items by trade code for O&P calculation ──
  const tradeGroups = new Map<string, typeof items>();
  const tradesSet = new Set<string>();

  for (const item of items) {
    tradesSet.add(item.tradeCode);
    const existing = tradeGroups.get(item.tradeCode) || [];
    existing.push(item);
    tradeGroups.set(item.tradeCode, existing);
  }

  const tradesInvolved = Array.from(tradesSet);
  const qualifiesForOP = tradesInvolved.length >= 3;

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

  const totalOverhead = tradeSubtotals.reduce((s, t) => s + t.overheadAmount, 0);
  const totalProfit = tradeSubtotals.reduce((s, t) => s + t.profitAmount, 0);

  // ── Step 3 & 4: Per-item RCV, tax, depreciation ──
  // Distribute O&P proportionally across items within each trade
  const depreciatedItems: DepreciatedLineItem[] = items.map(item => {
    const tradeTotal = tradeSubtotals.find(t => t.tradeCode === item.tradeCode);
    const tradeSubtotal = tradeTotal?.subtotal || 1;

    // Item's share of O&P (proportional to its share of trade subtotal)
    const itemShare = (item.totalPrice || 0) / (tradeSubtotal || 1);
    const itemOP = qualifiesForOP
      ? (tradeTotal?.overheadAmount || 0) * itemShare + (tradeTotal?.profitAmount || 0) * itemShare
      : 0;

    // Get policy rule for this item's coverage bucket
    const bucket = deriveCoverageBucket(item.structure, item.coverageBucket);
    const rule = ruleMap.get(bucket) || defaultRule;

    // Tax on materials portion (applied to totalPrice + O&P share)
    const taxableBase = (item.totalPrice || 0) + itemOP;
    const taxAmount = Math.round(taxableBase * (rule.taxRate / 100) * 100) / 100;

    // RCV = totalPrice + O&P share + tax
    const rcv = Math.round(((item.totalPrice || 0) + itemOP + taxAmount) * 100) / 100;

    // Depreciation
    const isRoofing = (item.category || "").toLowerCase().includes("roof") ||
                      (item.tradeCode || "").toUpperCase() === "RFG";

    const dep = calculateItemDepreciation(
      rcv,
      item.age,
      item.lifeExpectancy,
      item.depreciationPercentage,
      item.depreciationType,
      rule.applyRoofSchedule,
      isRoofing
    );

    return {
      id: item.id,
      description: item.description,
      category: item.category,
      tradeCode: item.tradeCode,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice || 0,
      taxAmount,
      rcv,
      age: item.age,
      lifeExpectancy: item.lifeExpectancy,
      depreciationPercentage: dep.depreciationPercentage,
      depreciationAmount: dep.depreciationAmount,
      acv: dep.acv,
      depreciationType: dep.effectiveDepType,
      coverageBucket: bucket,
    };
  });

  // ── Step 5 & 6: Group by coverage, apply deductible ──
  const coverageMap = new Map<string, DepreciatedLineItem[]>();
  for (const item of depreciatedItems) {
    const existing = coverageMap.get(item.coverageBucket) || [];
    existing.push(item);
    coverageMap.set(item.coverageBucket, existing);
  }

  const coverages: CoverageSummary[] = [];

  for (const [coverageType, covItems] of coverageMap) {
    const rule = ruleMap.get(coverageType) || defaultRule;

    const totalRCV = covItems.reduce((s, i) => s + i.rcv, 0);
    const totalRecDep = covItems
      .filter(i => i.depreciationType === "Recoverable")
      .reduce((s, i) => s + i.depreciationAmount, 0);
    const totalNonRecDep = covItems
      .filter(i => i.depreciationType === "Non-Recoverable")
      .reduce((s, i) => s + i.depreciationAmount, 0);
    const totalPWIDep = covItems
      .filter(i => i.depreciationType === "Paid When Incurred")
      .reduce((s, i) => s + i.rcv, 0);  // Full RCV is "held" for PWI items

    const totalDepreciation = totalRecDep + totalNonRecDep;
    const totalACV = totalRCV - totalDepreciation - totalPWIDep;
    const deductible = rule.deductible || 0;

    // Net Claim before limit check
    let netClaim = Math.max(totalACV - deductible, 0);

    // Policy limit check
    let overLimitDeduction = 0;
    if (rule.policyLimit != null && netClaim > rule.policyLimit) {
      overLimitDeduction = netClaim - rule.policyLimit;
      netClaim = rule.policyLimit;
    }

    coverages.push({
      coverageType,
      totalRCV: Math.round(totalRCV * 100) / 100,
      totalRecoverableDepreciation: Math.round(totalRecDep * 100) / 100,
      totalNonRecoverableDepreciation: Math.round(totalNonRecDep * 100) / 100,
      totalDepreciation: Math.round(totalDepreciation * 100) / 100,
      totalACV: Math.round(Math.max(totalACV, 0) * 100) / 100,
      deductible,
      policyLimit: rule.policyLimit,
      netClaim: Math.round(netClaim * 100) / 100,
      overLimitDeduction: Math.round(overLimitDeduction * 100) / 100,
      itemCount: covItems.length,
    });
  }

  // ── Step 7: Grand totals ──
  const grandTotalRCV = coverages.reduce((s, c) => s + c.totalRCV, 0);
  const grandTotalRecDep = coverages.reduce((s, c) => s + c.totalRecoverableDepreciation, 0);
  const grandTotalNonRecDep = coverages.reduce((s, c) => s + c.totalNonRecoverableDepreciation, 0);
  const grandTotalDep = coverages.reduce((s, c) => s + c.totalDepreciation, 0);
  const grandTotalACV = coverages.reduce((s, c) => s + c.totalACV, 0);
  const grandTotalDeductible = coverages.reduce((s, c) => s + c.deductible, 0);
  const grandTotalOverLimit = coverages.reduce((s, c) => s + c.overLimitDeduction, 0);
  const grandNetClaim = coverages.reduce((s, c) => s + c.netClaim, 0);

  return {
    coverages,
    grandTotalRCV: Math.round(grandTotalRCV * 100) / 100,
    grandTotalDepreciation: Math.round(grandTotalDep * 100) / 100,
    grandTotalRecoverableDep: Math.round(grandTotalRecDep * 100) / 100,
    grandTotalNonRecoverableDep: Math.round(grandTotalNonRecDep * 100) / 100,
    grandTotalACV: Math.round(grandTotalACV * 100) / 100,
    grandTotalDeductible: Math.round(grandTotalDeductible * 100) / 100,
    grandTotalOverLimit: Math.round(grandTotalOverLimit * 100) / 100,
    grandNetClaim: Math.round(grandNetClaim * 100) / 100,
    totalOverhead: Math.round(totalOverhead * 100) / 100,
    totalProfit: Math.round(totalProfit * 100) / 100,
    qualifiesForOP,
    tradesInvolved,
    tradeSubtotals,
    depreciatedItems,
  };
}
```

**IMPORTANT:** Keep the existing `calculateEstimateTotals` function as-is for backward compatibility. The new `calculateSettlement` is an enhanced parallel. Existing code that calls `calculateEstimateTotals` continues to work. New features should use `calculateSettlement`.

### B5. Backward-Compatible Wrapper

To bridge old callers, add a wrapper that produces the old `EstimateTotals` shape from the new engine:

```typescript
/**
 * Backward-compatible wrapper: runs calculateSettlement and maps to old EstimateTotals shape.
 * Use this as a drop-in replacement where calculateEstimateTotals was called.
 */
export function calculateEstimateTotalsV2(
  pricedItems: PricedLineItem[],
  policyRules: Array<{
    coverageType: string;
    policyLimit: number | null;
    deductible: number | null;
    applyRoofSchedule: boolean;
    overheadPct: number;
    profitPct: number;
    taxRate: number;
  }> = []
): EstimateTotals & { settlement: SettlementSummary } {
  // Map PricedLineItem to the shape calculateSettlement expects
  const mapped = pricedItems.map((item, idx) => ({
    id: idx,
    description: item.description,
    category: item.tradeCode,      // best approximation
    tradeCode: item.tradeCode,
    quantity: item.quantity,
    unitPrice: item.unitPriceBreakdown.unitPrice,
    totalPrice: item.totalPrice,
    age: null as number | null,
    lifeExpectancy: null as number | null,
    depreciationPercentage: null as number | null,
    depreciationType: "Recoverable",
    coverageBucket: "Coverage A",
    structure: null as string | null,
  }));

  const settlement = calculateSettlement(mapped, policyRules);

  // Reconstruct old shape
  let subtotalMaterial = 0, subtotalLabor = 0, subtotalEquipment = 0;
  for (const item of pricedItems) {
    subtotalMaterial += item.unitPriceBreakdown.materialCost * item.quantity;
    subtotalLabor += item.unitPriceBreakdown.laborCost * item.quantity;
    subtotalEquipment += item.unitPriceBreakdown.equipmentCost * item.quantity;
  }
  const subtotal = subtotalMaterial + subtotalLabor + subtotalEquipment;
  const wasteIncluded = pricedItems.reduce((sum, item) => {
    const wf = item.unitPriceBreakdown.wasteFactor;
    if (wf <= 0) return sum;
    const basePrice = (item.unitPriceBreakdown.materialCost / (1 + wf / 100) +
                       item.unitPriceBreakdown.laborCost / (1 + wf / 100) +
                       item.unitPriceBreakdown.equipmentCost / (1 + wf / 100)) * item.quantity;
    return sum + (item.totalPrice - basePrice);
  }, 0);

  return {
    subtotalMaterial,
    subtotalLabor,
    subtotalEquipment,
    subtotal,
    taxAmount: settlement.grandTotalRCV - settlement.tradeSubtotals.reduce((s, t) => s + t.tradeRCV, 0) + settlement.tradeSubtotals.reduce((s, t) => s + t.overheadAmount + t.profitAmount, 0),
    wasteIncluded,
    grandTotal: settlement.grandTotalRCV,
    tradesInvolved: settlement.tradesInvolved,
    qualifiesForOP: settlement.qualifiesForOP,
    overheadAmount: settlement.totalOverhead,
    profitAmount: settlement.totalProfit,
    totalWithOP: settlement.grandTotalRCV,
    settlement,
  };
}
```

---

## Part C — Voice Agent Integration

### C1. Update `add_line_item` Tool Definition

**File:** `server/realtime.ts`

In the existing `add_line_item` tool (within the `realtimeTools` array), add these new optional parameters to the `properties` object:

```typescript
        age: { type: "number", description: "Age of the item in years (e.g., 15 for a 15-year-old roof). Used to calculate depreciation." },
        lifeExpectancy: { type: "number", description: "Expected useful life in years (e.g., 30 for architectural shingles, 20 for 3-tab). Used with age to calculate depreciation percentage." },
        coverageBucket: { type: "string", enum: ["Coverage A", "Coverage B", "Coverage C"], description: "Override coverage assignment. Auto-derived from structure if not set. A=Dwelling, B=Other Structures, C=Contents." }
```

### C2. Add Depreciation Awareness to System Instructions

**File:** `server/realtime.ts`

In the `buildSystemInstructions` function, add a new behavior rule after item 8 ("Keep It Conversational") at line 85. Insert before the closing backtick:

```typescript

9. **Depreciation Capture:** When adding a line item for a material with significant age, ask for the item's age to calculate depreciation accurately:
   - Roof: "How old is this roof?" → sets age. Life expectancy defaults: 3-tab = 20 years, architectural/laminated = 30 years, metal = 50 years.
   - Siding: "How old is the siding?" → vinyl = 30 years, wood = 25 years, fiber cement = 40 years.
   - HVAC: "How old is the unit?" → 15 years typical.
   - Flooring: Carpet = 10 years, hardwood = 25 years, tile = 30 years.
   If the adjuster doesn't know the age, make your best estimate from the property profile in the briefing and note it. Age is CRITICAL for determining the check amount — don't skip it for major items.

10. **Coverage Bucket Awareness:** Items are auto-assigned coverage based on the current structure:
    - Main Dwelling → Coverage A
    - Detached structures (garage, shed, fence, gazebo) → Coverage B
    - Contents/personal property → Coverage C
    The adjuster can override this. Alert them if you detect a bucket mismatch (e.g., "You're adding items to the Detached Garage — these will fall under Coverage B with a separate deductible. Is that correct?")

11. **Roof Payment Schedule:** If the briefing indicates a Roof Payment Schedule endorsement, ask: "The policy has a roof payment schedule. How old is the roof?" If the roof age exceeds the schedule threshold, depreciation becomes NON-RECOVERABLE — the insured will NOT get that money back upon completion. Inform the adjuster: "With a [age]-year-old roof and the payment schedule, depreciation of [amount] is non-recoverable."
```

### C3. Handle `add_line_item` with Financial Fields

In the session manager's `add_line_item` handler, when creating the line item, include the new financial fields:

```typescript
case "add_line_item": {
  // ... existing room resolution logic ...

  const {
    category, action, description, catalogCode, quantity, unit, unitPrice,
    wasteFactor, depreciationType,
    age, lifeExpectancy, coverageBucket   // ← NEW from voice tool
  } = args;

  // Auto-derive coverage bucket from current structure if not explicit
  const session = await storage.getInspectionSession(sessionId);
  const room = session?.currentRoomId ? await storage.getRoom(session.currentRoomId) : null;
  const effectiveBucket = deriveCoverageBucket(room?.structure, coverageBucket);

  const item = await storage.createLineItem({
    sessionId,
    roomId: room?.id || null,
    // ... existing fields ...
    category,
    action: action || null,
    description,
    xactCode: catalogCode || null,
    quantity: quantity || 1,
    unit: unit || "EA",
    unitPrice: unitPrice || 0,
    totalPrice: (unitPrice || 0) * (quantity || 1),
    depreciationType: depreciationType || "Recoverable",
    wasteFactor: wasteFactor || null,
    // ── NEW financial fields ──
    age: age || null,
    lifeExpectancy: lifeExpectancy || null,
    coverageBucket: effectiveBucket,
  });

  // ... existing confirmation response ...
}
```

---

## Part D — PDF Report Enhancement

### D1. Update PDFReportData Interface

**File:** `server/pdfGenerator.ts`

**Replace** the `estimate` field in `PDFReportData` (lines 13–23) with:

```typescript
  estimate: {
    totalRCV: number;
    totalDepreciation: number;
    totalACV: number;
    itemCount: number;
    categories: Array<{
      category: string;
      subtotal: number;
      items: LineItem[];
    }>;
    // ── NEW: Settlement details ──
    recoverableDepreciation?: number;
    nonRecoverableDepreciation?: number;
    deductible?: number;
    netClaim?: number;
    overheadAmount?: number;
    profitAmount?: number;
    qualifiesForOP?: boolean;
    coverageBreakdown?: Array<{
      coverageType: string;
      totalRCV: number;
      totalACV: number;
      deductible: number;
      netClaim: number;
    }>;
  };
```

### D2. Update Estimate Summary Rendering

**File:** `server/pdfGenerator.ts`

In the `renderEstimateSummary` function (starting at line 266), **replace** the totals box section (lines 301–324) with an expanded version:

```typescript
  // Totals box — expanded with full settlement breakdown
  yPos += 10;
  const boxHeight = data.estimate.netClaim != null ? 160 : 80;
  doc.rect(40, yPos, doc.page.width - 80, boxHeight).fill(COLORS.lightGray);

  // RCV
  doc.font(FONTS.normal, 10).fill(COLORS.darkGray)
    .text("RCV (Replacement Cost Value):", 50, yPos + 10);
  doc.font(FONTS.bold, 12).fill(COLORS.deep)
    .text(`$${data.estimate.totalRCV.toFixed(2)}`, 400, yPos + 10, { align: "right" });

  // O&P (if applicable)
  let lineY = yPos + 26;
  if (data.estimate.qualifiesForOP && data.estimate.overheadAmount) {
    doc.font(FONTS.normal, 9).fill(COLORS.darkGray)
      .text(`  Includes O&P: $${(data.estimate.overheadAmount + (data.estimate.profitAmount || 0)).toFixed(2)} (OH: $${data.estimate.overheadAmount.toFixed(2)} + Profit: $${(data.estimate.profitAmount || 0).toFixed(2)})`, 50, lineY);
    lineY += 14;
  }

  // Depreciation breakdown
  doc.font(FONTS.normal, 10).fill(COLORS.darkGray)
    .text("Total Depreciation:", 50, lineY);
  doc.font(FONTS.bold, 12).fill(COLORS.deep)
    .text(`-$${data.estimate.totalDepreciation.toFixed(2)}`, 400, lineY, { align: "right" });
  lineY += 16;

  if (data.estimate.recoverableDepreciation != null) {
    doc.font(FONTS.normal, 9).fill(COLORS.darkGray)
      .text(`  Recoverable (holdback): ($${data.estimate.recoverableDepreciation.toFixed(2)})`, 50, lineY);
    lineY += 12;
    doc.font(FONTS.normal, 9).fill(COLORS.darkGray)
      .text(`  Non-Recoverable: <$${(data.estimate.nonRecoverableDepreciation || 0).toFixed(2)}>`, 50, lineY);
    lineY += 14;
  }

  // ACV
  doc.font(FONTS.bold, 11).fill(COLORS.primary)
    .text("ACV (Actual Cash Value):", 50, lineY);
  doc.font(FONTS.bold, 14).fill(COLORS.gold)
    .text(`$${data.estimate.totalACV.toFixed(2)}`, 400, lineY, { align: "right" });
  lineY += 18;

  // Deductible and Net Claim
  if (data.estimate.deductible != null) {
    doc.font(FONTS.normal, 10).fill(COLORS.darkGray)
      .text("Less Deductible:", 50, lineY);
    doc.font(FONTS.bold, 12).fill(COLORS.deep)
      .text(`-$${data.estimate.deductible.toFixed(2)}`, 400, lineY, { align: "right" });
    lineY += 16;
  }

  if (data.estimate.netClaim != null) {
    doc.moveTo(50, lineY).lineTo(doc.page.width - 50, lineY).stroke(COLORS.gold);
    lineY += 6;
    doc.font(FONTS.bold, 12).fill(COLORS.primary)
      .text("NET CLAIM (Check Amount):", 50, lineY);
    doc.font(FONTS.bold, 16).fill(COLORS.gold)
      .text(`$${data.estimate.netClaim.toFixed(2)}`, 400, lineY, { align: "right" });
  }
```

---

## Part E — Updating `getEstimateSummary` in IStorage

### E1. Enhanced Summary Method

The existing `getEstimateSummary` in `IStorage` returns `{ totalRCV, totalDepreciation, totalACV, itemCount }`. Add a parallel method that returns the full settlement:

**File:** `server/storage.ts`

**Add to IStorage interface:**

```typescript
  getSettlementSummary(sessionId: number, claimId: number): Promise<SettlementSummary>;
```

**Implement in DatabaseStorage:**

```typescript
  async getSettlementSummary(sessionId: number, claimId: number): Promise<SettlementSummary> {
    const items = await this.getLineItems(sessionId);
    const rooms = await this.getRooms(sessionId);
    const rules = await this.getPolicyRulesForClaim(claimId);

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
        quantity: item.quantity || 0,
        unitPrice: item.unitPrice || 0,
        totalPrice: item.totalPrice || 0,
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
    }));

    // Import and call the settlement engine
    const { calculateSettlement } = await import("./estimateEngine");
    return calculateSettlement(mapped, policyInput);
  }
```

---

## Part F — Seeding Default Policy Rules

### F1. Auto-Create Policy Rules from Briefing

When an inspection session starts (or when policy rules are first needed), auto-create default coverage rules from the briefing's `coverageSnapshot`. Add this logic to the session creation flow:

```typescript
// In the session-start handler or route:
async function ensurePolicyRules(claimId: number, storage: IStorage) {
  const existing = await storage.getPolicyRulesForClaim(claimId);
  if (existing.length > 0) return existing;

  // Seed from briefing
  const briefing = await storage.getBriefing(claimId);
  const coverage = briefing?.coverageSnapshot as any;

  const rules: InsertPolicyRule[] = [];

  // Coverage A — Dwelling
  rules.push({
    claimId,
    coverageType: "Coverage A",
    policyLimit: coverage?.coverageA?.limit || null,
    deductible: coverage?.deductible || 1000,
    applyRoofSchedule: coverage?.roofSchedule?.applies || false,
    roofScheduleAge: coverage?.roofSchedule?.ageThreshold || null,
    overheadPct: 10,
    profitPct: 10,
    taxRate: 8,
  });

  // Coverage B — Other Structures (if present)
  if (coverage?.coverageB) {
    rules.push({
      claimId,
      coverageType: "Coverage B",
      policyLimit: coverage.coverageB.limit || null,
      deductible: coverage.coverageB.deductible || coverage?.deductible || 0,
      applyRoofSchedule: false,
      overheadPct: 10,
      profitPct: 10,
      taxRate: 8,
    });
  }

  // Coverage C — Contents (if present)
  if (coverage?.coverageC) {
    rules.push({
      claimId,
      coverageType: "Coverage C",
      policyLimit: coverage.coverageC.limit || null,
      deductible: 0,
      applyRoofSchedule: false,
      overheadPct: 10,
      profitPct: 10,
      taxRate: 8,
    });
  }

  const created = [];
  for (const rule of rules) {
    created.push(await storage.createPolicyRule(rule));
  }
  return created;
}
```

---

## Verification Checklist

| # | Check | File |
|---|-------|------|
| 1 | `lineItems` table has 6 new columns (taxAmount, age, lifeExpectancy, depreciationPercentage, depreciationAmount, coverageBucket) | `shared/schema.ts` |
| 2 | `policyRules` table exists with all fields | `shared/schema.ts` |
| 3 | `PolicyRule` and `InsertPolicyRule` types exported | `shared/schema.ts` |
| 4 | `IStorage` has 4 new policy rule methods | `server/storage.ts` |
| 5 | `DatabaseStorage` implements all 4 | `server/storage.ts` |
| 6 | `getSettlementSummary` method on IStorage and DatabaseStorage | `server/storage.ts` |
| 7 | `calculateItemDepreciation` function exported | `server/estimateEngine.ts` |
| 8 | `deriveCoverageBucket` function exported | `server/estimateEngine.ts` |
| 9 | `calculateSettlement` function exported with SettlementSummary return | `server/estimateEngine.ts` |
| 10 | `calculateEstimateTotalsV2` backward-compatible wrapper exported | `server/estimateEngine.ts` |
| 11 | Original `calculateEstimateTotals` preserved (not deleted) | `server/estimateEngine.ts` |
| 12 | Policy rule REST endpoints (POST, GET, PATCH) | `server/routes.ts` |
| 13 | `add_line_item` voice tool has age, lifeExpectancy, coverageBucket params | `server/realtime.ts` |
| 14 | System instructions include depreciation capture, coverage bucket, roof schedule rules | `server/realtime.ts` |
| 15 | PDF estimate summary shows recoverable/non-recoverable depreciation split | `server/pdfGenerator.ts` |
| 16 | PDF estimate summary shows deductible and net claim | `server/pdfGenerator.ts` |
| 17 | `ensurePolicyRules` seeds from briefing coverageSnapshot | Session start flow |
| 18 | `drizzle-kit push` creates `policy_rules` table and updates `line_items` | Database |

---

## Code References

| Ref | File | Line(s) | Content |
|-----|------|---------|---------|
| R1 | `shared/schema.ts` | 168–185 | Existing `lineItems` table (add new columns before createdAt) |
| R2 | `shared/schema.ts` | 181 | Existing `depreciationType` varchar (keep as-is) |
| R3 | `shared/schema.ts` | 266 | `insertLineItemSchema` (auto-picks up new columns) |
| R4 | `server/estimateEngine.ts` | 5–36 | Existing interfaces (insert new interfaces after) |
| R5 | `server/estimateEngine.ts` | 38–54 | TRADE_CODES array (insert helpers after) |
| R6 | `server/estimateEngine.ts` | 124–178 | Existing `calculateEstimateTotals` (KEEP, add new functions alongside) |
| R7 | `server/storage.ts` | 27–121 | IStorage interface (add policy rule + settlement methods) |
| R8 | `server/realtime.ts` | 150–168 | `add_line_item` tool properties (add age/life/coverage params) |
| R9 | `server/realtime.ts` | 85 | End of system instructions (add depreciation/coverage rules) |
| R10 | `server/pdfGenerator.ts` | 5–25 | `PDFReportData` interface (expand estimate field) |
| R11 | `server/pdfGenerator.ts` | 301–324 | Estimate summary totals box (replace with expanded version) |
| R12 | `server/routes.ts` | 47–53 | Schema definition area (add policyRuleSchema) |

---

## Summary

This prompt adds:
- **6 new columns** on `line_items` (taxAmount, age, lifeExpectancy, depreciationPercentage, depreciationAmount, coverageBucket)
- **1 new table** (`policy_rules`) with 9 columns
- **5 new IStorage methods** (4 policy CRUD + getSettlementSummary)
- **3 new REST endpoints** (POST/GET/PATCH policy rules)
- **4 new exported functions** (calculateItemDepreciation, deriveCoverageBucket, calculateSettlement, calculateEstimateTotalsV2)
- **3 new voice agent behaviors** (depreciation capture, coverage bucket awareness, roof schedule alerts)
- **3 new `add_line_item` parameters** (age, lifeExpectancy, coverageBucket)
- **Enhanced PDF output** with full settlement breakdown (recoverable/non-recoverable split, deductible, net claim)
- **Auto-seeding** of policy rules from briefing coverage data

Total estimated diff: ~650 lines added, ~30 lines modified.
