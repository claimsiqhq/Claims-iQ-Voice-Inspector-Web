import { db } from "./db";
import { scopeLineItems, regionalPriceSets } from "@shared/schema";

const CATALOG_ITEMS = [
  // MIT (Mitigation - 10 items)
  { code: "MIT-EXTR-SF", trade: "MIT", desc: "Water extraction - standing, per SF", unit: "SF", waste: 0 },
  { code: "MIT-EXTR-CA", trade: "MIT", desc: "Water extraction - carpet/pad, per SF", unit: "SF", waste: 0 },
  { code: "MIT-DEHU-DAY", trade: "MIT", desc: "Dehumidifier per day", unit: "DAY", waste: 0 },
  { code: "MIT-AIRM-DAY", trade: "MIT", desc: "Air mover per day", unit: "DAY", waste: 0 },
  { code: "MIT-DEHM-DAY", trade: "MIT", desc: "Large dehumidifier per day", unit: "DAY", waste: 0 },
  { code: "MIT-APPL-SF", trade: "MIT", desc: "Apply antimicrobial, per SF", unit: "SF", waste: 5 },
  { code: "MIT-MOLD-SF", trade: "MIT", desc: "Mold remediation, per SF", unit: "SF", waste: 10 },
  { code: "MIT-DEMO-SF", trade: "MIT", desc: "Flood cut drywall, per SF", unit: "SF", waste: 0 },
  { code: "MIT-CONT-DAY", trade: "MIT", desc: "Containment setup, per day", unit: "DAY", waste: 0 },
  { code: "MIT-MONI-DAY", trade: "MIT", desc: "Moisture monitoring, per day", unit: "DAY", waste: 0 },

  // DEM (Demolition - 11 items)
  { code: "DEM-DRY-SF", trade: "DEM", desc: "Remove & reset drywall, per SF", unit: "SF", waste: 0 },
  { code: "DEM-CEIL-SF", trade: "DEM", desc: "Remove ceiling drywall, per SF", unit: "SF", waste: 0 },
  { code: "DEM-FLR-SF", trade: "DEM", desc: "Remove flooring, per SF", unit: "SF", waste: 0 },
  { code: "DEM-PAD-SF", trade: "DEM", desc: "Remove carpet pad, per SF", unit: "SF", waste: 0 },
  { code: "DEM-TILE-SF", trade: "DEM", desc: "Remove ceramic tile, per SF", unit: "SF", waste: 0 },
  { code: "DEM-CAB-LF", trade: "DEM", desc: "Remove base cabinets, per LF", unit: "LF", waste: 0 },
  { code: "DEM-TRIM-LF", trade: "DEM", desc: "Remove trim/baseboard, per LF", unit: "LF", waste: 0 },
  { code: "DEM-HAUL-LD", trade: "DEM", desc: "Haul debris, per load", unit: "LD", waste: 0 },
  { code: "DEM-DUMP-LD", trade: "DEM", desc: "Dump fees, per load", unit: "LD", waste: 0 },
  { code: "DEM-INSUL-SF", trade: "DEM", desc: "Remove insulation, per SF", unit: "SF", waste: 0 },
  { code: "DEM-VANITY-EA", trade: "DEM", desc: "Remove vanity, each", unit: "EA", waste: 0 },

  // DRY (Drywall - 10 items)
  { code: "DRY-SHEET-SF", trade: "DRY", desc: "Drywall sheet installation, per SF", unit: "SF", waste: 10 },
  { code: "DRY-TAPE-LF", trade: "DRY", desc: "Drywall tape, per LF", unit: "LF", waste: 5 },
  { code: "DRY-JOINT-SF", trade: "DRY", desc: "Joint compound application, per SF", unit: "SF", waste: 8 },
  { code: "DRY-SAND-SF", trade: "DRY", desc: "Sand drywall finish, per SF", unit: "SF", waste: 0 },
  { code: "DRY-PATCH-SF", trade: "DRY", desc: "Patch drywall, per SF", unit: "SF", waste: 10 },
  { code: "DRY-SOFFIT-SF", trade: "DRY", desc: "Install soffit drywall, per SF", unit: "SF", waste: 12 },
  { code: "DRY-CORNER-EA", trade: "DRY", desc: "Corner bead, each", unit: "EA", waste: 0 },
  { code: "DRY-FRAME-LF", trade: "DRY", desc: "Metal stud framing, per LF", unit: "LF", waste: 5 },
  { code: "DRY-MESH-SF", trade: "DRY", desc: "Drywall mesh tape, per SF", unit: "SF", waste: 3 },
  { code: "DRY-PRIMER-SF", trade: "DRY", desc: "Primer/sealer, per SF", unit: "SF", waste: 8 },

  // PNT (Painting - 12 items)
  { code: "PNT-INT-SF", trade: "PNT", desc: "Interior paint, per SF", unit: "SF", waste: 10 },
  { code: "PNT-EXT-SF", trade: "PNT", desc: "Exterior paint, per SF", unit: "SF", waste: 10 },
  { code: "PNT-TRIM-LF", trade: "PNT", desc: "Paint trim, per LF", unit: "LF", waste: 8 },
  { code: "PNT-PREP-SF", trade: "PNT", desc: "Paint prep/cleanup, per SF", unit: "SF", waste: 0 },
  { code: "PNT-STAIN-SF", trade: "PNT", desc: "Stain wood, per SF", unit: "SF", waste: 12 },
  { code: "PNT-CAULK-LF", trade: "PNT", desc: "Caulk, per LF", unit: "LF", waste: 5 },
  { code: "PNT-CABINET-SF", trade: "PNT", desc: "Cabinet refinish, per SF", unit: "SF", waste: 10 },
  { code: "PNT-DRYWALL-SF", trade: "PNT", desc: "Paint drywall, per SF", unit: "SF", waste: 8 },
  { code: "PNT-CEILING-SF", trade: "PNT", desc: "Paint ceiling, per SF", unit: "SF", waste: 12 },
  { code: "PNT-EPOXY-SF", trade: "PNT", desc: "Epoxy coating, per SF", unit: "SF", waste: 15 },
  { code: "PNT-SPRAY-SF", trade: "PNT", desc: "Spray painting, per SF", unit: "SF", waste: 12 },
  { code: "PNT-VARNISH-SF", trade: "PNT", desc: "Varnish/polyurethane, per SF", unit: "SF", waste: 10 },

  // FLR (Flooring - 10 items)
  { code: "FLR-TILE-SF", trade: "FLR", desc: "Ceramic tile flooring, per SF", unit: "SF", waste: 15 },
  { code: "FLR-VINYL-SF", trade: "FLR", desc: "Vinyl plank flooring, per SF", unit: "SF", waste: 10 },
  { code: "FLR-LAMINATE-SF", trade: "FLR", desc: "Laminate flooring, per SF", unit: "SF", waste: 12 },
  { code: "FLR-WOOD-SF", trade: "FLR", desc: "Hardwood flooring, per SF", unit: "SF", waste: 10 },
  { code: "FLR-CARPET-SF", trade: "FLR", desc: "Carpet installation, per SF", unit: "SF", waste: 12 },
  { code: "FLR-PAD-SF", trade: "FLR", desc: "Underlayment, per SF", unit: "SF", waste: 8 },
  { code: "FLR-GROUT-SF", trade: "FLR", desc: "Tile grout, per SF", unit: "SF", waste: 10 },
  { code: "FLR-MORTAR-SF", trade: "FLR", desc: "Tile mortar, per SF", unit: "SF", waste: 10 },
  { code: "FLR-SEALANT-SF", trade: "FLR", desc: "Grout/tile sealant, per SF", unit: "SF", waste: 8 },
  { code: "FLR-TRIM-LF", trade: "FLR", desc: "Floor trim/molding, per LF", unit: "LF", waste: 10 },

  // INS (Insulation - 8 items)
  { code: "INS-BATTS-SF", trade: "INS", desc: "Fiberglass batts, per SF", unit: "SF", waste: 15 },
  { code: "INS-BLOWN-SF", trade: "INS", desc: "Blown-in insulation, per SF", unit: "SF", waste: 10 },
  { code: "INS-SPRAY-SF", trade: "INS", desc: "Spray foam insulation, per SF", unit: "SF", waste: 8 },
  { code: "INS-RIGID-SF", trade: "INS", desc: "Rigid foam board, per SF", unit: "SF", waste: 10 },
  { code: "INS-VAPOR-SF", trade: "INS", desc: "Vapor barrier, per SF", unit: "SF", waste: 5 },
  { code: "INS-ATTIC-SF", trade: "INS", desc: "Attic insulation, per SF", unit: "SF", waste: 12 },
  { code: "INS-PIPE-LF", trade: "INS", desc: "Pipe insulation wrap, per LF", unit: "LF", waste: 5 },
  { code: "INS-CLOSURE-SF", trade: "INS", desc: "Foam closure strips, per SF", unit: "SF", waste: 0 },

  // CAR (Carpentry - 12 items)
  { code: "CAR-FRAME-LF", trade: "CAR", desc: "Wood framing, per LF", unit: "LF", waste: 10 },
  { code: "CAR-SHEATH-SF", trade: "CAR", desc: "Wall sheathing, per SF", unit: "SF", waste: 10 },
  { code: "CAR-DECK-SF", trade: "CAR", desc: "Deck construction, per SF", unit: "SF", waste: 15 },
  { code: "CAR-BEAM-LF", trade: "CAR", desc: "Header beam installation, per LF", unit: "LF", waste: 5 },
  { code: "CAR-RAFTER-LF", trade: "CAR", desc: "Rafter installation, per LF", unit: "LF", waste: 8 },
  { code: "CAR-PORCH-SF", trade: "CAR", desc: "Porch floor construction, per SF", unit: "SF", waste: 12 },
  { code: "CAR-JOISTS-LF", trade: "CAR", desc: "Floor joist installation, per LF", unit: "LF", waste: 8 },
  { code: "CAR-SILL-LF", trade: "CAR", desc: "Sill plate/band board, per LF", unit: "LF", waste: 5 },
  { code: "CAR-BLOCKING-LF", trade: "CAR", desc: "Blocking/bracing, per LF", unit: "LF", waste: 10 },
  { code: "CAR-STAIR-EA", trade: "CAR", desc: "Stair assembly, each", unit: "EA", waste: 10 },
  { code: "CAR-LANDING-SF", trade: "CAR", desc: "Landing platform, per SF", unit: "SF", waste: 12 },
  { code: "CAR-SOFFIT-SF", trade: "CAR", desc: "Soffit framing, per SF", unit: "SF", waste: 10 },

  // RFG (Roofing - 12 items)
  { code: "RFG-SHIN-AR", trade: "RFG", desc: "Architectural shingles, per SQ", unit: "SQ", waste: 10 },
  { code: "RFG-SHIN-3TAB", trade: "RFG", desc: "3-tab shingles, per SQ", unit: "SQ", waste: 10 },
  { code: "RFG-TILE-SF", trade: "RFG", desc: "Roof tile, per SF", unit: "SF", waste: 15 },
  { code: "RFG-METAL-SF", trade: "RFG", desc: "Metal roofing, per SF", unit: "SF", waste: 8 },
  { code: "RFG-UNDER-SF", trade: "RFG", desc: "Roofing underlayment, per SF", unit: "SF", waste: 10 },
  { code: "RFG-FELT-SQ", trade: "RFG", desc: "Roofing felt, per SQ", unit: "SQ", waste: 5 },
  { code: "RFG-RIDGE-LF", trade: "RFG", desc: "Ridge cap shingles, per LF", unit: "LF", waste: 8 },
  { code: "RFG-DRIP-LF", trade: "RFG", desc: "Drip edge, per LF", unit: "LF", waste: 0 },
  { code: "RFG-FLASH-LF", trade: "RFG", desc: "Flashing (roof penetration), per LF", unit: "LF", waste: 5 },
  { code: "RFG-ICE-SF", trade: "RFG", desc: "Ice/water shield, per SF", unit: "SF", waste: 8 },
  { code: "RFG-VENT-EA", trade: "RFG", desc: "Roof vent installation, each", unit: "EA", waste: 0 },
  { code: "RFG-VALLEY-LF", trade: "RFG", desc: "Valley flashing, per LF", unit: "LF", waste: 5 },

  // WIN (Windows - 8 items)
  { code: "WIN-DOUBLE-EA", trade: "WIN", desc: "Double-hung window, each", unit: "EA", waste: 5 },
  { code: "WIN-CASEMENT-EA", trade: "WIN", desc: "Casement window, each", unit: "EA", waste: 5 },
  { code: "WIN-PICTURE-EA", trade: "WIN", desc: "Picture window, each", unit: "EA", waste: 5 },
  { code: "WIN-GLASS-SF", trade: "WIN", desc: "Window glass replacement, per SF", unit: "SF", waste: 10 },
  { code: "WIN-FRAME-EA", trade: "WIN", desc: "Window frame repair, each", unit: "EA", waste: 0 },
  { code: "WIN-SEAL-LF", trade: "WIN", desc: "Window caulking/sealing, per LF", unit: "LF", waste: 5 },
  { code: "WIN-SILL-LF", trade: "WIN", desc: "Window sill replacement, per LF", unit: "LF", waste: 8 },
  { code: "WIN-SCREEN-EA", trade: "WIN", desc: "Window screen, each", unit: "EA", waste: 0 },

  // EXT (Exterior - 10 items)
  { code: "EXT-SIDING-SF", trade: "EXT", desc: "Vinyl siding, per SF", unit: "SF", waste: 10 },
  { code: "EXT-BRICK-SF", trade: "EXT", desc: "Brick veneer, per SF", unit: "SF", waste: 8 },
  { code: "EXT-STONE-SF", trade: "EXT", desc: "Stone veneer, per SF", unit: "SF", waste: 10 },
  { code: "EXT-STUCCO-SF", trade: "EXT", desc: "Stucco application, per SF", unit: "SF", waste: 12 },
  { code: "EXT-WRAP-SF", trade: "EXT", desc: "House wrap, per SF", unit: "SF", waste: 5 },
  { code: "EXT-FASCIA-LF", trade: "EXT", desc: "Fascia board, per LF", unit: "LF", waste: 10 },
  { code: "EXT-SOFFIT-SF", trade: "EXT", desc: "Soffit panel, per SF", unit: "SF", waste: 12 },
  { code: "EXT-CORNER-LF", trade: "EXT", desc: "Corner trim, per LF", unit: "LF", waste: 5 },
  { code: "EXT-DOOR-EA", trade: "EXT", desc: "Exterior door, each", unit: "EA", waste: 5 },
  { code: "EXT-GARAGE-EA", trade: "EXT", desc: "Garage door, each", unit: "EA", waste: 5 },
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
};

export async function seedCatalog() {
  console.log("Seeding pricing catalog...");

  // Seed catalog items
  for (const item of CATALOG_ITEMS) {
    await db.insert(scopeLineItems).values({
      code: item.code,
      description: item.desc,
      unit: item.unit,
      tradeCode: item.trade,
      defaultWasteFactor: item.waste,
      isActive: true,
      sortOrder: 0,
    });
  }

  console.log(`Inserted ${CATALOG_ITEMS.length} catalog items`);

  // Seed regional prices (US_NATIONAL)
  for (const [code, prices] of Object.entries(REGIONAL_PRICES)) {
    await db.insert(regionalPriceSets).values({
      regionId: "US_NATIONAL",
      regionName: "United States (National Average)",
      lineItemCode: code,
      materialCost: prices.material,
      laborCost: prices.labor,
      equipmentCost: prices.equipment,
      effectiveDate: new Date().toISOString().split("T")[0],
      priceListVersion: "1.0",
    });
  }

  console.log(`Inserted regional prices for US_NATIONAL region`);
}
