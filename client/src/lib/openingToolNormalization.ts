export interface OpeningDimensionInput {
  widthFt?: unknown;
  heightFt?: unknown;
  width?: unknown;
  height?: unknown;
}

export interface OpeningDimensionOutput {
  widthFt: number;
  heightFt: number;
}

export function parseFeetValue(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  if (typeof value !== "string") return undefined;

  const raw = value.trim().toLowerCase();
  if (!raw) return undefined;

  const normalized = raw
    .replace(/[′’]/g, "'")
    .replace(/[″“”]/g, '"')
    .replace(/\s+/g, " ");

  const feetInches = normalized.match(/^(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')\s*(\d+(?:\.\d+)?)?\s*(?:in|inch|inches|\")?$/i);
  if (feetInches) {
    const feet = Number(feetInches[1]);
    const inches = feetInches[2] ? Number(feetInches[2]) : 0;
    if (Number.isFinite(feet) && Number.isFinite(inches)) {
      return feet + inches / 12;
    }
  }

  const inchesOnly = normalized.match(/^(\d+(?:\.\d+)?)\s*(?:in|inch|inches|\")$/i);
  if (inchesOnly) {
    const inches = Number(inchesOnly[1]);
    return Number.isFinite(inches) ? inches / 12 : undefined;
  }

  const feetOnly = normalized.match(/^(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')$/i);
  if (feetOnly) {
    const feet = Number(feetOnly[1]);
    return Number.isFinite(feet) ? feet : undefined;
  }

  const numeric = Number(normalized.replace(/[^\d.]/g, ""));
  if (Number.isFinite(numeric) && numeric > 0) return numeric;

  return undefined;
}

/**
 * Heuristic: if a numeric value looks like inches (>= 18 for width, >= 48 for height),
 * and the opening type is NOT an overhead/garage door, auto-convert to feet.
 * This catches the common LLM mistake of passing "36" (inches) as widthFt.
 */
function autoConvertIfInches(value: number, dimension: "width" | "height", openingType?: string): number {
  const isOversized = openingType?.includes("overhead") || openingType?.includes("garage");
  if (isOversized) return value;

  if (dimension === "width" && value >= 18 && value <= 120) {
    return value / 12;
  }
  if (dimension === "height" && value >= 48 && value <= 120) {
    return value / 12;
  }
  return value;
}

export function normalizeOpeningDimensions(args: OpeningDimensionInput & { openingType?: string }, defaults: OpeningDimensionOutput): OpeningDimensionOutput {
  let widthFt = parseFeetValue(args.widthFt) ?? parseFeetValue(args.width) ?? defaults.widthFt;
  let heightFt = parseFeetValue(args.heightFt) ?? parseFeetValue(args.height) ?? defaults.heightFt;

  widthFt = autoConvertIfInches(widthFt, "width", args.openingType as string | undefined);
  heightFt = autoConvertIfInches(heightFt, "height", args.openingType as string | undefined);

  return { widthFt, heightFt };
}

export function normalizeWallDirection(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;

  if (v.includes("north") || v === "n") return "north";
  if (v.includes("south") || v === "s") return "south";
  if (v.includes("east") || v === "e") return "east";
  if (v.includes("west") || v === "w") return "west";
  if (v.includes("front")) return "front";
  if (v.includes("rear") || v.includes("back")) return "rear";
  if (v.includes("left")) return "left";
  if (v.includes("right")) return "right";

  return null;
}
