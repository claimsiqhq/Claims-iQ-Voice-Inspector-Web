/**
 * Scope Quantity Engine
 *
 * Derives line item quantities from room geometry (DIM_VARS).
 * PROMPT-15 stores computed DIM_VARS in inspectionRooms.dimensions JSONB:
 *   { length, width, height, ..., dimVars: { W, F, C, PF, PC, LW, SW, ... } }
 *
 * This engine maps quantity formula codes to those dimension values.
 * All quantities are deterministic — no AI estimation.
 */

import type { InspectionRoom } from "@shared/schema";

// Quantity formula codes (stored in scopeLineItems.quantityFormula)
export type QuantityFormula =
  | "FLOOR_SF"
  | "CEILING_SF"
  | "WALL_SF"
  | "WALL_SF_NET"
  | "WALLS_CEILING_SF"
  | "PERIMETER_LF"
  | "CEILING_PERIM_LF"
  | "FLOOR_SY"
  | "ROOF_SF"
  | "ROOF_SQ"
  | "VOLUME_CF"
  | "MANUAL"
  | "EACH";

export interface RoomDimVars {
  W?: number;
  F?: number;
  C?: number;
  PF?: number;
  PC?: number;
  LW?: number;
  SW?: number;
  HH?: number;
  SH?: number;
  LL?: number;
  R?: number;
  SQ?: number;
  V?: number;
}

export interface QuantityResult {
  quantity: number;
  unit: string;
  formula: QuantityFormula;
  derivation: string;
}

/**
 * Derives the quantity for a line item from room geometry.
 */
export function deriveQuantity(
  room: InspectionRoom,
  formula: QuantityFormula,
  netWallDeduction: number = 0
): QuantityResult | null {
  const dims = room.dimensions as Record<string, unknown> | null;
  if (!dims) return null;

  const dimVars: RoomDimVars = (dims.dimVars as RoomDimVars) || {};
  const length = (dims.length as number) || 0;
  const width = (dims.width as number) || 0;
  const height = (dims.height as number) || 8;

  const floorSF = dimVars.F ?? (length * width);
  const ceilingSF = dimVars.C ?? (length * width);
  const grossWallSF = dimVars.W ?? ((length + width) * 2 * height);
  const perimeterLF = dimVars.PF ?? ((length + width) * 2);
  const ceilingPerimLF = dimVars.PC ?? perimeterLF;
  const volumeCF = dimVars.V ?? (length * width * height);

  switch (formula) {
    case "FLOOR_SF":
      return {
        quantity: round2(floorSF),
        unit: "SF",
        formula,
        derivation: `Floor area: ${length}' × ${width}' = ${round2(floorSF)} SF`,
      };

    case "CEILING_SF":
      return {
        quantity: round2(ceilingSF),
        unit: "SF",
        formula,
        derivation: `Ceiling area: ${length}' × ${width}' = ${round2(ceilingSF)} SF`,
      };

    case "WALL_SF":
      return {
        quantity: round2(grossWallSF),
        unit: "SF",
        formula,
        derivation: `Gross wall area: perimeter ${round2(perimeterLF)} LF × ${height}' height = ${round2(grossWallSF)} SF`,
      };

    case "WALL_SF_NET": {
      const netWallSF = Math.max(0, grossWallSF - netWallDeduction);
      return {
        quantity: round2(netWallSF),
        unit: "SF",
        formula,
        derivation: `Net wall area: ${round2(grossWallSF)} SF gross - ${round2(netWallDeduction)} SF openings = ${round2(netWallSF)} SF`,
      };
    }

    case "WALLS_CEILING_SF": {
      const wallsCeilSF = grossWallSF + ceilingSF;
      return {
        quantity: round2(wallsCeilSF),
        unit: "SF",
        formula,
        derivation: `Walls + ceiling: ${round2(grossWallSF)} SF walls + ${round2(ceilingSF)} SF ceiling = ${round2(wallsCeilSF)} SF`,
      };
    }

    case "PERIMETER_LF":
      return {
        quantity: round2(perimeterLF),
        unit: "LF",
        formula,
        derivation: `Floor perimeter: (${length}' + ${width}') × 2 = ${round2(perimeterLF)} LF`,
      };

    case "CEILING_PERIM_LF":
      return {
        quantity: round2(ceilingPerimLF),
        unit: "LF",
        formula,
        derivation: `Ceiling perimeter: ${round2(ceilingPerimLF)} LF`,
      };

    case "FLOOR_SY": {
      const floorSY = floorSF / 9;
      return {
        quantity: round2(floorSY),
        unit: "SY",
        formula,
        derivation: `Floor area in SY: ${round2(floorSF)} SF ÷ 9 = ${round2(floorSY)} SY`,
      };
    }

    case "ROOF_SF": {
      const roofSF = dimVars.R ?? floorSF;
      return {
        quantity: round2(roofSF),
        unit: "SF",
        formula,
        derivation: `Roof area: ${round2(roofSF)} SF`,
      };
    }

    case "ROOF_SQ": {
      const roofSquares = dimVars.SQ ?? (floorSF / 100);
      return {
        quantity: round2(roofSquares),
        unit: "SQ",
        formula,
        derivation: `Roof squares: ${round2(roofSquares)} SQ`,
      };
    }

    case "VOLUME_CF":
      return {
        quantity: round2(volumeCF),
        unit: "CF",
        formula,
        derivation: `Volume: ${length}' × ${width}' × ${height}' = ${round2(volumeCF)} CF`,
      };

    case "EACH":
      return {
        quantity: 1,
        unit: "EA",
        formula,
        derivation: "Count-based item: 1 EA",
      };

    case "MANUAL":
      return null;

    default:
      return null;
  }
}

/**
 * Derives quantities for all applicable catalog items in a room.
 */
export function deriveRoomQuantities(
  room: InspectionRoom,
  catalogItems: Array<{ code: string; quantityFormula: string | null; unit: string }>,
  netWallDeduction: number = 0
): Map<string, QuantityResult> {
  const results = new Map<string, QuantityResult>();

  for (const item of catalogItems) {
    if (!item.quantityFormula) continue;
    const result = deriveQuantity(room, item.quantityFormula as QuantityFormula, netWallDeduction);
    if (result) {
      results.set(item.code, result);
    }
  }

  return results;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
