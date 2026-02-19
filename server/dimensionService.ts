/**
 * PROMPT-30 Part B: Dimension defaults with provenance tracking
 * When a room height/width/length is not provided, apply defaults
 * and mark provenance as "defaulted"
 */

export interface DimensionProvenance {
  length: "measured" | "estimated" | "defaulted";
  width: "measured" | "estimated" | "defaulted";
  height: "measured" | "estimated" | "defaulted";
}

export interface RoomWithProvenance {
  id: string | number;
  name: string;
  length: number;
  width: number;
  height: number;
  dimensionProvenance: DimensionProvenance;
}

const DEFAULTS = {
  ceilingHeight: 8,
  defaultLength: 10,
  defaultWidth: 10,
};

/**
 * Apply dimension defaults and track provenance
 */
export function assignDimensionDefaults(
  room: Partial<RoomWithProvenance>,
  providedProvenance?: Partial<DimensionProvenance>
): RoomWithProvenance {
  const provenance: DimensionProvenance = {
    length: providedProvenance?.length ?? "defaulted",
    width: providedProvenance?.width ?? "defaulted",
    height: providedProvenance?.height ?? "defaulted",
  };

  if (room.length !== undefined && room.length > 0) provenance.length = "measured";
  if (room.width !== undefined && room.width > 0) provenance.width = "measured";
  if (room.height !== undefined && room.height > 0) provenance.height = "measured";

  return {
    id: room.id ?? "",
    name: room.name ?? "Unnamed Room",
    length: room.length ?? DEFAULTS.defaultLength,
    width: room.width ?? DEFAULTS.defaultWidth,
    height: room.height ?? DEFAULTS.ceilingHeight,
    dimensionProvenance: provenance,
  };
}

/**
 * Calculate scope quantity with placeholder flag when dimensions are defaulted
 */
export function calculateScopeQuantity(
  room: RoomWithProvenance,
  _itemType: string,
  unit: "sf" | "lf" | "ea"
): { quantity: number; isPlaceholder: boolean } {
  const isPlaceholder =
    room.dimensionProvenance.length === "defaulted" ||
    room.dimensionProvenance.width === "defaulted" ||
    room.dimensionProvenance.height === "defaulted";

  let quantity = 0;
  switch (unit) {
    case "sf":
      quantity = room.length * room.width;
      break;
    case "lf":
      quantity = 2 * (room.length + room.width);
      break;
    case "ea":
      quantity = 1;
      break;
  }
  return { quantity, isPlaceholder };
}
