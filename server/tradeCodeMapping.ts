/**
 * tradeCodeMapping.ts
 * Comprehensive mapping of trade codes to Xactimate categories
 * with dynamic peril-aware categorization for mitigation work
 */

export const COMPLETE_TRADE_CODE_MAP: Record<string, string> = {
  RFG: "RFG",
  ROOF: "RFG",
  SFT: "RFG",
  FAS: "RFG",
  GUT: "RFG",
  FLS: "RFG",
  SDG: "SDG",
  EXT: "SDG",
  SID: "SDG",
  SIDING: "SDG",
  DRY: "DRY",
  DYW: "DRY",
  DRYWALL: "DRY",
  PNT: "PNT",
  PAINT: "PNT",
  FLR: "FLR",
  FLOOR: "FLR",
  CAR: "FLR",
  CARPET: "FLR",
  WIN: "WIN",
  WINDOW: "WIN",
  ELE: "ELE",
  ELEC: "ELE",
  ELECTRICAL: "ELE",
  PLM: "PLM",
  PLUMB: "PLM",
  PLUMBING: "PLM",
  HVA: "HVA",
  HVAC: "HVA",
  MEC: "HVA",
  MECHANICAL: "HVA",
  INS: "INS",
  INSULATION: "INS",
  CAB: "CAB",
  CABINET: "CAB",
  CTR: "CTR",
  COUNTERTOP: "CTR",
  COUNTER: "CTR",
  FRM: "FRM",
  FRAME: "FRM",
  CARPENTRY: "FRM",
  STRUCTURE: "FRM",
  APL: "APL",
  APPLIANCE: "APL",
  MAJOR_APL: "APL",
  DOR: "DOR",
  DOOR: "DOR",
  DEM: "DEM",
  DEMO: "DEM",
  DEMOLITION: "DEM",
  MIT: "MIT",
  MITIGATION: "MIT",
  GEN: "GEN",
  GENERAL: "GEN",
};

/**
 * Resolve mitigation category based on peril type
 */
export function resolveMitigationCategory(perilType?: string): string {
  if (!perilType) return "WTR";

  const normalized = perilType.toLowerCase().trim();
  const perilCategoryMap: Record<string, string> = {
    water: "WTR",
    flood: "WTR",
    flooding: "WTR",
    "water damage": "WTR",
    wet: "WTR",
    fire: "FIR",
    smoke: "FIR",
    "fire damage": "FIR",
    wind: "WND",
    hail: "WND",
    windstorm: "WND",
    mold: "MLR",
    "mold damage": "MLR",
    other: "GEN",
  };

  return perilCategoryMap[normalized] ?? "WTR";
}

/**
 * Resolve category for a trade code, with dynamic resolution for MIT
 */
export function resolveCategory(tradeCode?: string, perilType?: string): string {
  if (!tradeCode) return "GEN";

  const normalized = tradeCode.toUpperCase().trim();
  const category = COMPLETE_TRADE_CODE_MAP[normalized];

  if (category === "MIT") {
    return resolveMitigationCategory(perilType);
  }

  return category ?? "GEN";
}
