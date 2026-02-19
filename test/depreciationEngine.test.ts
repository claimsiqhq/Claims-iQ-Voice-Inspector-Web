import { describe, it, expect } from "vitest";
import {
  checkWaterDepreciationOverride,
  calculateDepreciation,
  lookupLifeExpectancy,
} from "../server/depreciationEngine";

describe("depreciationEngine", () => {
  describe("checkWaterDepreciationOverride", () => {
    it("returns 0 for Category 3 black water", () => {
      expect(
        checkWaterDepreciationOverride("DEM", { category: 3, waterClass: 4 })
      ).toBe(0);
      expect(
        checkWaterDepreciationOverride("RFG", { category: 3 })
      ).toBe(0);
    });

    it("returns 0 for Class 4 structural water", () => {
      expect(
        checkWaterDepreciationOverride("DRY", { category: 2, waterClass: 4 })
      ).toBe(0);
    });

    it("returns 0 for MIT trade", () => {
      expect(
        checkWaterDepreciationOverride("MIT", { category: 2, waterClass: 3 })
      ).toBe(0);
    });

    it("returns 0 for DRY trade", () => {
      expect(
        checkWaterDepreciationOverride("DRY", { category: 2, waterClass: 3 })
      ).toBe(0);
    });

    it("returns 50 for Category 2 + Class 3+ on DEM/RFG/FLR/EXT", () => {
      expect(
        checkWaterDepreciationOverride("DEM", { category: 2, waterClass: 3 })
      ).toBe(50);
      expect(
        checkWaterDepreciationOverride("RFG", { category: 2, waterClass: 3 })
      ).toBe(50);
      expect(
        checkWaterDepreciationOverride("FLR", { category: 2, waterClass: 3 })
      ).toBe(50);
      expect(
        checkWaterDepreciationOverride("EXT", { category: 2, waterClass: 3 })
      ).toBe(50);
    });

    it("returns 0 for Class 4 (structural) regardless of trade", () => {
      expect(
        checkWaterDepreciationOverride("FLR", { category: 2, waterClass: 4 })
      ).toBe(0);
    });

    it("returns undefined when no water classification", () => {
      expect(checkWaterDepreciationOverride("DEM", undefined)).toBeUndefined();
    });

    it("returns undefined for Category 2 Class 1/2 on DEM", () => {
      expect(
        checkWaterDepreciationOverride("DEM", { category: 2, waterClass: 1 })
      ).toBeUndefined();
      expect(
        checkWaterDepreciationOverride("DEM", { category: 2, waterClass: 2 })
      ).toBeUndefined();
    });
  });

  describe("calculateDepreciation with water override", () => {
    it("applies 0% depreciation for Category 3", () => {
      const result = calculateDepreciation({
        totalPrice: 1000,
        age: 10,
        tradeCode: "DEM",
        waterClassification: { category: 3, waterClass: 4 },
      });
      expect(result.depreciationPercentage).toBe(0);
      expect(result.depreciationAmount).toBe(0);
    });

    it("applies 50% depreciation for Cat 2 Class 3 DEM", () => {
      const result = calculateDepreciation({
        totalPrice: 1000,
        age: 5,
        tradeCode: "DEM",
        waterClassification: { category: 2, waterClass: 3 },
      });
      expect(result.depreciationPercentage).toBe(50);
      expect(result.depreciationAmount).toBe(500);
    });

    it("skips water override when Paid When Incurred", () => {
      const result = calculateDepreciation({
        totalPrice: 1000,
        age: 10,
        depreciationType: "Paid When Incurred",
        tradeCode: "DEM",
        waterClassification: { category: 3 },
      });
      expect(result.depreciationPercentage).toBe(0);
      expect(result.depreciationAmount).toBe(0);
    });
  });

  describe("lookupLifeExpectancy", () => {
    it("returns life for roofing keywords", () => {
      expect(lookupLifeExpectancy("roofing", "laminated/architectural shingles")).toBe(30);
      expect(lookupLifeExpectancy("rfg", "metal roofing")).toBe(50);
    });

    it("returns default for category when no keyword match", () => {
      expect(lookupLifeExpectancy("roofing", "unknown material")).toBe(25);
    });
  });
});
