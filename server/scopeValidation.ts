/**
 * Scope Validation Engine
 *
 * Comprehensive validation of scope completeness and consistency.
 * Checks 12 categories of issues, from missing companions to trade sequences.
 */

import { IStorage } from "./storage";
import type { ScopeItem, InspectionRoom, DamageObservation, ScopeLineItem } from "@shared/schema";

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
    { name: "Drywall", sequence: ["DEM", "DRY", "PNT"], trigger: "DRY" },
    { name: "Flooring", sequence: ["DEM", "FLR"], trigger: "FLR" },
    { name: "Mitigation", sequence: ["MIT", "DEM"], trigger: "MIT" },
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

  // ── 7. Coverage type consistency ───────────────────
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
