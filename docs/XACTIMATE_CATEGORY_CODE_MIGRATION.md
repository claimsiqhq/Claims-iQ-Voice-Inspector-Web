# Xactimate Category Code Migration

**Date:** 2026-02-25  
**Affects:** `scope_line_items` table (`xact_category_code`, `xact_selector` columns)  
**Reference:** [Xactware Category Codes](https://xactware.helpdocs.io)

## Summary

Updated all 132 catalog items in `scope_line_items` to use official Xactimate 3-letter category codes. Previously, several trades used internal shorthand codes (e.g., `DEM`, `FLR`, `WIN`, `EXT`, `CAR`, `HVA`, `GEN`) that don't exist in the Xactimate system. These have been corrected to the proper codes that Xactimate actually recognizes.

## How to Apply

### Option A: Run the SQL migration directly

For the parallel app or any database sharing the same `scope_line_items` table:

```bash
psql $SUPABASE_DATABASE_URL -f migrations/0001_xactimate_category_codes.sql
```

The migration is idempotent — safe to run multiple times.

### Option B: Run the seed (this app)

The TypeScript seed in `server/seed-catalog.ts` already contains the corrected codes. It runs automatically on server startup and uses `ON CONFLICT DO UPDATE` on the `code` column, so it will update existing rows.

## Changes by Trade

### Demolition: `DEM` → `DMO`

| Item Code | Old Category | New Category | Selector |
|-----------|-------------|-------------|----------|
| DEM-DRY-SF | DEM | **DMO** | DRY |
| DEM-CEIL-SF | DEM | **DMO** | CEIL |
| DEM-FLR-SF | DEM | **DMO** | FLR |
| DEM-PAD-SF | DEM | **DMO** | PAD |
| DEM-TILE-SF | DEM | **DMO** | TILE |
| DEM-CAB-LF | DEM | **DMO** | CAB |
| DEM-TRIM-LF | DEM | **DMO** | TRIM |
| DEM-HAUL-LD | DEM | **DMO** | HAUL |
| DEM-INSUL-SF | DEM | **DMO** | INSUL |
| DEM-VANITY-EA | DEM | **DMO** | VANITY |
| DEM-DUMP-LD | DEM | **FEE** | DUMP |

### Flooring: `FLR` → `FCT`/`FCV`/`FCR`/`FCW`/`FCC`/`FNC`

Xactimate splits flooring into sub-categories by material type:

| Item Code | Old Category | New Category | Meaning |
|-----------|-------------|-------------|---------|
| FLR-TILE-SF | FLR | **FCT** | Floor Covering — Tile |
| FLR-GROUT-SF | FLR | **FCT** | Floor Covering — Tile |
| FLR-MORTAR-SF | FLR | **FCT** | Floor Covering — Tile |
| FLR-SEALANT-SF | FLR | **FCT** | Floor Covering — Tile |
| FLR-VINYL-SF | FLR | **FCV** | Floor Covering — Vinyl |
| FLR-LAMINATE-SF | FLR | **FCR** | Floor Covering — Resilient |
| FLR-WOOD-SF | FLR | **FCW** | Floor Covering — Wood |
| FLR-CARPET-SF | FLR | **FCC** | Floor Covering — Carpet |
| FLR-PAD-SF | FLR | **FCC** | Floor Covering — Carpet |
| FLR-TRIM-LF | FLR | **FNC** | Finish Carpentry |

### Carpentry: `CAR` → `FRM`/`XST`/`STR`/`SFG`

Xactimate splits carpentry by structural purpose:

| Item Code | Old Category | New Category | Meaning |
|-----------|-------------|-------------|---------|
| CAR-FRAME-LF | CAR | **FRM** | Framing |
| CAR-SHEATH-SF | CAR | **FRM** | Framing |
| CAR-BEAM-LF | CAR | **FRM** | Framing |
| CAR-RAFTER-LF | CAR | **FRM** | Framing |
| CAR-JOISTS-LF | CAR | **FRM** | Framing |
| CAR-SILL-LF | CAR | **FRM** | Framing |
| CAR-BLOCKING-LF | CAR | **FRM** | Framing |
| CAR-DECK-SF | CAR | **XST** | Exterior Structures |
| CAR-PORCH-SF | CAR | **XST** | Exterior Structures |
| CAR-STAIR-EA | CAR | **STR** | Stairs |
| CAR-LANDING-SF | CAR | **STR** | Stairs |
| CAR-SOFFIT-SF | CAR | **SFG** | Soffit/Fascia/Gutter |

### Windows: `WIN` → `WDV`/`WDR`/`FNC`

Xactimate splits windows by vinyl (full replacement) vs reglazing (repair):

| Item Code | Old Category | New Category | Meaning |
|-----------|-------------|-------------|---------|
| WIN-DOUBLE-EA | WIN | **WDV** | Windows — Vinyl |
| WIN-CASEMENT-EA | WIN | **WDV** | Windows — Vinyl |
| WIN-PICTURE-EA | WIN | **WDV** | Windows — Vinyl |
| WIN-SCREEN-EA | WIN | **WDV** | Windows — Vinyl |
| WIN-GLASS-SF | WIN | **WDR** | Windows — Reglazing |
| WIN-FRAME-EA | WIN | **WDR** | Windows — Reglazing |
| WIN-SEAL-LF | WIN | **WDR** | Windows — Reglazing |
| WIN-SILL-LF | WIN | **FNC** | Finish Carpentry |

### Exterior: `EXT` → `SDG`/`MAS`/`STU`/`MPR`/`SFG`/`DOR`

Xactimate splits exterior work by material/component:

| Item Code | Old Category | New Category | Meaning |
|-----------|-------------|-------------|---------|
| EXT-SIDING-SF | EXT | **SDG** | Siding |
| EXT-CORNER-LF | EXT | **SDG** | Siding |
| EXT-BRICK-SF | EXT | **MAS** | Masonry |
| EXT-STONE-SF | EXT | **MAS** | Masonry |
| EXT-STUCCO-SF | EXT | **STU** | Stucco |
| EXT-WRAP-SF | EXT | **MPR** | Moisture Protection |
| EXT-FASCIA-LF | EXT | **SFG** | Soffit/Fascia/Gutter |
| EXT-SOFFIT-SF | EXT | **SFG** | Soffit/Fascia/Gutter |
| EXT-DOOR-EA | EXT | **DOR** | Doors |
| EXT-GARAGE-EA | EXT | **DOR** | Doors |

### HVAC: `HVA` → `HVC`

| Item Code | Old Category | New Category |
|-----------|-------------|-------------|
| HVAC-DUCT-LF | HVA | **HVC** |
| HVAC-VENT-EA | HVA | **HVC** |
| HVAC-RETN-EA | HVA | **HVC** |
| HVAC-THERM-EA | HVA | **HVC** |
| HVAC-CLEAN-EA | HVA | **HVC** |

### General Conditions: `GEN` → `TMP`/`CLN`/`LAB`/`FEE`/`CON`

Xactimate splits general conditions by activity type:

| Item Code | Old Category | New Category | Meaning |
|-----------|-------------|-------------|---------|
| GEN-PROT-SF | GEN | **TMP** | Temporary Repairs |
| GEN-CLEAN-SF | GEN | **CLN** | Cleaning |
| GEN-SUPER-HR | GEN | **LAB** | Labor |
| GEN-PERMIT-EA | GEN | **FEE** | Permits/Fees |
| GEN-CONTENT-EA | GEN | **CON** | Contents |

## Trades That Were Already Correct

These trades needed no changes:

| Trade | Category Code | Items |
|-------|--------------|-------|
| Mitigation | WTR | 10 items |
| Drywall | DRY | 10 items |
| Painting | PNT | 12 items |
| Insulation | INS | 8 items |
| Roofing | RFG | 12 items |
| Cabinetry | CAB | 4 items |
| Countertops | CTR | 5 items |
| Electrical | ELE | 5 items |
| Plumbing | PLM | 5 items |

## Complete Xactimate Category Code Reference

All official 3-letter codes used in this catalog:

| Code | Full Name |
|------|-----------|
| CAB | Cabinetry |
| CLN | Cleaning |
| CON | Contents |
| CTR | Countertops |
| DMO | Demolition |
| DOR | Doors |
| DRY | Drywall |
| ELE | Electrical |
| FCC | Floor Covering — Carpet |
| FCR | Floor Covering — Resilient |
| FCT | Floor Covering — Tile |
| FCV | Floor Covering — Vinyl |
| FCW | Floor Covering — Wood |
| FEE | Permits/Fees |
| FNC | Finish Carpentry |
| FRM | Framing |
| HVC | HVAC |
| INS | Insulation |
| LAB | Labor |
| MAS | Masonry |
| MPR | Moisture Protection |
| PLM | Plumbing |
| PNT | Painting |
| RFG | Roofing |
| SDG | Siding |
| SFG | Soffit/Fascia/Gutter |
| STR | Stairs |
| STU | Stucco |
| TMP | Temporary Repairs |
| WDR | Windows — Reglazing |
| WDV | Windows — Vinyl |
| WTR | Water/Mitigation |
| XST | Exterior Structures |

## Code Changes (Files Modified)

1. **`server/seed-catalog.ts`** — All 132 catalog items updated with correct `xactCategoryCode` and `xactSelector` values
2. **`server/tradeCodeMapping.ts`** — `resolveCategory()` and trade-to-category mappings updated to output official Xactimate codes
3. **`server/esxGenerator.ts`** — ESX XML generator now looks up `xactCategoryCode`/`xactSelector` from the catalog via a Map instead of splitting internal code strings
4. **`migrations/0001_xactimate_category_codes.sql`** — Standalone SQL migration for parallel databases
