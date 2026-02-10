/**
 * Scope Assembly Service
 *
 * Assembles scope items from damage observations, room geometry, and the catalog.
 * Scope defines WHAT work — never touches pricing.
 * Quantities come from room geometry (deterministic), not AI estimation.
 */

import { IStorage } from "./storage";
import { deriveQuantity, type QuantityFormula, type QuantityResult } from "./scopeQuantityEngine";
import type { InspectionRoom, DamageObservation, ScopeLineItem, ScopeItem, InsertScopeItem } from "@shared/schema";

export interface ScopeAssemblyResult {
  created: ScopeItem[];
  companionItems: ScopeItem[];
  manualQuantityNeeded: Array<{
    catalogCode: string;
    description: string;
    unit: string;
    reason: string;
  }>;
  warnings: string[];
}

interface ScopeConditions {
  damage_types?: string[];
  surfaces?: string[];
  severity?: string[];
  room_types?: string[];
  zone_types?: string[];
}

interface CompanionRules {
  requires?: string[];
  auto_adds?: string[];
  excludes?: string[];
}

/**
 * Assembles scope items for a damage observation in a room.
 */
export async function assembleScope(
  storage: IStorage,
  sessionId: number,
  room: InspectionRoom,
  damage: DamageObservation,
  netWallDeduction: number = 0
): Promise<ScopeAssemblyResult> {
  const result: ScopeAssemblyResult = {
    created: [],
    companionItems: [],
    manualQuantityNeeded: [],
    warnings: [],
  };

  const allCatalogItems = await storage.getScopeLineItems();
  const activeCatalog = allCatalogItems.filter(item => item.isActive);

  const matchingItems = filterByScopeConditions(activeCatalog, {
    damageType: damage.damageType || undefined,
    severity: damage.severity || undefined,
    roomType: room.roomType || undefined,
    zoneType: getZoneType(room.roomType || ""),
  });

  if (matchingItems.length === 0) {
    result.warnings.push(
      `No catalog items matched damage type "${damage.damageType}" with severity "${damage.severity}" in room type "${room.roomType}". ` +
      `Items must be added manually via add_line_item.`
    );
    return result;
  }

  const existingScopeItems = await storage.getScopeItems(sessionId);
  const existingCodes = new Set(
    existingScopeItems
      .filter(si => si.roomId === room.id && si.status === "active")
      .map(si => si.catalogCode)
  );

  const pendingCodes = new Set<string>();
  const itemsToCreate: InsertScopeItem[] = [];

  for (const catalogItem of matchingItems) {
    if (existingCodes.has(catalogItem.code)) {
      result.warnings.push(`Skipped "${catalogItem.code}" — already in scope for this room.`);
      continue;
    }

    if (isExcluded(catalogItem.code, existingScopeItems, matchingItems)) {
      result.warnings.push(`Skipped "${catalogItem.code}" — excluded by existing scope item.`);
      continue;
    }

    const formula = catalogItem.quantityFormula as QuantityFormula | null;
    let quantity: number;
    let quantityFormula: string | null = formula;
    const provenance = "damage_triggered";

    if (formula && formula !== "MANUAL") {
      const qResult = deriveQuantity(room, formula, netWallDeduction);
      if (qResult) {
        quantity = qResult.quantity;
      } else {
        result.manualQuantityNeeded.push({
          catalogCode: catalogItem.code,
          description: catalogItem.description,
          unit: catalogItem.unit,
          reason: `Room dimensions required for ${formula} formula`,
        });
        continue;
      }
    } else if (formula === "MANUAL") {
      result.manualQuantityNeeded.push({
        catalogCode: catalogItem.code,
        description: catalogItem.description,
        unit: catalogItem.unit,
        reason: "Manual quantity required",
      });
      continue;
    } else {
      quantity = 1;
      quantityFormula = "EACH";
    }

    if (quantity <= 0) continue;

    pendingCodes.add(catalogItem.code);
    itemsToCreate.push({
      sessionId,
      roomId: room.id,
      damageId: damage.id,
      catalogCode: catalogItem.code,
      description: catalogItem.description,
      tradeCode: catalogItem.tradeCode,
      quantity,
      unit: catalogItem.unit,
      quantityFormula,
      provenance,
      coverageType: catalogItem.coverageType || "A",
      activityType: catalogItem.activityType || "replace",
      wasteFactor: catalogItem.defaultWasteFactor ?? null,
      status: "active",
      parentScopeItemId: null,
    });
  }

  if (itemsToCreate.length > 0) {
    const created = await storage.createScopeItems(itemsToCreate);
    result.created.push(...created);

    for (const createdItem of created) {
      const catalogItem = activeCatalog.find(c => c.code === createdItem.catalogCode);
      if (!catalogItem?.companionRules) continue;

      const companions = catalogItem.companionRules as CompanionRules;
      if (!companions.auto_adds || companions.auto_adds.length === 0) continue;

      for (const companionCode of companions.auto_adds) {
        if (existingCodes.has(companionCode) || pendingCodes.has(companionCode)) continue;

        const companionCatalog = activeCatalog.find(c => c.code === companionCode);
        if (!companionCatalog) {
          result.warnings.push(`Companion "${companionCode}" not found in catalog.`);
          continue;
        }

        const cFormula = companionCatalog.quantityFormula as QuantityFormula | null;
        let cQuantity: number;

        if (cFormula && cFormula !== "MANUAL") {
          const cResult = deriveQuantity(room, cFormula, netWallDeduction);
          if (cResult) {
            cQuantity = cResult.quantity;
          } else {
            result.manualQuantityNeeded.push({
              catalogCode: companionCode,
              description: companionCatalog.description,
              unit: companionCatalog.unit,
              reason: `Companion of "${catalogItem.code}" — room dimensions needed`,
            });
            continue;
          }
        } else {
          cQuantity = 1;
        }

        if (cQuantity <= 0) continue;

        pendingCodes.add(companionCode);

        const companionItem = await storage.createScopeItem({
          sessionId,
          roomId: room.id,
          damageId: damage.id,
          catalogCode: companionCode,
          description: companionCatalog.description,
          tradeCode: companionCatalog.tradeCode,
          quantity: cQuantity,
          unit: companionCatalog.unit,
          quantityFormula: companionCatalog.quantityFormula,
          provenance: "companion_auto",
          coverageType: companionCatalog.coverageType || "A",
          activityType: companionCatalog.activityType || "replace",
          wasteFactor: companionCatalog.defaultWasteFactor ?? null,
          status: "active",
          parentScopeItemId: createdItem.id,
        });

        result.companionItems.push(companionItem);
      }
    }
  }

  await storage.recalculateScopeSummary(sessionId);

  return result;
}

function filterByScopeConditions(
  catalog: ScopeLineItem[],
  context: {
    damageType?: string;
    severity?: string;
    roomType?: string;
    zoneType?: string;
  }
): ScopeLineItem[] {
  return catalog.filter(item => {
    const conditions = item.scopeConditions as ScopeConditions | null;
    if (!conditions) return false;

    if (conditions.damage_types && conditions.damage_types.length > 0) {
      if (!context.damageType || !conditions.damage_types.includes(context.damageType)) {
        return false;
      }
    }

    if (conditions.severity && conditions.severity.length > 0) {
      if (!context.severity || !conditions.severity.includes(context.severity)) {
        return false;
      }
    }

    if (conditions.room_types && conditions.room_types.length > 0) {
      if (!context.roomType || !conditions.room_types.includes(context.roomType)) {
        return false;
      }
    }

    if (conditions.zone_types && conditions.zone_types.length > 0) {
      if (!context.zoneType || !conditions.zone_types.includes(context.zoneType)) {
        return false;
      }
    }

    return true;
  });
}

function isExcluded(
  code: string,
  existingItems: ScopeItem[],
  matchingCatalog: ScopeLineItem[]
): boolean {
  for (const item of matchingCatalog) {
    const rules = item.companionRules as CompanionRules | null;
    if (rules?.excludes?.includes(code)) {
      if (existingItems.some(si => si.catalogCode === item.code && si.status === "active")) {
        return true;
      }
    }
  }
  return false;
}

function getZoneType(roomType: string): string {
  if (roomType.startsWith("interior_")) return "interior";
  if (roomType.startsWith("exterior_")) return "exterior";
  return "unknown";
}
