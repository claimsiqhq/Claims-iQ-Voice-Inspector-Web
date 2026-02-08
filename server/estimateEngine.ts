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
