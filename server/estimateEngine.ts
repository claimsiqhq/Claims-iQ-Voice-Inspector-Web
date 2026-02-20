import { scopeLineItems, regionalPriceSets } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import type { SettlementRules } from "./settlementRules";
import {
  calculateTaxableBase,
  calculateDepreciationBasis,
  resolveTaxRateWithRules,
  tradeQualifiesForOP,
  validateSettlementRules,
  getDefaultSettlementRules,
} from "./settlementRules";

// ── Xactimate DIM_VARS: 14 calculated dimension variables ──
export interface DimVarsResult {
  HH: number;
  SH: number;
  W: number;
  W_NET?: number;  // Wall area after opening deductions
  LW: number;
  SW: number;
  PF: number;
  PC: number;
  C: number;
  F: number;
  LL: number;
  R: number;
  SQ: number;
  V: number;
}

export interface RoomDimensions {
  length: number;
  width: number;
  height: number;
  wallThickness?: number;
  orientation?: number;
  isExterior?: boolean;
  elevationType?: "box" | "elevation";
  ceilingType?: "flat" | "cathedral" | "tray" | "vaulted";
}

export interface OpeningData {
  openingType: string;
  widthFt: number;
  heightFt: number;
  quantity: number;
  opensInto: string | null;
  goesToFloor: boolean;
  goesToCeiling: boolean;
}

export function calculateDimVars(
  dims: RoomDimensions,
  openings: OpeningData[] = []
): { beforeMW: DimVarsResult; afterMW: DimVarsResult } {

  const L = dims.length;
  const W = dims.width;
  const H = dims.height || 8;

  const longDim = Math.max(L, W);
  const shortDim = Math.min(L, W);

  const heightInches = H * 12;

  const beforeMW: DimVarsResult = {
    HH: heightInches,
    SH: heightInches,
    W: 2 * (L * H + W * H),
    LW: 2 * (longDim * H),
    SW: 2 * (shortDim * H),
    PF: 2 * (L + W),
    PC: 2 * (L + W),
    C: L * W,
    F: L * W,
    LL: longDim,
    R: 0,
    SQ: 0,
    V: L * W * H,
  };

  if (dims.ceilingType === "cathedral") {
    beforeMW.V = L * W * H * 1.25;
  }

  const afterMW: DimVarsResult = { ...beforeMW };

  let totalOpeningAreaSF = 0;
  let totalOpeningWidthLF = 0;

  for (const opening of openings) {
    const count = opening.quantity || 1;
    const openingWidthFt = opening.widthFt;
    const openingHeightFt = opening.heightFt;
    const openingAreaSF = openingWidthFt * openingHeightFt * count;
    const openingWidthTotalLF = openingWidthFt * count;

    totalOpeningAreaSF += openingAreaSF;
    totalOpeningWidthLF += openingWidthTotalLF;

    if (opening.goesToFloor) {
      afterMW.PF -= openingWidthTotalLF;
    }
  }

  afterMW.W = Math.max(0, beforeMW.W - totalOpeningAreaSF);
  afterMW.W_NET = afterMW.W; // Net wall area after opening deductions
  afterMW.PF = Math.max(0, beforeMW.PF - totalOpeningWidthLF);

  const longWallRatio = beforeMW.LW / (beforeMW.LW + beforeMW.SW || 1);
  afterMW.LW = Math.max(0, beforeMW.LW - totalOpeningAreaSF * longWallRatio);
  afterMW.SW = Math.max(0, beforeMW.SW - totalOpeningAreaSF * (1 - longWallRatio));

  const r2 = (n: number) => Math.round(n * 100) / 100;
  for (const key of Object.keys(afterMW) as Array<keyof DimVarsResult>) {
    const afterValue = afterMW[key];
    if (typeof afterValue === "number") {
      afterMW[key] = r2(afterValue);
    }
    const beforeValue = beforeMW[key];
    if (typeof beforeValue === "number") {
      beforeMW[key] = r2(beforeValue);
    }
  }

  return { beforeMW, afterMW };
}

export function calculateElevationDimVars(
  elevationLengthFt: number,
  elevationHeightFt: number,
  openings: OpeningData[] = []
): { beforeMW: DimVarsResult; afterMW: DimVarsResult } {

  const L = elevationLengthFt;
  const H = elevationHeightFt;
  const heightInches = H * 12;

  const beforeMW: DimVarsResult = {
    HH: heightInches,
    SH: heightInches,
    W: L * H,
    LW: L * H,
    SW: 0,
    PF: L,
    PC: L,
    C: 0,
    F: 0,
    LL: L,
    R: 0,
    SQ: 0,
    V: 0,
  };

  const afterMW: DimVarsResult = { ...beforeMW };

  let totalOpeningAreaSF = 0;
  let totalOpeningWidthLF = 0;

  for (const opening of openings) {
    const count = opening.quantity || 1;
    totalOpeningAreaSF += opening.widthFt * opening.heightFt * count;
    totalOpeningWidthLF += opening.widthFt * count;
    if (opening.goesToFloor) {
      afterMW.PF -= opening.widthFt * count;
    }
  }

  afterMW.W = Math.max(0, beforeMW.W - totalOpeningAreaSF);
  afterMW.W_NET = afterMW.W;
  afterMW.LW = afterMW.W;
  afterMW.PF = Math.max(0, beforeMW.PF - totalOpeningWidthLF);

  const r2 = (n: number) => Math.round(n * 100) / 100;
  for (const key of Object.keys(afterMW) as Array<keyof DimVarsResult>) {
    const afterValue = afterMW[key];
    if (typeof afterValue === "number") {
      afterMW[key] = r2(afterValue);
    }
    const beforeValue = beforeMW[key];
    if (typeof beforeValue === "number") {
      beforeMW[key] = r2(beforeValue);
    }
  }

  return { beforeMW, afterMW };
}

function escapeXmlVal(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function generateSubroomXml(
  roomName: string,
  dims: RoomDimensions,
  openings: OpeningData[]
): string {
  const isElevation = dims.elevationType === "elevation" ||
    roomName.toLowerCase().includes("elevation") ||
    roomName.toLowerCase().includes("siding");

  let dimVarsResult: { beforeMW: DimVarsResult; afterMW: DimVarsResult };
  let subroomType: string;
  let printableDims: string;
  let xpertVarsXml: string;

  if (isElevation) {
    subroomType = "Elevation";
    dimVarsResult = calculateElevationDimVars(dims.length, dims.height || 8, openings);
    printableDims = `${dims.length}' x ${dims.height || 8}' x 0"`;
    xpertVarsXml = `
    <XPERT_VARS>
      <XPERT_VAR name="ELLENGTH" type="Numeric" value="${dims.length * 12}"/>
      <XPERT_VAR name="ELHEIGHT" type="Numeric" value="${(dims.height || 8) * 12}"/>
      <XPERT_VAR name="GBLHEIGHT" type="Numeric" value="${(dims.height || 8) * 12}"/>
    </XPERT_VARS>`;
  } else {
    subroomType = "Box";
    dimVarsResult = calculateDimVars(dims, openings);
    printableDims = `${dims.length}' x ${dims.width}' x ${dims.height || 8}'`;
    xpertVarsXml = `
    <XPERT_VARS>
      <XPERT_VAR name="ROOMHEIGHT" type="Numeric" value="${(dims.height || 8) * 12}"/>
      <XPERT_VAR name="ROOMLENGTH" type="Numeric" value="${dims.length * 12}"/>
      <XPERT_VAR name="ROOMWIDTH" type="Numeric" value="${dims.width * 12}"/>
    </XPERT_VARS>`;
  }

  const { beforeMW, afterMW } = dimVarsResult;

  const dimVarsAttrs = (dv: DimVarsResult) =>
    `HH="${dv.HH}" SH="${dv.SH}" W="${dv.W}" W_NET="${dv.W_NET ?? dv.W}" LW="${dv.LW}" SW="${dv.SW}" PF="${dv.PF}" PC="${dv.PC}" C="${dv.C}" F="${dv.F}" LL="${dv.LL}" R="${dv.R}" SQ="${dv.SQ}" V="${dv.V}"`;

  let misswallsXml = "";
  if (openings.length > 0) {
    const misswallEntries = openings.map(o => {
      const lengthUnits = Math.round(o.widthFt * 12000);
      const heightUnits = Math.round(o.heightFt * 12000);
      const opensIntoAttr = o.opensInto ? ` opensInto="${escapeXmlVal(o.opensInto === "E" ? "Exterior" : o.opensInto)}"` : ' opensInto="Exterior"';
      const floorAttr = o.goesToFloor ? ' opensToFloor="1"' : "";
      return `      <MISSWALL${opensIntoAttr} quantity="${o.quantity}" length="${lengthUnits}" height="${heightUnits}"${floorAttr}/>`;
    }).join("\n");

    misswallsXml = `
    <MISSWALLS>
${misswallEntries}
    </MISSWALLS>`;
  }

  return `  <SUBROOM printableDims="${printableDims}" type="${subroomType}" name="${escapeXmlVal(roomName)}">
    ${xpertVarsXml}
    <DIM_VARS_BEFORE_MW ${dimVarsAttrs(beforeMW)}/>
    ${misswallsXml}
    <DIM_VARS ${dimVarsAttrs(afterMW)}/>
  </SUBROOM>`;
}

export interface UnitPriceBreakdown {
  materialCost: number;
  laborCost: number;
  equipmentCost: number;
  wasteFactor: number;
  unitPrice: number;
}

/** Round to 2 decimal places for currency precision */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface PricedLineItem {
  code: string;
  description: string;
  unit: string;
  quantity: number;
  unitPriceBreakdown: UnitPriceBreakdown;
  totalPrice: number;
  tradeCode: string;
}

export interface EstimateTotals {
  subtotalMaterial: number;
  subtotalLabor: number;
  subtotalEquipment: number;
  subtotal: number;
  taxAmount: number;
  wasteIncluded: number;
  grandTotal: number;
  tradesInvolved: string[];
  qualifiesForOP: boolean;
  overheadAmount: number;
  profitAmount: number;
  totalWithOP: number;
}

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
  opEligible: boolean;               // Whether this trade received O&P
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
  coverages: CoverageSummary[];
  grandTotalRCV: number;
  grandTotalDepreciation: number;
  grandTotalRecoverableDep: number;
  grandTotalNonRecoverableDep: number;
  grandTotalACV: number;
  grandTotalDeductible: number;
  grandTotalOverLimit: number;
  grandNetClaim: number;
  totalOverhead: number;
  totalProfit: number;
  qualifiesForOP: boolean;
  tradesInvolved: string[];
  totalTaxOnMaterials: number;
  totalTaxOnLabor: number;
  totalTaxOnOP: number;
  totalOPAmount: number;
  depreciationBasis: string;
  tradeSubtotals: TradeSubtotal[];
  depreciatedItems: DepreciatedLineItem[];
}

// Trade codes used throughout (16 trades)
export const TRADE_CODES = [
  "MIT",   // Mitigation
  "DEM",   // Demolition
  "DRY",   // Drywall
  "PNT",   // Painting
  "FLR",   // Flooring
  "INS",   // Insulation
  "CAR",   // Carpentry
  "CAB",   // Cabinetry
  "CTR",   // Countertops
  "RFG",   // Roofing
  "WIN",   // Windows
  "EXT",   // Exterior
  "ELE",   // Electrical
  "PLM",   // Plumbing
  "HVAC",  // HVAC
  "GEN",   // General
];

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
  effectiveDepType: string;
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

/**
 * Calculates the full settlement summary from line items and policy rules.
 *
 * ORDER OF OPERATIONS (matches Xactimate):
 * 1. Group items by trade code
 * 2. For each trade: subtotal, then apply O&P (overhead + profit) — if qualifies
 * 3. Per-item: calculate taxable base (excluding O&P per Xactimate)
 * 4. Per-item: add tax → gives RCV
 * 5. Per-item: calculate depreciation from configured basis → gives ACV
 * 6. Group by coverage bucket
 * 7. Per-coverage: sum ACV, subtract deductible → Net Claim
 * 8. Check policy limits → Over Limit Deduction
 * 9. Grand totals across all coverages → The Check Amount
 */
export type SettlementItemInput = {
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
  taxable?: boolean;
  taxRate?: number | null;
  laborCost?: number;
  materialCost?: number;
};

/** Converts tax rules (from DB) to the format expected by resolveTaxRateWithRules */
export function taxRulesToCategoryFormat(
  taxRules: Array<{
    taxRate: number;
    appliesToCategories?: string[];
    appliesToCostType?: string;
  }>
): Array<{ category: string; taxRate: number; costType: "all" | "materials_only" | "labor_only" }> {
  const out: Array<{ category: string; taxRate: number; costType: "all" | "materials_only" | "labor_only" }> = [];
  for (const r of taxRules) {
    const costType =
      r.appliesToCostType === "materials_only"
        ? "materials_only"
        : r.appliesToCostType === "labor_only"
          ? "labor_only"
          : "all";
    const cats = r.appliesToCategories || [];
    if (cats.length > 0) {
      for (const c of cats) {
        out.push({ category: c, taxRate: r.taxRate, costType });
      }
    } else {
      out.push({ category: "", taxRate: r.taxRate, costType });
    }
  }
  return out;
}

/** Extracts policy overrides and limits from policy rules (from DB) */
export function getPolicyOverridesAndLimits(
  policyRules: Array<{
    coverageType: string;
    policyLimit: number | null;
    deductible: number | null;
    applyRoofSchedule?: boolean;
    overheadPct?: number;
    profitPct?: number;
    taxRate?: number;
    opExcludedTrades?: string[];
  }>
): {
  overrides: Partial<SettlementRules>;
  limits: Array<{ coverageType: string; policyLimit: number | null; deductible: number | null }>;
} {
  const limits = policyRules.map(p => ({
    coverageType: p.coverageType,
    policyLimit: p.policyLimit,
    deductible: p.deductible,
  }));
  const overrides: Partial<SettlementRules> = {};
  if (policyRules.length > 0) {
    const first = policyRules[0];
    overrides.defaultTaxRate = first.taxRate ?? 8;
    overrides.overheadPercentage = first.overheadPct ?? 10;
    overrides.profitPercentage = first.profitPct ?? 10;
    overrides.applyRoofDepreciationSchedule = first.applyRoofSchedule ?? false;
    overrides.opExcludedTrades = first.opExcludedTrades ?? [];
  }
  return { overrides, limits };
}

/**
 * Main settlement calculator — Xactimate-compliant.
 * Accepts SettlementRules and policy limits/deductibles.
 */
export function calculateSettlement(
  items: SettlementItemInput[],
  settlementRules: SettlementRules,
  policyLimitsAndDeductibles: Array<{
    coverageType: string;
    policyLimit: number | null;
    deductible: number | null;
  }> = [],
  taxRulesByCategory?: Array<{
    category: string;
    taxRate: number;
    costType: "all" | "materials_only" | "labor_only";
  }>
): SettlementSummary {
  validateSettlementRules(settlementRules);
  const limitsMap = new Map(
    policyLimitsAndDeductibles.map(p => [p.coverageType, p])
  );

  // ── Step 1: Group items by trade code ──
  const tradeGroups = new Map<string, SettlementItemInput[]>();
  const tradesSet = new Set<string>();
  for (const item of items) {
    tradesSet.add(item.tradeCode);
    const existing = tradeGroups.get(item.tradeCode) || [];
    existing.push(item);
    tradeGroups.set(item.tradeCode, existing);
  }
  const tradesInvolved = Array.from(tradesSet);

  // ── Step 2: Per-trade O&P using configurable rules ──
  const tradeSubtotals: TradeSubtotal[] = [];
  for (const [tradeCode, tradeItems] of tradeGroups) {
    const subtotal = tradeItems.reduce((sum, i) => sum + (i.totalPrice || 0), 0);
    const tradeIsEligible = tradeQualifiesForOP(tradesInvolved, tradeCode, settlementRules);
    const overheadAmount = tradeIsEligible
      ? subtotal * (settlementRules.overheadPercentage / 100)
      : 0;
    const profitAmount = tradeIsEligible
      ? subtotal * (settlementRules.profitPercentage / 100)
      : 0;
    tradeSubtotals.push({
      tradeCode,
      subtotal: round2(subtotal),
      overheadAmount: round2(overheadAmount),
      profitAmount: round2(profitAmount),
      tradeRCV: round2(subtotal + overheadAmount + profitAmount),
      opEligible: tradeIsEligible,
    });
  }
  const totalOverhead = tradeSubtotals.reduce((s, t) => s + t.overheadAmount, 0);
  const totalProfit = tradeSubtotals.reduce((s, t) => s + t.profitAmount, 0);
  const totalOPAmount = totalOverhead + totalProfit;

  // Track tax breakdown
  let totalTaxOnMaterials = 0;
  let totalTaxOnLabor = 0;
  let totalTaxOnOP = 0;

  // ── Step 3–5: Per-item tax, RCV, depreciation ──
  const depreciatedItems: DepreciatedLineItem[] = items.map(item => {
    const tradeTotal = tradeSubtotals.find(t => t.tradeCode === item.tradeCode);
    const tradeSubtotal = tradeTotal?.subtotal || 1;
    const itemShare = (item.totalPrice || 0) / (tradeSubtotal || 1);
    const itemOP = tradeTotal?.opEligible
      ? round2((tradeTotal.overheadAmount + tradeTotal.profitAmount) * itemShare)
      : 0;

    const bucket = deriveCoverageBucket(item.structure, item.coverageBucket);

    let taxRatePct = settlementRules.defaultTaxRate;
    if (item.taxRate != null) {
      taxRatePct = item.taxRate;
    } else {
      taxRatePct =
        resolveTaxRateWithRules(
          item.category,
          settlementRules,
          taxRulesByCategory
        ) * 100;
    }

    const laborPortion = item.laborCost ?? (item.totalPrice || 0) * 0.3;
    const taxableBase = calculateTaxableBase(
      item.totalPrice || 0,
      laborPortion,
      itemOP,
      settlementRules
    );

    const taxAmount = round2(taxableBase * (taxRatePct / 100));

    // Tax breakdown: allocate tax by portion of taxable base
    if (taxableBase > 0) {
      const matPortion = Math.max(0, (item.totalPrice || 0) - laborPortion);
      if (settlementRules.taxOnLabor) {
        totalTaxOnMaterials += round2(taxAmount * (matPortion / taxableBase));
        totalTaxOnLabor += round2(taxAmount * (laborPortion / taxableBase));
      } else {
        totalTaxOnMaterials += taxAmount;
      }
    }
    if (settlementRules.taxOnOP && itemOP > 0) {
      totalTaxOnOP += round2(itemOP * (taxRatePct / 100));
    }

    const rcv = round2((item.totalPrice || 0) + itemOP + taxAmount);

    const depBasis = calculateDepreciationBasis(
      rcv,
      taxAmount,
      itemOP,
      item.materialCost ?? null,
      settlementRules
    );

    const isRoofing =
      (item.category || "").toLowerCase().includes("roof") ||
      (item.tradeCode || "").toUpperCase() === "RFG";

    const dep = calculateItemDepreciation(
      depBasis,
      item.age,
      item.lifeExpectancy,
      item.depreciationPercentage,
      item.depreciationType,
      settlementRules.applyRoofDepreciationSchedule,
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

  // ── Step 6 & 7: Group by coverage, apply deductible and limits ──
  const coverageMap = new Map<string, DepreciatedLineItem[]>();
  for (const item of depreciatedItems) {
    const existing = coverageMap.get(item.coverageBucket) || [];
    existing.push(item);
    coverageMap.set(item.coverageBucket, existing);
  }

  const coverages: CoverageSummary[] = [];
  for (const [coverageType, covItems] of coverageMap) {
    const limitData = limitsMap.get(coverageType);

    const totalRCV = covItems.reduce((s, i) => s + i.rcv, 0);
    const totalRecDep = covItems
      .filter(i => i.depreciationType === "Recoverable")
      .reduce((s, i) => s + i.depreciationAmount, 0);
    const totalNonRecDep = covItems
      .filter(i => i.depreciationType === "Non-Recoverable")
      .reduce((s, i) => s + i.depreciationAmount, 0);
    const totalPWIDep = covItems
      .filter(i => i.depreciationType === "Paid When Incurred")
      .reduce((s, i) => s + i.rcv, 0);

    const totalDepreciation = totalRecDep + totalNonRecDep;
    const totalACV = totalRCV - totalDepreciation - totalPWIDep;
    const deductible = limitData?.deductible || 0;

    let netClaim = Math.max(totalACV - deductible, 0);
    let overLimitDeduction = 0;
    if (limitData?.policyLimit != null && netClaim > limitData.policyLimit) {
      overLimitDeduction = netClaim - limitData.policyLimit;
      netClaim = limitData.policyLimit;
    }

    coverages.push({
      coverageType,
      totalRCV: round2(totalRCV),
      totalRecoverableDepreciation: round2(totalRecDep),
      totalNonRecoverableDepreciation: round2(totalNonRecDep),
      totalDepreciation: round2(totalDepreciation),
      totalACV: round2(Math.max(totalACV, 0)),
      deductible,
      policyLimit: limitData?.policyLimit ?? null,
      netClaim: round2(netClaim),
      overLimitDeduction: round2(overLimitDeduction),
      itemCount: covItems.length,
    });
  }

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
    grandTotalRCV: round2(grandTotalRCV),
    grandTotalDepreciation: round2(grandTotalDep),
    grandTotalRecoverableDep: round2(grandTotalRecDep),
    grandTotalNonRecoverableDep: round2(grandTotalNonRecDep),
    grandTotalACV: round2(grandTotalACV),
    grandTotalDeductible: round2(grandTotalDeductible),
    grandTotalOverLimit: round2(grandTotalOverLimit),
    grandNetClaim: round2(grandNetClaim),
    totalOverhead: round2(totalOverhead),
    totalProfit: round2(totalProfit),
    qualifiesForOP: tradesInvolved.length >= settlementRules.opThreshold,
    tradesInvolved,
    totalTaxOnMaterials: round2(totalTaxOnMaterials),
    totalTaxOnLabor: round2(totalTaxOnLabor),
    totalTaxOnOP: round2(totalTaxOnOP),
    totalOPAmount: round2(totalOPAmount),
    depreciationBasis: settlementRules.depreciationBasis,
    tradeSubtotals,
    depreciatedItems,
  };
}

/**
 * Returns tax breakdown from a settlement summary.
 * Used for reporting and policy compliance audits.
 */
export function getTaxBreakdown(summary: SettlementSummary): {
  totalTaxOnMaterials: number;
  totalTaxOnLabor: number;
  totalTaxOnOP: number;
} {
  return {
    totalTaxOnMaterials: summary.totalTaxOnMaterials,
    totalTaxOnLabor: summary.totalTaxOnLabor,
    totalTaxOnOP: summary.totalTaxOnOP,
  };
}

async function getDbOrNull() {
  // Lazy import so pure calculations can be tested without DB env vars.
  // If DB env vars are missing, callers should treat pricing as unavailable.
  try {
    const { db } = await import("./db");
    return db;
  } catch {
    return null;
  }
}

/**
 * Looks up a catalog item by code
 */
export async function lookupCatalogItem(code: string) {
  const db = await getDbOrNull();
  if (!db) return null;
  const items = await db
    .select()
    .from(scopeLineItems)
    .where(eq(scopeLineItems.code, code))
    .limit(1);
  return items[0] || null;
}

/**
 * Gets the regional price for a line item in a specific region
 */
export async function getRegionalPrice(code: string, regionId: string, activityType?: string) {
  const db = await getDbOrNull();
  if (!db) return null;
  const rows = await db
    .select()
    .from(regionalPriceSets)
    .where(
      and(eq(regionalPriceSets.lineItemCode, code), eq(regionalPriceSets.regionId, regionId))
    );

  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0];

  if (activityType) {
    const match = rows.find(r => r.activityType === activityType);
    if (match) return match;
  }

  const install = rows.find(r => r.activityType === "install");
  if (install) return install;

  return rows[0];
}

/**
 * Calculates the unit price and total price for a line item
 */
export function calculateLineItemPrice(
  catalogItem: any,
  regionalPrice: any,
  quantity: number,
  overrideWasteFactor?: number
): PricedLineItem {
  const wasteFactor = overrideWasteFactor ?? (catalogItem?.defaultWasteFactor || 0);

  const materialCost = regionalPrice?.materialCost || 0;
  const laborCost = regionalPrice?.laborCost || 0;
  const equipmentCost = regionalPrice?.equipmentCost || 0;

  // Waste factor applies only to materials, not labor or equipment
  const wastedMaterialCost = round2(materialCost * (1 + wasteFactor / 100));
  const unitPrice = round2(wastedMaterialCost + laborCost + equipmentCost);

  const totalPrice = round2(unitPrice * quantity);

  return {
    code: catalogItem.code,
    description: catalogItem.description,
    unit: catalogItem.unit,
    quantity,
    unitPriceBreakdown: {
      materialCost: wastedMaterialCost,
      laborCost,
      equipmentCost,
      wasteFactor,
      unitPrice,
    },
    totalPrice,
    tradeCode: catalogItem.tradeCode,
  };
}

/**
 * Calculates estimate totals from a list of priced items
 * Checks if 3+ trades are involved for O&P eligibility
 */
export function calculateEstimateTotals(
  pricedItems: PricedLineItem[],
  taxRate: number = 0.08,
  overheadPctOverride?: number,
  profitPctOverride?: number,
): EstimateTotals {
  let subtotalMaterial = 0;
  let subtotalLabor = 0;
  let subtotalEquipment = 0;
  const tradesSet = new Set<string>();

  for (const item of pricedItems) {
    subtotalMaterial += item.unitPriceBreakdown.materialCost * item.quantity;
    subtotalLabor += item.unitPriceBreakdown.laborCost * item.quantity;
    subtotalEquipment += item.unitPriceBreakdown.equipmentCost * item.quantity;
    tradesSet.add(item.tradeCode);
  }

  subtotalMaterial = round2(subtotalMaterial);
  subtotalLabor = round2(subtotalLabor);
  subtotalEquipment = round2(subtotalEquipment);
  const subtotal = round2(subtotalMaterial + subtotalLabor + subtotalEquipment);

  // Calculate waste amount (difference between waste-applied material cost and base material cost)
  const wasteIncluded = round2(pricedItems.reduce((sum, item) => {
    const wf = item.unitPriceBreakdown.wasteFactor;
    if (wf <= 0) return sum;
    const baseMaterial = item.unitPriceBreakdown.materialCost / (1 + wf / 100);
    const wasteAmount = (item.unitPriceBreakdown.materialCost - baseMaterial) * item.quantity;
    return sum + wasteAmount;
  }, 0));

  // Tax applies to materials only (standard in most US jurisdictions)
  const taxAmount = round2(subtotalMaterial * taxRate);

  // O&P (Overhead & Profit) qualifies if 3+ trades involved
  const tradesInvolved = Array.from(tradesSet);
  const qualifiesForOP = tradesInvolved.length >= 3;
  const overheadPct = overheadPctOverride ?? 0.10;
  const profitPct = profitPctOverride ?? 0.10;
  const overheadAmount = round2(qualifiesForOP ? subtotal * overheadPct : 0);
  const profitAmount = round2(qualifiesForOP ? subtotal * profitPct : 0);

  // grandTotal always includes O&P when applicable
  const grandTotal = round2(subtotal + taxAmount + overheadAmount + profitAmount);

  return {
    subtotalMaterial,
    subtotalLabor,
    subtotalEquipment,
    subtotal,
    taxAmount,
    wasteIncluded,
    grandTotal,
    tradesInvolved,
    qualifiesForOP,
    overheadAmount,
    profitAmount,
    totalWithOP: grandTotal,
  };
}

/**
 * Validates an estimate for scope gaps and issues
 */
export async function validateEstimate(items: PricedLineItem[]): Promise<{
  valid: boolean;
  errors: string[];
  warnings: string[];
}> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const codes = new Set<string>();

  // Check for duplicates
  for (const item of items) {
    if (codes.has(item.code)) {
      warnings.push(`Duplicate item: ${item.code} appears multiple times`);
    }
    codes.add(item.code);
  }

  // Check for companion item violations (e.g., if DRY is present, DEM should come before)
  const tradeCodes = new Set(items.map(i => i.tradeCode));

  // Common sequences: DEM → DRY → PNT
  if (tradeCodes.has("DRY") && !tradeCodes.has("DEM")) {
    warnings.push("Drywall work (DRY) present without Demolition (DEM) — verify existing condition");
  }

  if (tradeCodes.has("PNT") && !tradeCodes.has("DRY")) {
    warnings.push("Painting (PNT) present without Drywall (DRY) — verify surface prep");
  }

  // Check for quantities
  for (const item of items) {
    if (!item.quantity || item.quantity <= 0) {
      errors.push(`Item ${item.code} has invalid quantity`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Suggests companion items that might be missing based on what's already in the estimate
 */
export function getCompanionSuggestions(
  existingItems: Array<{ category: string; xactCode?: string }>,
): Array<{ code: string; reason: string }> {
  const suggestions: Array<{ code: string; reason: string }> = [];
  const existingCodes = new Set(existingItems.map((i) => i.xactCode).filter(Boolean));
  const existingCategories = new Set(existingItems.map((i) => i.category.toUpperCase()));

  // Roofing companions
  const hasRoofing = existingItems.some(
    (i) => i.xactCode?.startsWith('RFG-SHIN') || i.category?.toUpperCase() === 'ROOFING',
  );
  if (hasRoofing) {
    if (!existingCodes.has('RFG-FELT-SQ')) {
      suggestions.push({ code: 'RFG-FELT-SQ', reason: 'Roofing felt underlayment required with shingle replacement' });
    }
    if (!existingCodes.has('RFG-ICE-SQ')) {
      suggestions.push({ code: 'RFG-ICE-SQ', reason: 'Ice & water shield recommended at eaves and valleys' });
    }
    if (!existingCodes.has('RFG-DRIP-LF')) {
      suggestions.push({ code: 'RFG-DRIP-LF', reason: 'Drip edge typically replaced with new shingles' });
    }
    if (!existingCodes.has('RFG-RIDG-LF')) {
      suggestions.push({ code: 'RFG-RIDG-LF', reason: 'Ridge cap shingles needed for roof replacement' });
    }
  }

  // Drywall companions
  const hasDrywall = existingItems.some(
    (i) => i.xactCode?.startsWith('DRY-') && !i.xactCode?.startsWith('DRY-TAPE') && !i.xactCode?.startsWith('DRY-TEXT'),
  );
  if (hasDrywall) {
    if (!existingCodes.has('DRY-TAPE-SF')) {
      suggestions.push({ code: 'DRY-TAPE-SF', reason: 'Tape and finish required for new drywall' });
    }
    if (!existingCodes.has('DRY-TEXT-SF')) {
      suggestions.push({ code: 'DRY-TEXT-SF', reason: 'Texture match required after drywall replacement' });
    }
  }

  // Flooring companions
  const hasFlooring = existingItems.some(
    (i) =>
      i.xactCode?.startsWith('FLR-CAR') ||
      i.xactCode?.startsWith('FLR-VIN') ||
      i.xactCode?.startsWith('FLR-LAM') ||
      i.xactCode?.startsWith('FLR-HWD'),
  );
  if (hasFlooring) {
    if (!existingCodes.has('FLR-ULAY-SF')) {
      suggestions.push({ code: 'FLR-ULAY-SF', reason: 'Underlayment typically required with new flooring' });
    }
    if (!existingCodes.has('FLR-BASE-LF')) {
      suggestions.push({ code: 'FLR-BASE-LF', reason: 'Baseboard often replaced or reinstalled with new flooring' });
    }
  }

  // Carpet-specific: pad
  const hasCarpet = existingItems.some((i) => i.xactCode === 'FLR-CAR-SF');
  if (hasCarpet && !existingCodes.has('FLR-CAR-PAD')) {
    suggestions.push({ code: 'FLR-CAR-PAD', reason: 'Carpet pad required with carpet installation' });
  }

  // Painting companions — if drywall present, painting likely needed
  if (hasDrywall && !existingCategories.has('PAINTING') && !existingCategories.has('PNT')) {
    suggestions.push({ code: 'PNT-WALL-SF', reason: 'Paint required after drywall replacement' });
    suggestions.push({ code: 'PNT-PRIM-SF', reason: 'Primer/sealer recommended for new drywall' });
  }

  // Demo → Haul
  const hasDemo = existingItems.some((i) => i.xactCode?.startsWith('DEM-'));
  if (hasDemo && !existingCodes.has('DEM-HAUL-EA')) {
    suggestions.push({ code: 'DEM-HAUL-EA', reason: 'Debris haul-off needed for demolished materials' });
  }

  // General — floor protection if 3+ trades
  const uniqueTrades = new Set(
    existingItems
      .map((i) => {
        if (i.xactCode) return i.xactCode.split('-')[0];
        return null;
      })
      .filter(Boolean),
  );
  if (uniqueTrades.size >= 3 && !existingCodes.has('GEN-PROT-SF')) {
    suggestions.push({ code: 'GEN-PROT-SF', reason: 'Floor protection recommended for multi-trade projects' });
  }

  return suggestions;
}

/**
 * Calculates adjusted wall SF after subtracting all opening deductions.
 *
 * Formula: Adjusted sfWalls = Gross sfWalls - Σ(opening_width × opening_height × quantity)
 *
 * Used by ESX generator to produce accurate ROOM_DIM_VARS and by the voice agent
 * to give the adjuster a running net wall area during inspection.
 */
export function calculateNetWallArea(
  dimensions: { length?: number; width?: number; height?: number },
  openings: Array<{ widthFt: number; heightFt: number; quantity: number }>
): {
  grossSfWalls: number;
  totalDeductions: number;
  netSfWalls: number;
  sfCeiling: number;
  sfFloor: number;
  lfFloorPerim: number;
  sfLongWall: number;
  sfShortWall: number;
} {
  const L = dimensions.length || 0;
  const W = dimensions.width || 0;
  const H = dimensions.height || 8;

  const grossSfWalls = (L + W) * 2 * H;
  const sfCeiling = L * W;
  const sfFloor = L * W;
  const lfFloorPerim = (L + W) * 2;
  const sfLongWall = Math.max(L, W) * H;
  const sfShortWall = Math.min(L, W) * H;

  const totalDeductions = openings.reduce(
    (sum, o) => sum + o.widthFt * o.heightFt * (o.quantity || 1),
    0
  );

  const netSfWalls = Math.max(0, grossSfWalls - totalDeductions);

  return {
    grossSfWalls,
    totalDeductions,
    netSfWalls,
    sfCeiling,
    sfFloor,
    lfFloorPerim,
    sfLongWall,
    sfShortWall,
  };
}
