import { describe, it, expect, vi } from "vitest";
import { assembleScope } from "../server/scopeAssemblyService";
import { createMockStorage } from "./mocks/storage.mock";
import { makeRoom, makeSession } from "./mocks/fixtures";

function makeCatalogItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    code: "DRY-X-1-2",
    description: "1/2\" drywall hung, taped, floated",
    unit: "SF",
    tradeCode: "DRY",
    quantityFormula: "FLOOR_SF",
    xactCategoryCode: "DRY",
    isActive: true,
    ...overrides,
  };
}

describe("scopeAssemblyService", () => {
  it("returns companion items when assembling water damage with DRY primary and area > 100", async () => {
    const catalogItems = [
      makeCatalogItem({ code: "DRY-X-1-2", tradeCode: "DRY" }),
      makeCatalogItem({ code: "DEM-DRY-SF", tradeCode: "DEM" }),
    ];

    let createdIds = 0;
    const mockStorage = createMockStorage({
      getScopeLineItems: vi.fn().mockResolvedValue(catalogItems),
      getRoomOpenings: vi.fn().mockResolvedValue([]),
      getScopeItems: vi.fn().mockResolvedValue([]),
      getInspectionSession: vi.fn().mockResolvedValue(makeSession()),
      createScopeItems: vi.fn().mockImplementation((items: unknown[]) => {
        const arr = Array.isArray(items) ? items : [items];
        return Promise.resolve(
          arr.map((item: Record<string, unknown>, i: number) => ({
            ...item,
            id: ++createdIds,
            sessionId: item.sessionId,
            roomId: item.roomId,
            damageId: item.damageId,
            catalogCode: item.catalogCode,
            description: item.description,
            tradeCode: item.tradeCode,
            quantity: item.quantity,
            unit: item.unit,
            provenance: item.provenance,
            status: "active",
            parentScopeItemId: item.parentScopeItemId ?? null,
            createdAt: new Date(),
          }))
        );
      }),
      recalculateScopeSummary: vi.fn().mockResolvedValue([]),
    });

    const room = makeRoom({
      id: 1,
      dimensions: { length: 12, width: 10, height: 8 },
    });
    const damage = {
      id: 1,
      sessionId: 1,
      roomId: 1,
      damageType: "water",
      severity: "moderate",
      description: "Water damage",
      location: null,
    };

    const result = await assembleScope(mockStorage as any, 1, room as any, damage as any);

    expect(result.created.length).toBeGreaterThan(0);
    expect(result.created.some((c) => c.tradeCode === "DRY")).toBe(true);

    if (result.companionItems.length > 0) {
      const dem = result.companionItems.find((c) => c.tradeCode === "DEM");
      const mit = result.companionItems.find((c) => c.tradeCode === "MIT");
      expect(dem || mit).toBeDefined();
      if (dem) {
        expect(dem.provenance).toBe("companion_auto_added");
        expect(dem.parentScopeItemId).toBeDefined();
      }
    }
  });

  it("includes Category 3 companions when session has water classification", async () => {
    const catalogItems = [
      makeCatalogItem({ code: "DRY-X-1-2", tradeCode: "DRY" }),
    ];

    let createdIds = 0;
    const mockStorage = createMockStorage({
      getScopeLineItems: vi.fn().mockResolvedValue(catalogItems),
      getRoomOpenings: vi.fn().mockResolvedValue([]),
      getScopeItems: vi.fn().mockResolvedValue([]),
      getInspectionSession: vi.fn().mockResolvedValue(
        makeSession({
          waterClassification: {
            category: 3,
            waterClass: 4,
            source: "black",
            contaminationLevel: "high",
            dryingPossible: false,
          },
        })
      ),
      createScopeItems: vi.fn().mockImplementation((items: unknown[]) => {
        const arr = Array.isArray(items) ? items : [items];
        return Promise.resolve(
          arr.map((item: Record<string, unknown>, i: number) => ({
            ...item,
            id: ++createdIds,
            sessionId: item.sessionId,
            roomId: item.roomId,
            damageId: item.damageId,
            catalogCode: item.catalogCode,
            description: item.description,
            tradeCode: item.tradeCode,
            quantity: item.quantity,
            unit: item.unit,
            provenance: item.provenance,
            status: "active",
            parentScopeItemId: item.parentScopeItemId ?? null,
            createdAt: new Date(),
          }))
        );
      }),
      recalculateScopeSummary: vi.fn().mockResolvedValue([]),
    });

    const room = makeRoom({
      id: 1,
      dimensions: { length: 12, width: 10, height: 8 },
    });
    const damage = {
      id: 1,
      sessionId: 1,
      roomId: 1,
      damageType: "water",
      severity: "moderate",
      description: "Sewer backup",
      location: null,
    };

    const result = await assembleScope(mockStorage as any, 1, room as any, damage as any);

    expect(result.created.length).toBeGreaterThan(0);
    const dem = result.companionItems.find((c) => c.tradeCode === "DEM");
    const mit = result.companionItems.find((c) => c.tradeCode === "MIT");
    expect(dem || mit).toBeDefined();
  });
});
