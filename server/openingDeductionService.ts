// server/openingDeductionService.ts

// ── Opening Deduction Service ──
// Calculates the total opening area (doors, windows, etc.) for a room.
// Used by scope assembly to reduce wall treatment scope via WALL_SF_NET formula.
//
// Opening type defaults (standard residential):
//   - window (3' × 4'): 12 SF
//   - standard_door (2.67' × 6.67'): 17.82 SF
//   - sliding_door (6' × 6.67'): 40.02 SF
//   - overhead_door (7' × 8'): 56 SF
//   - archway (3' × 7'): 21 SF
//   - pass_through (3' × 4'): 12 SF
//   - missing_wall, cased_opening: 0 SF (construction, not openings)

export interface RoomOpening {
  id: number;
  openingType: string;
  widthFt: number | null;
  heightFt: number | null;
  quantity: number;
  label?: string | null;
}

export interface OpeningDeductionResult {
  totalDeductionSF: number;
  openingCount: number;
  openingsByType: Record<string, { count: number; totalAreaSF: number }>;
  warnings: string[];
}

/**
 * Gets default dimensions for an opening type when actual dimensions are missing.
 * Matches standard opening sizes from Xactimate catalogs.
 */
function getDefaultOpeningDimensions(openingType: string): { widthFt: number; heightFt: number } {
  const defaults: Record<string, { widthFt: number; heightFt: number }> = {
    window: { widthFt: 3, heightFt: 4 },           // 12 SF
    standard_door: { widthFt: 2.67, heightFt: 6.67 }, // ~17.82 SF
    door: { widthFt: 2.67, heightFt: 6.67 },       // ~17.82 SF
    sliding_door: { widthFt: 6, heightFt: 6.67 },  // ~40 SF
    overhead_door: { widthFt: 7, heightFt: 8 },    // 56 SF
    garage_door: { widthFt: 7, heightFt: 8 },      // 56 SF
    archway: { widthFt: 3, heightFt: 7 },          // 21 SF
    pass_through: { widthFt: 3, heightFt: 4 },     // 12 SF
    // missing_wall, cased_opening: not actual openings, contribute 0
    missing_wall: { widthFt: 0, heightFt: 0 },
    cased_opening: { widthFt: 0, heightFt: 0 },
  };

  return defaults[openingType] || { widthFt: 3, heightFt: 4 }; // Fallback to window
}

/**
 * Calculates total opening deductions for a room.
 * Sums areas of all openings (doors, windows, etc.) that reduce wall treatment scope.
 *
 * @param openings Array of RoomOpening records for the room
 * @returns OpeningDeductionResult with total SF, counts, and any data quality warnings
 */
export function calculateOpeningDeductions(openings: RoomOpening[]): OpeningDeductionResult {
  const result: OpeningDeductionResult = {
    totalDeductionSF: 0,
    openingCount: 0,
    openingsByType: {},
    warnings: [],
  };

  if (!openings || openings.length === 0) {
    return result;
  }

  const typeStats: Record<string, { count: number; totalAreaSF: number }> = {};

  for (const opening of openings) {
    const count = opening.quantity || 1;
    result.openingCount += count;

    // Get dimensions: use provided, fall back to defaults
    let widthFt = opening.widthFt;
    let heightFt = opening.heightFt;

    if (!widthFt || !heightFt) {
      const defaults = getDefaultOpeningDimensions(opening.openingType);
      widthFt = widthFt || defaults.widthFt;
      heightFt = heightFt || defaults.heightFt;

      if (!opening.widthFt || !opening.heightFt) {
        result.warnings.push(
          `Opening "${opening.label || opening.openingType}" (ID: ${opening.id}) missing dimensions; ` +
          `using defaults: ${widthFt}' × ${heightFt}' = ${widthFt * heightFt} SF`
        );
      }
    }

    const areaPerOpening = widthFt * heightFt;
    const totalAreaForType = areaPerOpening * count;

    result.totalDeductionSF += totalAreaForType;

    // Track by type for diagnostics
    if (!typeStats[opening.openingType]) {
      typeStats[opening.openingType] = { count: 0, totalAreaSF: 0 };
    }
    typeStats[opening.openingType].count += count;
    typeStats[opening.openingType].totalAreaSF += totalAreaForType;

    // Data quality checks
    if (widthFt > 15) {
      result.warnings.push(
        `Opening "${opening.label || opening.openingType}" (ID: ${opening.id}) width ${widthFt}' exceeds typical door width; verify dimensions`
      );
    }
    if (heightFt > 15) {
      result.warnings.push(
        `Opening "${opening.label || opening.openingType}" (ID: ${opening.id}) height ${heightFt}' exceeds typical door height; verify dimensions`
      );
    }
    if (areaPerOpening > 200) {
      result.warnings.push(
        `Opening "${opening.label || opening.openingType}" (ID: ${opening.id}) area ${areaPerOpening} SF is unusually large; verify dimensions`
      );
    }
  }

  result.openingsByType = typeStats;

  // Round to 2 decimals
  result.totalDeductionSF = Math.round(result.totalDeductionSF * 100) / 100;
  for (const type of Object.keys(result.openingsByType)) {
    result.openingsByType[type].totalAreaSF = Math.round(result.openingsByType[type].totalAreaSF * 100) / 100;
  }

  return result;
}
