import { db } from "./db";
import { scopeLineItems, regionalPriceSets } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export interface UnitPriceBreakdown {
  materialCost: number;
  laborCost: number;
  equipmentCost: number;
  wasteFactor: number;
  unitPrice: number;
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

// Trade codes used throughout (14 trades)
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
];

/**
 * Looks up a catalog item by code
 */
export async function lookupCatalogItem(code: string) {
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
export async function getRegionalPrice(code: string, regionId: string) {
  const prices = await db
    .select()
    .from(regionalPriceSets)
    .where(
      and(eq(regionalPriceSets.lineItemCode, code), eq(regionalPriceSets.regionId, regionId))
    )
    .limit(1);
  return prices[0] || null;
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

  // Unit price = (M + L + E) × (1 + waste%)
  const baseUnitPrice = materialCost + laborCost + equipmentCost;
  const unitPrice = baseUnitPrice * (1 + wasteFactor / 100);

  const totalPrice = unitPrice * quantity;

  return {
    code: catalogItem.code,
    description: catalogItem.description,
    unit: catalogItem.unit,
    quantity,
    unitPriceBreakdown: {
      materialCost: materialCost * (1 + wasteFactor / 100),
      laborCost: laborCost * (1 + wasteFactor / 100),
      equipmentCost: equipmentCost * (1 + wasteFactor / 100),
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
  taxRate: number = 0.08
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

  const subtotal = subtotalMaterial + subtotalLabor + subtotalEquipment;

  // Calculate waste amount (difference between base and waste-applied prices)
  const wasteIncluded = pricedItems.reduce((sum, item) => {
    const wf = item.unitPriceBreakdown.wasteFactor;
    if (wf <= 0) return sum;
    const basePrice = (item.unitPriceBreakdown.materialCost / (1 + wf / 100) +
                       item.unitPriceBreakdown.laborCost / (1 + wf / 100) +
                       item.unitPriceBreakdown.equipmentCost / (1 + wf / 100)) * item.quantity;
    return sum + (item.totalPrice - basePrice);
  }, 0);

  const taxAmount = subtotal * taxRate;

  // O&P (Overhead & Profit) qualifies if 3+ trades involved
  const tradesInvolved = Array.from(tradesSet);
  const qualifiesForOP = tradesInvolved.length >= 3;
  const overheadPct = 0.10; // 10%
  const profitPct = 0.10;   // 10%
  const overheadAmount = qualifiesForOP ? subtotal * overheadPct : 0;
  const profitAmount = qualifiesForOP ? subtotal * profitPct : 0;

  const totalWithOP = subtotal + taxAmount + overheadAmount + profitAmount;

  return {
    subtotalMaterial,
    subtotalLabor,
    subtotalEquipment,
    subtotal,
    taxAmount,
    wasteIncluded,
    grandTotal: subtotal + taxAmount,
    tradesInvolved,
    qualifiesForOP,
    overheadAmount,
    profitAmount,
    totalWithOP,
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
export async function getCompanionSuggestions(items: PricedLineItem[]): Promise<string[]> {
  const suggestions: string[] = [];
  const codes = new Set(items.map(i => i.code));
  const tradeCodes = new Set(items.map(i => i.tradeCode));

  // Roofing + ice barrier/underlayment
  if (tradeCodes.has("RFG") && !codes.has("RFG-UNDER-SF")) {
    suggestions.push("Consider adding roofing underlayment (RFG-UNDER-SF) for complete installation");
  }

  // Drywall + joint compound/tape
  if (tradeCodes.has("DRY") && !codes.has("DRY-TAPE-LF")) {
    suggestions.push("Consider adding drywall tape and compound (DRY-TAPE-LF, DRY-JOINT-SF) for finishing");
  }

  // Siding + house wrap
  if (tradeCodes.has("EXT") && !codes.has("EXT-WRAP-SF")) {
    suggestions.push("Consider adding house wrap (EXT-WRAP-SF) under new siding");
  }

  // Flooring + underlayment
  if (tradeCodes.has("FLR") && !codes.has("FLR-PAD-SF")) {
    suggestions.push("Consider adding underlayment (FLR-PAD-SF) under new flooring");
  }

  return suggestions;
}
