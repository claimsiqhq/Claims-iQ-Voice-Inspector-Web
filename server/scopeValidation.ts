/**
 * Scope Validation Engine
 *
 * Comprehensive validation of scope completeness and consistency.
 * Checks 12 categories of issues, from missing companions to trade sequences.
 */

import { IStorage } from "./storage";
import type { ScopeItem, InspectionRoom, DamageObservation, ScopeLineItem, InspectionSession } from "@shared/schema";
import { calculateOpeningDeductions } from "./openingDeductionService";
import { companionEngine } from "./companionEngine";

export interface ValidationResult {
  valid: boolean;
  score: number;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  suggestions: ValidationIssue[];
}

export interface ValidationIssue {
  category: string;
  severity: "error" | "warning" | "suggestion";
  message: string;
  roomId?: number;
  scopeItemId?: number;
  code?: string;
}

/**
 * Validates scope completeness and consistency for an entire session.
 */
export async function validateScopeCompleteness(
  storage: IStorage,
  sessionId: number,
  scopeItems: ScopeItem[],
  rooms: InspectionRoom[],
  damages: DamageObservation[]
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];
  const allCatalog = await storage.getScopeLineItems();
  const catalogMap = new Map(allCatalog.map(c => [c.code, c]));

  // ── 1. Rooms with damage but no scope items ───────
  for (const room of rooms) {
    const roomDamages = damages.filter(d => d.roomId === room.id);
    const roomScope = scopeItems.filter(s => s.roomId === room.id && s.status === "active");

    if (roomDamages.length > 0 && roomScope.length === 0) {
      issues.push({
        category: "missing_scope",
        severity: "error",
        message: `Room "${room.name}" has ${roomDamages.length} damage observation(s) but no scope items. Run generate_scope or add items manually.`,
        roomId: room.id,
      });
    }
  }

  // ── 2. Unlinked damages ──
  for (const damage of damages) {
    const linkedScope = scopeItems.filter(s => s.damageId === damage.id && s.status === "active");
    if (linkedScope.length === 0) {
      const room = rooms.find(r => r.id === damage.roomId);
      issues.push({
        category: "unlinked_damage",
        severity: "warning",
        message: `Damage "${damage.description}" in "${room?.name || "unknown room"}" has no linked scope items.`,
        roomId: damage.roomId,
      });
    }
  }

  // ── 3. Missing companion items ─────────────────────
  for (const item of scopeItems) {
    if (item.status !== "active" || !item.catalogCode) continue;
    const catalog = catalogMap.get(item.catalogCode);
    if (!catalog?.companionRules) continue;

    const rules = catalog.companionRules as { requires?: string[]; auto_adds?: string[] };
    const roomScope = scopeItems.filter(s => s.roomId === item.roomId && s.status === "active");
    const roomCodes = new Set(roomScope.map(s => s.catalogCode));

    if (rules.requires) {
      for (const req of rules.requires) {
        if (!roomCodes.has(req)) {
          const reqCatalog = catalogMap.get(req);
          issues.push({
            category: "missing_companion",
            severity: "error",
            message: `"${item.description}" requires "${reqCatalog?.description || req}" but it's not in scope for this room.`,
            roomId: item.roomId || undefined,
            scopeItemId: item.id,
            code: req,
          });
        }
      }
    }
  }

  // ── 4. Trade sequence completeness ─────────────────
  const tradesByRoom = new Map<number, Set<string>>();
  for (const item of scopeItems) {
    if (item.status !== "active" || !item.roomId) continue;
    const existing = tradesByRoom.get(item.roomId) || new Set();
    existing.add(item.tradeCode);
    tradesByRoom.set(item.roomId, existing);
  }

  const TRADE_SEQUENCES = [
    { name: "Drywall", sequence: ["DEM", "DRY", "PNT"], trigger: "DRY", companionTrades: ["DEM", "MIT", "PNT"] },
    { name: "Flooring", sequence: ["DEM", "FLR"], trigger: "FLR", companionTrades: ["DEM", "PNT"] },
    { name: "Mitigation", sequence: ["MIT", "DEM"], trigger: "MIT", companionTrades: ["DRY"] },
    { name: "Roofing", sequence: ["DEM", "RFG"], trigger: "RFG", companionTrades: ["DEM", "WIN"] },
    { name: "Painting", sequence: ["DEM", "DRY", "PNT"], trigger: "PNT", companionTrades: [] },
    { name: "Plumbing", sequence: ["PLM", "DEM", "DRY"], trigger: "PLM", companionTrades: ["DEM", "DRY"] },
    { name: "Electrical", sequence: ["ELE", "DEM", "PNT"], trigger: "ELE", companionTrades: ["DEM", "PNT"] },
    { name: "Windows", sequence: ["WIN", "PNT"], trigger: "WIN", companionTrades: ["PNT"] },
    { name: "Exterior", sequence: ["EXT", "PNT"], trigger: "EXT", companionTrades: ["PNT"] },
  ];

  for (const [roomId, trades] of tradesByRoom) {
    const room = rooms.find(r => r.id === roomId);
    for (const seq of TRADE_SEQUENCES) {
      if (!trades.has(seq.trigger)) continue;
      for (const required of seq.sequence) {
        if (required === seq.trigger) continue;
        if (!trades.has(required)) {
          issues.push({
            category: "trade_sequence",
            severity: "warning",
            message: `Room "${room?.name}": ${seq.name} sequence incomplete — has ${seq.trigger} but missing ${required}.`,
            roomId,
          });
        }
      }
    }
  }

  // ── 5. Quantity reasonableness ─────────────────────
  for (const item of scopeItems) {
    if (item.status !== "active") continue;

    if (!item.quantity || item.quantity <= 0) {
      issues.push({
        category: "invalid_quantity",
        severity: "error",
        message: `"${item.description}" has invalid quantity: ${item.quantity}`,
        scopeItemId: item.id,
      });
    }

    if (item.unit === "SF" && item.quantity > 10000) {
      issues.push({
        category: "quantity_outlier",
        severity: "warning",
        message: `"${item.description}" has unusually large quantity: ${item.quantity} SF. Verify this is correct.`,
        scopeItemId: item.id,
      });
    }
  }

  // ── 6. Duplicate items per room ────────────────────
  const roomItemKeys = new Set<string>();
  for (const item of scopeItems) {
    if (item.status !== "active") continue;
    const key = `${item.roomId}-${item.catalogCode}-${item.activityType}`;
    if (roomItemKeys.has(key)) {
      issues.push({
        category: "duplicate",
        severity: "warning",
        message: `Duplicate scope item: "${item.description}" (${item.catalogCode}) appears multiple times in the same room.`,
        roomId: item.roomId || undefined,
        scopeItemId: item.id,
      });
    }
    roomItemKeys.add(key);
  }

  // ── 7. Missing openings for wall scope items ─────────
  for (const room of rooms) {
    const roomScope = scopeItems.filter(s => s.roomId === room.id && s.status === "active");
    const hasWallScope = roomScope.some(si =>
      si.quantityFormula === "WALL_SF_NET" || si.quantityFormula === "WALL_SF"
    );
    if (hasWallScope) {
      const roomOpenings = await storage.getRoomOpenings(room.id);
      if (!roomOpenings || roomOpenings.length === 0) {
        issues.push({
          category: "wall_scope_no_openings",
          severity: "warning",
          message:
            `Room "${room.name}" has wall treatment items (WALL_SF_NET or WALL_SF) ` +
            `but zero openings recorded. Wall scope may be overstated. ` +
            `Add openings via add_room_opening or update_room_opening to deduct doors/windows from wall area.`,
          roomId: room.id,
          code: "WALL_SCOPE_NO_OPENINGS",
        });
      } else {
        const deductionResult = calculateOpeningDeductions(
          roomOpenings.map((o: { id: number; openingType: string; widthFt: number | null; heightFt: number | null; quantity?: number; label?: string | null }) => ({
            id: o.id,
            openingType: o.openingType,
            widthFt: o.widthFt,
            heightFt: o.heightFt,
            quantity: o.quantity || 1,
            label: o.label,
          }))
        );
        const dims = room.dimensions as Record<string, unknown> | null;
        if (dims) {
          const length = (dims.length as number) || 0;
          const width = (dims.width as number) || 0;
          const height = (dims.height as number) || 8;
          const grossWallSF = (length + width) * 2 * height;
          const deductionPercent = grossWallSF > 0 ? (deductionResult.totalDeductionSF / grossWallSF) * 100 : 0;

          if (deductionPercent > 50) {
            issues.push({
              category: "opening_deduction_excessive",
              severity: "warning",
              message:
                `Room "${room.name}" opening deductions (${deductionResult.totalDeductionSF} SF) ` +
                `exceed 50% of gross wall area (${Math.round(grossWallSF)} SF). ` +
                `Deduction: ${Math.round(deductionPercent)}%. Verify opening dimensions are accurate.`,
              roomId: room.id,
              code: "OPENING_DEDUCTION_EXCESSIVE",
            });
          }
        }
      }
    }
  }

  // ── 8. Coverage type consistency ───────────────────
  for (const item of scopeItems) {
    if (item.status !== "active" || !item.roomId) continue;
    const room = rooms.find(r => r.id === item.roomId);
    if (!room) continue;

    const structure = (room.structure || "Main Dwelling").toLowerCase();
    const expectedCoverage = structure.includes("detach") || structure.includes("garage") ||
                            structure.includes("shed") || structure.includes("fence") ? "B" : "A";

    if (item.coverageType && item.coverageType !== expectedCoverage) {
      issues.push({
        category: "coverage_mismatch",
        severity: "suggestion",
        message: `"${item.description}" in "${room.name}" (${room.structure}) has coverage ${item.coverageType} but expected ${expectedCoverage}.`,
        roomId: item.roomId,
        scopeItemId: item.id,
      });
    }
  }

  // ── 9. Water classification warnings ───────────────
  const session = await storage.getInspectionSession(sessionId);
  const waterIssues = validateWaterClassificationWarnings(session, scopeItems);
  issues.push(...waterIssues);

  // ── Calculate score ────────────────────────────────
  const errors = issues.filter(i => i.severity === "error");
  const warnings = issues.filter(i => i.severity === "warning");
  const suggestions = issues.filter(i => i.severity === "suggestion");

  let score = 100;
  score -= errors.length * 10;
  score -= warnings.length * 3;
  score -= suggestions.length * 1;
  score = Math.max(0, Math.min(100, score));

  return {
    valid: errors.length === 0,
    score,
    errors,
    warnings,
    suggestions,
  };
}

/**
 * Validate companion items after auto-addition.
 */
export async function validateCompanionsPostAutoAdd(
  storage: IStorage,
  sessionId: number
): Promise<ValidationIssue[]> {
  const items = await storage.getScopeItems(sessionId);
  const result = companionEngine.validateCompanionItems(items);

  const issues: ValidationIssue[] = result.issues.map((i) => ({
    category: "companion",
    severity: i.severity,
    message: i.message,
    scopeItemId: typeof i.itemId === "number" ? i.itemId : undefined,
  }));

  for (const companion of items.filter((i) => i.parentScopeItemId != null)) {
    const primary = items.find((p) => p.id === companion.parentScopeItemId);
    if (primary && (companion.quantity ?? 0) / (primary.quantity ?? 1) > 10) {
      issues.push({
        category: "companion_quantity",
        severity: "warning",
        message: `Companion quantity (${companion.quantity}) is disproportionate to primary (${primary.quantity})`,
        scopeItemId: companion.id,
      });
    }
  }

  return issues;
}

/**
 * Water classification warning checks for Category 3 and Class 4.
 */
export function validateWaterClassificationWarnings(
  session: InspectionSession | undefined,
  items: ScopeItem[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const wc = session?.waterClassification as
    | { category?: number; waterClass?: number }
    | undefined;

  if (!wc) return issues;

  const { category, waterClass } = wc;
  const hasTrade = (code: string) => items.some((i) => i.tradeCode === code && i.status === "active");

  if (category === 3 && !hasTrade("DEM")) {
    issues.push({
      category: "water_classification",
      severity: "error",
      message: "Category 3 black water damage requires Demolition (DEM) in scope",
    });
  }
  if (category === 3 && !hasTrade("MIT")) {
    issues.push({
      category: "water_classification",
      severity: "error",
      message: "Category 3 water damage requires Mitigation Equipment (MIT) for safe handling",
    });
  }
  if (waterClass === 4 && !hasTrade("DRY")) {
    issues.push({
      category: "water_classification",
      severity: "warning",
      message: "Class 4 water damage (structural/masonry) typically requires professional Drying (DRY)",
    });
  }

  return issues;
}
