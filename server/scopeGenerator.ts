import { db } from "./db";
import { scopeLineItems, regionalPriceSets } from "@shared/schema";
import { eq, and, like } from "drizzle-orm";
import { lookupCatalogItem, getRegionalPrice, calculateLineItemPrice } from "./estimateEngine";

/**
 * Maps damage types to catalog line item codes.
 * Each damage type can generate multiple line items.
 */
const DAMAGE_TO_SCOPE: Record<string, Array<{
  code?: string;
  codePattern?: string;
  description: string;
  category: string;
  action: string;
  unit: string;
  quantitySource: "walls" | "ceiling" | "floor" | "perimeter" | "fixed" | "each";
  fixedQty?: number;
}>> = {
  hail_impact: [
    { codePattern: "RFG%SHINGLE%", description: "R&R Composition shingles", category: "Roofing", action: "R&R", unit: "SQ", quantitySource: "fixed", fixedQty: 1 },
    { codePattern: "RFG%FELT%", description: "R&R Roofing felt", category: "Roofing", action: "R&R", unit: "SQ", quantitySource: "fixed", fixedQty: 1 },
    { codePattern: "RFG%DRIP%", description: "R&R Drip edge", category: "Roofing", action: "R&R", unit: "LF", quantitySource: "perimeter" },
    { codePattern: "RFG%RIDGE%", description: "R&R Ridge cap", category: "Roofing", action: "R&R", unit: "LF", quantitySource: "fixed", fixedQty: 30 },
  ],
  wind_damage: [
    { codePattern: "RFG%SHINGLE%", description: "R&R Composition shingles", category: "Roofing", action: "R&R", unit: "SQ", quantitySource: "fixed", fixedQty: 1 },
    { codePattern: "EXT%SIDING%", description: "R&R Siding", category: "Siding", action: "R&R", unit: "SF", quantitySource: "walls" },
  ],
  water_stain: [
    { codePattern: "DRY%CEIL%", description: "R&R Drywall - ceiling", category: "Drywall", action: "R&R", unit: "SF", quantitySource: "ceiling" },
    { codePattern: "PNT%CEIL%", description: "Paint ceiling", category: "Painting", action: "Paint", unit: "SF", quantitySource: "ceiling" },
  ],
  water_intrusion: [
    { codePattern: "DRY%", description: "R&R Drywall", category: "Drywall", action: "R&R", unit: "SF", quantitySource: "walls" },
    { codePattern: "PNT%", description: "Paint walls", category: "Painting", action: "Paint", unit: "SF", quantitySource: "walls" },
    { codePattern: "FLR%", description: "R&R Flooring", category: "Flooring", action: "R&R", unit: "SF", quantitySource: "floor" },
    { description: "Tear out wet insulation", category: "General", action: "Tear Off", unit: "SF", quantitySource: "walls" },
  ],
  crack: [
    { codePattern: "DRY%", description: "Repair drywall crack", category: "Drywall", action: "Repair", unit: "LF", quantitySource: "fixed", fixedQty: 10 },
    { codePattern: "PNT%", description: "Paint repaired area", category: "Painting", action: "Paint", unit: "SF", quantitySource: "fixed", fixedQty: 50 },
  ],
  dent: [
    { description: "R&R dented component", category: "General", action: "R&R", unit: "EA", quantitySource: "each" },
  ],
  missing: [
    { description: "R&R missing component", category: "General", action: "R&R", unit: "EA", quantitySource: "each" },
  ],
  rot: [
    { codePattern: "CAR%", description: "R&R rotted wood", category: "Carpentry", action: "R&R", unit: "LF", quantitySource: "fixed", fixedQty: 8 },
    { codePattern: "PNT%", description: "Prime and paint", category: "Painting", action: "Paint", unit: "SF", quantitySource: "fixed", fixedQty: 20 },
  ],
  mold: [
    { description: "Mold remediation", category: "General", action: "Clean", unit: "SF", quantitySource: "walls" },
    { codePattern: "DRY%", description: "R&R contaminated drywall", category: "Drywall", action: "R&R", unit: "SF", quantitySource: "walls" },
  ],
  mechanical: [
    { description: "Repair mechanical damage", category: "General", action: "Repair", unit: "EA", quantitySource: "each" },
  ],
  wear_tear: [],
  other: [
    { description: "General repair", category: "General", action: "Repair", unit: "EA", quantitySource: "each" },
  ],
};

interface RoomDims {
  length: number;
  width: number;
  height: number;
}

function calculateQuantity(
  source: string,
  dims: RoomDims | null,
  fixedQty?: number
): number {
  if (!dims) return fixedQty || 1;
  const h = dims.height || 8;
  switch (source) {
    case "walls": return (dims.length + dims.width) * 2 * h;
    case "ceiling":
    case "floor": return dims.length * dims.width;
    case "perimeter": return (dims.length + dims.width) * 2;
    case "fixed": return fixedQty || 1;
    case "each": return 1;
    default: return fixedQty || 1;
  }
}

export interface GeneratedLineItem {
  description: string;
  category: string;
  action: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  xactCode: string | null;
  tradeCode: string | null;
}

/**
 * Given a damage observation, auto-generates scope line items
 * with pricing from the catalog.
 */
export async function generateScopeFromDamage(
  damageType: string,
  severity: string | null,
  roomDimensions: RoomDims | null,
  regionId: string = "US-TX"
): Promise<GeneratedLineItem[]> {
  const templates = DAMAGE_TO_SCOPE[damageType] || DAMAGE_TO_SCOPE["other"] || [];
  if (templates.length === 0) return [];

  const results: GeneratedLineItem[] = [];

  for (const tmpl of templates) {
    let quantity = calculateQuantity(tmpl.quantitySource, roomDimensions, tmpl.fixedQty);

    // Severity multiplier
    if (severity === "minor") quantity = Math.ceil(quantity * 0.5);
    if (severity === "severe") quantity = Math.ceil(quantity * 1.2);

    let unitPrice = 0;
    let xactCode: string | null = null;
    let tradeCode: string | null = null;

    // Try to find catalog item
    if (tmpl.code) {
      const item = await lookupCatalogItem(tmpl.code);
      if (item) {
        xactCode = item.code;
        tradeCode = item.tradeCode;
        const price = await getRegionalPrice(item.code, regionId);
        if (price) {
          const priced = calculateLineItemPrice(item, price, quantity);
          unitPrice = priced.unitPriceBreakdown.unitPrice;
        }
      }
    } else if (tmpl.codePattern) {
      // Search by pattern
      const pattern = tmpl.codePattern;
      const items = await db.select().from(scopeLineItems)
        .where(like(scopeLineItems.code, pattern))
        .limit(1);
      if (items[0]) {
        xactCode = items[0].code;
        tradeCode = items[0].tradeCode;
        const price = await getRegionalPrice(items[0].code, regionId);
        if (price) {
          const priced = calculateLineItemPrice(items[0], price, quantity);
          unitPrice = priced.unitPriceBreakdown.unitPrice;
        }
      }
    }

    results.push({
      description: tmpl.description,
      category: tmpl.category,
      action: tmpl.action,
      unit: tmpl.unit,
      quantity: Math.round(quantity * 100) / 100,
      unitPrice,
      totalPrice: Math.round(unitPrice * quantity * 100) / 100,
      xactCode,
      tradeCode,
    });
  }

  return results;
}
