/**
 * Peril Scope Templates
 *
 * Pre-built scope packages for each peril type. When the voice agent identifies
 * a peril type (or the claim already has one), a template can be loaded as a
 * starting point.
 */

export interface PerilTemplate {
  perilType: string;
  name: string;
  description: string;
  /** Room types where this template applies */
  applicableRoomTypes: string[];
  /** Zone types where this template applies (interior, exterior, roof) */
  applicableZoneTypes: string[];
  /** Catalog codes to include — order matters for display */
  items: PerilTemplateItem[];
}

export interface PerilTemplateItem {
  catalogCode: string;
  /** If true, auto-add when template is applied. If false, suggest only. */
  autoInclude: boolean;
  /** Default quantity multiplier (1.0 = use geometry formula) */
  quantityMultiplier: number;
  /** Notes specific to this peril/item combination */
  perilNotes?: string;
}

export const WATER_INTERIOR_TEMPLATE: PerilTemplate = {
  perilType: "water",
  name: "Water Damage — Interior Room",
  description:
    "Standard scope for water-damaged interior room (Category 1-2 water, walls and floors affected)",
  applicableRoomTypes: [
    "interior_bedroom",
    "interior_living",
    "interior_family",
    "interior_den",
    "interior_dining",
    "interior_hallway",
  ],
  applicableZoneTypes: ["interior"],
  items: [
    { catalogCode: "MIT-EXTR-SF", autoInclude: true, quantityMultiplier: 1.0, perilNotes: "Extract standing water first" },
    { catalogCode: "MIT-DEHU-DAY", autoInclude: true, quantityMultiplier: 1.0, perilNotes: "Minimum 3 days, adjust per monitoring" },
    { catalogCode: "MIT-AIRM-DAY", autoInclude: true, quantityMultiplier: 1.0, perilNotes: "1 per 10-16 LF of affected wall" },
    { catalogCode: "MIT-MONI-DAY", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "MIT-APPL-SF", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "Add for Category 2/3 water" },
    { catalogCode: "DEM-DRY-SF", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "Full removal for severe; use MIT-DEMO-SF for flood cut" },
    { catalogCode: "MIT-DEMO-SF", autoInclude: true, quantityMultiplier: 1.0, perilNotes: "Flood cut 2-4 ft — default for moderate damage" },
    { catalogCode: "DEM-TRIM-LF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "DEM-FLR-SF", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "Only if flooring non-salvageable" },
    { catalogCode: "DEM-HAUL-LD", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "DRY-SHEET-SF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "DRY-TAPE-LF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "DRY-JOINT-SF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "PNT-DRYWALL-SF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "PNT-TRIM-LF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "FLR-VINYL-SF", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "Select appropriate flooring type" },
    { catalogCode: "FLR-PAD-SF", autoInclude: false, quantityMultiplier: 1.0 },
    { catalogCode: "FLR-TRIM-LF", autoInclude: true, quantityMultiplier: 1.0, perilNotes: "New baseboard after flooring" },
    { catalogCode: "GEN-CONTENT-EA", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "If room contents need move-out" },
    { catalogCode: "GEN-CLEAN-SF", autoInclude: true, quantityMultiplier: 1.0 },
  ],
};

export const WATER_KITCHEN_TEMPLATE: PerilTemplate = {
  perilType: "water",
  name: "Water Damage — Kitchen",
  description: "Kitchen-specific water damage scope including cabinetry and countertops",
  applicableRoomTypes: ["interior_kitchen"],
  applicableZoneTypes: ["interior"],
  items: [
    { catalogCode: "MIT-EXTR-SF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "MIT-DEHU-DAY", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "MIT-AIRM-DAY", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "MIT-MONI-DAY", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "DEM-CAB-LF", autoInclude: true, quantityMultiplier: 1.0, perilNotes: "Remove affected base cabinets" },
    { catalogCode: "DEM-DRY-SF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "DEM-FLR-SF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "DEM-TRIM-LF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "DEM-HAUL-LD", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "DEM-DUMP-LD", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "DRY-SHEET-SF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "PNT-DRYWALL-SF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "CAB-BASE-LF", autoInclude: true, quantityMultiplier: 1.0, perilNotes: "Match existing cabinet grade" },
    { catalogCode: "CTR-LAM-SF", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "Select countertop material" },
    { catalogCode: "PLM-SINK-EA", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "If sink damaged or non-reusable" },
    { catalogCode: "ELE-GFCI-EA", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "Code upgrade if replacing outlets" },
    { catalogCode: "GEN-CLEAN-SF", autoInclude: true, quantityMultiplier: 1.0 },
  ],
};

export const WATER_BATHROOM_TEMPLATE: PerilTemplate = {
  perilType: "water",
  name: "Water Damage — Bathroom",
  description: "Bathroom-specific water damage scope including fixtures, vanity, and tile",
  applicableRoomTypes: ["interior_bathroom"],
  applicableZoneTypes: ["interior"],
  items: [
    { catalogCode: "MIT-EXTR-SF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "MIT-DEHU-DAY", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "MIT-AIRM-DAY", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "MIT-APPL-SF", autoInclude: true, quantityMultiplier: 1.0, perilNotes: "Bathrooms = always antimicrobial" },
    { catalogCode: "DEM-VANITY-EA", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "DEM-DRY-SF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "DEM-TILE-SF", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "Only if tile is damaged" },
    { catalogCode: "DEM-TRIM-LF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "PLM-TOIL-EA", autoInclude: true, quantityMultiplier: 1.0, perilNotes: "Detach & reset for floor work" },
    { catalogCode: "DRY-SHEET-SF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "PNT-DRYWALL-SF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "FLR-TILE-SF", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "If tile replacement needed" },
    { catalogCode: "CAB-VAN-LF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "ELE-GFCI-EA", autoInclude: false, quantityMultiplier: 1.0 },
    { catalogCode: "GEN-CLEAN-SF", autoInclude: true, quantityMultiplier: 1.0 },
  ],
};

export const HAIL_ROOF_TEMPLATE: PerilTemplate = {
  perilType: "hail",
  name: "Hail Damage — Roof",
  description: "Complete roof replacement scope for hail damage",
  applicableRoomTypes: ["exterior_roof_slope"],
  applicableZoneTypes: ["exterior", "roof"],
  items: [
    { catalogCode: "RFG-SHIN-AR", autoInclude: true, quantityMultiplier: 1.0, perilNotes: "Full slope replacement per test square protocol" },
    { catalogCode: "RFG-FELT-SQ", autoInclude: true, quantityMultiplier: 1.0, perilNotes: "Underlayment — matches shingle quantity" },
    { catalogCode: "RFG-ICE-SF", autoInclude: true, quantityMultiplier: 1.0, perilNotes: "Eaves + valleys. 3-foot minimum from edge." },
    { catalogCode: "RFG-DRIP-LF", autoInclude: true, quantityMultiplier: 1.0, perilNotes: "All eave and rake edges" },
    { catalogCode: "RFG-RIDGE-LF", autoInclude: true, quantityMultiplier: 1.0, perilNotes: "All ridge lines and hip lines" },
    { catalogCode: "RFG-FLASH-LF", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "At wall/roof intersections and penetrations" },
    { catalogCode: "RFG-VALLEY-LF", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "All valley lines" },
    { catalogCode: "RFG-VENT-EA", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "Replace damaged vents — count in field" },
    { catalogCode: "RFG-UNDER-SF", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "Synthetic underlayment if upgrading from felt" },
  ],
};

export const HAIL_EXTERIOR_TEMPLATE: PerilTemplate = {
  perilType: "hail",
  name: "Hail Damage — Exterior",
  description: "Exterior damage scope for hail — siding, gutters, soft metals",
  applicableRoomTypes: [
    "exterior_elevation_front",
    "exterior_elevation_left",
    "exterior_elevation_right",
    "exterior_elevation_rear",
  ],
  applicableZoneTypes: ["exterior"],
  items: [
    { catalogCode: "EXT-SIDING-SF", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "Per elevation — measure damaged area" },
    { catalogCode: "EXT-WRAP-SF", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "Required behind new siding" },
    { catalogCode: "EXT-FASCIA-LF", autoInclude: false, quantityMultiplier: 1.0 },
    { catalogCode: "EXT-SOFFIT-SF", autoInclude: false, quantityMultiplier: 1.0 },
    { catalogCode: "WIN-SCREEN-EA", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "Check all window screens for hail damage" },
    { catalogCode: "PNT-EXT-SF", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "For wood or fiber cement siding" },
  ],
};

export const WIND_ROOF_TEMPLATE: PerilTemplate = {
  perilType: "wind",
  name: "Wind Damage — Roof",
  description: "Partial roof repair scope for wind damage — lifted/missing shingles",
  applicableRoomTypes: ["exterior_roof_slope"],
  applicableZoneTypes: ["exterior", "roof"],
  items: [
    { catalogCode: "RFG-SHIN-AR", autoInclude: true, quantityMultiplier: 1.0, perilNotes: "Affected slopes only — not full replacement" },
    { catalogCode: "RFG-FELT-SQ", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "RFG-RIDGE-LF", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "If ridge caps lifted/missing" },
    { catalogCode: "RFG-DRIP-LF", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "If edge damage present" },
    { catalogCode: "RFG-FLASH-LF", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "If flashing displaced" },
  ],
};

export const FIRE_INTERIOR_TEMPLATE: PerilTemplate = {
  perilType: "fire",
  name: "Fire Damage — Interior Room",
  description: "Standard scope for fire-damaged interior room including demolition, fire-rated drywall, paint, and electrical",
  applicableRoomTypes: [
    "interior_bedroom",
    "interior_living",
    "interior_kitchen",
    "interior_bathroom",
    "interior_hallway",
    "interior_den",
    "interior_dining",
    "interior_other",
  ],
  applicableZoneTypes: ["interior"],
  items: [
    { catalogCode: "DEM-DRY-SF", autoInclude: true, quantityMultiplier: 1.0, perilNotes: "Full removal in fire rooms" },
    { catalogCode: "DEM-CEIL-SF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "DEM-FLR-SF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "DEM-TRIM-LF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "DEM-INSUL-SF", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "If wall cavities exposed" },
    { catalogCode: "DRY-X-5-8", autoInclude: true, quantityMultiplier: 1.0, perilNotes: "5/8\" fire-rated drywall" },
    { catalogCode: "PNT-INT-SF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "PNT-CEILING-SF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "PNT-TRIM-LF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "FLR-CARPET-SF", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "Select appropriate flooring type" },
    { catalogCode: "FLR-PAD-SF", autoInclude: false, quantityMultiplier: 1.0 },
    { catalogCode: "INS-BATTS-SF", autoInclude: false, quantityMultiplier: 1.0 },
    { catalogCode: "ELE-OUTL-EA", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "Replace melted/damaged outlets" },
    { catalogCode: "ELE-SWCH-EA", autoInclude: false, quantityMultiplier: 1.0 },
    { catalogCode: "GEN-CLEAN-SF", autoInclude: true, quantityMultiplier: 1.0 },
  ],
};

export const FIRE_EXTERIOR_TEMPLATE: PerilTemplate = {
  perilType: "fire",
  name: "Fire Damage — Exterior",
  description: "Exterior fire damage scope — siding, trim, roofing",
  applicableRoomTypes: [
    "exterior_elevation_front",
    "exterior_elevation_left",
    "exterior_elevation_right",
    "exterior_elevation_rear",
  ],
  applicableZoneTypes: ["exterior"],
  items: [
    { catalogCode: "EXT-SIDING-SF", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "Per elevation — measure charred area" },
    { catalogCode: "EXT-FASCIA-LF", autoInclude: false, quantityMultiplier: 1.0 },
    { catalogCode: "EXT-SOFFIT-SF", autoInclude: false, quantityMultiplier: 1.0 },
    { catalogCode: "RFG-SHIN-AR", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "If fire reached roof" },
    { catalogCode: "RFG-FELT-SQ", autoInclude: false, quantityMultiplier: 1.0 },
    { catalogCode: "PNT-EXT-SF", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "For smoke-stained exterior surfaces" },
  ],
};

export const PERIL_TEMPLATES: PerilTemplate[] = [
  WATER_INTERIOR_TEMPLATE,
  WATER_KITCHEN_TEMPLATE,
  WATER_BATHROOM_TEMPLATE,
  HAIL_ROOF_TEMPLATE,
  HAIL_EXTERIOR_TEMPLATE,
  WIND_ROOF_TEMPLATE,
  FIRE_INTERIOR_TEMPLATE,
  FIRE_EXTERIOR_TEMPLATE,
];

/**
 * Finds matching templates for a given peril type and room context.
 */
export function getMatchingTemplates(perilType: string, roomType: string): PerilTemplate[] {
  return PERIL_TEMPLATES.filter(t => {
    if (t.perilType !== perilType) return false;
    if (t.applicableRoomTypes.includes(roomType)) return true;
    return t.applicableZoneTypes.some(z => {
      if (z === "interior") return roomType.startsWith("interior_");
      if (z === "exterior" || z === "roof") return roomType.startsWith("exterior_");
      return false;
    });
  });
}
