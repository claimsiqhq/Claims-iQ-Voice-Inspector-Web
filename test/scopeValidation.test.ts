import { describe, it, expect, vi } from "vitest";
import {
  validateScopeCompleteness,
  validateCompanionsPostAutoAdd,
  validateWaterClassificationWarnings,
} from "../server/scopeValidation";
import { createMockStorage } from "./mocks/storage.mock";

describe("scopeValidation", () => {
  describe("validateScopeCompleteness", () => {
    it("includes companion issues from validateCompanionsPostAutoAdd", async () => {
      const orphanCompanion = {
        id: 2,
        sessionId: 1,
        roomId: 1,
        damageId: null,
        catalogCode: "DEM-DRY-SF",
        description: "Demolition",
        tradeCode: "DEM",
        quantity: 1,
        unit: "SF",
        provenance: "companion_auto_added",
        status: "active",
        parentScopeItemId: 999,
        createdAt: new Date(),
      };

      const mockStorage = createMockStorage({
        getScopeLineItems: vi.fn().mockResolvedValue([]),
        getScopeItems: vi.fn().mockResolvedValue([orphanCompanion]),
        getRoomOpenings: vi.fn().mockResolvedValue([]),
        getInspectionSession: vi.fn().mockResolvedValue(null),
      });

      const result = await validateScopeCompleteness(
        mockStorage as any,
        1,
        [orphanCompanion as any],
        [{ id: 1, name: "Kitchen", sessionId: 1, structureId: 1 }] as any,
        []
      );

      const companionIssues = result.errors.concat(result.warnings).filter(
        (i) => i.category === "companion" || i.category === "companion_quantity"
      );
      expect(companionIssues.length).toBeGreaterThan(0);
    });
  });

  describe("validateCompanionsPostAutoAdd", () => {
    it("returns issues when companion references non-existent primary", async () => {
      const orphanCompanion = {
        id: 2,
        sessionId: 1,
        roomId: 1,
        damageId: null,
        catalogCode: "DEM-DRY-SF",
        description: "Demolition",
        tradeCode: "DEM",
        quantity: 1,
        unit: "SF",
        provenance: "companion_auto_added",
        status: "active",
        parentScopeItemId: 999,
        createdAt: new Date(),
      };

      const mockStorage = createMockStorage({
        getScopeItems: vi.fn().mockResolvedValue([orphanCompanion]),
      });

      const issues = await validateCompanionsPostAutoAdd(mockStorage as any, 1);
      expect(issues.some((i) => i.category === "companion" && i.severity === "error")).toBe(true);
    });
  });

  describe("validateWaterClassificationWarnings", () => {
    it("errors when Category 3 but no DEM in scope", () => {
      const session = { waterClassification: { category: 3, waterClass: 4 } };
      const items = [{ tradeCode: "DRY", status: "active" }];
      const issues = validateWaterClassificationWarnings(session as any, items as any);
      expect(issues.some((i) => i.message.includes("Demolition") && i.severity === "error")).toBe(true);
    });

    it("errors when Category 3 but no MIT in scope", () => {
      const session = { waterClassification: { category: 3, waterClass: 4 } };
      const items = [{ tradeCode: "DEM", status: "active" }];
      const issues = validateWaterClassificationWarnings(session as any, items as any);
      expect(issues.some((i) => i.message.includes("Mitigation") && i.severity === "error")).toBe(true);
    });

    it("returns empty when no water classification", () => {
      const issues = validateWaterClassificationWarnings(undefined, []);
      expect(issues).toHaveLength(0);
    });
  });
});
