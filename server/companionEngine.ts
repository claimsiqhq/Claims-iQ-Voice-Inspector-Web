/**
 * Companion Item Auto-Addition Engine
 *
 * Automatically identifies and adds dependent scope items based on primary trade
 * selection. Integrates with Water Damage Classification for water-aware rules.
 */

import type { ScopeItem, InsertScopeItem } from "@shared/schema";
import { logger } from "./logger";

/**
 * IICRC-compliant water damage classification
 */
export interface WaterClassification {
  category: 1 | 2 | 3;
  waterClass: 1 | 2 | 3 | 4;
  source: "clean" | "gray" | "black";
  contaminationLevel: "low" | "medium" | "high";
  dryingPossible: boolean;
  classifiedAt: Date;
  notes?: string;
}

/**
 * Session scope context (session-based, not standalone scope table)
 */
export interface SessionScope {
  id: number;
  damageProperties?: {
    affectedArea?: number;
    linearFootage?: number;
  };
}

/**
 * Context passed to companion rule evaluators
 */
export interface CompanionContext {
  scope: SessionScope;
  primaryItem: ScopeItem;
  existingItems: ScopeItem[];
  scopeMeasurements: {
    grossArea?: number;
    affectedArea?: number;
    linearFeet?: number;
  };
  waterClassification?: WaterClassification;
  tradeExists: (tradeCode: string) => boolean;
  getTradeQuantity: (tradeCode: string) => number;
  findItems: (filter: (item: ScopeItem) => boolean) => ScopeItem[];
  addedDate: Date;
}

/**
 * Single companion addition rule
 */
export interface CompanionRule {
  id: string;
  triggerCode: string;
  companionCode: string;
  relationship: string;
  condition: (context: CompanionContext) => boolean;
  quantityDerivation: (context: CompanionContext) => number;
  minimumThreshold?: number;
  deduplicationWindow?: number;
  priority: number;
}

export interface CompanionValidationResult {
  valid: boolean;
  issues: CompanionValidationIssue[];
}

export interface CompanionValidationIssue {
  itemId: number | string;
  severity: "error" | "warning";
  message: string;
}

/**
 * Default catalog codes per trade for companion items
 */
const COMPANION_DEFAULT_CODES: Record<string, string> = {
  DEM: "DEM-DRY-SF",
  DRY: "DRY-X-1-2",
  PNT: "PNT-INT-SF",
  FLR: "FLR-CARPET-SF",
  MIT: "MIT-AIRM-DAY",
  RFG: "RFG-X-300",
  WIN: "WIN-DOUBLE-EA",
  ELE: "ELE-OUTL-EA",
  ELC: "ELE-OUTL-EA",
};

export class CompanionEngine {
  private rules: CompanionRule[] = [];

  constructor() {
    this.initializeRules();
  }

  /**
   * Auto-add companion items based on primary item.
   * Uses parentScopeItemId for companion relationship.
   */
  async autoAddCompanions(
    sessionId: number,
    roomId: number,
    damageId: number | null,
    primaryItem: ScopeItem,
    existingItems: ScopeItem[],
    waterClassification?: WaterClassification,
    scopeMeasurements?: { affectedArea?: number; linearFeet?: number }
  ): Promise<InsertScopeItem[]> {
    const addedCompanions: InsertScopeItem[] = [];

    const scope: SessionScope = {
      id: sessionId,
      damageProperties: scopeMeasurements
        ? { affectedArea: scopeMeasurements.affectedArea, linearFootage: scopeMeasurements.linearFeet }
        : undefined,
    };

    const context: CompanionContext = {
      scope,
      primaryItem,
      existingItems,
      scopeMeasurements: {
        grossArea: scopeMeasurements?.affectedArea ?? 0,
        affectedArea: scopeMeasurements?.affectedArea ?? 0,
        linearFeet: scopeMeasurements?.linearFeet ?? 0,
      },
      waterClassification,
      tradeExists: (code) => existingItems.some((item) => item.tradeCode === code),
      getTradeQuantity: (code) =>
        existingItems
          .filter((item) => item.tradeCode === code)
          .reduce((sum, item) => sum + (item.quantity ?? 0), 0),
      findItems: (filter) => existingItems.filter(filter),
      addedDate: new Date(),
    };

    const applicableRules = this.rules
      .filter(
        (rule) =>
          rule.triggerCode === primaryItem.tradeCode || rule.triggerCode === "any"
      )
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    for (const rule of applicableRules) {
      try {
        if (!this.evaluateCondition(rule.condition, context)) continue;

        if (rule.deduplicationWindow && context.tradeExists(rule.companionCode)) {
          const existing = existingItems.find((i) => i.tradeCode === rule.companionCode);
          if (
            existing &&
            this.isWithinDeduplicationWindow(
              existing.createdAt ? new Date(existing.createdAt) : new Date(),
              rule.deduplicationWindow
            )
          ) {
            continue;
          }
        }

        const quantity = this.deriveQuantity(rule.quantityDerivation, context);
        if (quantity <= 0) continue;

        const companionItem = this.createCompanionItem(
          rule,
          primaryItem,
          quantity,
          sessionId,
          roomId,
          damageId
        );
        addedCompanions.push(companionItem);
        context.existingItems.push(companionItem as unknown as ScopeItem);
      } catch (error) {
        logger.warn(`Companion rule ${rule.id} error`, {
          ruleId: rule.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return addedCompanions;
  }

  private evaluateCondition(
    condition: (ctx: CompanionContext) => boolean,
    context: CompanionContext
  ): boolean {
    try {
      return condition(context);
    } catch {
      return false;
    }
  }

  private deriveQuantity(
    derivation: (ctx: CompanionContext) => number,
    context: CompanionContext
  ): number {
    try {
      return Math.max(0, derivation(context));
    } catch {
      return 0;
    }
  }

  private isWithinDeduplicationWindow(itemDate: Date, windowDays: number): boolean {
    const daysDiff = (Date.now() - itemDate.getTime()) / (1000 * 60 * 60 * 24);
    return daysDiff <= windowDays;
  }

  private createCompanionItem(
    rule: CompanionRule,
    primaryItem: ScopeItem,
    quantity: number,
    sessionId: number,
    roomId: number,
    damageId: number | null
  ): InsertScopeItem {
    const catalogCode = COMPANION_DEFAULT_CODES[rule.companionCode] ?? null;
    return {
      sessionId,
      roomId,
      damageId,
      catalogCode,
      description: `Auto-added: ${rule.relationship}`,
      tradeCode: rule.companionCode,
      quantity,
      unit: "EA",
      provenance: "companion_auto_added",
      status: "active",
      parentScopeItemId: primaryItem.id,
    };
  }

  getRules(): CompanionRule[] {
    return [...this.rules];
  }

  validateCompanionItems(items: ScopeItem[]): CompanionValidationResult {
    const issues: CompanionValidationIssue[] = [];
    const companions = items.filter((i) => i.parentScopeItemId != null);

    for (const companion of companions) {
      const primary = items.find((i) => i.id === companion.parentScopeItemId);
      if (!primary) {
        issues.push({
          itemId: companion.id,
          severity: "error",
          message: `Companion references non-existent primary item ${companion.parentScopeItemId}`,
        });
      }
      if ((companion.quantity ?? 0) <= 0) {
        issues.push({
          itemId: companion.id,
          severity: "warning",
          message: "Companion item has quantity <= 0",
        });
      }
    }

    return {
      valid: issues.filter((i) => i.severity === "error").length === 0,
      issues,
    };
  }

  private initializeRules(): void {
    // DRY rules
    this.rules.push({
      id: "dry-001",
      triggerCode: "DRY",
      companionCode: "DEM",
      relationship: "Drying requires preliminary demolition of affected materials",
      condition: (ctx) => (ctx.scopeMeasurements.affectedArea ?? 0) > 100,
      quantityDerivation: (ctx) =>
        Math.ceil((ctx.scopeMeasurements.affectedArea ?? 0) / 500),
      priority: 100,
      deduplicationWindow: 7,
    });
    this.rules.push({
      id: "dry-002",
      triggerCode: "DRY",
      companionCode: "DEM",
      relationship: "Category 3 water requires structural demolition assessment",
      condition: (ctx) => ctx.waterClassification?.category === 3,
      quantityDerivation: () => 1,
      priority: 110,
      deduplicationWindow: 7,
    });
    this.rules.push({
      id: "dry-003",
      triggerCode: "DRY",
      companionCode: "MIT",
      relationship: "Mitigation equipment required for active drying operations",
      condition: () => true,
      quantityDerivation: (ctx) =>
        Math.max(1, Math.ceil((ctx.scopeMeasurements.affectedArea ?? 0) / 200)),
      priority: 95,
      deduplicationWindow: 14,
    });
    this.rules.push({
      id: "dry-004",
      triggerCode: "DRY",
      companionCode: "PNT",
      relationship: "Painting required post-drying to seal and restore surfaces",
      condition: (ctx) => ctx.waterClassification?.dryingPossible !== false,
      quantityDerivation: (ctx) =>
        Math.max(1, Math.ceil((ctx.scopeMeasurements.affectedArea ?? 0) / 1000)),
      priority: 50,
      deduplicationWindow: 30,
    });

    // MIT rules
    this.rules.push({
      id: "mit-001",
      triggerCode: "MIT",
      companionCode: "DRY",
      relationship: "Mitigation equipment enables professional drying operations",
      condition: (ctx) =>
        !ctx.tradeExists("DRY") && (ctx.scopeMeasurements.affectedArea ?? 0) > 50,
      quantityDerivation: () => 1,
      priority: 120,
      deduplicationWindow: 7,
    });
    this.rules.push({
      id: "mit-002",
      triggerCode: "MIT",
      companionCode: "DEM",
      relationship: "Mitigation may require removal of unsalvageable materials",
      condition: (ctx) => (ctx.waterClassification?.waterClass ?? 0) >= 3,
      quantityDerivation: () => 1,
      priority: 105,
      deduplicationWindow: 7,
    });

    // FLR rules
    this.rules.push({
      id: "flr-001",
      triggerCode: "FLR",
      companionCode: "DEM",
      relationship: "Flooring replacement requires underlayment/subfloor demolition",
      condition: () => true,
      quantityDerivation: () => 1,
      priority: 100,
      deduplicationWindow: 7,
    });
    this.rules.push({
      id: "flr-002",
      triggerCode: "FLR",
      companionCode: "PNT",
      relationship: "Flooring work may require painting adjacent trim/walls",
      condition: (ctx) => (ctx.scopeMeasurements.affectedArea ?? 0) < 500,
      quantityDerivation: () => 1,
      priority: 40,
      deduplicationWindow: 30,
    });

    // DEM rules
    this.rules.push({
      id: "dem-001",
      triggerCode: "DEM",
      companionCode: "DRY",
      relationship: "Post-demolition drying required for residual moisture",
      condition: (ctx) =>
        !ctx.tradeExists("DRY") && ctx.waterClassification !== undefined,
      quantityDerivation: () => 1,
      priority: 90,
      deduplicationWindow: 14,
    });
    this.rules.push({
      id: "dem-002",
      triggerCode: "DEM",
      companionCode: "FLR",
      relationship: "Flooring replacement follows structural demolition",
      condition: (ctx) => !ctx.tradeExists("FLR"),
      quantityDerivation: () => 1,
      priority: 80,
      deduplicationWindow: 30,
    });
    this.rules.push({
      id: "dem-003",
      triggerCode: "DEM",
      companionCode: "PNT",
      relationship: "Demolition exposes surfaces requiring painting",
      condition: () => true,
      quantityDerivation: () => 1,
      priority: 70,
      deduplicationWindow: 30,
    });

    // PNT rules
    this.rules.push({
      id: "pnt-001",
      triggerCode: "PNT",
      companionCode: "DEM",
      relationship: "Painting may follow material removal on walls/ceilings",
      condition: (ctx) =>
        !ctx.tradeExists("DEM") && (ctx.scopeMeasurements.affectedArea ?? 0) > 300,
      quantityDerivation: () => 1,
      priority: 45,
      deduplicationWindow: 30,
    });

    // RFG rules
    this.rules.push({
      id: "rfg-001",
      triggerCode: "RFG",
      companionCode: "DEM",
      relationship: "Roof replacement requires removal of old roofing/decking",
      condition: () => true,
      quantityDerivation: () => 1,
      priority: 110,
      deduplicationWindow: 30,
    });
    this.rules.push({
      id: "rfg-002",
      triggerCode: "RFG",
      companionCode: "WIN",
      relationship: "Roof replacement may require windows/flashing work",
      condition: (ctx) => (ctx.scopeMeasurements.affectedArea ?? 0) > 1000,
      quantityDerivation: () => 1,
      priority: 35,
      deduplicationWindow: 30,
    });

    // WIN rules
    this.rules.push({
      id: "win-001",
      triggerCode: "WIN",
      companionCode: "PNT",
      relationship: "Window replacement often requires trim/wall painting",
      condition: () => true,
      quantityDerivation: () => 1,
      priority: 55,
      deduplicationWindow: 30,
    });

    // PLM rules
    this.rules.push({
      id: "plm-001",
      triggerCode: "PLM",
      companionCode: "DEM",
      relationship: "Plumbing repairs may require wall/ceiling access",
      condition: (ctx) =>
        ctx.waterClassification !== undefined &&
        (ctx.scopeMeasurements.affectedArea ?? 0) > 200,
      quantityDerivation: () => 1,
      priority: 75,
      deduplicationWindow: 14,
    });
    this.rules.push({
      id: "plm-002",
      triggerCode: "PLM",
      companionCode: "DRY",
      relationship: "Plumbing failure requires drying mitigation",
      condition: (ctx) =>
        !ctx.tradeExists("DRY") && ctx.waterClassification !== undefined,
      quantityDerivation: () => 1,
      priority: 85,
      deduplicationWindow: 7,
    });

    // ELE/ELC rules
    this.rules.push({
      id: "elc-001",
      triggerCode: "ELE",
      companionCode: "DEM",
      relationship: "Electrical work requires wall access/demolition",
      condition: (ctx) => (ctx.scopeMeasurements.linearFeet ?? 0) > 50,
      quantityDerivation: () => 1,
      priority: 70,
      deduplicationWindow: 30,
    });
    this.rules.push({
      id: "elc-002",
      triggerCode: "ELE",
      companionCode: "PNT",
      relationship: "Electrical panel/outlet work requires wall finishing",
      condition: () => true,
      quantityDerivation: () => 1,
      priority: 50,
      deduplicationWindow: 30,
    });

    // EXT rules
    this.rules.push({
      id: "ext-001",
      triggerCode: "EXT",
      companionCode: "PNT",
      relationship: "Exterior siding/cladding work often requires painting",
      condition: () => true,
      quantityDerivation: () => 1,
      priority: 60,
      deduplicationWindow: 30,
    });

    // Category 3 water rules (triggerCode: any)
    this.rules.push({
      id: "cat3-001",
      triggerCode: "any",
      companionCode: "DEM",
      relationship: "Category 3 water mandates structural assessment and demolition",
      condition: (ctx) =>
        ctx.waterClassification?.category === 3 && !ctx.tradeExists("DEM"),
      quantityDerivation: () => 1,
      priority: 150,
      deduplicationWindow: 7,
    });
    this.rules.push({
      id: "cat3-002",
      triggerCode: "any",
      companionCode: "MIT",
      relationship: "Category 3 water requires mitigation equipment for safety",
      condition: (ctx) =>
        ctx.waterClassification?.category === 3 && !ctx.tradeExists("MIT"),
      quantityDerivation: () => 1,
      priority: 140,
      deduplicationWindow: 14,
    });

    logger.info(`CompanionEngine initialized with ${this.rules.length} rules`);
  }
}

export const companionEngine = new CompanionEngine();
