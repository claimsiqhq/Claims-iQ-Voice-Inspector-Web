/**
 * tradeCodeMapping.ts
 * Maps internal trade codes to official Xactimate category codes.
 * Reference: https://xactware.helpdocs.io/l/enUS/article/gb9lf49tdw-category-codes-in-xactimate-online
 */

export const COMPLETE_TRADE_CODE_MAP: Record<string, string> = {
  RFG: "RFG",
  ROOF: "RFG",
  SFT: "SFG",
  FAS: "SFG",
  GUT: "SFG",
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
  FLR: "FCC",
  FLOOR: "FCC",
  CAR: "FCC",
  CARPET: "FCC",
  TILE: "FCT",
  VINYL: "FCV",
  LAMINATE: "FCR",
  HARDWOOD: "FCW",
  WIN: "WDW",
  WINDOW: "WDW",
  ELE: "ELE",
  ELEC: "ELE",
  ELECTRICAL: "ELE",
  PLM: "PLM",
  PLUMB: "PLM",
  PLUMBING: "PLM",
  HVA: "HVC",
  HVAC: "HVC",
  MEC: "HVC",
  MECHANICAL: "HVC",
  INS: "INS",
  INSULATION: "INS",
  CAB: "CAB",
  CABINET: "CAB",
  CTR: "CAB",
  COUNTERTOP: "CAB",
  COUNTER: "CAB",
  FRM: "FRM",
  FRAME: "FRM",
  CARPENTRY: "FRM",
  STRUCTURE: "FRM",
  APL: "APP",
  APPLIANCE: "APP",
  MAJOR_APL: "APP",
  DOR: "DOR",
  DOOR: "DOR",
  DEM: "DMO",
  DEMO: "DMO",
  DEMOLITION: "DMO",
  MIT: "MIT",
  MITIGATION: "MIT",
  GEN: "GEN",
  GENERAL: "GEN",
  CLN: "CLN",
  CLEAN: "CLN",
  FEE: "FEE",
  PERMIT: "FEE",
  LAB: "LAB",
  LABOR: "LAB",
  CON: "CON",
  CONTENT: "CON",
  FEN: "FEN",
  FENCE: "FEN",
  STU: "STU",
  STUCCO: "STU",
  MAS: "MAS",
  MASONRY: "MAS",
  SFG: "SFG",
  SOFFIT: "SFG",
  FASCIA: "SFG",
  GUTTER: "SFG",
};

export function resolveMitigationCategory(perilType?: string): string {
  if (!perilType) return "WTR";

  const normalized = perilType.toLowerCase().trim();
  const perilCategoryMap: Record<string, string> = {
    water: "WTR",
    flood: "WTR",
    flooding: "WTR",
    "water damage": "WTR",
    wet: "WTR",
    fire: "FRP",
    smoke: "FRP",
    "fire damage": "FRP",
    wind: "TMP",
    hail: "TMP",
    windstorm: "TMP",
    mold: "HMR",
    "mold damage": "HMR",
    other: "GEN",
  };

  return perilCategoryMap[normalized] ?? "WTR";
}

export function resolveCategory(tradeCode?: string, perilType?: string): string {
  if (!tradeCode) return "GEN";

  const normalized = tradeCode.toUpperCase().trim();
  const category = COMPLETE_TRADE_CODE_MAP[normalized];

  if (category === "MIT") {
    return resolveMitigationCategory(perilType);
  }

  return category ?? "GEN";
}
