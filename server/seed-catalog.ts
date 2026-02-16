import { db } from "./db";
import { logger } from "./logger";
import { scopeLineItems, regionalPriceSets } from "@shared/schema";
import { eq } from "drizzle-orm";

interface EnhancedCatalogItem {
  code: string;
  trade: string;
  desc: string;
  unit: string;
  waste: number;
  quantityFormula: string;
  activityType: string;
  coverageType: string;
  xactCategoryCode: string;
  xactSelector: string;
  notes: string;
  scopeConditions: {
    damage_types?: string[];
    surfaces?: string[];
    severity?: string[];
    room_types?: string[];
    zone_types?: string[];
  } | null;
  companionRules: { requires?: string[]; auto_adds?: string[]; excludes?: string[] };
}

const ENHANCED_CATALOG: EnhancedCatalogItem[] = [
  // ─── MIT: Mitigation ─────────────────────────────────────────────────────
  { code: "MIT-EXTR-SF", trade: "MIT", desc: "Water extraction - standing water, per SF", unit: "SF", waste: 0, quantityFormula: "FLOOR_SF", activityType: "clean", coverageType: "A", xactCategoryCode: "WTR", xactSelector: "WTEX", notes: "Standing water extraction.", scopeConditions: { damage_types: ["water_intrusion"], surfaces: ["floor"], severity: ["moderate", "severe"] }, companionRules: { auto_adds: ["MIT-DEHU-DAY", "MIT-AIRM-DAY"] } },
  { code: "MIT-EXTR-CA", trade: "MIT", desc: "Water extraction - carpet/pad, per SF", unit: "SF", waste: 0, quantityFormula: "FLOOR_SF", activityType: "clean", coverageType: "A", xactCategoryCode: "WTR", xactSelector: "WTEX-C", notes: "Carpet/pad water extraction.", scopeConditions: { damage_types: ["water_intrusion"], surfaces: ["floor"], room_types: ["interior_bedroom", "interior_living", "interior_family", "interior_den"] }, companionRules: { auto_adds: ["MIT-DEHU-DAY", "MIT-AIRM-DAY"] } },
  { code: "MIT-DEHU-DAY", trade: "MIT", desc: "Dehumidifier per day", unit: "DAY", waste: 0, quantityFormula: "MANUAL", activityType: "labor_only", coverageType: "A", xactCategoryCode: "WTR", xactSelector: "DEHU", notes: "Standard dehumidifier. Typically 3-5 day minimum.", scopeConditions: { damage_types: ["water_intrusion", "water_stain"] }, companionRules: { auto_adds: ["MIT-MONI-DAY"] } },
  { code: "MIT-AIRM-DAY", trade: "MIT", desc: "Air mover per day", unit: "DAY", waste: 0, quantityFormula: "MANUAL", activityType: "labor_only", coverageType: "A", xactCategoryCode: "WTR", xactSelector: "AIRM", notes: "Air mover/fan. Typically 3-5 day minimum.", scopeConditions: { damage_types: ["water_intrusion", "water_stain"] }, companionRules: {} },
  { code: "MIT-DEHM-DAY", trade: "MIT", desc: "Large dehumidifier per day", unit: "DAY", waste: 0, quantityFormula: "MANUAL", activityType: "labor_only", coverageType: "A", xactCategoryCode: "WTR", xactSelector: "DEHM", notes: "Large/industrial dehumidifier.", scopeConditions: { damage_types: ["water_intrusion"], severity: ["severe"] }, companionRules: { auto_adds: ["MIT-MONI-DAY"] } },
  { code: "MIT-APPL-SF", trade: "MIT", desc: "Apply antimicrobial treatment, per SF", unit: "SF", waste: 5, quantityFormula: "WALLS_CEILING_SF", activityType: "clean", coverageType: "A", xactCategoryCode: "WTR", xactSelector: "ANTI", notes: "Antimicrobial/antifungal application.", scopeConditions: { damage_types: ["water_intrusion", "mold"], severity: ["moderate", "severe"] }, companionRules: {} },
  { code: "MIT-MOLD-SF", trade: "MIT", desc: "Mold remediation, per SF", unit: "SF", waste: 10, quantityFormula: "WALL_SF", activityType: "clean", coverageType: "A", xactCategoryCode: "WTR", xactSelector: "MOLD", notes: "Professional mold remediation.", scopeConditions: { damage_types: ["mold"], severity: ["moderate", "severe"] }, companionRules: { requires: ["MIT-CONT-DAY"], auto_adds: ["MIT-APPL-SF"] } },
  { code: "MIT-DEMO-SF", trade: "MIT", desc: "Flood cut drywall (up to 4 ft), per SF", unit: "SF", waste: 0, quantityFormula: "MANUAL", activityType: "remove", coverageType: "A", xactCategoryCode: "WTR", xactSelector: "FLDC", notes: "Flood cut: remove drywall up to 4' height.", scopeConditions: { damage_types: ["water_intrusion"], surfaces: ["wall"], severity: ["moderate", "severe"] }, companionRules: { auto_adds: ["MIT-APPL-SF", "DRY-SHEET-SF"] } },
  { code: "MIT-CONT-DAY", trade: "MIT", desc: "Containment setup, per day", unit: "DAY", waste: 0, quantityFormula: "MANUAL", activityType: "labor_only", coverageType: "A", xactCategoryCode: "WTR", xactSelector: "CONT", notes: "Containment barrier with poly sheeting.", scopeConditions: { damage_types: ["mold"], severity: ["severe"] }, companionRules: {} },
  { code: "MIT-MONI-DAY", trade: "MIT", desc: "Moisture monitoring, per day", unit: "DAY", waste: 0, quantityFormula: "MANUAL", activityType: "labor_only", coverageType: "A", xactCategoryCode: "WTR", xactSelector: "MONI", notes: "Daily moisture readings.", scopeConditions: { damage_types: ["water_intrusion", "water_stain"] }, companionRules: {} },

  // ─── DEM: Demolition ─────────────────────────────────────────────────────
  { code: "DEM-DRY-SF", trade: "DEM", desc: "Remove drywall, per SF", unit: "SF", waste: 0, quantityFormula: "WALL_SF", activityType: "remove", coverageType: "A", xactCategoryCode: "DEM", xactSelector: "DRY", notes: "Full wall drywall removal.", scopeConditions: { damage_types: ["water_intrusion", "water_stain", "mold"], surfaces: ["wall"], severity: ["severe"] }, companionRules: { auto_adds: ["DEM-HAUL-LD", "DRY-SHEET-SF"] } },
  { code: "DEM-CEIL-SF", trade: "DEM", desc: "Remove ceiling drywall, per SF", unit: "SF", waste: 0, quantityFormula: "CEILING_SF", activityType: "remove", coverageType: "A", xactCategoryCode: "DEM", xactSelector: "CEIL", notes: "Ceiling drywall removal.", scopeConditions: { damage_types: ["water_intrusion", "water_stain"], surfaces: ["ceiling"], severity: ["severe"] }, companionRules: { auto_adds: ["DEM-HAUL-LD", "DEM-INSUL-SF"] } },
  { code: "DEM-FLR-SF", trade: "DEM", desc: "Remove flooring, per SF", unit: "SF", waste: 0, quantityFormula: "FLOOR_SF", activityType: "remove", coverageType: "A", xactCategoryCode: "DEM", xactSelector: "FLR", notes: "Generic flooring removal.", scopeConditions: { damage_types: ["water_intrusion"], surfaces: ["floor"], severity: ["moderate", "severe"] }, companionRules: { auto_adds: ["DEM-HAUL-LD"] } },
  { code: "DEM-PAD-SF", trade: "DEM", desc: "Remove carpet pad, per SF", unit: "SF", waste: 0, quantityFormula: "FLOOR_SF", activityType: "remove", coverageType: "A", xactCategoryCode: "DEM", xactSelector: "PAD", notes: "Carpet pad removal.", scopeConditions: { damage_types: ["water_intrusion"], surfaces: ["floor"] }, companionRules: { auto_adds: ["DEM-HAUL-LD"] } },
  { code: "DEM-TILE-SF", trade: "DEM", desc: "Remove ceramic tile, per SF", unit: "SF", waste: 0, quantityFormula: "FLOOR_SF", activityType: "remove", coverageType: "A", xactCategoryCode: "DEM", xactSelector: "TILE", notes: "Ceramic/porcelain tile removal.", scopeConditions: { damage_types: ["water_intrusion", "crack"], surfaces: ["floor"] }, companionRules: { auto_adds: ["DEM-HAUL-LD"], excludes: ["DEM-FLR-SF"] } },
  { code: "DEM-CAB-LF", trade: "DEM", desc: "Remove base cabinets, per LF", unit: "LF", waste: 0, quantityFormula: "MANUAL", activityType: "remove", coverageType: "A", xactCategoryCode: "DEM", xactSelector: "CAB", notes: "Base cabinet removal.", scopeConditions: { damage_types: ["water_intrusion"], room_types: ["interior_kitchen", "interior_bathroom", "interior_laundry"] }, companionRules: { auto_adds: ["DEM-HAUL-LD"] } },
  { code: "DEM-TRIM-LF", trade: "DEM", desc: "Remove trim/baseboard, per LF", unit: "LF", waste: 0, quantityFormula: "PERIMETER_LF", activityType: "remove", coverageType: "A", xactCategoryCode: "DEM", xactSelector: "TRIM", notes: "Baseboard/trim removal.", scopeConditions: { damage_types: ["water_intrusion"], surfaces: ["floor"] }, companionRules: { auto_adds: ["FLR-TRIM-LF"] } },
  { code: "DEM-HAUL-LD", trade: "DEM", desc: "Haul debris, per load", unit: "LD", waste: 0, quantityFormula: "MANUAL", activityType: "labor_only", coverageType: "A", xactCategoryCode: "DEM", xactSelector: "HAUL", notes: "Debris haul-off.", scopeConditions: null, companionRules: { auto_adds: ["DEM-DUMP-LD"] } },
  { code: "DEM-DUMP-LD", trade: "DEM", desc: "Dump fees, per load", unit: "LD", waste: 0, quantityFormula: "MANUAL", activityType: "labor_only", coverageType: "A", xactCategoryCode: "DEM", xactSelector: "DUMP", notes: "Disposal/dump fees.", scopeConditions: null, companionRules: {} },
  { code: "DEM-INSUL-SF", trade: "DEM", desc: "Remove insulation, per SF", unit: "SF", waste: 0, quantityFormula: "CEILING_SF", activityType: "remove", coverageType: "A", xactCategoryCode: "DEM", xactSelector: "INSUL", notes: "Insulation removal from ceiling/attic.", scopeConditions: { damage_types: ["water_intrusion"], surfaces: ["ceiling"] }, companionRules: { auto_adds: ["INS-BATTS-SF"] } },
  { code: "DEM-VANITY-EA", trade: "DEM", desc: "Remove vanity, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "remove", coverageType: "A", xactCategoryCode: "DEM", xactSelector: "VANITY", notes: "Vanity removal.", scopeConditions: { damage_types: ["water_intrusion"], room_types: ["interior_bathroom"] }, companionRules: { auto_adds: ["DEM-HAUL-LD"] } },

  // ─── DRY: Drywall ────────────────────────────────────────────────────────
  { code: "DRY-SHEET-SF", trade: "DRY", desc: "Drywall 1/2\" - hang, tape, float, texture", unit: "SF", waste: 10, quantityFormula: "WALL_SF", activityType: "replace", coverageType: "A", xactCategoryCode: "DRY", xactSelector: "1/2++", notes: "Standard 1/2\" drywall.", scopeConditions: { damage_types: ["water_intrusion", "water_stain", "mold"], surfaces: ["wall"], severity: ["moderate", "severe"] }, companionRules: { requires: ["DEM-DRY-SF"], auto_adds: ["DRY-TAPE-LF", "DRY-JOINT-SF", "PNT-DRYWALL-SF"], excludes: ["DRY-PATCH-SF"] } },
  { code: "DRY-TAPE-LF", trade: "DRY", desc: "Drywall tape, per LF", unit: "LF", waste: 5, quantityFormula: "MANUAL", activityType: "install", coverageType: "A", xactCategoryCode: "DRY", xactSelector: "TAPE", notes: "Paper or fiberglass mesh tape.", scopeConditions: null, companionRules: {} },
  { code: "DRY-JOINT-SF", trade: "DRY", desc: "Joint compound application, per SF", unit: "SF", waste: 8, quantityFormula: "WALL_SF", activityType: "install", coverageType: "A", xactCategoryCode: "DRY", xactSelector: "JOINT", notes: "Joint compound (mud) application.", scopeConditions: null, companionRules: { auto_adds: ["DRY-SAND-SF"] } },
  { code: "DRY-SAND-SF", trade: "DRY", desc: "Sand drywall finish, per SF", unit: "SF", waste: 0, quantityFormula: "WALL_SF", activityType: "labor_only", coverageType: "A", xactCategoryCode: "DRY", xactSelector: "SAND", notes: "Sanding between joint compound coats.", scopeConditions: null, companionRules: {} },
  { code: "DRY-PATCH-SF", trade: "DRY", desc: "Patch drywall, per SF", unit: "SF", waste: 10, quantityFormula: "MANUAL", activityType: "repair", coverageType: "A", xactCategoryCode: "DRY", xactSelector: "PTCH", notes: "Small area patch (< 16 SF).", scopeConditions: { damage_types: ["water_stain", "crack", "dent"], surfaces: ["wall", "ceiling"], severity: ["minor"] }, companionRules: { auto_adds: ["PNT-DRYWALL-SF"], excludes: ["DRY-SHEET-SF"] } },
  { code: "DRY-SOFFIT-SF", trade: "DRY", desc: "Install soffit drywall, per SF", unit: "SF", waste: 12, quantityFormula: "MANUAL", activityType: "install", coverageType: "A", xactCategoryCode: "DRY", xactSelector: "SOFF", notes: "Soffit/bulkhead drywall.", scopeConditions: null, companionRules: { auto_adds: ["DRY-TAPE-LF", "DRY-JOINT-SF"] } },
  { code: "DRY-CORNER-EA", trade: "DRY", desc: "Corner bead, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "install", coverageType: "A", xactCategoryCode: "DRY", xactSelector: "CRNR", notes: "Metal or vinyl corner bead.", scopeConditions: null, companionRules: {} },
  { code: "DRY-FRAME-LF", trade: "DRY", desc: "Metal stud framing, per LF", unit: "LF", waste: 5, quantityFormula: "MANUAL", activityType: "install", coverageType: "A", xactCategoryCode: "DRY", xactSelector: "STUD", notes: "Light gauge metal stud framing.", scopeConditions: null, companionRules: {} },
  { code: "DRY-MESH-SF", trade: "DRY", desc: "Drywall mesh tape, per SF", unit: "SF", waste: 3, quantityFormula: "WALL_SF", activityType: "install", coverageType: "A", xactCategoryCode: "DRY", xactSelector: "MESH", notes: "Self-adhesive fiberglass mesh.", scopeConditions: null, companionRules: {} },
  { code: "DRY-PRIMER-SF", trade: "DRY", desc: "Primer/sealer on new drywall, per SF", unit: "SF", waste: 8, quantityFormula: "WALL_SF", activityType: "install", coverageType: "A", xactCategoryCode: "DRY", xactSelector: "PRIM", notes: "PVA primer/sealer on new drywall.", scopeConditions: null, companionRules: {} },

  // ─── PNT: Painting ───────────────────────────────────────────────────────
  { code: "PNT-INT-SF", trade: "PNT", desc: "Interior wall paint - 2 coats, per SF", unit: "SF", waste: 10, quantityFormula: "WALL_SF", activityType: "install", coverageType: "A", xactCategoryCode: "PNT", xactSelector: "INT", notes: "Standard interior latex paint, 2 coats.", scopeConditions: { surfaces: ["wall"] }, companionRules: { requires: ["DRY-SHEET-SF"], auto_adds: ["PNT-PREP-SF"] } },
  { code: "PNT-EXT-SF", trade: "PNT", desc: "Exterior paint - 2 coats, per SF", unit: "SF", waste: 10, quantityFormula: "WALL_SF", activityType: "install", coverageType: "A", xactCategoryCode: "PNT", xactSelector: "EXT", notes: "Exterior latex or acrylic paint, 2 coats.", scopeConditions: { zone_types: ["exterior"], surfaces: ["wall"] }, companionRules: { auto_adds: ["PNT-PREP-SF"] } },
  { code: "PNT-TRIM-LF", trade: "PNT", desc: "Paint trim/baseboard, per LF", unit: "LF", waste: 8, quantityFormula: "PERIMETER_LF", activityType: "install", coverageType: "A", xactCategoryCode: "PNT", xactSelector: "TRIM", notes: "Paint baseboard, door/window trim.", scopeConditions: null, companionRules: {} },
  { code: "PNT-PREP-SF", trade: "PNT", desc: "Paint prep and masking, per SF", unit: "SF", waste: 0, quantityFormula: "WALL_SF", activityType: "labor_only", coverageType: "A", xactCategoryCode: "PNT", xactSelector: "PREP", notes: "Prep, mask, and protect.", scopeConditions: null, companionRules: {} },
  { code: "PNT-STAIN-SF", trade: "PNT", desc: "Stain wood surfaces, per SF", unit: "SF", waste: 12, quantityFormula: "MANUAL", activityType: "install", coverageType: "A", xactCategoryCode: "PNT", xactSelector: "STAIN", notes: "Wood stain application.", scopeConditions: null, companionRules: {} },
  { code: "PNT-CAULK-LF", trade: "PNT", desc: "Caulk joints and seams, per LF", unit: "LF", waste: 5, quantityFormula: "PERIMETER_LF", activityType: "install", coverageType: "A", xactCategoryCode: "PNT", xactSelector: "CAULK", notes: "Paintable caulk at wall/ceiling/trim joints.", scopeConditions: null, companionRules: {} },
  { code: "PNT-CABINET-SF", trade: "PNT", desc: "Cabinet refinish/paint, per SF", unit: "SF", waste: 10, quantityFormula: "MANUAL", activityType: "install", coverageType: "A", xactCategoryCode: "PNT", xactSelector: "CAB", notes: "Cabinet painting/refinishing.", scopeConditions: { room_types: ["interior_kitchen", "interior_bathroom"] }, companionRules: {} },
  { code: "PNT-DRYWALL-SF", trade: "PNT", desc: "Paint new drywall, per SF", unit: "SF", waste: 8, quantityFormula: "WALL_SF", activityType: "install", coverageType: "A", xactCategoryCode: "PNT", xactSelector: "DRY", notes: "Paint over new drywall. Includes prime + 2 finish coats.", scopeConditions: null, companionRules: { requires: ["DRY-SHEET-SF"] } },
  { code: "PNT-CEILING-SF", trade: "PNT", desc: "Paint ceiling, per SF", unit: "SF", waste: 12, quantityFormula: "CEILING_SF", activityType: "install", coverageType: "A", xactCategoryCode: "PNT", xactSelector: "CEIL", notes: "Ceiling paint - flat white standard.", scopeConditions: { surfaces: ["ceiling"] }, companionRules: { auto_adds: ["PNT-PREP-SF"] } },
  { code: "PNT-EPOXY-SF", trade: "PNT", desc: "Epoxy floor coating, per SF", unit: "SF", waste: 15, quantityFormula: "FLOOR_SF", activityType: "install", coverageType: "A", xactCategoryCode: "PNT", xactSelector: "EPOXY", notes: "Epoxy floor coating for garages, basements.", scopeConditions: { room_types: ["interior_garage", "interior_utility"] }, companionRules: {} },
  { code: "PNT-SPRAY-SF", trade: "PNT", desc: "Spray painting, per SF", unit: "SF", waste: 12, quantityFormula: "WALL_SF", activityType: "install", coverageType: "A", xactCategoryCode: "PNT", xactSelector: "SPRAY", notes: "Airless spray application.", scopeConditions: null, companionRules: {} },
  { code: "PNT-VARNISH-SF", trade: "PNT", desc: "Varnish/polyurethane, per SF", unit: "SF", waste: 10, quantityFormula: "FLOOR_SF", activityType: "install", coverageType: "A", xactCategoryCode: "PNT", xactSelector: "VARN", notes: "Clear-coat finish for wood floors or trim.", scopeConditions: null, companionRules: {} },

  // ─── FLR: Flooring ───────────────────────────────────────────────────────
  { code: "FLR-TILE-SF", trade: "FLR", desc: "Ceramic tile flooring, per SF", unit: "SF", waste: 15, quantityFormula: "FLOOR_SF", activityType: "replace", coverageType: "A", xactCategoryCode: "FLR", xactSelector: "TILE", notes: "Ceramic/porcelain tile installation.", scopeConditions: { damage_types: ["water_intrusion"], surfaces: ["floor"] }, companionRules: { requires: ["DEM-FLR-SF"], auto_adds: ["FLR-GROUT-SF", "FLR-MORTAR-SF"] } },
  { code: "FLR-VINYL-SF", trade: "FLR", desc: "Vinyl plank flooring, per SF", unit: "SF", waste: 10, quantityFormula: "FLOOR_SF", activityType: "replace", coverageType: "A", xactCategoryCode: "FLR", xactSelector: "VINYL", notes: "LVT or vinyl plank flooring.", scopeConditions: { damage_types: ["water_intrusion"], surfaces: ["floor"] }, companionRules: { requires: ["DEM-FLR-SF"] } },
  { code: "FLR-LAMINATE-SF", trade: "FLR", desc: "Laminate flooring, per SF", unit: "SF", waste: 12, quantityFormula: "FLOOR_SF", activityType: "replace", coverageType: "A", xactCategoryCode: "FLR", xactSelector: "LAM", notes: "Laminate flooring installation.", scopeConditions: { damage_types: ["water_intrusion"], surfaces: ["floor"] }, companionRules: { requires: ["DEM-FLR-SF"], auto_adds: ["FLR-PAD-SF"] } },
  { code: "FLR-WOOD-SF", trade: "FLR", desc: "Hardwood flooring, per SF", unit: "SF", waste: 10, quantityFormula: "FLOOR_SF", activityType: "replace", coverageType: "A", xactCategoryCode: "FLR", xactSelector: "HWD", notes: "Solid or engineered hardwood.", scopeConditions: { damage_types: ["water_intrusion"], surfaces: ["floor"] }, companionRules: { requires: ["DEM-FLR-SF"] } },
  { code: "FLR-CARPET-SF", trade: "FLR", desc: "Carpet installation, per SF", unit: "SF", waste: 12, quantityFormula: "FLOOR_SF", activityType: "replace", coverageType: "A", xactCategoryCode: "FLR", xactSelector: "CAR", notes: "Carpet installation.", scopeConditions: { damage_types: ["water_intrusion"], surfaces: ["floor"] }, companionRules: { requires: ["DEM-FLR-SF"], auto_adds: ["FLR-PAD-SF"] } },
  { code: "FLR-PAD-SF", trade: "FLR", desc: "Underlayment, per SF", unit: "SF", waste: 8, quantityFormula: "FLOOR_SF", activityType: "install", coverageType: "A", xactCategoryCode: "FLR", xactSelector: "PAD", notes: "Carpet pad or underlayment.", scopeConditions: null, companionRules: {} },
  { code: "FLR-GROUT-SF", trade: "FLR", desc: "Tile grout, per SF", unit: "SF", waste: 10, quantityFormula: "FLOOR_SF", activityType: "install", coverageType: "A", xactCategoryCode: "FLR", xactSelector: "GROUT", notes: "Tile grout application.", scopeConditions: null, companionRules: { auto_adds: ["FLR-SEALANT-SF"] } },
  { code: "FLR-MORTAR-SF", trade: "FLR", desc: "Tile mortar, per SF", unit: "SF", waste: 10, quantityFormula: "FLOOR_SF", activityType: "install", coverageType: "A", xactCategoryCode: "FLR", xactSelector: "MORTAR", notes: "Thinset mortar for tile.", scopeConditions: null, companionRules: {} },
  { code: "FLR-SEALANT-SF", trade: "FLR", desc: "Grout/tile sealant, per SF", unit: "SF", waste: 8, quantityFormula: "FLOOR_SF", activityType: "install", coverageType: "A", xactCategoryCode: "FLR", xactSelector: "SEAL", notes: "Grout sealant.", scopeConditions: null, companionRules: {} },
  { code: "FLR-TRIM-LF", trade: "FLR", desc: "Floor trim/molding, per LF", unit: "LF", waste: 10, quantityFormula: "PERIMETER_LF", activityType: "install", coverageType: "A", xactCategoryCode: "FLR", xactSelector: "TRIM", notes: "Baseboard after flooring replacement.", scopeConditions: null, companionRules: { auto_adds: ["PNT-TRIM-LF"] } },

  // ─── INS: Insulation ──────────────────────────────────────────────────────
  { code: "INS-BATTS-SF", trade: "INS", desc: "Fiberglass batts, per SF", unit: "SF", waste: 15, quantityFormula: "WALL_SF", activityType: "install", coverageType: "A", xactCategoryCode: "INS", xactSelector: "BATT", notes: "Fiberglass batt insulation.", scopeConditions: { damage_types: ["water_intrusion"], surfaces: ["ceiling"] }, companionRules: { requires: ["DEM-INSUL-SF"] } },
  { code: "INS-BLOWN-SF", trade: "INS", desc: "Blown-in insulation, per SF", unit: "SF", waste: 10, quantityFormula: "CEILING_SF", activityType: "install", coverageType: "A", xactCategoryCode: "INS", xactSelector: "BLOWN", notes: "Blown-in attic insulation.", scopeConditions: { damage_types: ["water_intrusion"], surfaces: ["ceiling"] }, companionRules: { requires: ["DEM-INSUL-SF"] } },
  { code: "INS-SPRAY-SF", trade: "INS", desc: "Spray foam insulation, per SF", unit: "SF", waste: 8, quantityFormula: "WALL_SF", activityType: "install", coverageType: "A", xactCategoryCode: "INS", xactSelector: "SPRAY", notes: "Spray foam insulation.", scopeConditions: null, companionRules: {} },
  { code: "INS-RIGID-SF", trade: "INS", desc: "Rigid foam board, per SF", unit: "SF", waste: 10, quantityFormula: "WALL_SF", activityType: "install", coverageType: "A", xactCategoryCode: "INS", xactSelector: "RIGID", notes: "Rigid foam board insulation.", scopeConditions: null, companionRules: {} },
  { code: "INS-VAPOR-SF", trade: "INS", desc: "Vapor barrier, per SF", unit: "SF", waste: 5, quantityFormula: "WALL_SF", activityType: "install", coverageType: "A", xactCategoryCode: "INS", xactSelector: "VAPOR", notes: "Vapor barrier installation.", scopeConditions: null, companionRules: {} },
  { code: "INS-ATTIC-SF", trade: "INS", desc: "Attic insulation, per SF", unit: "SF", waste: 12, quantityFormula: "CEILING_SF", activityType: "install", coverageType: "A", xactCategoryCode: "INS", xactSelector: "ATTIC", notes: "Attic insulation.", scopeConditions: { surfaces: ["ceiling"] }, companionRules: {} },
  { code: "INS-PIPE-LF", trade: "INS", desc: "Pipe insulation wrap, per LF", unit: "LF", waste: 5, quantityFormula: "MANUAL", activityType: "install", coverageType: "A", xactCategoryCode: "INS", xactSelector: "PIPE", notes: "Pipe insulation wrap.", scopeConditions: null, companionRules: {} },
  { code: "INS-CLOSURE-SF", trade: "INS", desc: "Foam closure strips, per SF", unit: "SF", waste: 0, quantityFormula: "CEILING_SF", activityType: "install", coverageType: "A", xactCategoryCode: "INS", xactSelector: "CLOSURE", notes: "Foam closure strips at insulation edges.", scopeConditions: null, companionRules: {} },

  // ─── CAR: Carpentry ───────────────────────────────────────────────────────
  { code: "CAR-FRAME-LF", trade: "CAR", desc: "Wood framing, per LF", unit: "LF", waste: 10, quantityFormula: "MANUAL", activityType: "install", coverageType: "A", xactCategoryCode: "CAR", xactSelector: "FRAME", notes: "Wood framing member.", scopeConditions: null, companionRules: {} },
  { code: "CAR-SHEATH-SF", trade: "CAR", desc: "Wall sheathing, per SF", unit: "SF", waste: 10, quantityFormula: "WALL_SF", activityType: "install", coverageType: "A", xactCategoryCode: "CAR", xactSelector: "SHEATH", notes: "Wall sheathing.", scopeConditions: { zone_types: ["exterior"] }, companionRules: { requires: ["EXT-WRAP-SF"] } },
  { code: "CAR-DECK-SF", trade: "CAR", desc: "Deck construction, per SF", unit: "SF", waste: 15, quantityFormula: "FLOOR_SF", activityType: "replace", coverageType: "A", xactCategoryCode: "CAR", xactSelector: "DECK", notes: "Deck construction.", scopeConditions: { zone_types: ["exterior"] }, companionRules: {} },
  { code: "CAR-BEAM-LF", trade: "CAR", desc: "Header beam installation, per LF", unit: "LF", waste: 5, quantityFormula: "MANUAL", activityType: "install", coverageType: "A", xactCategoryCode: "CAR", xactSelector: "BEAM", notes: "Header beam.", scopeConditions: null, companionRules: {} },
  { code: "CAR-RAFTER-LF", trade: "CAR", desc: "Rafter installation, per LF", unit: "LF", waste: 8, quantityFormula: "ROOF_SF", activityType: "install", coverageType: "A", xactCategoryCode: "CAR", xactSelector: "RAFTER", notes: "Rafter installation.", scopeConditions: { damage_types: ["wind", "hail"], surfaces: ["roof"] }, companionRules: { auto_adds: ["RFG-UNDER-SF"] } },
  { code: "CAR-PORCH-SF", trade: "CAR", desc: "Porch floor construction, per SF", unit: "SF", waste: 12, quantityFormula: "FLOOR_SF", activityType: "replace", coverageType: "A", xactCategoryCode: "CAR", xactSelector: "PORCH", notes: "Porch floor.", scopeConditions: { zone_types: ["exterior"] }, companionRules: {} },
  { code: "CAR-JOISTS-LF", trade: "CAR", desc: "Floor joist installation, per LF", unit: "LF", waste: 8, quantityFormula: "MANUAL", activityType: "install", coverageType: "A", xactCategoryCode: "CAR", xactSelector: "JOIST", notes: "Floor joist.", scopeConditions: null, companionRules: {} },
  { code: "CAR-SILL-LF", trade: "CAR", desc: "Sill plate/band board, per LF", unit: "LF", waste: 5, quantityFormula: "PERIMETER_LF", activityType: "install", coverageType: "A", xactCategoryCode: "CAR", xactSelector: "SILL", notes: "Sill plate.", scopeConditions: null, companionRules: {} },
  { code: "CAR-BLOCKING-LF", trade: "CAR", desc: "Blocking/bracing, per LF", unit: "LF", waste: 10, quantityFormula: "MANUAL", activityType: "install", coverageType: "A", xactCategoryCode: "CAR", xactSelector: "BLOCK", notes: "Blocking/bracing.", scopeConditions: null, companionRules: {} },
  { code: "CAR-STAIR-EA", trade: "CAR", desc: "Stair assembly, each", unit: "EA", waste: 10, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "CAR", xactSelector: "STAIR", notes: "Stair assembly.", scopeConditions: null, companionRules: {} },
  { code: "CAR-LANDING-SF", trade: "CAR", desc: "Landing platform, per SF", unit: "SF", waste: 12, quantityFormula: "FLOOR_SF", activityType: "install", coverageType: "A", xactCategoryCode: "CAR", xactSelector: "LAND", notes: "Landing platform.", scopeConditions: null, companionRules: {} },
  { code: "CAR-SOFFIT-SF", trade: "CAR", desc: "Soffit framing, per SF", unit: "SF", waste: 10, quantityFormula: "MANUAL", activityType: "install", coverageType: "A", xactCategoryCode: "CAR", xactSelector: "SOFF", notes: "Soffit framing.", scopeConditions: null, companionRules: {} },

  // ─── RFG: Roofing ────────────────────────────────────────────────────────
  { code: "RFG-SHIN-AR", trade: "RFG", desc: "Architectural shingles, per SQ", unit: "SQ", waste: 10, quantityFormula: "ROOF_SQ", activityType: "replace", coverageType: "A", xactCategoryCode: "RFG", xactSelector: "AR", notes: "Architectural shingles per SQ.", scopeConditions: { damage_types: ["wind", "hail"], surfaces: ["roof"] }, companionRules: { auto_adds: ["RFG-UNDER-SF", "RFG-RIDGE-LF", "RFG-DRIP-LF"] } },
  { code: "RFG-SHIN-3TAB", trade: "RFG", desc: "3-tab shingles, per SQ", unit: "SQ", waste: 10, quantityFormula: "ROOF_SQ", activityType: "replace", coverageType: "A", xactCategoryCode: "RFG", xactSelector: "3TAB", notes: "3-tab shingles per SQ.", scopeConditions: { damage_types: ["wind", "hail"], surfaces: ["roof"] }, companionRules: { auto_adds: ["RFG-UNDER-SF", "RFG-RIDGE-LF", "RFG-DRIP-LF"] } },
  { code: "RFG-TILE-SF", trade: "RFG", desc: "Roof tile, per SF", unit: "SF", waste: 15, quantityFormula: "ROOF_SF", activityType: "replace", coverageType: "A", xactCategoryCode: "RFG", xactSelector: "TILE", notes: "Concrete/clay roof tile.", scopeConditions: { damage_types: ["wind", "hail"], surfaces: ["roof"] }, companionRules: { auto_adds: ["RFG-UNDER-SF", "RFG-RIDGE-LF"] } },
  { code: "RFG-METAL-SF", trade: "RFG", desc: "Metal roofing, per SF", unit: "SF", waste: 8, quantityFormula: "ROOF_SF", activityType: "replace", coverageType: "A", xactCategoryCode: "RFG", xactSelector: "METAL", notes: "Metal roofing.", scopeConditions: { damage_types: ["wind", "hail"], surfaces: ["roof"] }, companionRules: { auto_adds: ["RFG-UNDER-SF"] } },
  { code: "RFG-UNDER-SF", trade: "RFG", desc: "Roofing underlayment, per SF", unit: "SF", waste: 10, quantityFormula: "ROOF_SF", activityType: "install", coverageType: "A", xactCategoryCode: "RFG", xactSelector: "UNDER", notes: "Roofing underlayment.", scopeConditions: null, companionRules: {} },
  { code: "RFG-FELT-SQ", trade: "RFG", desc: "Roofing felt, per SQ", unit: "SQ", waste: 5, quantityFormula: "ROOF_SQ", activityType: "install", coverageType: "A", xactCategoryCode: "RFG", xactSelector: "FELT", notes: "Roofing felt.", scopeConditions: null, companionRules: {} },
  { code: "RFG-RIDGE-LF", trade: "RFG", desc: "Ridge cap shingles, per LF", unit: "LF", waste: 8, quantityFormula: "CEILING_PERIM_LF", activityType: "install", coverageType: "A", xactCategoryCode: "RFG", xactSelector: "RIDGE", notes: "Ridge cap.", scopeConditions: null, companionRules: {} },
  { code: "RFG-DRIP-LF", trade: "RFG", desc: "Drip edge, per LF", unit: "LF", waste: 0, quantityFormula: "PERIMETER_LF", activityType: "install", coverageType: "A", xactCategoryCode: "RFG", xactSelector: "DRIP", notes: "Drip edge.", scopeConditions: null, companionRules: {} },
  { code: "RFG-FLASH-LF", trade: "RFG", desc: "Flashing (roof penetration), per LF", unit: "LF", waste: 5, quantityFormula: "MANUAL", activityType: "install", coverageType: "A", xactCategoryCode: "RFG", xactSelector: "FLASH", notes: "Flashing at penetrations.", scopeConditions: null, companionRules: {} },
  { code: "RFG-ICE-SF", trade: "RFG", desc: "Ice/water shield, per SF", unit: "SF", waste: 8, quantityFormula: "ROOF_SF", activityType: "install", coverageType: "A", xactCategoryCode: "RFG", xactSelector: "ICE", notes: "Ice/water shield.", scopeConditions: { damage_types: ["water_intrusion"], surfaces: ["roof"] }, companionRules: {} },
  { code: "RFG-VENT-EA", trade: "RFG", desc: "Roof vent installation, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "install", coverageType: "A", xactCategoryCode: "RFG", xactSelector: "VENT", notes: "Roof vent.", scopeConditions: null, companionRules: {} },
  { code: "RFG-VALLEY-LF", trade: "RFG", desc: "Valley flashing, per LF", unit: "LF", waste: 5, quantityFormula: "MANUAL", activityType: "install", coverageType: "A", xactCategoryCode: "RFG", xactSelector: "VALLEY", notes: "Valley flashing.", scopeConditions: null, companionRules: {} },

  // ─── WIN: Windows ────────────────────────────────────────────────────────
  { code: "WIN-DOUBLE-EA", trade: "WIN", desc: "Double-hung window, each", unit: "EA", waste: 5, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "WIN", xactSelector: "DH", notes: "Double-hung window.", scopeConditions: { damage_types: ["wind", "hail"], surfaces: ["window"] }, companionRules: { auto_adds: ["WIN-SEAL-LF"] } },
  { code: "WIN-CASEMENT-EA", trade: "WIN", desc: "Casement window, each", unit: "EA", waste: 5, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "WIN", xactSelector: "CAS", notes: "Casement window.", scopeConditions: { damage_types: ["wind", "hail"], surfaces: ["window"] }, companionRules: { auto_adds: ["WIN-SEAL-LF"] } },
  { code: "WIN-PICTURE-EA", trade: "WIN", desc: "Picture window, each", unit: "EA", waste: 5, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "WIN", xactSelector: "PIC", notes: "Picture window.", scopeConditions: { damage_types: ["wind", "hail"], surfaces: ["window"] }, companionRules: { auto_adds: ["WIN-SEAL-LF"] } },
  { code: "WIN-GLASS-SF", trade: "WIN", desc: "Window glass replacement, per SF", unit: "SF", waste: 10, quantityFormula: "MANUAL", activityType: "repair", coverageType: "A", xactCategoryCode: "WIN", xactSelector: "GLASS", notes: "Glass replacement only.", scopeConditions: { damage_types: ["wind", "hail"], surfaces: ["window"] }, companionRules: {} },
  { code: "WIN-FRAME-EA", trade: "WIN", desc: "Window frame repair, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "repair", coverageType: "A", xactCategoryCode: "WIN", xactSelector: "FRAME", notes: "Window frame repair.", scopeConditions: null, companionRules: {} },
  { code: "WIN-SEAL-LF", trade: "WIN", desc: "Window caulking/sealing, per LF", unit: "LF", waste: 5, quantityFormula: "PERIMETER_LF", activityType: "install", coverageType: "A", xactCategoryCode: "WIN", xactSelector: "SEAL", notes: "Caulking/sealing.", scopeConditions: null, companionRules: {} },
  { code: "WIN-SILL-LF", trade: "WIN", desc: "Window sill replacement, per LF", unit: "LF", waste: 8, quantityFormula: "MANUAL", activityType: "replace", coverageType: "A", xactCategoryCode: "WIN", xactSelector: "SILL", notes: "Window sill replacement.", scopeConditions: { damage_types: ["water_intrusion"], surfaces: ["window"] }, companionRules: {} },
  { code: "WIN-SCREEN-EA", trade: "WIN", desc: "Window screen, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "install", coverageType: "A", xactCategoryCode: "WIN", xactSelector: "SCREEN", notes: "Window screen.", scopeConditions: null, companionRules: {} },

  // ─── EXT: Exterior ───────────────────────────────────────────────────────
  { code: "EXT-SIDING-SF", trade: "EXT", desc: "Vinyl siding, per SF", unit: "SF", waste: 10, quantityFormula: "WALL_SF", activityType: "replace", coverageType: "A", xactCategoryCode: "EXT", xactSelector: "VINYL", notes: "Vinyl siding.", scopeConditions: { damage_types: ["wind", "hail"], zone_types: ["exterior"], surfaces: ["wall"] }, companionRules: { auto_adds: ["EXT-WRAP-SF"] } },
  { code: "EXT-BRICK-SF", trade: "EXT", desc: "Brick veneer, per SF", unit: "SF", waste: 8, quantityFormula: "WALL_SF", activityType: "replace", coverageType: "A", xactCategoryCode: "EXT", xactSelector: "BRICK", notes: "Brick veneer.", scopeConditions: { damage_types: ["wind", "hail"], zone_types: ["exterior"], surfaces: ["wall"] }, companionRules: {} },
  { code: "EXT-STONE-SF", trade: "EXT", desc: "Stone veneer, per SF", unit: "SF", waste: 10, quantityFormula: "WALL_SF", activityType: "replace", coverageType: "A", xactCategoryCode: "EXT", xactSelector: "STONE", notes: "Stone veneer.", scopeConditions: { damage_types: ["wind", "hail"], zone_types: ["exterior"], surfaces: ["wall"] }, companionRules: {} },
  { code: "EXT-STUCCO-SF", trade: "EXT", desc: "Stucco application, per SF", unit: "SF", waste: 12, quantityFormula: "WALL_SF", activityType: "replace", coverageType: "A", xactCategoryCode: "EXT", xactSelector: "STUCCO", notes: "Stucco application.", scopeConditions: { damage_types: ["wind", "hail"], zone_types: ["exterior"], surfaces: ["wall"] }, companionRules: {} },
  { code: "EXT-WRAP-SF", trade: "EXT", desc: "House wrap, per SF", unit: "SF", waste: 5, quantityFormula: "WALL_SF", activityType: "install", coverageType: "A", xactCategoryCode: "EXT", xactSelector: "WRAP", notes: "House wrap.", scopeConditions: null, companionRules: {} },
  { code: "EXT-FASCIA-LF", trade: "EXT", desc: "Fascia board, per LF", unit: "LF", waste: 10, quantityFormula: "PERIMETER_LF", activityType: "replace", coverageType: "A", xactCategoryCode: "EXT", xactSelector: "FASCIA", notes: "Fascia board.", scopeConditions: { damage_types: ["wind", "hail"], zone_types: ["exterior"] }, companionRules: { auto_adds: ["EXT-SOFFIT-SF"] } },
  { code: "EXT-SOFFIT-SF", trade: "EXT", desc: "Soffit panel, per SF", unit: "SF", waste: 12, quantityFormula: "MANUAL", activityType: "replace", coverageType: "A", xactCategoryCode: "EXT", xactSelector: "SOFFIT", notes: "Soffit panel.", scopeConditions: { damage_types: ["wind", "hail"], zone_types: ["exterior"] }, companionRules: {} },
  { code: "EXT-CORNER-LF", trade: "EXT", desc: "Corner trim, per LF", unit: "LF", waste: 5, quantityFormula: "MANUAL", activityType: "install", coverageType: "A", xactCategoryCode: "EXT", xactSelector: "CORNER", notes: "Corner trim.", scopeConditions: null, companionRules: {} },
  { code: "EXT-DOOR-EA", trade: "EXT", desc: "Exterior door, each", unit: "EA", waste: 5, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "EXT", xactSelector: "DOOR", notes: "Exterior door.", scopeConditions: { damage_types: ["wind", "water_intrusion"], surfaces: ["door"] }, companionRules: {} },
  { code: "EXT-GARAGE-EA", trade: "EXT", desc: "Garage door, each", unit: "EA", waste: 5, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "EXT", xactSelector: "GARAGE", notes: "Garage door.", scopeConditions: { damage_types: ["wind", "hail"], surfaces: ["door"] }, companionRules: {} },

  // ─── CAB: Cabinetry ───────────────────────────────────────────────────────
  { code: "CAB-BASE-LF", trade: "CAB", desc: "Base cabinet - standard grade, per LF", unit: "LF", waste: 5, quantityFormula: "MANUAL", activityType: "replace", coverageType: "A", xactCategoryCode: "CAB", xactSelector: "BASE", notes: "Standard base cabinet. Quantity = linear feet of run.", scopeConditions: { room_types: ["interior_kitchen"] }, companionRules: { requires: ["DEM-CAB-LF"], auto_adds: ["CTR-LAM-SF"] } },
  { code: "CAB-WALL-LF", trade: "CAB", desc: "Wall cabinet - standard grade, per LF", unit: "LF", waste: 5, quantityFormula: "MANUAL", activityType: "replace", coverageType: "A", xactCategoryCode: "CAB", xactSelector: "WALL", notes: "Upper wall cabinet.", scopeConditions: { room_types: ["interior_kitchen"] }, companionRules: {} },
  { code: "CAB-TALL-EA", trade: "CAB", desc: "Tall/pantry cabinet, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "CAB", xactSelector: "TALL", notes: "Tall pantry or utility cabinet.", scopeConditions: null, companionRules: {} },
  { code: "CAB-VAN-LF", trade: "CAB", desc: "Bathroom vanity - high grade, per LF", unit: "LF", waste: 5, quantityFormula: "MANUAL", activityType: "replace", coverageType: "A", xactCategoryCode: "CAB", xactSelector: "VAN", notes: "Bathroom vanity cabinet. Includes countertop if spec'd.", scopeConditions: { room_types: ["interior_bathroom"], damage_types: ["water_intrusion"] }, companionRules: { requires: ["DEM-VANITY-EA"] } },

  // ─── CTR: Countertops ─────────────────────────────────────────────────────
  { code: "CTR-LAM-SF", trade: "CTR", desc: "Laminate countertop, per SF", unit: "SF", waste: 10, quantityFormula: "MANUAL", activityType: "replace", coverageType: "A", xactCategoryCode: "CTR", xactSelector: "LAM", notes: "Post-form laminate countertop.", scopeConditions: null, companionRules: {} },
  { code: "CTR-GRAN-SF", trade: "CTR", desc: "Granite countertop, per SF", unit: "SF", waste: 5, quantityFormula: "MANUAL", activityType: "replace", coverageType: "A", xactCategoryCode: "CTR", xactSelector: "GRAN", notes: "Granite slab countertop with polished edge.", scopeConditions: null, companionRules: {} },
  { code: "CTR-QRTZ-SF", trade: "CTR", desc: "Quartz countertop, per SF", unit: "SF", waste: 5, quantityFormula: "MANUAL", activityType: "replace", coverageType: "A", xactCategoryCode: "CTR", xactSelector: "QRTZ", notes: "Engineered quartz countertop.", scopeConditions: null, companionRules: {} },
  { code: "CTR-SOLID-SF", trade: "CTR", desc: "Solid surface countertop, per SF", unit: "SF", waste: 8, quantityFormula: "MANUAL", activityType: "replace", coverageType: "A", xactCategoryCode: "CTR", xactSelector: "SOLID", notes: "Solid surface (Corian or similar).", scopeConditions: null, companionRules: {} },
  { code: "CTR-SINK-EA", trade: "CTR", desc: "Undermount sink cutout, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "install", coverageType: "A", xactCategoryCode: "CTR", xactSelector: "SINK", notes: "Sink cutout in countertop. Labor for cutout and polish.", scopeConditions: null, companionRules: {} },

  // ─── ELE: Electrical ─────────────────────────────────────────────────────
  { code: "ELE-OUTL-EA", trade: "ELE", desc: "Standard electrical outlet, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "ELE", xactSelector: "OUTL", notes: "Standard duplex outlet. Detach & reset if existing.", scopeConditions: { damage_types: ["water_intrusion"] }, companionRules: {} },
  { code: "ELE-GFCI-EA", trade: "ELE", desc: "GFCI outlet, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "ELE", xactSelector: "GFCI", notes: "GFCI outlet — required in kitchen, bath, garage, exterior.", scopeConditions: { damage_types: ["water_intrusion"], room_types: ["interior_kitchen", "interior_bathroom"] }, companionRules: {} },
  { code: "ELE-SWCH-EA", trade: "ELE", desc: "Light switch, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "ELE", xactSelector: "SWCH", notes: "Single-pole light switch.", scopeConditions: null, companionRules: {} },
  { code: "ELE-LITE-EA", trade: "ELE", desc: "Light fixture - standard, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "ELE", xactSelector: "LITE", notes: "Standard ceiling or wall light fixture.", scopeConditions: null, companionRules: {} },
  { code: "ELE-FAN-EA", trade: "ELE", desc: "Ceiling fan with light, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "ELE", xactSelector: "FAN", notes: "Ceiling fan with integrated light kit.", scopeConditions: null, companionRules: {} },

  // ─── PLM: Plumbing ────────────────────────────────────────────────────────
  { code: "PLM-SINK-EA", trade: "PLM", desc: "Kitchen sink - stainless, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "PLM", xactSelector: "SINK", notes: "Standard stainless steel kitchen sink.", scopeConditions: { room_types: ["interior_kitchen"] }, companionRules: { auto_adds: ["PLM-FAUCET-EA"] } },
  { code: "PLM-FAUCET-EA", trade: "PLM", desc: "Kitchen faucet, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "PLM", xactSelector: "FAUC", notes: "Kitchen faucet with sprayer.", scopeConditions: null, companionRules: {} },
  { code: "PLM-TOIL-EA", trade: "PLM", desc: "Toilet - standard, detach & reset, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "reset", coverageType: "A", xactCategoryCode: "PLM", xactSelector: "TOIL", notes: "Detach & reset toilet for flooring or plumbing work.", scopeConditions: { damage_types: ["water_intrusion"], room_types: ["interior_bathroom"] }, companionRules: {} },
  { code: "PLM-TUB-EA", trade: "PLM", desc: "Bathtub - standard, R&R, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "PLM", xactSelector: "TUB", notes: "Replace bathtub. Includes disconnect/reconnect.", scopeConditions: { room_types: ["interior_bathroom"], severity: ["severe"] }, companionRules: {} },
  { code: "PLM-WH-EA", trade: "PLM", desc: "Water heater - 50 gallon, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "PLM", xactSelector: "WH50", notes: "50-gallon water heater replacement.", scopeConditions: null, companionRules: {} },

  // ─── HVAC ─────────────────────────────────────────────────────────────────
  { code: "HVAC-DUCT-LF", trade: "HVAC", desc: "Flexible ductwork, per LF", unit: "LF", waste: 10, quantityFormula: "MANUAL", activityType: "replace", coverageType: "A", xactCategoryCode: "HVA", xactSelector: "DUCT", notes: "Flexible HVAC duct replacement.", scopeConditions: null, companionRules: {} },
  { code: "HVAC-VENT-EA", trade: "HVAC", desc: "Supply vent/register, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "HVA", xactSelector: "VENT", notes: "Supply vent or register cover.", scopeConditions: null, companionRules: {} },
  { code: "HVAC-RETN-EA", trade: "HVAC", desc: "Return air grille, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "HVA", xactSelector: "RETN", notes: "Return air grille cover.", scopeConditions: null, companionRules: {} },
  { code: "HVAC-THERM-EA", trade: "HVAC", desc: "Thermostat - standard, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "HVA", xactSelector: "THERM", notes: "Standard programmable thermostat.", scopeConditions: null, companionRules: {} },
  { code: "HVAC-CLEAN-EA", trade: "HVAC", desc: "Duct cleaning, each system", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "clean", coverageType: "A", xactCategoryCode: "HVA", xactSelector: "CLEN", notes: "Full duct system cleaning after water/fire damage.", scopeConditions: { damage_types: ["water_intrusion", "mold"] }, companionRules: {} },

  // ─── GEN: General Conditions ───────────────────────────────────────────────
  { code: "GEN-PROT-SF", trade: "GEN", desc: "Floor protection - temporary, per SF", unit: "SF", waste: 0, quantityFormula: "FLOOR_SF", activityType: "install", coverageType: "A", xactCategoryCode: "GEN", xactSelector: "PROT", notes: "Ram board or poly protection for floors during construction. Add when 3+ trades.", scopeConditions: null, companionRules: {} },
  { code: "GEN-CLEAN-SF", trade: "GEN", desc: "Final construction cleaning, per SF", unit: "SF", waste: 0, quantityFormula: "FLOOR_SF", activityType: "clean", coverageType: "A", xactCategoryCode: "GEN", xactSelector: "CLEN", notes: "Post-construction detail cleaning.", scopeConditions: null, companionRules: {} },
  { code: "GEN-SUPER-HR", trade: "GEN", desc: "Supervision/project management, per HR", unit: "HR", waste: 0, quantityFormula: "MANUAL", activityType: "labor_only", coverageType: "A", xactCategoryCode: "GEN", xactSelector: "SUPR", notes: "On-site supervision/project management.", scopeConditions: null, companionRules: {} },
  { code: "GEN-PERMIT-EA", trade: "GEN", desc: "Building permit, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "labor_only", coverageType: "A", xactCategoryCode: "GEN", xactSelector: "PERM", notes: "Building permit fee. Required for structural, electrical, or plumbing work.", scopeConditions: null, companionRules: {} },
  { code: "GEN-CONTENT-EA", trade: "GEN", desc: "Contents move-out and reset, each room", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "labor_only", coverageType: "C", xactCategoryCode: "GEN", xactSelector: "CONT", notes: "Move room contents out for work, then move back. Coverage C item.", scopeConditions: null, companionRules: {} },
];

const REGIONAL_PRICES: Record<string, { material: number; labor: number; equipment: number }> = {
  "MIT-EXTR-SF": { material: 0.50, labor: 1.50, equipment: 0.75 },
  "MIT-EXTR-CA": { material: 1.00, labor: 2.00, equipment: 1.00 },
  "MIT-DEHU-DAY": { material: 25.00, labor: 15.00, equipment: 50.00 },
  "MIT-AIRM-DAY": { material: 10.00, labor: 10.00, equipment: 40.00 },
  "MIT-DEHM-DAY": { material: 35.00, labor: 20.00, equipment: 75.00 },
  "MIT-APPL-SF": { material: 0.25, labor: 0.75, equipment: 0.25 },
  "MIT-MOLD-SF": { material: 0.50, labor: 2.50, equipment: 0.50 },
  "MIT-DEMO-SF": { material: 0.25, labor: 1.00, equipment: 0.25 },
  "MIT-CONT-DAY": { material: 50.00, labor: 100.00, equipment: 0.00 },
  "MIT-MONI-DAY": { material: 25.00, labor: 50.00, equipment: 0.00 },

  "DEM-DRY-SF": { material: 0.50, labor: 1.50, equipment: 0.25 },
  "DEM-CEIL-SF": { material: 0.50, labor: 1.25, equipment: 0.25 },
  "DEM-FLR-SF": { material: 0.25, labor: 1.00, equipment: 0.50 },
  "DEM-PAD-SF": { material: 0.15, labor: 0.50, equipment: 0.25 },
  "DEM-TILE-SF": { material: 0.25, labor: 1.50, equipment: 0.50 },
  "DEM-CAB-LF": { material: 2.00, labor: 5.00, equipment: 0.50 },
  "DEM-TRIM-LF": { material: 0.50, labor: 1.00, equipment: 0.00 },
  "DEM-HAUL-LD": { material: 0.00, labor: 75.00, equipment: 50.00 },
  "DEM-DUMP-LD": { material: 75.00, labor: 0.00, equipment: 0.00 },
  "DEM-INSUL-SF": { material: 0.25, labor: 0.75, equipment: 0.25 },
  "DEM-VANITY-EA": { material: 0.00, labor: 50.00, equipment: 10.00 },

  "DRY-SHEET-SF": { material: 0.75, labor: 1.50, equipment: 0.25 },
  "DRY-TAPE-LF": { material: 0.10, labor: 0.25, equipment: 0.00 },
  "DRY-JOINT-SF": { material: 0.25, labor: 1.00, equipment: 0.25 },
  "DRY-SAND-SF": { material: 0.10, labor: 0.50, equipment: 0.10 },
  "DRY-PATCH-SF": { material: 0.50, labor: 1.50, equipment: 0.25 },
  "DRY-SOFFIT-SF": { material: 2.50, labor: 2.00, equipment: 0.50 },
  "DRY-CORNER-EA": { material: 1.00, labor: 0.50, equipment: 0.00 },
  "DRY-FRAME-LF": { material: 0.50, labor: 1.00, equipment: 0.25 },
  "DRY-MESH-SF": { material: 0.15, labor: 0.30, equipment: 0.00 },
  "DRY-PRIMER-SF": { material: 0.30, labor: 0.30, equipment: 0.10 },

  "PNT-INT-SF": { material: 0.35, labor: 0.75, equipment: 0.15 },
  "PNT-EXT-SF": { material: 0.35, labor: 1.00, equipment: 0.25 },
  "PNT-TRIM-LF": { material: 0.10, labor: 0.50, equipment: 0.10 },
  "PNT-PREP-SF": { material: 0.00, labor: 0.50, equipment: 0.10 },
  "PNT-STAIN-SF": { material: 0.50, labor: 0.75, equipment: 0.15 },
  "PNT-CAULK-LF": { material: 0.15, labor: 0.25, equipment: 0.00 },
  "PNT-CABINET-SF": { material: 0.75, labor: 2.00, equipment: 0.25 },
  "PNT-DRYWALL-SF": { material: 0.25, labor: 0.75, equipment: 0.10 },
  "PNT-CEILING-SF": { material: 0.35, labor: 1.00, equipment: 0.25 },
  "PNT-EPOXY-SF": { material: 0.50, labor: 1.00, equipment: 0.25 },
  "PNT-SPRAY-SF": { material: 0.40, labor: 1.25, equipment: 0.50 },
  "PNT-VARNISH-SF": { material: 0.40, labor: 0.75, equipment: 0.10 },

  "FLR-TILE-SF": { material: 3.50, labor: 4.00, equipment: 0.50 },
  "FLR-VINYL-SF": { material: 2.00, labor: 2.00, equipment: 0.50 },
  "FLR-LAMINATE-SF": { material: 1.75, labor: 1.75, equipment: 0.50 },
  "FLR-WOOD-SF": { material: 5.00, labor: 3.00, equipment: 0.50 },
  "FLR-CARPET-SF": { material: 2.50, labor: 1.50, equipment: 0.50 },
  "FLR-PAD-SF": { material: 0.50, labor: 0.75, equipment: 0.25 },
  "FLR-GROUT-SF": { material: 0.30, labor: 0.75, equipment: 0.15 },
  "FLR-MORTAR-SF": { material: 0.25, labor: 0.75, equipment: 0.15 },
  "FLR-SEALANT-SF": { material: 0.20, labor: 0.50, equipment: 0.10 },
  "FLR-TRIM-LF": { material: 1.00, labor: 1.00, equipment: 0.25 },

  "INS-BATTS-SF": { material: 0.40, labor: 0.75, equipment: 0.15 },
  "INS-BLOWN-SF": { material: 0.35, labor: 0.75, equipment: 0.50 },
  "INS-SPRAY-SF": { material: 1.50, labor: 1.50, equipment: 0.50 },
  "INS-RIGID-SF": { material: 0.75, labor: 0.75, equipment: 0.25 },
  "INS-VAPOR-SF": { material: 0.15, labor: 0.25, equipment: 0.00 },
  "INS-ATTIC-SF": { material: 0.35, labor: 0.75, equipment: 0.25 },
  "INS-PIPE-LF": { material: 0.25, labor: 0.50, equipment: 0.00 },
  "INS-CLOSURE-SF": { material: 0.20, labor: 0.50, equipment: 0.00 },

  "CAR-FRAME-LF": { material: 0.75, labor: 2.00, equipment: 0.25 },
  "CAR-SHEATH-SF": { material: 0.50, labor: 1.00, equipment: 0.25 },
  "CAR-DECK-SF": { material: 3.00, labor: 2.50, equipment: 0.50 },
  "CAR-BEAM-LF": { material: 2.00, labor: 3.00, equipment: 0.50 },
  "CAR-RAFTER-LF": { material: 0.75, labor: 1.50, equipment: 0.25 },
  "CAR-PORCH-SF": { material: 1.50, labor: 2.00, equipment: 0.50 },
  "CAR-JOISTS-LF": { material: 0.50, labor: 1.25, equipment: 0.25 },
  "CAR-SILL-LF": { material: 1.00, labor: 1.50, equipment: 0.25 },
  "CAR-BLOCKING-LF": { material: 0.50, labor: 1.00, equipment: 0.15 },
  "CAR-STAIR-EA": { material: 50.00, labor: 100.00, equipment: 10.00 },
  "CAR-LANDING-SF": { material: 1.50, labor: 2.00, equipment: 0.50 },
  "CAR-SOFFIT-SF": { material: 2.00, labor: 2.00, equipment: 0.50 },

  "RFG-SHIN-AR": { material: 100.00, labor: 40.00, equipment: 5.00 },
  "RFG-SHIN-3TAB": { material: 75.00, labor: 35.00, equipment: 5.00 },
  "RFG-TILE-SF": { material: 8.00, labor: 4.00, equipment: 0.50 },
  "RFG-METAL-SF": { material: 6.00, labor: 3.50, equipment: 0.50 },
  "RFG-UNDER-SF": { material: 0.35, labor: 0.50, equipment: 0.15 },
  "RFG-FELT-SQ": { material: 15.00, labor: 10.00, equipment: 2.00 },
  "RFG-RIDGE-LF": { material: 2.00, labor: 1.50, equipment: 0.25 },
  "RFG-DRIP-LF": { material: 0.75, labor: 0.50, equipment: 0.00 },
  "RFG-FLASH-LF": { material: 1.50, labor: 2.00, equipment: 0.25 },
  "RFG-ICE-SF": { material: 0.50, labor: 0.50, equipment: 0.10 },
  "RFG-VENT-EA": { material: 15.00, labor: 25.00, equipment: 5.00 },
  "RFG-VALLEY-LF": { material: 2.00, labor: 2.50, equipment: 0.50 },

  "WIN-DOUBLE-EA": { material: 150.00, labor: 75.00, equipment: 10.00 },
  "WIN-CASEMENT-EA": { material: 175.00, labor: 75.00, equipment: 10.00 },
  "WIN-PICTURE-EA": { material: 200.00, labor: 50.00, equipment: 10.00 },
  "WIN-GLASS-SF": { material: 5.00, labor: 3.00, equipment: 0.50 },
  "WIN-FRAME-EA": { material: 50.00, labor: 50.00, equipment: 5.00 },
  "WIN-SEAL-LF": { material: 0.25, labor: 0.50, equipment: 0.10 },
  "WIN-SILL-LF": { material: 5.00, labor: 3.00, equipment: 0.50 },
  "WIN-SCREEN-EA": { material: 25.00, labor: 15.00, equipment: 0.00 },

  "EXT-SIDING-SF": { material: 2.00, labor: 2.00, equipment: 0.50 },
  "EXT-BRICK-SF": { material: 4.00, labor: 3.00, equipment: 0.50 },
  "EXT-STONE-SF": { material: 6.00, labor: 4.00, equipment: 0.50 },
  "EXT-STUCCO-SF": { material: 2.50, labor: 3.00, equipment: 0.50 },
  "EXT-WRAP-SF": { material: 0.20, labor: 0.30, equipment: 0.10 },
  "EXT-FASCIA-LF": { material: 1.50, labor: 1.50, equipment: 0.25 },
  "EXT-SOFFIT-SF": { material: 2.00, labor: 2.00, equipment: 0.50 },
  "EXT-CORNER-LF": { material: 0.75, labor: 1.00, equipment: 0.15 },
  "EXT-DOOR-EA": { material: 150.00, labor: 100.00, equipment: 10.00 },
  "EXT-GARAGE-EA": { material: 400.00, labor: 200.00, equipment: 50.00 },

  "CAB-BASE-LF": { material: 50.00, labor: 75.00, equipment: 10.00 },
  "CAB-WALL-LF": { material: 40.00, labor: 60.00, equipment: 10.00 },
  "CAB-TALL-EA": { material: 200.00, labor: 150.00, equipment: 15.00 },
  "CAB-VAN-LF": { material: 0.00, labor: 162.68, equipment: 27.19 },
  "CTR-LAM-SF": { material: 8.00, labor: 6.00, equipment: 0.50 },
  "CTR-GRAN-SF": { material: 25.00, labor: 15.00, equipment: 2.00 },
  "CTR-QRTZ-SF": { material: 30.00, labor: 15.00, equipment: 2.00 },
  "CTR-SOLID-SF": { material: 0.00, labor: 23.96, equipment: 0.00 },
  "CTR-SINK-EA": { material: 25.00, labor: 50.00, equipment: 5.00 },
  "ELE-OUTL-EA": { material: 18.54, labor: 35.00, equipment: 5.00 },
  "ELE-GFCI-EA": { material: 25.00, labor: 45.00, equipment: 5.00 },
  "ELE-SWCH-EA": { material: 8.00, labor: 25.00, equipment: 3.00 },
  "ELE-LITE-EA": { material: 30.00, labor: 40.00, equipment: 5.00 },
  "ELE-FAN-EA": { material: 75.00, labor: 60.00, equipment: 10.00 },
  "PLM-SINK-EA": { material: 150.00, labor: 75.00, equipment: 10.00 },
  "PLM-FAUCET-EA": { material: 80.00, labor: 50.00, equipment: 5.00 },
  "PLM-TOIL-EA": { material: 218.97, labor: 50.00, equipment: 0.36 },
  "PLM-TUB-EA": { material: 71.95, labor: 801.18, equipment: 28.87 },
  "PLM-WH-EA": { material: 350.00, labor: 200.00, equipment: 25.00 },
  "HVAC-DUCT-LF": { material: 3.00, labor: 5.00, equipment: 1.00 },
  "HVAC-VENT-EA": { material: 10.00, labor: 20.00, equipment: 2.00 },
  "HVAC-RETN-EA": { material: 12.00, labor: 20.00, equipment: 2.00 },
  "HVAC-THERM-EA": { material: 40.00, labor: 35.00, equipment: 5.00 },
  "HVAC-CLEAN-EA": { material: 0.00, labor: 300.00, equipment: 100.00 },
  "GEN-PROT-SF": { material: 0.00, labor: 0.25, equipment: 2.03 },
  "GEN-CLEAN-SF": { material: 0.00, labor: 0.23, equipment: 4.67 },
  "GEN-SUPER-HR": { material: 0.00, labor: 85.00, equipment: 0.00 },
  "GEN-PERMIT-EA": { material: 250.00, labor: 0.00, equipment: 0.00 },
  "GEN-CONTENT-EA": { material: 0.00, labor: 73.58, equipment: 0.00 },
};

export async function seedCatalog() {
  logger.info("SeedCatalog", "Seeding enhanced pricing catalog...");

  for (const item of ENHANCED_CATALOG) {
    const companionRules =
      Object.keys(item.companionRules).length > 0 ? item.companionRules : null;
    await db
      .insert(scopeLineItems)
      .values({
        code: item.code,
        description: item.desc,
        unit: item.unit,
        tradeCode: item.trade,
        defaultWasteFactor: item.waste,
        quantityFormula: item.quantityFormula,
        activityType: item.activityType,
        coverageType: item.coverageType,
        xactCategoryCode: item.xactCategoryCode,
        xactSelector: item.xactSelector,
        notes: item.notes,
        scopeConditions: item.scopeConditions,
        companionRules,
        isActive: true,
        sortOrder: 0,
      })
      .onConflictDoUpdate({
        target: scopeLineItems.code,
        set: {
          description: item.desc,
          unit: item.unit,
          tradeCode: item.trade,
          defaultWasteFactor: item.waste,
          quantityFormula: item.quantityFormula,
          activityType: item.activityType,
          coverageType: item.coverageType,
          xactCategoryCode: item.xactCategoryCode,
          xactSelector: item.xactSelector,
          notes: item.notes,
          scopeConditions: item.scopeConditions,
          companionRules,
        },
      });
  }

  logger.info("SeedCatalog", `Upserted ${ENHANCED_CATALOG.length} enhanced catalog items`);

  // Delete existing US_NATIONAL prices, then insert (regionalPriceSets has no unique on regionId+lineItemCode)
  await db.delete(regionalPriceSets).where(eq(regionalPriceSets.regionId, "US_NATIONAL"));

  for (const [code, prices] of Object.entries(REGIONAL_PRICES)) {
    await db.insert(regionalPriceSets).values({
      regionId: "US_NATIONAL",
      regionName: "United States (National Average)",
      lineItemCode: code,
      materialCost: String(prices.material),
      laborCost: String(prices.labor),
      equipmentCost: String(prices.equipment),
      effectiveDate: new Date().toISOString().split("T")[0],
      priceListVersion: "2.0",
    });
  }

  logger.info("SeedCatalog", "Seeded regional prices for US_NATIONAL region");
}
