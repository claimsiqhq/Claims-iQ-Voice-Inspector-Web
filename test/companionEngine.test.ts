import { describe, it, expect, beforeEach } from "vitest";
import { CompanionEngine, type WaterClassification } from "../server/companionEngine";
import type { ScopeItem } from "@shared/schema";

describe("CompanionEngine", () => {
  let engine: CompanionEngine;

  beforeEach(() => {
    engine = new CompanionEngine();
  });

  const mockScopeItem = (
    overrides: Partial<ScopeItem> = {}
  ): ScopeItem =>
    ({
      id: 1,
      sessionId: 1,
      roomId: 1,
      damageId: null,
      catalogCode: "DRY-X-1-2",
      description: "Drywall",
      tradeCode: "DRY",
      quantity: 1,
      unit: "SF",
      provenance: "voice_command",
      status: "active",
      parentScopeItemId: null,
      createdAt: new Date(),
      ...overrides,
    }) as ScopeItem;

  it("auto-adds DEM companion when DRY is primary and area > 100", async () => {
    const primary = mockScopeItem({ tradeCode: "DRY" });
    const companions = await engine.autoAddCompanions(
      1,
      1,
      null,
      primary,
      [],
      undefined,
      { affectedArea: 500 }
    );

    const dem = companions.find((c) => c.tradeCode === "DEM");
    expect(dem).toBeDefined();
    expect(dem?.parentScopeItemId).toBe(1);
    expect(dem?.provenance).toBe("companion_auto_added");
  });

  it("adds MIT companion for DRY trade", async () => {
    const primary = mockScopeItem({ tradeCode: "DRY" });
    const companions = await engine.autoAddCompanions(
      1,
      1,
      null,
      primary,
      [],
      undefined,
      { affectedArea: 500 }
    );

    const mit = companions.find((c) => c.tradeCode === "MIT");
    expect(mit).toBeDefined();
  });

  it("does not add DEM when area < 100 (dry-001 condition)", async () => {
    const primary = mockScopeItem({ tradeCode: "DRY" });
    const companions = await engine.autoAddCompanions(
      1,
      1,
      null,
      primary,
      [],
      undefined,
      { affectedArea: 50 }
    );

    const dem = companions.find((c) => c.tradeCode === "DEM");
    expect(dem).toBeUndefined();
  });

  it("adds DEM and MIT for Category 3 water", async () => {
    const waterClass: WaterClassification = {
      category: 3,
      waterClass: 4,
      source: "black",
      contaminationLevel: "high",
      dryingPossible: false,
      classifiedAt: new Date(),
    };

    const primary = mockScopeItem({ tradeCode: "DRY" });
    const companions = await engine.autoAddCompanions(
      1,
      1,
      null,
      primary,
      [],
      waterClass,
      { affectedArea: 500 }
    );

    const dem = companions.find((c) => c.tradeCode === "DEM");
    const mit = companions.find((c) => c.tradeCode === "MIT");
    expect(dem).toBeDefined();
    expect(mit).toBeDefined();
  });

  it("derives quantity from affected area for dry-001", async () => {
    const primary = mockScopeItem({ tradeCode: "DRY" });
    const companions = await engine.autoAddCompanions(
      1,
      1,
      null,
      primary,
      [],
      undefined,
      { affectedArea: 2000 }
    );

    const dem = companions.find((c) => c.tradeCode === "DEM");
    expect(dem?.quantity).toBe(4); // 2000 / 500
  });

  it("validates companion items correctly", () => {
    const items: ScopeItem[] = [
      mockScopeItem({ id: 1 }),
      mockScopeItem({
        id: 2,
        parentScopeItemId: 1,
        tradeCode: "DEM",
      }) as ScopeItem,
    ];

    const result = engine.validateCompanionItems(items);
    expect(result.valid).toBe(true);
  });

  it("errors on companion referencing non-existent primary", () => {
    const items: ScopeItem[] = [
      mockScopeItem({
        id: 2,
        parentScopeItemId: 999,
        tradeCode: "DEM",
      }) as ScopeItem,
    ];

    const result = engine.validateCompanionItems(items);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.severity === "error")).toBe(true);
  });

  it("deduplicates within window when DEM already exists", async () => {
    const existingDem = mockScopeItem({
      id: 2,
      tradeCode: "DEM",
      createdAt: new Date(),
    });
    const primary = mockScopeItem({ tradeCode: "DRY" });

    const companions = await engine.autoAddCompanions(
      1,
      1,
      null,
      primary,
      [existingDem],
      undefined,
      { affectedArea: 500 }
    );

    const dem = companions.find((c) => c.tradeCode === "DEM");
    expect(dem).toBeUndefined();
  });

  it("returns all rules via getRules", () => {
    const rules = engine.getRules();
    expect(rules.length).toBeGreaterThanOrEqual(20);
    expect(rules.some((r) => r.triggerCode === "DRY")).toBe(true);
    expect(rules.some((r) => r.triggerCode === "any")).toBe(true);
  });
});
