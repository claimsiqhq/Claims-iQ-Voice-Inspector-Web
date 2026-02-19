/**
 * mleSplitService.ts
 * Resolves M/L/E (Material/Labor/Equipment) breakdowns per item using category defaults
 * when regional price lookup fails. This replaces the hardcoded 65/35 split.
 */

/**
 * M/L/E split percentages by category
 * All percentages must sum to 100%
 * Based on typical Xactimate price list distributions
 */
const CATEGORY_MLE_DEFAULTS: Record<string, { material: number; labor: number; equipment: number }> = {
  RFG: { material: 55, labor: 40, equipment: 5 },
  DRY: { material: 40, labor: 55, equipment: 5 },
  PNT: { material: 35, labor: 60, equipment: 5 },
  FLR: { material: 50, labor: 45, equipment: 5 },
  PLM: { material: 45, labor: 50, equipment: 5 },
  HVA: { material: 40, labor: 45, equipment: 15 },
  ELE: { material: 35, labor: 55, equipment: 10 },
  DEM: { material: 15, labor: 80, equipment: 5 },
  MIT: { material: 15, labor: 80, equipment: 5 },
  SDG: { material: 60, labor: 35, equipment: 5 },
  INS: { material: 65, labor: 30, equipment: 5 },
  FRM: { material: 50, labor: 45, equipment: 5 },
  CAB: { material: 50, labor: 45, equipment: 5 },
  CTR: { material: 65, labor: 30, equipment: 5 },
  WIN: { material: 60, labor: 35, equipment: 5 },
  EXT: { material: 60, labor: 35, equipment: 5 },
  APL: { material: 80, labor: 15, equipment: 5 },
  MEC: { material: 40, labor: 45, equipment: 15 },
  GEN: { material: 50, labor: 45, equipment: 5 },
};

/**
 * Result of M/L/E resolution at the item level
 */
export interface MLESplit {
  material: number;
  labor: number;
  equipment: number;
  source: "regional" | "category" | "fallback";
  priceListId?: string;
}

/**
 * Resolves M/L/E split for a single item using a three-tier resolution strategy.
 */
export async function resolveMLE(params: {
  xactCode?: string;
  category?: string;
  priceListId?: string;
  activityType?: string;
  getRegionalPrice?: (code: string, listId: string, activity: string) => Promise<any>;
}): Promise<MLESplit> {
  const {
    xactCode,
    category,
    priceListId = "USNATNL",
    activityType = "install",
    getRegionalPrice,
  } = params;

  if (xactCode && getRegionalPrice && priceListId) {
    try {
      const regionalPrice = await getRegionalPrice(xactCode, priceListId, activityType);
      if (regionalPrice?.materialCost != null && regionalPrice?.laborCost != null) {
        const material = Number(regionalPrice.materialCost) || 0;
        const labor = Number(regionalPrice.laborCost) || 0;
        const equipment = Number(regionalPrice.equipmentCost) || 0;
        const total = material + labor + equipment;

        if (total > 0) {
          return {
            material: Math.round((material / total) * 10000) / 100,
            labor: Math.round((labor / total) * 10000) / 100,
            equipment: Math.round((equipment / total) * 10000) / 100,
            source: "regional",
            priceListId,
          };
        }
      }
    } catch {
      // Fall through to category defaults
    }
  }

  const normalizedCategory = (category || "GEN").toUpperCase().trim().substring(0, 3);
  const categoryDefaults = CATEGORY_MLE_DEFAULTS[normalizedCategory] ?? CATEGORY_MLE_DEFAULTS["GEN"];

  return {
    material: categoryDefaults.material,
    labor: categoryDefaults.labor,
    equipment: categoryDefaults.equipment,
    source: normalizedCategory in CATEGORY_MLE_DEFAULTS ? "category" : "fallback",
  };
}

/**
 * Validates that an MLESplit's percentages sum to 100% (with 1% tolerance for rounding)
 */
export function validateMLESplit(split: MLESplit): boolean {
  const sum = split.material + split.labor + split.equipment;
  return Math.abs(sum - 100) <= 1;
}

/**
 * Applies M/L/E percentages to a total price to calculate breakdown amounts
 */
export function applyMLEToPrice(totalPrice: number, split: MLESplit) {
  return {
    material: Math.round((totalPrice * split.material) / 100 * 100) / 100,
    labor: Math.round((totalPrice * split.labor) / 100 * 100) / 100,
    equipment: Math.round((totalPrice * split.equipment) / 100 * 100) / 100,
  };
}
