-- Migration: Xactimate Category Code Compliance
-- Date: 2026-02-25
-- Description: Updates all scope_line_items xact_category_code and xact_selector
--              values to use official Xactimate 3-letter category codes from xactware.helpdocs.io
--
-- SAFE TO RE-RUN: All statements use UPDATE...WHERE code = ... (idempotent)
-- AFFECTS: scope_line_items table only (xact_category_code and xact_selector columns)
-- SCHEMA CHANGE: Drops the unique constraint on (xact_category_code, xact_selector)
--                because multiple items can legitimately share the same category+selector
--
-- Run against any database sharing the same scope_line_items table:
--   psql $SUPABASE_DATABASE_URL -f migrations/0001_xactimate_category_codes.sql

BEGIN;

-- Drop the unique constraint on (xact_category_code, xact_selector) — multiple items
-- can legitimately share the same Xactimate category+selector (e.g., FCC+PAD)
DROP INDEX IF EXISTS scope_line_items_xact_cat_sel_unique;

-- ─── MIT: Mitigation (WTR) ──────────────────────────────────────────────────
-- No changes needed — already using WTR

-- ─── DEM: Demolition → DMO ──────────────────────────────────────────────────
UPDATE scope_line_items SET xact_category_code = 'DMO', xact_selector = 'DRY' WHERE code = 'DEM-DRY-SF';
UPDATE scope_line_items SET xact_category_code = 'DMO', xact_selector = 'CEIL' WHERE code = 'DEM-CEIL-SF';
UPDATE scope_line_items SET xact_category_code = 'DMO', xact_selector = 'FLR' WHERE code = 'DEM-FLR-SF';
UPDATE scope_line_items SET xact_category_code = 'DMO', xact_selector = 'PAD' WHERE code = 'DEM-PAD-SF';
UPDATE scope_line_items SET xact_category_code = 'DMO', xact_selector = 'TILE' WHERE code = 'DEM-TILE-SF';
UPDATE scope_line_items SET xact_category_code = 'DMO', xact_selector = 'CAB' WHERE code = 'DEM-CAB-LF';
UPDATE scope_line_items SET xact_category_code = 'DMO', xact_selector = 'TRIM' WHERE code = 'DEM-TRIM-LF';
UPDATE scope_line_items SET xact_category_code = 'DMO', xact_selector = 'HAUL' WHERE code = 'DEM-HAUL-LD';
UPDATE scope_line_items SET xact_category_code = 'DMO', xact_selector = 'INSUL' WHERE code = 'DEM-INSUL-SF';
UPDATE scope_line_items SET xact_category_code = 'DMO', xact_selector = 'VANITY' WHERE code = 'DEM-VANITY-EA';
UPDATE scope_line_items SET xact_category_code = 'FEE', xact_selector = 'DUMP' WHERE code = 'DEM-DUMP-LD';

-- ─── DRY: Drywall (DRY) ────────────────────────────────────────────────────
-- No changes needed — already using DRY

-- ─── PNT: Painting (PNT) ───────────────────────────────────────────────────
-- No changes needed — already using PNT

-- ─── FLR: Flooring → split by type ──────────────────────────────────────────
UPDATE scope_line_items SET xact_category_code = 'FCT', xact_selector = 'TILE' WHERE code = 'FLR-TILE-SF';
UPDATE scope_line_items SET xact_category_code = 'FCV', xact_selector = 'VINYL' WHERE code = 'FLR-VINYL-SF';
UPDATE scope_line_items SET xact_category_code = 'FCR', xact_selector = 'LAM' WHERE code = 'FLR-LAMINATE-SF';
UPDATE scope_line_items SET xact_category_code = 'FCW', xact_selector = 'HWD' WHERE code = 'FLR-WOOD-SF';
UPDATE scope_line_items SET xact_category_code = 'FCC', xact_selector = 'CAR' WHERE code = 'FLR-CARPET-SF';
UPDATE scope_line_items SET xact_category_code = 'FCC', xact_selector = 'PAD' WHERE code = 'FLR-PAD-SF';
UPDATE scope_line_items SET xact_category_code = 'FCT', xact_selector = 'GROUT' WHERE code = 'FLR-GROUT-SF';
UPDATE scope_line_items SET xact_category_code = 'FCT', xact_selector = 'MORTAR' WHERE code = 'FLR-MORTAR-SF';
UPDATE scope_line_items SET xact_category_code = 'FCT', xact_selector = 'SEAL' WHERE code = 'FLR-SEALANT-SF';
UPDATE scope_line_items SET xact_category_code = 'FNC', xact_selector = 'TRIM' WHERE code = 'FLR-TRIM-LF';

-- ─── INS: Insulation (INS) ──────────────────────────────────────────────────
-- No changes needed — already using INS

-- ─── CAR: Carpentry → split by type ─────────────────────────────────────────
UPDATE scope_line_items SET xact_category_code = 'FRM', xact_selector = 'FRAME' WHERE code = 'CAR-FRAME-LF';
UPDATE scope_line_items SET xact_category_code = 'FRM', xact_selector = 'SHEATH' WHERE code = 'CAR-SHEATH-SF';
UPDATE scope_line_items SET xact_category_code = 'FRM', xact_selector = 'BEAM' WHERE code = 'CAR-BEAM-LF';
UPDATE scope_line_items SET xact_category_code = 'FRM', xact_selector = 'RAFTER' WHERE code = 'CAR-RAFTER-LF';
UPDATE scope_line_items SET xact_category_code = 'FRM', xact_selector = 'JOIST' WHERE code = 'CAR-JOISTS-LF';
UPDATE scope_line_items SET xact_category_code = 'FRM', xact_selector = 'SILL' WHERE code = 'CAR-SILL-LF';
UPDATE scope_line_items SET xact_category_code = 'FRM', xact_selector = 'BLOCK' WHERE code = 'CAR-BLOCKING-LF';
UPDATE scope_line_items SET xact_category_code = 'XST', xact_selector = 'DECK' WHERE code = 'CAR-DECK-SF';
UPDATE scope_line_items SET xact_category_code = 'XST', xact_selector = 'PORCH' WHERE code = 'CAR-PORCH-SF';
UPDATE scope_line_items SET xact_category_code = 'STR', xact_selector = 'STAIR' WHERE code = 'CAR-STAIR-EA';
UPDATE scope_line_items SET xact_category_code = 'STR', xact_selector = 'LAND' WHERE code = 'CAR-LANDING-SF';
UPDATE scope_line_items SET xact_category_code = 'SFG', xact_selector = 'SOFF' WHERE code = 'CAR-SOFFIT-SF';

-- ─── RFG: Roofing (RFG) ────────────────────────────────────────────────────
-- No changes needed — already using RFG

-- ─── WIN: Windows → split by type ───────────────────────────────────────────
UPDATE scope_line_items SET xact_category_code = 'WDV', xact_selector = 'DH' WHERE code = 'WIN-DOUBLE-EA';
UPDATE scope_line_items SET xact_category_code = 'WDV', xact_selector = 'CAS' WHERE code = 'WIN-CASEMENT-EA';
UPDATE scope_line_items SET xact_category_code = 'WDV', xact_selector = 'PIC' WHERE code = 'WIN-PICTURE-EA';
UPDATE scope_line_items SET xact_category_code = 'WDV', xact_selector = 'SCREEN' WHERE code = 'WIN-SCREEN-EA';
UPDATE scope_line_items SET xact_category_code = 'WDR', xact_selector = 'GLASS' WHERE code = 'WIN-GLASS-SF';
UPDATE scope_line_items SET xact_category_code = 'WDR', xact_selector = 'FRAME' WHERE code = 'WIN-FRAME-EA';
UPDATE scope_line_items SET xact_category_code = 'WDR', xact_selector = 'SEAL' WHERE code = 'WIN-SEAL-LF';
UPDATE scope_line_items SET xact_category_code = 'FNC', xact_selector = 'SILL' WHERE code = 'WIN-SILL-LF';

-- ─── EXT: Exterior → split by type ──────────────────────────────────────────
UPDATE scope_line_items SET xact_category_code = 'SDG', xact_selector = 'VINYL' WHERE code = 'EXT-SIDING-SF';
UPDATE scope_line_items SET xact_category_code = 'SDG', xact_selector = 'CORNER' WHERE code = 'EXT-CORNER-LF';
UPDATE scope_line_items SET xact_category_code = 'MAS', xact_selector = 'BRICK' WHERE code = 'EXT-BRICK-SF';
UPDATE scope_line_items SET xact_category_code = 'MAS', xact_selector = 'STONE' WHERE code = 'EXT-STONE-SF';
UPDATE scope_line_items SET xact_category_code = 'STU', xact_selector = 'STUCCO' WHERE code = 'EXT-STUCCO-SF';
UPDATE scope_line_items SET xact_category_code = 'MPR', xact_selector = 'WRAP' WHERE code = 'EXT-WRAP-SF';
UPDATE scope_line_items SET xact_category_code = 'SFG', xact_selector = 'FASCIA' WHERE code = 'EXT-FASCIA-LF';
UPDATE scope_line_items SET xact_category_code = 'SFG', xact_selector = 'SOFFIT' WHERE code = 'EXT-SOFFIT-SF';
UPDATE scope_line_items SET xact_category_code = 'DOR', xact_selector = 'DOOR' WHERE code = 'EXT-DOOR-EA';
UPDATE scope_line_items SET xact_category_code = 'DOR', xact_selector = 'GARAGE' WHERE code = 'EXT-GARAGE-EA';

-- ─── CAB: Cabinetry (CAB) ───────────────────────────────────────────────────
-- No changes needed — already using CAB

-- ─── CTR: Countertops (CTR) ─────────────────────────────────────────────────
-- No changes needed — already using CTR

-- ─── ELE: Electrical (ELE) ──────────────────────────────────────────────────
-- No changes needed — already using ELE

-- ─── PLM: Plumbing (PLM) ───────────────────────────────────────────────────
-- No changes needed — already using PLM

-- ─── HVAC → HVC ─────────────────────────────────────────────────────────────
UPDATE scope_line_items SET xact_category_code = 'HVC', xact_selector = 'DUCT' WHERE code = 'HVAC-DUCT-LF';
UPDATE scope_line_items SET xact_category_code = 'HVC', xact_selector = 'VENT' WHERE code = 'HVAC-VENT-EA';
UPDATE scope_line_items SET xact_category_code = 'HVC', xact_selector = 'RETN' WHERE code = 'HVAC-RETN-EA';
UPDATE scope_line_items SET xact_category_code = 'HVC', xact_selector = 'THERM' WHERE code = 'HVAC-THERM-EA';
UPDATE scope_line_items SET xact_category_code = 'HVC', xact_selector = 'CLEN' WHERE code = 'HVAC-CLEAN-EA';

-- ─── GEN: General Conditions → split by type ────────────────────────────────
UPDATE scope_line_items SET xact_category_code = 'TMP', xact_selector = 'PROT' WHERE code = 'GEN-PROT-SF';
UPDATE scope_line_items SET xact_category_code = 'CLN', xact_selector = 'CLEN' WHERE code = 'GEN-CLEAN-SF';
UPDATE scope_line_items SET xact_category_code = 'LAB', xact_selector = 'SUPR' WHERE code = 'GEN-SUPER-HR';
UPDATE scope_line_items SET xact_category_code = 'FEE', xact_selector = 'PERM' WHERE code = 'GEN-PERMIT-EA';
UPDATE scope_line_items SET xact_category_code = 'CON', xact_selector = 'CONT' WHERE code = 'GEN-CONTENT-EA';

COMMIT;

-- Verification query (optional — run after migration to confirm):
-- SELECT code, xact_category_code, xact_selector FROM scope_line_items ORDER BY code;
