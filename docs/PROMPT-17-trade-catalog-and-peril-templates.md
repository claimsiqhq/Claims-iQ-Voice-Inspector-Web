# PROMPT 17 — Trade Catalog Seeding, Companion Rule Chains & Peril Scope Templates

**Depends on:** PROMPT-16 (Scope Engine & Pricing Overhaul)
**Branch:** `feat/trade-catalog-seeding`

---

## Context

PROMPT-16 built the entire scope assembly infrastructure — the `scopeAssemblyService`, `scopeQuantityEngine`, `scopeValidation`, the `generate_scope` voice tool, the per-trade summary rollups, the new `scopeTrades` / `scopeItems` / `scopeSummary` tables, and the enhanced `scopeLineItems` schema with fields for `companionRules`, `scopeConditions`, `quantityFormula`, `coverageType`, `xactCategoryCode`, `xactSelector`, and `notes`.

**The problem:** That engine has no fuel. The existing `seed-catalog.ts` populates 103 catalog items with only the basic fields (`code`, `description`, `unit`, `tradeCode`, `defaultWasteFactor`) — it does not populate any of the PROMPT-16 enhanced fields. Without `companionRules` JSONB, the companion cascading in `scopeAssemblyService.assembleScope()` never fires. Without `scopeConditions` JSONB, `filterByScopeConditions()` returns nothing. Without `quantityFormula`, `scopeQuantityEngine.deriveQuantity()` falls back to `MANUAL` for everything.

PROMPT-17 upgrades the seeding layer so the scope engine can actually function.

---

## Part A — Enhanced Catalog Seed

### Goal
Replace the current `seed-catalog.ts` with a comprehensive seeding module that populates every PROMPT-16 field for every catalog item. Add 24 new items for trades that were underrepresented (CAB, CTR, HVAC, GEN, ELE, PLM). Bring the total catalog to ~127 items.

### File: `server/seed-catalog.ts` — Full Replacement

Replace the entire `CATALOG_ITEMS` array with an enhanced version. Each item must now include all PROMPT-16 fields.

**Current item shape** (what we have):
```ts
{ code: "DRY-SHEET-SF", trade: "DRY", desc: "Drywall sheet installation, per SF", unit: "SF", waste: 10 }
```

**Enhanced item shape** (what we need):
```ts
{
  code: "DRY-SHEET-SF",
  trade: "DRY",
  desc: "Drywall 1/2\" - hang, tape, float, texture",
  unit: "SF",
  waste: 10,
  quantityFormula: "WALL_SF",           // ← NEW: ties to scopeQuantityEngine
  activityType: "replace",              // ← NEW: reset|remove|replace|install|repair|clean|labor_only
  coverageType: "A",                    // ← NEW: A=Dwelling, B=Other Structures, C=Contents
  xactCategoryCode: "DRY",             // ← NEW: Xactimate 3-char category
  xactSelector: "1/2++",              // ← NEW: Xactimate selector string
  notes: "Standard 1/2\" drywall. For fire-rated areas use DRY-5/8-SF.",
  scopeConditions: {                   // ← NEW: when this item auto-matches
    damage_types: ["water_intrusion", "water_stain", "mold"],
    surfaces: ["wall"],
    severity: ["moderate", "severe"],
  },
  companionRules: {                    // ← NEW: cascading dependencies
    requires: ["DEM-DRY-SF"],
    auto_adds: ["DRY-TAPE-LF", "DRY-JOINT-SF"],
    excludes: ["DRY-PATCH-SF"],
  },
}
```

### Enhanced Catalog Array — All Items

Below is the complete enhanced catalog. Each trade section shows every item with all PROMPT-16 fields populated.

#### MIT — Mitigation (10 items)

```ts
const ENHANCED_CATALOG: EnhancedCatalogItem[] = [
  // ─── MIT: Mitigation / Water Extraction ──────────────────────────────────
  {
    code: "MIT-EXTR-SF", trade: "MIT",
    desc: "Water extraction - standing water, per SF",
    unit: "SF", waste: 0,
    quantityFormula: "FLOOR_SF",
    activityType: "clean",
    coverageType: "A",
    xactCategoryCode: "WTR", xactSelector: "WTEX",
    notes: "Standing water extraction. Use MIT-EXTR-CA for carpet/pad extraction.",
    scopeConditions: {
      damage_types: ["water_intrusion"],
      surfaces: ["floor"],
      severity: ["moderate", "severe"],
    },
    companionRules: {
      auto_adds: ["MIT-DEHU-DAY", "MIT-AIRM-DAY"],
    },
  },
  {
    code: "MIT-EXTR-CA", trade: "MIT",
    desc: "Water extraction - carpet/pad, per SF",
    unit: "SF", waste: 0,
    quantityFormula: "FLOOR_SF",
    activityType: "clean",
    coverageType: "A",
    xactCategoryCode: "WTR", xactSelector: "WTEX-C",
    notes: "Carpet/pad water extraction. More labor-intensive than standing water.",
    scopeConditions: {
      damage_types: ["water_intrusion"],
      surfaces: ["floor"],
      room_types: ["interior_bedroom", "interior_living", "interior_family", "interior_den"],
    },
    companionRules: {
      auto_adds: ["MIT-DEHU-DAY", "MIT-AIRM-DAY"],
    },
  },
  {
    code: "MIT-DEHU-DAY", trade: "MIT",
    desc: "Dehumidifier per day",
    unit: "DAY", waste: 0,
    quantityFormula: "MANUAL",
    activityType: "labor_only",
    coverageType: "A",
    xactCategoryCode: "WTR", xactSelector: "DEHU",
    notes: "Standard dehumidifier. Typically 3-5 day minimum. Quantity = number of units × days.",
    scopeConditions: {
      damage_types: ["water_intrusion", "water_stain"],
    },
    companionRules: {
      auto_adds: ["MIT-MONI-DAY"],
    },
  },
  {
    code: "MIT-AIRM-DAY", trade: "MIT",
    desc: "Air mover per day",
    unit: "DAY", waste: 0,
    quantityFormula: "MANUAL",
    activityType: "labor_only",
    coverageType: "A",
    xactCategoryCode: "WTR", xactSelector: "AIRM",
    notes: "Air mover/fan. Rule of thumb: 1 per 10-16 LF of affected wall. Typically 3-5 day minimum.",
    scopeConditions: {
      damage_types: ["water_intrusion", "water_stain"],
    },
    companionRules: {},
  },
  {
    code: "MIT-DEHM-DAY", trade: "MIT",
    desc: "Large dehumidifier per day",
    unit: "DAY", waste: 0,
    quantityFormula: "MANUAL",
    activityType: "labor_only",
    coverageType: "A",
    xactCategoryCode: "WTR", xactSelector: "DEHM",
    notes: "Large/industrial dehumidifier. Use for areas > 1000 SF or Category 2/3 water.",
    scopeConditions: {
      damage_types: ["water_intrusion"],
      severity: ["severe"],
    },
    companionRules: {
      auto_adds: ["MIT-MONI-DAY"],
    },
  },
  {
    code: "MIT-APPL-SF", trade: "MIT",
    desc: "Apply antimicrobial treatment, per SF",
    unit: "SF", waste: 5,
    quantityFormula: "WALLS_CEILING_SF",
    activityType: "clean",
    coverageType: "A",
    xactCategoryCode: "WTR", xactSelector: "ANTI",
    notes: "Antimicrobial/antifungal application. Required for Category 2/3 water or visible mold.",
    scopeConditions: {
      damage_types: ["water_intrusion", "mold"],
      severity: ["moderate", "severe"],
    },
    companionRules: {},
  },
  {
    code: "MIT-MOLD-SF", trade: "MIT",
    desc: "Mold remediation, per SF",
    unit: "SF", waste: 10,
    quantityFormula: "WALL_SF",
    activityType: "clean",
    coverageType: "A",
    xactCategoryCode: "WTR", xactSelector: "MOLD",
    notes: "Professional mold remediation. Requires containment if area > 10 SF per EPA guidelines.",
    scopeConditions: {
      damage_types: ["mold"],
      severity: ["moderate", "severe"],
    },
    companionRules: {
      requires: ["MIT-CONT-DAY"],
      auto_adds: ["MIT-APPL-SF"],
    },
  },
  {
    code: "MIT-DEMO-SF", trade: "MIT",
    desc: "Flood cut drywall (up to 4 ft), per SF",
    unit: "SF", waste: 0,
    quantityFormula: "MANUAL",
    activityType: "remove",
    coverageType: "A",
    xactCategoryCode: "WTR", xactSelector: "FLDC",
    notes: "Flood cut: remove drywall up to 4' height. Quantity = affected LF × 4 (height). Not full wall removal.",
    scopeConditions: {
      damage_types: ["water_intrusion"],
      surfaces: ["wall"],
      severity: ["moderate", "severe"],
    },
    companionRules: {
      auto_adds: ["MIT-APPL-SF", "DRY-SHEET-SF"],
    },
  },
  {
    code: "MIT-CONT-DAY", trade: "MIT",
    desc: "Containment setup, per day",
    unit: "DAY", waste: 0,
    quantityFormula: "MANUAL",
    activityType: "labor_only",
    coverageType: "A",
    xactCategoryCode: "WTR", xactSelector: "CONT",
    notes: "Containment barrier with poly sheeting and negative air. Required for mold > 10 SF.",
    scopeConditions: {
      damage_types: ["mold"],
      severity: ["severe"],
    },
    companionRules: {},
  },
  {
    code: "MIT-MONI-DAY", trade: "MIT",
    desc: "Moisture monitoring, per day",
    unit: "DAY", waste: 0,
    quantityFormula: "MANUAL",
    activityType: "labor_only",
    coverageType: "A",
    xactCategoryCode: "WTR", xactSelector: "MONI",
    notes: "Daily moisture readings. Drying goal: materials within 2% of dry standard.",
    scopeConditions: {
      damage_types: ["water_intrusion", "water_stain"],
    },
    companionRules: {},
  },
```

#### DEM — Demolition (11 items)

```ts
  // ─── DEM: Demolition ─────────────────────────────────────────────────────
  {
    code: "DEM-DRY-SF", trade: "DEM",
    desc: "Remove drywall, per SF",
    unit: "SF", waste: 0,
    quantityFormula: "WALL_SF",
    activityType: "remove",
    coverageType: "A",
    xactCategoryCode: "DEM", xactSelector: "DRY",
    notes: "Full wall drywall removal. For flood cut (partial), use MIT-DEMO-SF instead.",
    scopeConditions: {
      damage_types: ["water_intrusion", "water_stain", "mold"],
      surfaces: ["wall"],
      severity: ["severe"],
    },
    companionRules: {
      auto_adds: ["DEM-HAUL-LD", "DRY-SHEET-SF"],
    },
  },
  {
    code: "DEM-CEIL-SF", trade: "DEM",
    desc: "Remove ceiling drywall, per SF",
    unit: "SF", waste: 0,
    quantityFormula: "CEILING_SF",
    activityType: "remove",
    coverageType: "A",
    xactCategoryCode: "DEM", xactSelector: "CEIL",
    notes: "Ceiling drywall removal. Check for insulation above — may need INS-BATTS-SF.",
    scopeConditions: {
      damage_types: ["water_intrusion", "water_stain"],
      surfaces: ["ceiling"],
      severity: ["severe"],
    },
    companionRules: {
      auto_adds: ["DEM-HAUL-LD", "DEM-INSUL-SF"],
    },
  },
  {
    code: "DEM-FLR-SF", trade: "DEM",
    desc: "Remove flooring, per SF",
    unit: "SF", waste: 0,
    quantityFormula: "FLOOR_SF",
    activityType: "remove",
    coverageType: "A",
    xactCategoryCode: "DEM", xactSelector: "FLR",
    notes: "Generic flooring removal. Use DEM-TILE-SF for ceramic, DEM-PAD-SF for carpet pad.",
    scopeConditions: {
      damage_types: ["water_intrusion"],
      surfaces: ["floor"],
      severity: ["moderate", "severe"],
    },
    companionRules: {
      auto_adds: ["DEM-HAUL-LD"],
    },
  },
  {
    code: "DEM-PAD-SF", trade: "DEM",
    desc: "Remove carpet pad, per SF",
    unit: "SF", waste: 0,
    quantityFormula: "FLOOR_SF",
    activityType: "remove",
    coverageType: "A",
    xactCategoryCode: "DEM", xactSelector: "PAD",
    notes: "Carpet pad removal. Often paired with MIT-EXTR-CA (extraction before removal).",
    scopeConditions: {
      damage_types: ["water_intrusion"],
      surfaces: ["floor"],
    },
    companionRules: {
      auto_adds: ["DEM-HAUL-LD"],
    },
  },
  {
    code: "DEM-TILE-SF", trade: "DEM",
    desc: "Remove ceramic tile, per SF",
    unit: "SF", waste: 0,
    quantityFormula: "FLOOR_SF",
    activityType: "remove",
    coverageType: "A",
    xactCategoryCode: "DEM", xactSelector: "TILE",
    notes: "Ceramic/porcelain tile removal. Higher labor than standard flooring removal.",
    scopeConditions: {
      damage_types: ["water_intrusion", "crack"],
      surfaces: ["floor"],
    },
    companionRules: {
      auto_adds: ["DEM-HAUL-LD"],
      excludes: ["DEM-FLR-SF"],
    },
  },
  {
    code: "DEM-CAB-LF", trade: "DEM",
    desc: "Remove base cabinets, per LF",
    unit: "LF", waste: 0,
    quantityFormula: "MANUAL",
    activityType: "remove",
    coverageType: "A",
    xactCategoryCode: "DEM", xactSelector: "CAB",
    notes: "Base cabinet removal. Quantity = linear feet of cabinet run.",
    scopeConditions: {
      damage_types: ["water_intrusion"],
      room_types: ["interior_kitchen", "interior_bathroom", "interior_laundry"],
    },
    companionRules: {
      auto_adds: ["DEM-HAUL-LD"],
    },
  },
  {
    code: "DEM-TRIM-LF", trade: "DEM",
    desc: "Remove trim/baseboard, per LF",
    unit: "LF", waste: 0,
    quantityFormula: "PERIMETER_LF",
    activityType: "remove",
    coverageType: "A",
    xactCategoryCode: "DEM", xactSelector: "TRIM",
    notes: "Baseboard/trim removal. Usually precedes flooring work.",
    scopeConditions: {
      damage_types: ["water_intrusion"],
      surfaces: ["floor"],
    },
    companionRules: {
      auto_adds: ["FLR-TRIM-LF"],
    },
  },
  {
    code: "DEM-HAUL-LD", trade: "DEM",
    desc: "Haul debris, per load",
    unit: "LD", waste: 0,
    quantityFormula: "MANUAL",
    activityType: "labor_only",
    coverageType: "A",
    xactCategoryCode: "DEM", xactSelector: "HAUL",
    notes: "Debris haul-off. Rule of thumb: 1 load per 500 SF of demo. Always paired with DEM-DUMP-LD.",
    scopeConditions: null,
    companionRules: {
      auto_adds: ["DEM-DUMP-LD"],
    },
  },
  {
    code: "DEM-DUMP-LD", trade: "DEM",
    desc: "Dump fees, per load",
    unit: "LD", waste: 0,
    quantityFormula: "MANUAL",
    activityType: "labor_only",
    coverageType: "A",
    xactCategoryCode: "DEM", xactSelector: "DUMP",
    notes: "Disposal/dump fees. Quantity matches DEM-HAUL-LD.",
    scopeConditions: null,
    companionRules: {},
  },
  {
    code: "DEM-INSUL-SF", trade: "DEM",
    desc: "Remove insulation, per SF",
    unit: "SF", waste: 0,
    quantityFormula: "CEILING_SF",
    activityType: "remove",
    coverageType: "A",
    xactCategoryCode: "DEM", xactSelector: "INSUL",
    notes: "Insulation removal from ceiling/attic. Pairs with ceiling drywall removal.",
    scopeConditions: {
      damage_types: ["water_intrusion"],
      surfaces: ["ceiling"],
    },
    companionRules: {
      auto_adds: ["INS-BATTS-SF"],
    },
  },
  {
    code: "DEM-VANITY-EA", trade: "DEM",
    desc: "Remove vanity, each",
    unit: "EA", waste: 0,
    quantityFormula: "EACH",
    activityType: "remove",
    coverageType: "A",
    xactCategoryCode: "DEM", xactSelector: "VANITY",
    notes: "Vanity removal. Requires disconnecting plumbing supply lines.",
    scopeConditions: {
      damage_types: ["water_intrusion"],
      room_types: ["interior_bathroom"],
    },
    companionRules: {
      auto_adds: ["DEM-HAUL-LD"],
    },
  },
```

#### DRY — Drywall (10 items)

```ts
  // ─── DRY: Drywall ────────────────────────────────────────────────────────
  {
    code: "DRY-SHEET-SF", trade: "DRY",
    desc: "Drywall 1/2\" - hang, tape, float, texture",
    unit: "SF", waste: 10,
    quantityFormula: "WALL_SF",
    activityType: "replace",
    coverageType: "A",
    xactCategoryCode: "DRY", xactSelector: "1/2++",
    notes: "Standard 1/2\" drywall. Includes hang, tape, float. Texture and paint separate.",
    scopeConditions: {
      damage_types: ["water_intrusion", "water_stain", "mold"],
      surfaces: ["wall"],
      severity: ["moderate", "severe"],
    },
    companionRules: {
      requires: ["DEM-DRY-SF"],
      auto_adds: ["DRY-TAPE-LF", "DRY-JOINT-SF", "PNT-DRYWALL-SF"],
      excludes: ["DRY-PATCH-SF"],
    },
  },
  {
    code: "DRY-TAPE-LF", trade: "DRY",
    desc: "Drywall tape, per LF",
    unit: "LF", waste: 5,
    quantityFormula: "MANUAL",
    activityType: "install",
    coverageType: "A",
    xactCategoryCode: "DRY", xactSelector: "TAPE",
    notes: "Paper or fiberglass mesh tape at seams. Auto-added with drywall sheet installation.",
    scopeConditions: null,
    companionRules: {},
  },
  {
    code: "DRY-JOINT-SF", trade: "DRY",
    desc: "Joint compound application, per SF",
    unit: "SF", waste: 8,
    quantityFormula: "WALL_SF",
    activityType: "install",
    coverageType: "A",
    xactCategoryCode: "DRY", xactSelector: "JOINT",
    notes: "Joint compound (mud) application. 3 coats standard. Auto-added with sheet installation.",
    scopeConditions: null,
    companionRules: {
      auto_adds: ["DRY-SAND-SF"],
    },
  },
  {
    code: "DRY-SAND-SF", trade: "DRY",
    desc: "Sand drywall finish, per SF",
    unit: "SF", waste: 0,
    quantityFormula: "WALL_SF",
    activityType: "labor_only",
    coverageType: "A",
    xactCategoryCode: "DRY", xactSelector: "SAND",
    notes: "Sanding between joint compound coats. Labor only — no material.",
    scopeConditions: null,
    companionRules: {},
  },
  {
    code: "DRY-PATCH-SF", trade: "DRY",
    desc: "Patch drywall, per SF",
    unit: "SF", waste: 10,
    quantityFormula: "MANUAL",
    activityType: "repair",
    coverageType: "A",
    xactCategoryCode: "DRY", xactSelector: "PTCH",
    notes: "Small area patch (< 16 SF). For larger areas use DRY-SHEET-SF. Includes tape and mud.",
    scopeConditions: {
      damage_types: ["water_stain", "crack", "dent"],
      surfaces: ["wall", "ceiling"],
      severity: ["minor"],
    },
    companionRules: {
      auto_adds: ["PNT-DRYWALL-SF"],
      excludes: ["DRY-SHEET-SF"],
    },
  },
  {
    code: "DRY-SOFFIT-SF", trade: "DRY",
    desc: "Install soffit drywall, per SF",
    unit: "SF", waste: 12,
    quantityFormula: "MANUAL",
    activityType: "install",
    coverageType: "A",
    xactCategoryCode: "DRY", xactSelector: "SOFF",
    notes: "Soffit/bulkhead drywall. Higher waste factor due to custom cuts.",
    scopeConditions: null,
    companionRules: {
      auto_adds: ["DRY-TAPE-LF", "DRY-JOINT-SF"],
    },
  },
  {
    code: "DRY-CORNER-EA", trade: "DRY",
    desc: "Corner bead, each",
    unit: "EA", waste: 0,
    quantityFormula: "EACH",
    activityType: "install",
    coverageType: "A",
    xactCategoryCode: "DRY", xactSelector: "CRNR",
    notes: "Metal or vinyl corner bead. One per outside corner requiring finishing.",
    scopeConditions: null,
    companionRules: {},
  },
  {
    code: "DRY-FRAME-LF", trade: "DRY",
    desc: "Metal stud framing, per LF",
    unit: "LF", waste: 5,
    quantityFormula: "MANUAL",
    activityType: "install",
    coverageType: "A",
    xactCategoryCode: "DRY", xactSelector: "STUD",
    notes: "Light gauge metal stud framing for drywall. Use CAR-FRAME-LF for structural wood framing.",
    scopeConditions: null,
    companionRules: {},
  },
  {
    code: "DRY-MESH-SF", trade: "DRY",
    desc: "Drywall mesh tape, per SF",
    unit: "SF", waste: 3,
    quantityFormula: "WALL_SF",
    activityType: "install",
    coverageType: "A",
    xactCategoryCode: "DRY", xactSelector: "MESH",
    notes: "Self-adhesive fiberglass mesh. Use instead of paper tape for moisture-prone areas.",
    scopeConditions: null,
    companionRules: {},
  },
  {
    code: "DRY-PRIMER-SF", trade: "DRY",
    desc: "Primer/sealer on new drywall, per SF",
    unit: "SF", waste: 8,
    quantityFormula: "WALL_SF",
    activityType: "install",
    coverageType: "A",
    xactCategoryCode: "DRY", xactSelector: "PRIM",
    notes: "PVA primer/sealer on new drywall before paint. Separate from PNT codes.",
    scopeConditions: null,
    companionRules: {},
  },
```

#### PNT — Painting (12 items)

```ts
  // ─── PNT: Painting ───────────────────────────────────────────────────────
  {
    code: "PNT-INT-SF", trade: "PNT",
    desc: "Interior wall paint - 2 coats, per SF",
    unit: "SF", waste: 10,
    quantityFormula: "WALL_SF",
    activityType: "install",
    coverageType: "A",
    xactCategoryCode: "PNT", xactSelector: "INT",
    notes: "Standard interior latex paint, 2 coats. Walls only — use PNT-CEILING-SF for ceilings.",
    scopeConditions: {
      surfaces: ["wall"],
    },
    companionRules: {
      requires: ["DRY-SHEET-SF"],
      auto_adds: ["PNT-PREP-SF"],
    },
  },
  {
    code: "PNT-EXT-SF", trade: "PNT",
    desc: "Exterior paint - 2 coats, per SF",
    unit: "SF", waste: 10,
    quantityFormula: "WALL_SF",
    activityType: "install",
    coverageType: "A",
    xactCategoryCode: "PNT", xactSelector: "EXT",
    notes: "Exterior latex or acrylic paint, 2 coats.",
    scopeConditions: {
      zone_types: ["exterior"],
      surfaces: ["wall"],
    },
    companionRules: {
      auto_adds: ["PNT-PREP-SF"],
    },
  },
  {
    code: "PNT-TRIM-LF", trade: "PNT",
    desc: "Paint trim/baseboard, per LF",
    unit: "LF", waste: 8,
    quantityFormula: "PERIMETER_LF",
    activityType: "install",
    coverageType: "A",
    xactCategoryCode: "PNT", xactSelector: "TRIM",
    notes: "Paint baseboard, door/window trim. Semi-gloss standard.",
    scopeConditions: null,
    companionRules: {},
  },
  {
    code: "PNT-PREP-SF", trade: "PNT",
    desc: "Paint prep and masking, per SF",
    unit: "SF", waste: 0,
    quantityFormula: "WALL_SF",
    activityType: "labor_only",
    coverageType: "A",
    xactCategoryCode: "PNT", xactSelector: "PREP",
    notes: "Prep, mask, and protect. Labor only. Auto-added with painting items.",
    scopeConditions: null,
    companionRules: {},
  },
  {
    code: "PNT-STAIN-SF", trade: "PNT",
    desc: "Stain wood surfaces, per SF",
    unit: "SF", waste: 12,
    quantityFormula: "MANUAL",
    activityType: "install",
    coverageType: "A",
    xactCategoryCode: "PNT", xactSelector: "STAIN",
    notes: "Wood stain application. 1-2 coats standard.",
    scopeConditions: null,
    companionRules: {},
  },
  {
    code: "PNT-CAULK-LF", trade: "PNT",
    desc: "Caulk joints and seams, per LF",
    unit: "LF", waste: 5,
    quantityFormula: "PERIMETER_LF",
    activityType: "install",
    coverageType: "A",
    xactCategoryCode: "PNT", xactSelector: "CAULK",
    notes: "Paintable caulk at wall/ceiling/trim joints.",
    scopeConditions: null,
    companionRules: {},
  },
  {
    code: "PNT-CABINET-SF", trade: "PNT",
    desc: "Cabinet refinish/paint, per SF",
    unit: "SF", waste: 10,
    quantityFormula: "MANUAL",
    activityType: "install",
    coverageType: "A",
    xactCategoryCode: "PNT", xactSelector: "CAB",
    notes: "Cabinet painting/refinishing. Requires sanding, priming, 2 coats.",
    scopeConditions: {
      room_types: ["interior_kitchen", "interior_bathroom"],
    },
    companionRules: {},
  },
  {
    code: "PNT-DRYWALL-SF", trade: "PNT",
    desc: "Paint new drywall, per SF",
    unit: "SF", waste: 8,
    quantityFormula: "WALL_SF",
    activityType: "install",
    coverageType: "A",
    xactCategoryCode: "PNT", xactSelector: "DRY",
    notes: "Paint over new drywall. Includes prime coat + 2 finish coats for matching.",
    scopeConditions: null,
    companionRules: {
      requires: ["DRY-SHEET-SF"],
    },
  },
  {
    code: "PNT-CEILING-SF", trade: "PNT",
    desc: "Paint ceiling, per SF",
    unit: "SF", waste: 12,
    quantityFormula: "CEILING_SF",
    activityType: "install",
    coverageType: "A",
    xactCategoryCode: "PNT", xactSelector: "CEIL",
    notes: "Ceiling paint - flat white standard. Higher waste due to overhead application.",
    scopeConditions: {
      surfaces: ["ceiling"],
    },
    companionRules: {
      auto_adds: ["PNT-PREP-SF"],
    },
  },
  {
    code: "PNT-EPOXY-SF", trade: "PNT",
    desc: "Epoxy floor coating, per SF",
    unit: "SF", waste: 15,
    quantityFormula: "FLOOR_SF",
    activityType: "install",
    coverageType: "A",
    xactCategoryCode: "PNT", xactSelector: "EPOXY",
    notes: "Epoxy floor coating for garages, basements. 2-part application.",
    scopeConditions: {
      room_types: ["interior_garage", "interior_utility"],
    },
    companionRules: {},
  },
  {
    code: "PNT-SPRAY-SF", trade: "PNT",
    desc: "Spray painting, per SF",
    unit: "SF", waste: 12,
    quantityFormula: "WALL_SF",
    activityType: "install",
    coverageType: "A",
    xactCategoryCode: "PNT", xactSelector: "SPRAY",
    notes: "Airless spray application. Faster but requires more masking.",
    scopeConditions: null,
    companionRules: {},
  },
  {
    code: "PNT-VARNISH-SF", trade: "PNT",
    desc: "Varnish/polyurethane, per SF",
    unit: "SF", waste: 10,
    quantityFormula: "FLOOR_SF",
    activityType: "install",
    coverageType: "A",
    xactCategoryCode: "PNT", xactSelector: "VARN",
    notes: "Clear-coat finish for wood floors or trim. 2-3 coats.",
    scopeConditions: null,
    companionRules: {},
  },
```

### Pattern for Remaining Trades

The remaining trades (FLR, INS, CAR, CAB, CTR, RFG, WIN, EXT, ELE, PLM, HVAC, GEN) follow the same enhancement pattern. **For each item, populate:**

1. **`quantityFormula`** — map to geometry:
   - Floor items → `FLOOR_SF` or `FLOOR_SY`
   - Wall items → `WALL_SF` or `WALL_SF_NET`
   - Ceiling items → `CEILING_SF`
   - Perimeter items → `PERIMETER_LF`
   - Roof items → `ROOF_SF` or `ROOF_SQ`
   - Count items (doors, windows, fixtures) → `EACH`
   - Equipment/day items → `MANUAL`

2. **`activityType`** — from the action:
   - Removal → `"remove"`
   - Installation → `"install"` or `"replace"`
   - Repair/patch → `"repair"`
   - Clean/treat → `"clean"`
   - Labor only → `"labor_only"`

3. **`coverageType`** — almost always `"A"` (dwelling):
   - Detached structures → `"B"`
   - Contents (appliances, personal property) → `"C"`

4. **`scopeConditions`** — which damage contexts trigger auto-matching:
   - `damage_types`: from the 12-type enum
   - `surfaces`: `["wall", "ceiling", "floor"]`
   - `severity`: `["minor", "moderate", "severe"]`
   - `room_types`: from the 21 room type enum in `create_room`
   - `zone_types`: `["interior", "exterior", "roof", "attic"]`
   - Set to `null` for items that are never auto-suggested (only companion-added or manual)

5. **`companionRules`** — see Part B for the complete chain mapping

### Key Quantity Formula Assignments by Trade

| Trade | Item Pattern | Formula |
|-------|-------------|---------|
| FLR | Tile, vinyl, laminate, wood, carpet, pad, grout, mortar, sealant | `FLOOR_SF` |
| FLR | Trim, molding | `PERIMETER_LF` |
| INS | Batts, blown, spray, rigid, vapor | `WALL_SF` or `CEILING_SF` (depends on location) |
| INS | Attic insulation | `CEILING_SF` |
| INS | Pipe insulation | `MANUAL` |
| CAR | Wall framing, sheathing | `WALL_SF` or `MANUAL` |
| CAR | Rafters, joists | `MANUAL` |
| CAR | Stairs, doors | `EACH` |
| RFG | Shingles, felt | `ROOF_SQ` |
| RFG | Underlayment, ice shield, metal | `ROOF_SF` |
| RFG | Ridge cap, drip edge, flashing | `MANUAL` (measured in field) |
| RFG | Vents | `EACH` |
| WIN | All windows | `EACH` |
| WIN | Sealing, sill | `MANUAL` |
| EXT | Siding, wrap, brick, stone, stucco | `WALL_SF` |
| EXT | Fascia, soffit, corner trim | `MANUAL` |
| EXT | Doors | `EACH` |
| ELE | All electrical items | `EACH` or `MANUAL` |
| PLM | All plumbing fixtures | `EACH` |
| HVAC | Ductwork | `MANUAL` |
| HVAC | Vents, registers, thermostats | `EACH` |
| GEN | Protection, cleaning | `FLOOR_SF` |
| GEN | Supervision | `MANUAL` |
| GEN | Permits | `EACH` |

### New Items to Add (24 items for underrepresented trades)

Add these items that were missing from the original catalog:

```ts
  // ─── CAB: Cabinetry (4 new items) ────────────────────────────────────────
  { code: "CAB-BASE-LF", trade: "CAB", desc: "Base cabinet - standard grade, per LF", unit: "LF", waste: 5, quantityFormula: "MANUAL", activityType: "replace", coverageType: "A", xactCategoryCode: "CAB", xactSelector: "BASE", notes: "Standard base cabinet. Quantity = linear feet of run.", scopeConditions: { room_types: ["interior_kitchen"] }, companionRules: { requires: ["DEM-CAB-LF"], auto_adds: ["CTR-LAM-SF"] } },
  { code: "CAB-WALL-LF", trade: "CAB", desc: "Wall cabinet - standard grade, per LF", unit: "LF", waste: 5, quantityFormula: "MANUAL", activityType: "replace", coverageType: "A", xactCategoryCode: "CAB", xactSelector: "WALL", notes: "Upper wall cabinet.", scopeConditions: { room_types: ["interior_kitchen"] }, companionRules: {} },
  { code: "CAB-TALL-EA", trade: "CAB", desc: "Tall/pantry cabinet, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "CAB", xactSelector: "TALL", notes: "Tall pantry or utility cabinet.", scopeConditions: null, companionRules: {} },
  { code: "CAB-VAN-LF", trade: "CAB", desc: "Bathroom vanity - high grade, per LF", unit: "LF", waste: 5, quantityFormula: "MANUAL", activityType: "replace", coverageType: "A", xactCategoryCode: "CAB", xactSelector: "VAN", notes: "Bathroom vanity cabinet. Includes countertop if spec'd.", scopeConditions: { room_types: ["interior_bathroom"], damage_types: ["water_intrusion"] }, companionRules: { requires: ["DEM-VANITY-EA"] } },

  // ─── CTR: Countertops (5 new items) ───────────────────────────────────────
  { code: "CTR-LAM-SF", trade: "CTR", desc: "Laminate countertop, per SF", unit: "SF", waste: 10, quantityFormula: "MANUAL", activityType: "replace", coverageType: "A", xactCategoryCode: "CTR", xactSelector: "LAM", notes: "Post-form laminate countertop.", scopeConditions: null, companionRules: {} },
  { code: "CTR-GRAN-SF", trade: "CTR", desc: "Granite countertop, per SF", unit: "SF", waste: 5, quantityFormula: "MANUAL", activityType: "replace", coverageType: "A", xactCategoryCode: "CTR", xactSelector: "GRAN", notes: "Granite slab countertop with polished edge.", scopeConditions: null, companionRules: {} },
  { code: "CTR-QRTZ-SF", trade: "CTR", desc: "Quartz countertop, per SF", unit: "SF", waste: 5, quantityFormula: "MANUAL", activityType: "replace", coverageType: "A", xactCategoryCode: "CTR", xactSelector: "QRTZ", notes: "Engineered quartz countertop.", scopeConditions: null, companionRules: {} },
  { code: "CTR-SOLID-SF", trade: "CTR", desc: "Solid surface countertop, per SF", unit: "SF", waste: 8, quantityFormula: "MANUAL", activityType: "replace", coverageType: "A", xactCategoryCode: "CTR", xactSelector: "SOLID", notes: "Solid surface (Corian or similar).", scopeConditions: null, companionRules: {} },
  { code: "CTR-SINK-EA", trade: "CTR", desc: "Undermount sink cutout, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "install", coverageType: "A", xactCategoryCode: "CTR", xactSelector: "SINK", notes: "Sink cutout in countertop. Labor for cutout and polish.", scopeConditions: null, companionRules: {} },

  // ─── ELE: Electrical (5 new items) ────────────────────────────────────────
  { code: "ELE-OUTL-EA", trade: "ELE", desc: "Standard electrical outlet, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "ELE", xactSelector: "OUTL", notes: "Standard duplex outlet. Detach & reset if existing.", scopeConditions: { damage_types: ["water_intrusion"] }, companionRules: {} },
  { code: "ELE-GFCI-EA", trade: "ELE", desc: "GFCI outlet, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "ELE", xactSelector: "GFCI", notes: "GFCI outlet — required in kitchen, bath, garage, exterior.", scopeConditions: { damage_types: ["water_intrusion"], room_types: ["interior_kitchen", "interior_bathroom"] }, companionRules: {} },
  { code: "ELE-SWCH-EA", trade: "ELE", desc: "Light switch, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "ELE", xactSelector: "SWCH", notes: "Single-pole light switch.", scopeConditions: null, companionRules: {} },
  { code: "ELE-LITE-EA", trade: "ELE", desc: "Light fixture - standard, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "ELE", xactSelector: "LITE", notes: "Standard ceiling or wall light fixture.", scopeConditions: null, companionRules: {} },
  { code: "ELE-FAN-EA", trade: "ELE", desc: "Ceiling fan with light, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "ELE", xactSelector: "FAN", notes: "Ceiling fan with integrated light kit.", scopeConditions: null, companionRules: {} },

  // ─── PLM: Plumbing (5 new items) ──────────────────────────────────────────
  { code: "PLM-SINK-EA", trade: "PLM", desc: "Kitchen sink - stainless, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "PLM", xactSelector: "SINK", notes: "Standard stainless steel kitchen sink.", scopeConditions: { room_types: ["interior_kitchen"] }, companionRules: { auto_adds: ["PLM-FAUCET-EA"] } },
  { code: "PLM-FAUCET-EA", trade: "PLM", desc: "Kitchen faucet, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "PLM", xactSelector: "FAUC", notes: "Kitchen faucet with sprayer.", scopeConditions: null, companionRules: {} },
  { code: "PLM-TOIL-EA", trade: "PLM", desc: "Toilet - standard, detach & reset, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "reset", coverageType: "A", xactCategoryCode: "PLM", xactSelector: "TOIL", notes: "Detach & reset toilet for flooring or plumbing work.", scopeConditions: { damage_types: ["water_intrusion"], room_types: ["interior_bathroom"] }, companionRules: {} },
  { code: "PLM-TUB-EA", trade: "PLM", desc: "Bathtub - standard, R&R, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "PLM", xactSelector: "TUB", notes: "Replace bathtub. Includes disconnect/reconnect.", scopeConditions: { room_types: ["interior_bathroom"], severity: ["severe"] }, companionRules: {} },
  { code: "PLM-WH-EA", trade: "PLM", desc: "Water heater - 50 gallon, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "PLM", xactSelector: "WH50", notes: "50-gallon water heater replacement.", scopeConditions: null, companionRules: {} },

  // ─── HVAC (5 new items) ───────────────────────────────────────────────────
  { code: "HVAC-DUCT-LF", trade: "HVAC", desc: "Flexible ductwork, per LF", unit: "LF", waste: 10, quantityFormula: "MANUAL", activityType: "replace", coverageType: "A", xactCategoryCode: "HVA", xactSelector: "DUCT", notes: "Flexible HVAC duct replacement.", scopeConditions: null, companionRules: {} },
  { code: "HVAC-VENT-EA", trade: "HVAC", desc: "Supply vent/register, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "HVA", xactSelector: "VENT", notes: "Supply vent or register cover.", scopeConditions: null, companionRules: {} },
  { code: "HVAC-RETN-EA", trade: "HVAC", desc: "Return air grille, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "HVA", xactSelector: "RETN", notes: "Return air grille cover.", scopeConditions: null, companionRules: {} },
  { code: "HVAC-THERM-EA", trade: "HVAC", desc: "Thermostat - standard, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "replace", coverageType: "A", xactCategoryCode: "HVA", xactSelector: "THERM", notes: "Standard programmable thermostat.", scopeConditions: null, companionRules: {} },
  { code: "HVAC-CLEAN-EA", trade: "HVAC", desc: "Duct cleaning, each system", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "clean", coverageType: "A", xactCategoryCode: "HVA", xactSelector: "CLEN", notes: "Full duct system cleaning after water/fire damage.", scopeConditions: { damage_types: ["water_intrusion", "mold"] }, companionRules: {} },

  // ─── GEN: General Conditions (5 items — 1 existing + 4 new) ───────────────
  { code: "GEN-PROT-SF", trade: "GEN", desc: "Floor protection - temporary, per SF", unit: "SF", waste: 0, quantityFormula: "FLOOR_SF", activityType: "install", coverageType: "A", xactCategoryCode: "GEN", xactSelector: "PROT", notes: "Ram board or poly protection for floors during construction. Add when 3+ trades.", scopeConditions: null, companionRules: {} },
  { code: "GEN-CLEAN-SF", trade: "GEN", desc: "Final construction cleaning, per SF", unit: "SF", waste: 0, quantityFormula: "FLOOR_SF", activityType: "clean", coverageType: "A", xactCategoryCode: "GEN", xactSelector: "CLEN", notes: "Post-construction detail cleaning.", scopeConditions: null, companionRules: {} },
  { code: "GEN-SUPER-HR", trade: "GEN", desc: "Supervision/project management, per HR", unit: "HR", waste: 0, quantityFormula: "MANUAL", activityType: "labor_only", coverageType: "A", xactCategoryCode: "GEN", xactSelector: "SUPR", notes: "On-site supervision/project management.", scopeConditions: null, companionRules: {} },
  { code: "GEN-PERMIT-EA", trade: "GEN", desc: "Building permit, each", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "labor_only", coverageType: "A", xactCategoryCode: "GEN", xactSelector: "PERM", notes: "Building permit fee. Required for structural, electrical, or plumbing work.", scopeConditions: null, companionRules: {} },
  { code: "GEN-CONTENT-EA", trade: "GEN", desc: "Contents move-out and reset, each room", unit: "EA", waste: 0, quantityFormula: "EACH", activityType: "labor_only", coverageType: "C", xactCategoryCode: "GEN", xactSelector: "CONT", notes: "Move room contents out for work, then move back. Coverage C item.", scopeConditions: null, companionRules: {} },
];
```

### Regional Pricing Updates

The `REGIONAL_PRICES` object must also be updated to include entries for all new items. Use the same structure:

```ts
// Add prices for new items
"CAB-BASE-LF":  { material: 50.00,  labor: 75.00,   equipment: 10.00 },
"CAB-WALL-LF":  { material: 40.00,  labor: 60.00,   equipment: 10.00 },
"CAB-TALL-EA":  { material: 200.00, labor: 150.00,  equipment: 15.00 },
"CAB-VAN-LF":   { material: 0.00,   labor: 162.68,  equipment: 27.19 },
"CTR-LAM-SF":   { material: 8.00,   labor: 6.00,    equipment: 0.50 },
"CTR-GRAN-SF":  { material: 25.00,  labor: 15.00,   equipment: 2.00 },
"CTR-QRTZ-SF":  { material: 30.00,  labor: 15.00,   equipment: 2.00 },
"CTR-SOLID-SF": { material: 0.00,   labor: 23.96,   equipment: 0.00 },
"CTR-SINK-EA":  { material: 25.00,  labor: 50.00,   equipment: 5.00 },
"ELE-OUTL-EA":  { material: 18.54,  labor: 35.00,   equipment: 5.00 },
"ELE-GFCI-EA":  { material: 25.00,  labor: 45.00,   equipment: 5.00 },
"ELE-SWCH-EA":  { material: 8.00,   labor: 25.00,   equipment: 3.00 },
"ELE-LITE-EA":  { material: 30.00,  labor: 40.00,   equipment: 5.00 },
"ELE-FAN-EA":   { material: 75.00,  labor: 60.00,   equipment: 10.00 },
"PLM-SINK-EA":  { material: 150.00, labor: 75.00,   equipment: 10.00 },
"PLM-FAUCET-EA":{ material: 80.00,  labor: 50.00,   equipment: 5.00 },
"PLM-TOIL-EA":  { material: 218.97, labor: 50.00,   equipment: 0.36 },
"PLM-TUB-EA":   { material: 71.95,  labor: 801.18,  equipment: 28.87 },
"PLM-WH-EA":    { material: 350.00, labor: 200.00,  equipment: 25.00 },
"HVAC-DUCT-LF": { material: 3.00,   labor: 5.00,    equipment: 1.00 },
"HVAC-VENT-EA": { material: 10.00,  labor: 20.00,   equipment: 2.00 },
"HVAC-RETN-EA": { material: 12.00,  labor: 20.00,   equipment: 2.00 },
"HVAC-THERM-EA":{ material: 40.00,  labor: 35.00,   equipment: 5.00 },
"HVAC-CLEAN-EA":{ material: 0.00,   labor: 300.00,  equipment: 100.00 },
"GEN-PROT-SF":  { material: 0.00,   labor: 0.25,    equipment: 2.03 },
"GEN-CLEAN-SF": { material: 0.00,   labor: 0.23,    equipment: 4.67 },
"GEN-SUPER-HR": { material: 0.00,   labor: 85.00,   equipment: 0.00 },
"GEN-PERMIT-EA":{ material: 250.00, labor: 0.00,    equipment: 0.00 },
"GEN-CONTENT-EA":{ material: 0.00,  labor: 73.58,   equipment: 0.00 },
```

### TypeScript Interface

Add this interface to `seed-catalog.ts` for type safety:

```ts
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
  companionRules: {
    requires?: string[];
    auto_adds?: string[];
    excludes?: string[];
  };
}
```

### Updated `seedCatalog()` Function

```ts
export async function seedCatalog() {
  console.log("Seeding enhanced pricing catalog...");

  for (const item of ENHANCED_CATALOG) {
    await db.insert(scopeLineItems).values({
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
      companionRules: Object.keys(item.companionRules).length > 0
        ? item.companionRules
        : null,
      isActive: true,
      sortOrder: 0,
    }).onConflictDoUpdate({
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
        companionRules: Object.keys(item.companionRules).length > 0
          ? item.companionRules
          : null,
      },
    });
  }

  console.log(`Upserted ${ENHANCED_CATALOG.length} enhanced catalog items`);

  // Seed regional prices with upsert
  for (const [code, prices] of Object.entries(REGIONAL_PRICES)) {
    await db.insert(regionalPriceSets).values({
      regionId: "US_NATIONAL",
      regionName: "United States (National Average)",
      lineItemCode: code,
      materialCost: prices.material,
      laborCost: prices.labor,
      equipmentCost: prices.equipment,
      effectiveDate: new Date().toISOString().split("T")[0],
      priceListVersion: "2.0",
    }).onConflictDoNothing(); // Keep existing prices if already seeded
  }

  console.log(`Seeded regional prices for US_NATIONAL region`);
}
```

**Key change:** Use `onConflictDoUpdate` on the `code` unique index so the seed is idempotent — running it again updates existing items rather than failing.

---

## Part B — Companion Rule Chains

### Goal
Define the complete cascading dependency graph across all 16 trades. When the scope assembly service processes damage and generates scope items, companion rules fire recursively: item A auto-adds item B, which may auto-add item C.

### Master Companion Rule Matrix

This matrix documents every companion relationship. The seed data in Part A encodes these as JSONB on each catalog item's `companionRules` field.

#### Water Damage Cascade (most common)

```
Damage: water_intrusion, severity: severe, surface: wall
  └→ MIT-EXTR-SF (extraction)
      └→ auto_adds: MIT-DEHU-DAY, MIT-AIRM-DAY
          └→ MIT-DEHU-DAY auto_adds: MIT-MONI-DAY
  └→ DEM-DRY-SF (remove drywall)
      └→ auto_adds: DEM-HAUL-LD, DRY-SHEET-SF
          └→ DEM-HAUL-LD auto_adds: DEM-DUMP-LD
          └→ DRY-SHEET-SF requires: DEM-DRY-SF ✓ (already present)
          └→ DRY-SHEET-SF auto_adds: DRY-TAPE-LF, DRY-JOINT-SF, PNT-DRYWALL-SF
              └→ DRY-JOINT-SF auto_adds: DRY-SAND-SF
              └→ PNT-DRYWALL-SF requires: DRY-SHEET-SF ✓
  └→ DEM-TRIM-LF (remove baseboard)
      └→ auto_adds: FLR-TRIM-LF (new baseboard)
```

#### Roofing Cascade (hail/wind)

```
Damage: hail_impact, surface: roof
  └→ RFG-SHIN-AR (architectural shingles)
      └→ auto_adds: RFG-FELT-SQ, RFG-ICE-SF, RFG-DRIP-LF, RFG-RIDGE-LF
  └→ If 3+ slopes: auto_adds RFG-VALLEY-LF
  └→ If vents present: auto_adds RFG-VENT-EA
```

#### Flooring Cascade

```
Damage: water_intrusion, surface: floor
  └→ DEM-FLR-SF or DEM-TILE-SF (remove existing)
      └→ auto_adds: DEM-HAUL-LD
  └→ FLR-TILE-SF or FLR-VINYL-SF etc. (new floor)
      └→ If carpet: auto_adds FLR-PAD-SF
      └→ If tile: auto_adds FLR-GROUT-SF, FLR-MORTAR-SF
  └→ FLR-TRIM-LF (new baseboard)
      └→ auto_adds: PNT-TRIM-LF (paint baseboard)
```

#### Kitchen Cascade

```
Damage: water_intrusion, room: kitchen
  └→ DEM-CAB-LF (remove cabinets)
      └→ auto_adds: DEM-HAUL-LD
  └→ CAB-BASE-LF (new cabinets)
      └→ requires: DEM-CAB-LF ✓
      └→ auto_adds: CTR-LAM-SF (countertop)
```

#### Bathroom Cascade

```
Damage: water_intrusion, room: bathroom
  └→ DEM-VANITY-EA (remove vanity)
      └→ auto_adds: DEM-HAUL-LD
  └→ PLM-TOIL-EA (detach & reset toilet for floor work)
  └→ CAB-VAN-LF (new vanity)
      └→ requires: DEM-VANITY-EA ✓
```

### Recursion Depth Limit

The `scopeAssemblyService.assembleScope()` must enforce a maximum companion recursion depth of **3 levels** to prevent infinite loops. If item A → B → C → D, stop at D. Log a warning if depth exceeded.

### Duplicate Prevention

Before adding a companion item, check if it already exists in the session's scope items for the same room. The `isExcluded()` function from PROMPT-16 handles the `excludes` array; extend it to also check for duplicates:

```ts
function shouldAddCompanion(
  code: string,
  existingItems: ScopeItem[],
  currentBatch: string[],
): boolean {
  // Already in existing scope for this room
  if (existingItems.some(i => i.catalogCode === code && i.status === "active")) return false;
  // Already in the current companion batch
  if (currentBatch.includes(code)) return false;
  return true;
}
```

---

## Part C — Peril Scope Templates

### Goal
Create pre-built scope packages for each peril type. When the voice agent identifies a peril type (or the claim already has one), a template can be loaded as a starting point — the adjuster then adjusts quantities and adds/removes items.

### File: `server/perilTemplates.ts` — New File

```ts
import type { ScopeLineItem } from "@shared/schema";

export interface PerilTemplate {
  perilType: string;
  name: string;
  description: string;
  /** Room types where this template applies */
  applicableRoomTypes: string[];
  /** Zone types where this template applies */
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
```

### Template: Water Damage — Interior Room

```ts
export const WATER_INTERIOR_TEMPLATE: PerilTemplate = {
  perilType: "water",
  name: "Water Damage — Interior Room",
  description: "Standard scope for water-damaged interior room (Category 1-2 water, walls and floors affected)",
  applicableRoomTypes: [
    "interior_bedroom", "interior_living", "interior_family",
    "interior_den", "interior_dining", "interior_hallway",
  ],
  applicableZoneTypes: ["interior"],
  items: [
    // Phase 1: Mitigation
    { catalogCode: "MIT-EXTR-SF", autoInclude: true, quantityMultiplier: 1.0, perilNotes: "Extract standing water first" },
    { catalogCode: "MIT-DEHU-DAY", autoInclude: true, quantityMultiplier: 1.0, perilNotes: "Minimum 3 days, adjust per monitoring" },
    { catalogCode: "MIT-AIRM-DAY", autoInclude: true, quantityMultiplier: 1.0, perilNotes: "1 per 10-16 LF of affected wall" },
    { catalogCode: "MIT-MONI-DAY", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "MIT-APPL-SF", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "Add for Category 2/3 water" },

    // Phase 2: Demolition
    { catalogCode: "DEM-DRY-SF", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "Full removal for severe; use MIT-DEMO-SF for flood cut" },
    { catalogCode: "MIT-DEMO-SF", autoInclude: true, quantityMultiplier: 1.0, perilNotes: "Flood cut 2-4 ft — default for moderate damage" },
    { catalogCode: "DEM-TRIM-LF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "DEM-FLR-SF", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "Only if flooring non-salvageable" },
    { catalogCode: "DEM-HAUL-LD", autoInclude: true, quantityMultiplier: 1.0 },

    // Phase 3: Reconstruction — Drywall
    { catalogCode: "DRY-SHEET-SF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "DRY-TAPE-LF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "DRY-JOINT-SF", autoInclude: true, quantityMultiplier: 1.0 },

    // Phase 4: Reconstruction — Paint
    { catalogCode: "PNT-DRYWALL-SF", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "PNT-TRIM-LF", autoInclude: true, quantityMultiplier: 1.0 },

    // Phase 5: Reconstruction — Flooring
    { catalogCode: "FLR-VINYL-SF", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "Select appropriate flooring type" },
    { catalogCode: "FLR-PAD-SF", autoInclude: false, quantityMultiplier: 1.0 },
    { catalogCode: "FLR-TRIM-LF", autoInclude: true, quantityMultiplier: 1.0, perilNotes: "New baseboard after flooring" },

    // General
    { catalogCode: "GEN-CONTENT-EA", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "If room contents need move-out" },
    { catalogCode: "GEN-CLEAN-SF", autoInclude: true, quantityMultiplier: 1.0 },
  ],
};
```

### Template: Water Damage — Kitchen

```ts
export const WATER_KITCHEN_TEMPLATE: PerilTemplate = {
  perilType: "water",
  name: "Water Damage — Kitchen",
  description: "Kitchen-specific water damage scope including cabinetry and countertops",
  applicableRoomTypes: ["interior_kitchen"],
  applicableZoneTypes: ["interior"],
  items: [
    // Includes all of WATER_INTERIOR_TEMPLATE items, plus:
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
```

### Template: Water Damage — Bathroom

```ts
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
```

### Template: Hail Damage — Roof

```ts
export const HAIL_ROOF_TEMPLATE: PerilTemplate = {
  perilType: "hail",
  name: "Hail Damage — Roof",
  description: "Complete roof replacement scope for hail damage",
  applicableRoomTypes: ["exterior_roof_slope"],
  applicableZoneTypes: ["roof"],
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
```

### Template: Hail Damage — Exterior

```ts
export const HAIL_EXTERIOR_TEMPLATE: PerilTemplate = {
  perilType: "hail",
  name: "Hail Damage — Exterior",
  description: "Exterior damage scope for hail — siding, gutters, soft metals",
  applicableRoomTypes: ["exterior_elevation_front", "exterior_elevation_left", "exterior_elevation_right", "exterior_elevation_rear"],
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
```

### Template: Wind Damage — Roof

```ts
export const WIND_ROOF_TEMPLATE: PerilTemplate = {
  perilType: "wind",
  name: "Wind Damage — Roof",
  description: "Partial roof repair scope for wind damage — lifted/missing shingles",
  applicableRoomTypes: ["exterior_roof_slope"],
  applicableZoneTypes: ["roof"],
  items: [
    { catalogCode: "RFG-SHIN-AR", autoInclude: true, quantityMultiplier: 1.0, perilNotes: "Affected slopes only — not full replacement" },
    { catalogCode: "RFG-FELT-SQ", autoInclude: true, quantityMultiplier: 1.0 },
    { catalogCode: "RFG-RIDGE-LF", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "If ridge caps lifted/missing" },
    { catalogCode: "RFG-DRIP-LF", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "If edge damage present" },
    { catalogCode: "RFG-FLASH-LF", autoInclude: false, quantityMultiplier: 1.0, perilNotes: "If flashing displaced" },
  ],
};
```

### Template Registry

```ts
export const PERIL_TEMPLATES: PerilTemplate[] = [
  WATER_INTERIOR_TEMPLATE,
  WATER_KITCHEN_TEMPLATE,
  WATER_BATHROOM_TEMPLATE,
  HAIL_ROOF_TEMPLATE,
  HAIL_EXTERIOR_TEMPLATE,
  WIND_ROOF_TEMPLATE,
];

/**
 * Finds matching templates for a given peril type and room context.
 */
export function getMatchingTemplates(
  perilType: string,
  roomType: string,
): PerilTemplate[] {
  return PERIL_TEMPLATES.filter(t =>
    t.perilType === perilType &&
    (t.applicableRoomTypes.includes(roomType) ||
     t.applicableZoneTypes.some(z => roomType.startsWith(`${z === "interior" ? "interior" : "exterior"}`)))
  );
}
```

---

## Part D — Inspection Flow → Scope Assembly Integration

### Goal
Wire the voice agent's inspection flow so that damage observations automatically trigger scope assembly. Currently `add_damage` and `add_line_item` are independent tools — the voice agent must manually decide to call `add_line_item` after `add_damage`. PROMPT-16 added the `generate_scope` tool but nothing in the flow triggers it automatically.

### Update 1: System Instructions Enhancement

In `server/realtime.ts`, update the `buildSystemInstructions()` function to add explicit scope assembly behavior in the system prompt.

**Add after the existing phase descriptions (around line 55):**

```ts
// Inside the system prompt string, add:
`
## SCOPE ASSEMBLY PROTOCOL
After recording any damage observation with add_damage:
1. IMMEDIATELY call generate_scope with the returned damageId and roomId
2. Review the generated scope items with the adjuster
3. If companion items were auto-added, briefly mention them: "I've also added [companion items] since they're typically needed with [primary item]"
4. If any items need manual quantities, ask the adjuster for measurements

When entering a new room:
1. After create_room, check if a peril template applies
2. Suggest the template: "For [peril] damage in a [room type], I typically start with [template items]. Shall I load that as a starting point?"
3. If approved, apply the template items via generate_scope

When completing a room:
1. Call validate_scope to check for gaps
2. Report any warnings: "Before we leave this room, I notice [warning]. Should we add [suggested item]?"
`
```

### Update 2: Add `apply_template` Voice Tool

Add a new voice tool to `realtimeTools` array in `server/realtime.ts`:

```ts
{
  type: "function",
  name: "apply_peril_template",
  description: "Applies a peril-specific scope template to a room, pre-populating line items based on the claim's peril type and room type. Use when entering a new room to establish a baseline scope.",
  parameters: {
    type: "object",
    properties: {
      roomId: {
        type: "integer",
        description: "The room ID to apply the template to",
      },
      templateName: {
        type: "string",
        description: "The template name to apply (e.g., 'Water Damage — Interior Room', 'Hail Damage — Roof')",
      },
      includeAutoOnly: {
        type: "boolean",
        description: "If true, only include auto-include items. If false, include all template items as suggestions.",
      },
    },
    required: ["roomId"],
  },
}
```

### Update 3: Template Application Route

Add a new route in `server/routes.ts`:

```ts
// POST /api/inspection/:sessionId/scope/apply-template
app.post("/api/inspection/:sessionId/scope/apply-template", async (req, res) => {
  const sessionId = parseInt(req.params.sessionId);
  const { roomId, templateName, includeAutoOnly = true } = req.body;

  const session = await storage.getInspectionSession(sessionId);
  if (!session) return res.status(404).json({ error: "Session not found" });

  const claim = await storage.getClaim(session.claimId);
  if (!claim) return res.status(404).json({ error: "Claim not found" });

  const room = await storage.getRoom(roomId);
  if (!room) return res.status(404).json({ error: "Room not found" });

  // Find matching templates
  const templates = getMatchingTemplates(
    claim.perilType || "water",
    room.roomType || "interior_bedroom",
  );

  const template = templateName
    ? templates.find(t => t.name === templateName)
    : templates[0]; // Default to first match

  if (!template) {
    return res.status(404).json({
      error: "No matching template found",
      availableTemplates: templates.map(t => t.name),
    });
  }

  // Apply template items
  const appliedItems = [];
  const suggestedItems = [];

  for (const templateItem of template.items) {
    if (includeAutoOnly && !templateItem.autoInclude) {
      suggestedItems.push(templateItem);
      continue;
    }

    // Look up catalog item
    const catalogItem = await lookupCatalogItem(templateItem.catalogCode);
    if (!catalogItem) continue;

    // Derive quantity from room geometry
    const quantity = deriveQuantity(
      room,
      catalogItem.quantityFormula || "MANUAL",
    );

    // Create scope item
    const scopeItem = await storage.createScopeItem({
      sessionId,
      roomId,
      catalogCode: templateItem.catalogCode,
      description: catalogItem.description,
      tradeCode: catalogItem.tradeCode,
      quantity: quantity?.value || 0,
      unit: catalogItem.unit,
      quantityFormula: catalogItem.quantityFormula,
      provenance: "template",
      coverageType: catalogItem.coverageType || "A",
      activityType: catalogItem.activityType || "replace",
      wasteFactor: catalogItem.defaultWasteFactor || 0,
      status: "active",
    });

    appliedItems.push({
      ...scopeItem,
      perilNotes: templateItem.perilNotes,
      needsManualQuantity: !quantity || quantity.value === 0,
    });
  }

  res.json({
    templateName: template.name,
    appliedCount: appliedItems.length,
    appliedItems,
    suggestedItems: suggestedItems.map(s => ({
      catalogCode: s.catalogCode,
      perilNotes: s.perilNotes,
    })),
  });
});
```

### Update 4: Auto-Scope on Damage Creation

In the `add_damage` tool handler in `server/routes.ts` (currently around lines 796-817), add a post-creation hook that triggers scope assembly:

```ts
// After successfully creating the damage observation:
// (Inside the POST /api/inspection/:sessionId/rooms/:roomId/damages handler)

const damage = await storage.createDamageObservation({ ... });

// ── Auto-trigger scope assembly ──
try {
  const room = await storage.getRoom(parseInt(req.params.roomId));
  const result = await assembleScope(
    storage,
    sessionId,
    room!,
    damage,
  );

  res.json({
    damage,
    autoScope: {
      itemsGenerated: result.items.length,
      companionItems: result.companionItems.length,
      manualQuantityNeeded: result.manualQuantityNeeded,
      warnings: result.warnings,
    },
  });
} catch (scopeErr) {
  // Scope assembly failure should not block damage creation
  console.error("Auto-scope assembly failed:", scopeErr);
  res.json({
    damage,
    autoScope: null,
    scopeError: "Scope assembly failed — items can be added manually",
  });
}
```

This is the key bridge between "noting a problem" and "adding a repair item" that the second opinion analysis identified as missing.

### Update 5: Phase Transition Scope Validation

When the voice agent transitions between inspection phases, validate the current room's scope completeness. Add a middleware concept to the `set_inspection_context` tool handler:

```ts
// When phase changes via set_inspection_context:
if (newPhase !== currentPhase) {
  // If leaving a room-focused phase (3-5), validate scope
  if (currentPhase >= 3 && currentPhase <= 5) {
    const scopeItems = await storage.getScopeItems(sessionId);
    const rooms = await storage.getRooms(sessionId);
    const damages = await storage.getDamageObservations(sessionId);

    const validation = await validateScopeCompleteness(
      storage, sessionId, scopeItems, rooms, damages,
    );

    if (validation.warnings.length > 0) {
      // Return warnings to the voice agent so it can mention them
      return {
        phaseChanged: true,
        scopeValidation: {
          warnings: validation.warnings,
          suggestions: validation.suggestions,
        },
      };
    }
  }
}
```

---

## Testing Checklist

1. **Seed idempotency:** Run `seedCatalog()` twice — second run should update, not duplicate
2. **Companion cascading:** Create a `DRY-SHEET-SF` scope item → verify `DRY-TAPE-LF`, `DRY-JOINT-SF`, `PNT-DRYWALL-SF` are auto-added
3. **Recursion limit:** Verify companion chain stops at depth 3
4. **Scope conditions filtering:** With `damage_type: "water_intrusion"` + `surface: "wall"` + `severity: "severe"`, verify `DEM-DRY-SF`, `MIT-EXTR-SF`, `DRY-SHEET-SF` all match
5. **Quantity derivation:** For a room with dimensions 12×10×8, verify:
   - `FLOOR_SF` → 120
   - `WALL_SF` → 352
   - `PERIMETER_LF` → 44
   - `CEILING_SF` → 120
6. **Template application:** Apply `WATER_INTERIOR_TEMPLATE` to a bedroom → verify all `autoInclude: true` items created with correct quantities
7. **Auto-scope on damage:** Create a damage observation → verify scope items auto-generated via `assembleScope()`
8. **Phase validation:** Complete Phase 4 with drywall but no painting → verify warning about missing PNT items
9. **ESX export:** After scope assembly, export ESX → verify all items appear in `GENERIC_ROUGHDRAFT.XML` grouped by room
10. **Regional pricing:** Verify all 127+ items have `US_NATIONAL` pricing entries

---

## Files Modified

| File | Action | Description |
|------|--------|-------------|
| `server/seed-catalog.ts` | **Replace** | Full replacement with enhanced catalog items + new items |
| `server/perilTemplates.ts` | **New** | Peril scope templates and matching logic |
| `server/realtime.ts` | **Modify** | Add scope assembly protocol to system prompt, add `apply_peril_template` tool |
| `server/routes.ts` | **Modify** | Add `apply-template` route, add auto-scope hook to damage creation |

## Files Referenced (Read-Only)

| File | Reason |
|------|--------|
| `shared/schema.ts` | scopeLineItems, scopeItems, inspectionRooms, damageObservations schemas |
| `server/estimateEngine.ts` | lookupCatalogItem, calculateLineItemPrice |
| `server/esxGenerator.ts` | ESX export consuming scope items |

---

## Summary

PROMPT-17 gives the PROMPT-16 scope engine its fuel:

- **Part A** populates every catalog item with `quantityFormula`, `companionRules`, `scopeConditions`, `coverageType`, `xactCategoryCode`, `xactSelector`, and `notes` — turning the empty shell into a functional lookup service
- **Part B** defines the cascading dependency graph so that adding one item automatically brings its companions — the drywall→tape→mud→sand→paint chain, the shingle→felt→ice-shield→drip-edge chain
- **Part C** provides peril-specific starter packages so the voice agent can say "for water damage in a bedroom, here's what we typically need" rather than building from scratch
- **Part D** bridges the damage→scope disconnect by auto-triggering scope assembly when damage is observed, adding template application to room entry, and validating scope completeness at phase transitions
