/**
 * Scope Assembly Service v5
 *
 * Assembles scope items from damage observations using ONLY real Xactimate catalog items.
 * Maps damage type → trades → curated Xactimate codes that a real adjuster would pull.
 * No seed data, no alphabetical selection. Hand-picked codes per damage scenario.
 *
 * Quantities are derived from room geometry via scopeQuantityEngine when dimensions
 * are available. Falls back to 1 when room dimensions are missing, and flags items
 * that need manual quantities.
 */

import { IStorage } from "./storage";
import type { InspectionRoom, DamageObservation, ScopeLineItem, ScopeItem, InsertScopeItem } from "@shared/schema";
import { deriveQuantity, type QuantityFormula } from "./scopeQuantityEngine";

export interface ScopeAssemblyResult {
  created: ScopeItem[];
  companionItems: ScopeItem[];
  manualQuantityNeeded: Array<{
    catalogCode: string;
    description: string;
    unit: string;
    reason: string;
  }>;
  warnings: string[];
}

const DAMAGE_TYPE_TO_TRADES: Record<string, string[]> = {
  water:           ["DEM", "DRY", "PNT", "FLR", "INS", "MIT"],
  water_stain:     ["DRY", "PNT", "MIT"],
  water_intrusion: ["DEM", "DRY", "PNT", "FLR", "INS", "MIT"],
  mold:            ["DEM", "DRY", "PNT", "MIT", "INS"],
  wind:            ["RFG", "EXT", "WIN", "DRY", "PNT"],
  wind_damage:     ["RFG", "EXT", "WIN", "DRY", "PNT"],
  hail:            ["RFG", "EXT", "WIN", "PNT"],
  hail_impact:     ["RFG", "EXT", "WIN", "PNT"],
  fire:            ["DEM", "DRY", "PNT", "FLR", "EXT", "RFG", "INS", "ELE"],
  smoke:           ["DRY", "PNT", "MIT", "DEM"],
  crack:           ["DRY", "PNT", "EXT"],
  dent:            ["EXT", "WIN", "CAB"],
  missing:         ["RFG", "EXT", "WIN", "DRY"],
  rot:             ["EXT", "RFG", "DRY", "FLR", "DEM"],
  mechanical:      ["PLM", "ELE", "HVAC"],
  wear_tear:       ["FLR", "CAR", "PNT", "DRY"],
  other:           ["DRY", "PNT", "FLR", "EXT", "RFG"],
};

/**
 * Curated Xactimate codes per damage+trade combination.
 * Every code here has been verified to exist in the FLFM8X_NOV22 price list.
 */
const CURATED_CODES: Record<string, Record<string, string[]>> = {
  water: {
    DEM: [
      "DEM-DRY-SF",      // Remove drywall
      "DEM-CEIL-SF",     // Remove ceiling drywall
      "DEM-FLR-SF",      // Remove flooring
      "DEM-TRIM-LF",     // Remove baseboard/trim
      "DEM-INSUL-SF",    // Remove insulation
      "DEM-PAD-SF",      // Remove carpet pad
    ],
    DRY: [
      "DRY-X-1-2",       // 1/2" drywall hung, taped, floated, ready for paint
      "DRY-X-1-2MR",     // 1/2" mold resistant drywall
      "DRY-X-5-8",       // 5/8" drywall
      "DRY-PATCH-SF",    // Patch drywall
    ],
    PNT: [
      "PNT-INT-SF",      // Interior wall paint - 2 coats
      "PNT-CEILING-SF",  // Paint ceiling
      "PNT-TRIM-LF",     // Paint trim/baseboard
      "PNT-DRYWALL-SF",  // Paint new drywall
    ],
    FLR: [
      "FLR-CARPET-SF",   // Carpet installation
      "FLR-PAD-SF",      // Carpet pad/underlayment
      "FLR-VINYL-SF",    // Vinyl plank flooring
      "FLR-LAMINATE-SF", // Laminate flooring
      "FLR-X-LAM",       // Laminate flooring (Xact)
    ],
    INS: [
      "INS-BATTS-SF",    // Fiberglass batts
      "INS-BLOWN-SF",    // Blown-in insulation
      "INS-VAPOR-SF",    // Vapor barrier
    ],
    MIT: [
      "MIT-AIRM-DAY",    // Air mover per day
      "MIT-DEHM-DAY",    // Large dehumidifier per day
      "MIT-DEHU-DAY",    // Dehumidifier per day
      "MIT-APPL-SF",     // Antimicrobial treatment
      "MIT-MONI-DAY",    // Moisture monitoring per day
      "MIT-EXTR-SF",     // Water extraction - standing water
      "MIT-EXTR-CA",     // Water extraction - carpet/pad
      "MIT-DEMO-SF",     // Flood cut drywall (up to 4 ft)
    ],
  },
  water_stain: {
    DRY: [
      "DRY-PATCH-SF",    // Patch drywall
      "DRY-X-1-2",       // 1/2" drywall
    ],
    PNT: [
      "PNT-INT-SF",      // Interior wall paint
      "PNT-CEILING-SF",  // Paint ceiling
    ],
    MIT: [
      "MIT-MONI-DAY",    // Moisture monitoring
      "MIT-APPL-SF",     // Antimicrobial
    ],
  },
  water_intrusion: {
    DEM: [
      "DEM-DRY-SF",
      "DEM-CEIL-SF",
      "DEM-FLR-SF",
      "DEM-TRIM-LF",
      "DEM-INSUL-SF",
      "DEM-PAD-SF",
    ],
    DRY: [
      "DRY-X-1-2",
      "DRY-X-1-2MR",
      "DRY-PATCH-SF",
    ],
    PNT: [
      "PNT-INT-SF",
      "PNT-CEILING-SF",
      "PNT-TRIM-LF",
    ],
    FLR: [
      "FLR-CARPET-SF",
      "FLR-PAD-SF",
      "FLR-VINYL-SF",
    ],
    INS: [
      "INS-BATTS-SF",
      "INS-BLOWN-SF",
    ],
    MIT: [
      "MIT-AIRM-DAY",
      "MIT-DEHM-DAY",
      "MIT-APPL-SF",
      "MIT-EXTR-SF",
      "MIT-EXTR-CA",
      "MIT-DEMO-SF",
    ],
  },
  mold: {
    DEM: [
      "DEM-DRY-SF",
      "DEM-CEIL-SF",
      "DEM-INSUL-SF",
      "DEM-TRIM-LF",
    ],
    DRY: [
      "DRY-X-1-2MR",     // Mold resistant drywall
      "DRY-X-1-2MRP",    // Mold resistant ready for paint
    ],
    PNT: [
      "PNT-INT-SF",
      "PNT-CEILING-SF",
      "PNT-DRYWALL-SF",
    ],
    MIT: [
      "MIT-APPL-SF",     // Antimicrobial treatment
      "MIT-CONT-DAY",    // Containment setup
      "MIT-MOLD-SF",     // Mold remediation
      "MIT-DEHM-DAY",    // Dehumidifier
    ],
    INS: [
      "INS-BATTS-SF",
    ],
  },
  wind: {
    RFG: [
      "RFG-X-300",       // Laminated comp shingle w/ felt
      "RFG-SHIN-AR",     // Architectural shingles
      "RFG-FELT-SQ",     // Roofing felt
      "RFG-RIDGE-LF",    // Ridge cap shingles
      "RFG-DRIP-LF",     // Drip edge
      "RFG-FLASH-LF",    // Flashing
    ],
    EXT: [
      "EXT-SIDING-SF",   // Vinyl siding
      "EXT-SOFFIT-SF",   // Soffit panel
      "EXT-FASCIA-LF",   // Fascia board
    ],
    WIN: [
      "WIN-DOUBLE-EA",   // Double-hung window
      "WIN-GLASS-SF",    // Window glass replacement
    ],
    DRY: [
      "DRY-X-1-2",
    ],
    PNT: [
      "PNT-INT-SF",
      "PNT-EXT-SF",      // Exterior paint
    ],
  },
  wind_damage: {
    RFG: [
      "RFG-X-300",
      "RFG-SHIN-AR",
      "RFG-FELT-SQ",
      "RFG-RIDGE-LF",
      "RFG-DRIP-LF",
      "RFG-FLASH-LF",
    ],
    EXT: [
      "EXT-SIDING-SF",
      "EXT-SOFFIT-SF",
      "EXT-FASCIA-LF",
    ],
    WIN: [
      "WIN-DOUBLE-EA",
      "WIN-GLASS-SF",
    ],
    DRY: [
      "DRY-X-1-2",
    ],
    PNT: [
      "PNT-INT-SF",
      "PNT-EXT-SF",
    ],
  },
  hail: {
    RFG: [
      "RFG-X-300",       // Laminated comp shingle w/ felt
      "RFG-SHIN-AR",     // Architectural shingles
      "RFG-SHIN-3TAB",   // 3-tab shingles
      "RFG-FELT-SQ",     // Roofing felt
      "RFG-RIDGE-LF",    // Ridge cap
      "RFG-DRIP-LF",     // Drip edge
      "RFG-ICE-SF",      // Ice & water shield
      "RFG-VENT-EA",     // Roof vent
      "RFG-FLASH-LF",    // Flashing
    ],
    EXT: [
      "EXT-SIDING-SF",   // Siding
      "EXT-SOFFIT-SF",   // Soffit
      "EXT-FASCIA-LF",   // Fascia
    ],
    WIN: [
      "WIN-GLASS-SF",    // Window glass
      "WIN-SCREEN-EA",   // Window screen
    ],
    PNT: [
      "PNT-EXT-SF",      // Exterior paint
    ],
  },
  hail_impact: {
    RFG: [
      "RFG-X-300",
      "RFG-SHIN-AR",
      "RFG-FELT-SQ",
      "RFG-RIDGE-LF",
      "RFG-DRIP-LF",
      "RFG-ICE-SF",
      "RFG-VENT-EA",
    ],
    EXT: [
      "EXT-SIDING-SF",
      "EXT-SOFFIT-SF",
    ],
    WIN: [
      "WIN-GLASS-SF",
      "WIN-SCREEN-EA",
    ],
    PNT: [
      "PNT-EXT-SF",
    ],
  },
  fire: {
    DEM: [
      "DEM-DRY-SF",
      "DEM-CEIL-SF",
      "DEM-FLR-SF",
      "DEM-TRIM-LF",
      "DEM-INSUL-SF",
      "DEM-CAB-LF",
    ],
    DRY: [
      "DRY-X-1-2",
      "DRY-X-5-8",       // 5/8" fire-rated drywall
      "DRY-X-1-2FT",     // Fire taped
    ],
    PNT: [
      "PNT-INT-SF",
      "PNT-CEILING-SF",
      "PNT-TRIM-LF",
      "PNT-DRYWALL-SF",
    ],
    FLR: [
      "FLR-CARPET-SF",
      "FLR-PAD-SF",
      "FLR-VINYL-SF",
    ],
    EXT: [
      "EXT-SIDING-SF",
      "EXT-FASCIA-LF",
    ],
    RFG: [
      "RFG-SHIN-AR",
      "RFG-FELT-SQ",
    ],
    INS: [
      "INS-BATTS-SF",
      "INS-BLOWN-SF",
    ],
    ELE: [
      "ELE-OUTL-EA",     // Standard outlet
      "ELE-SWCH-EA",     // Light switch
      "ELE-X-110",       // 110 volt wiring run, box and outlet
    ],
  },
  smoke: {
    DRY: [
      "DRY-X-1-2",
    ],
    PNT: [
      "PNT-INT-SF",
      "PNT-CEILING-SF",
      "PNT-DRYWALL-SF",
    ],
    MIT: [
      "MIT-APPL-SF",     // Antimicrobial/cleaning
      "MIT-CONT-DAY",    // Containment
    ],
    DEM: [
      "DEM-DRY-SF",
    ],
  },
  crack: {
    DRY: [
      "DRY-PATCH-SF",
      "DRY-X-1-2",
    ],
    PNT: [
      "PNT-INT-SF",
      "PNT-DRYWALL-SF",
    ],
    EXT: [
      "EXT-STUCCO-SF",   // Stucco
    ],
  },
  dent: {
    EXT: [
      "EXT-SIDING-SF",
    ],
    WIN: [
      "WIN-GLASS-SF",
      "WIN-SCREEN-EA",
    ],
    CAB: [
      "CAB-BASE-LF",     // Base cabinet
    ],
  },
  missing: {
    RFG: [
      "RFG-X-300",
      "RFG-SHIN-AR",
      "RFG-FELT-SQ",
    ],
    EXT: [
      "EXT-SIDING-SF",
      "EXT-SOFFIT-SF",
    ],
    WIN: [
      "WIN-GLASS-SF",
      "WIN-SCREEN-EA",
    ],
    DRY: [
      "DRY-X-1-2",
    ],
  },
  rot: {
    EXT: [
      "EXT-SIDING-SF",
      "EXT-FASCIA-LF",
      "EXT-SOFFIT-SF",
    ],
    RFG: [
      "RFG-SHIN-AR",
      "RFG-UNDER-SF",    // Underlayment
    ],
    DRY: [
      "DRY-X-1-2",
      "DRY-PATCH-SF",
    ],
    FLR: [
      "FLR-WOOD-SF",     // Hardwood flooring
      "FLR-VINYL-SF",
    ],
    DEM: [
      "DEM-DRY-SF",
      "DEM-FLR-SF",
    ],
  },
  mechanical: {
    PLM: [
      "PLM-FAUCET-EA",   // Kitchen faucet
      "PLM-SINK-EA",     // Kitchen sink
      "PLM-TOIL-EA",     // Toilet
    ],
    ELE: [
      "ELE-OUTL-EA",     // Outlet
      "ELE-SWCH-EA",     // Switch
      "ELE-GFCI-EA",     // GFCI outlet
      "ELE-X-110",       // 110V wiring run
    ],
    HVAC: [
      "HVAC-DUCT-LF",    // Ductwork
      "HVAC-VENT-EA",    // Supply vent
      "HVAC-RETN-EA",    // Return air grille
      "HVAC-THERM-EA",   // Thermostat
    ],
  },
  wear_tear: {
    FLR: [
      "FLR-CARPET-SF",
      "FLR-PAD-SF",
      "FLR-VINYL-SF",
      "FLR-LAMINATE-SF",
    ],
    CAR: [
      "CAR-FRAME-LF",    // Wood framing
    ],
    PNT: [
      "PNT-INT-SF",
      "PNT-TRIM-LF",
    ],
    DRY: [
      "DRY-PATCH-SF",
    ],
  },
};

/**
 * Default codes per trade when no specific damage mapping exists.
 * Most common residential repair items for each trade.
 */
const DEFAULT_TRADE_CODES: Record<string, string[]> = {
  DEM: ["DEM-DRY-SF", "DEM-CEIL-SF", "DEM-FLR-SF", "DEM-TRIM-LF"],
  DRY: ["DRY-X-1-2", "DRY-PATCH-SF"],
  PNT: ["PNT-INT-SF", "PNT-CEILING-SF", "PNT-TRIM-LF"],
  FLR: ["FLR-CARPET-SF", "FLR-PAD-SF", "FLR-VINYL-SF", "FLR-LAMINATE-SF"],
  RFG: ["RFG-X-300", "RFG-SHIN-AR", "RFG-FELT-SQ", "RFG-RIDGE-LF"],
  EXT: ["EXT-SIDING-SF", "EXT-SOFFIT-SF", "EXT-FASCIA-LF"],
  WIN: ["WIN-DOUBLE-EA", "WIN-GLASS-SF"],
  INS: ["INS-BATTS-SF", "INS-BLOWN-SF"],
  CAR: ["CAR-FRAME-LF"],
  MIT: ["MIT-AIRM-DAY", "MIT-DEHM-DAY", "MIT-APPL-SF"],
  ELE: ["ELE-OUTL-EA", "ELE-SWCH-EA", "ELE-GFCI-EA"],
  PLM: ["PLM-FAUCET-EA", "PLM-TOIL-EA"],
  HVAC: ["HVAC-DUCT-LF", "HVAC-VENT-EA"],
  CAB: ["CAB-BASE-LF", "CAB-WALL-LF"],
  CTR: ["CTR-LAM-SF", "CTR-GRAN-SF"],
};

/**
 * Assembles scope items for a damage observation in a room.
 * 1. Maps damageType → trades → curated Xactimate codes
 * 2. Looks up each code in the catalog
 * 3. Falls back to searching by trade if curated code not found
 * 4. Derives quantities from room geometry via scopeQuantityEngine when available
 * 5. Flags items needing manual quantities when dimensions are missing
 */
export async function assembleScope(
  storage: IStorage,
  sessionId: number,
  room: InspectionRoom,
  damage: DamageObservation,
  _netWallDeduction: number = 0
): Promise<ScopeAssemblyResult> {
  const result: ScopeAssemblyResult = {
    created: [],
    companionItems: [],
    manualQuantityNeeded: [],
    warnings: [],
  };

  const allCatalogItems = await storage.getScopeLineItems();
  const activeCatalog = allCatalogItems.filter(item => item.isActive && item.xactCategoryCode != null);

  const catalogByCode = new Map<string, ScopeLineItem>();
  for (const item of activeCatalog) {
    catalogByCode.set(item.code, item);
  }

  const matchingItems = findMatchingItems(catalogByCode, activeCatalog, damage);

  if (matchingItems.length === 0) {
    result.warnings.push(
      `No Xactimate items found for damage "${damage.damageType}" in "${room.roomType || "unknown"}" room. ` +
      `Items can be added manually via add_line_item.`
    );
    return result;
  }

  result.warnings.push(`Found ${matchingItems.length} Xactimate items for "${damage.damageType}" damage.`);

  const existingScopeItems = await storage.getScopeItems(sessionId);
  const existingCodes = new Set(
    existingScopeItems
      .filter(si => si.roomId === room.id && si.status === "active")
      .map(si => si.catalogCode)
  );

  // Check if room has usable dimensions for quantity derivation
  const dims = room.dimensions as Record<string, unknown> | null;
  const hasDimensions = !!(dims && (dims.length as number) > 0 && (dims.width as number) > 0);

  const itemsToCreate: InsertScopeItem[] = [];

  for (const catalogItem of matchingItems) {
    if (existingCodes.has(catalogItem.code)) {
      continue;
    }

    // Derive quantity from room geometry using catalog's quantityFormula
    let quantity = 1;
    let quantityFormula: string | null = catalogItem.quantityFormula || null;

    if (quantityFormula && quantityFormula !== "MANUAL" && quantityFormula !== "EACH") {
      if (hasDimensions) {
        const qResult = deriveQuantity(room, quantityFormula as QuantityFormula, _netWallDeduction);
        if (qResult && qResult.quantity > 0) {
          quantity = qResult.quantity;
        } else {
          // Formula didn't produce a usable quantity
          result.manualQuantityNeeded.push({
            catalogCode: catalogItem.code,
            description: catalogItem.xactDescription || catalogItem.description,
            unit: catalogItem.unit,
            reason: "Could not derive quantity from room geometry",
          });
        }
      } else {
        // Room lacks dimensions — flag for manual entry
        result.manualQuantityNeeded.push({
          catalogCode: catalogItem.code,
          description: catalogItem.xactDescription || catalogItem.description,
          unit: catalogItem.unit,
          reason: "Room dimensions not available — provide dimensions with update_room_dimensions for accurate quantities",
        });
      }
    } else if (quantityFormula === "MANUAL") {
      result.manualQuantityNeeded.push({
        catalogCode: catalogItem.code,
        description: catalogItem.xactDescription || catalogItem.description,
        unit: catalogItem.unit,
        reason: "Manual measurement required",
      });
    } else if (quantityFormula === "EACH" || !quantityFormula) {
      // EACH or no formula — quantity stays at 1
      quantity = 1;
    }

    itemsToCreate.push({
      sessionId,
      roomId: room.id,
      damageId: damage.id,
      catalogCode: catalogItem.code,
      description: catalogItem.xactDescription || catalogItem.description,
      tradeCode: catalogItem.tradeCode,
      quantity,
      unit: catalogItem.unit,
      quantityFormula,
      provenance: "damage_triggered",
      coverageType: catalogItem.coverageType || "A",
      activityType: catalogItem.activityType || "replace",
      wasteFactor: catalogItem.defaultWasteFactor ?? null,
      status: "active",
      parentScopeItemId: null,
    });
  }

  if (itemsToCreate.length > 0) {
    const created = await storage.createScopeItems(itemsToCreate);
    result.created.push(...created);
  }

  if (!hasDimensions && itemsToCreate.length > 0) {
    result.warnings.push(
      `Room "${room.name}" has no dimensions — scope item quantities default to 1. ` +
      `Call update_room_dimensions to set measurements; quantities will auto-update.`
    );
  }

  await storage.recalculateScopeSummary(sessionId);

  return result;
}

/**
 * Finds matching Xactimate catalog items for a damage observation.
 * Uses curated code lists first, then falls back to trade-based lookup.
 */
function findMatchingItems(
  catalogByCode: Map<string, ScopeLineItem>,
  allItems: ScopeLineItem[],
  damage: DamageObservation,
): ScopeLineItem[] {
  const damageType = damage.damageType || "other";
  const relevantTrades = DAMAGE_TYPE_TO_TRADES[damageType] || DAMAGE_TYPE_TO_TRADES["other"];

  const matched: ScopeLineItem[] = [];
  const seenCodes = new Set<string>();

  const curatedMapping = CURATED_CODES[damageType];

  for (const tradeCode of relevantTrades) {
    const codesToTry = curatedMapping?.[tradeCode] || DEFAULT_TRADE_CODES[tradeCode] || [];

    for (const code of codesToTry) {
      if (seenCodes.has(code)) continue;
      const item = catalogByCode.get(code);
      if (item) {
        seenCodes.add(code);
        matched.push(item);
      }
    }

    if (matched.filter(m => m.tradeCode === tradeCode).length === 0) {
      const tradeItems = allItems.filter(item =>
        item.tradeCode === tradeCode &&
        item.activityType === "install" &&
        !seenCodes.has(item.code)
      );
      const topItems = tradeItems.slice(0, 3);
      for (const item of topItems) {
        seenCodes.add(item.code);
        matched.push(item);
      }
    }
  }

  return matched;
}
