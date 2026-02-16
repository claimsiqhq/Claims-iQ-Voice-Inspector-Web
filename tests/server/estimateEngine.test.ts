import { describe, it, expect } from "vitest";
import {
  calculateLineItemPrice,
  calculateEstimateTotals,
  validateEstimate,
  calculateDimVars,
  TRADE_CODES,
  type PricedLineItem,
} from "../../server/estimateEngine";
import { makeCatalogItem, makeRegionalPrice, makePricedItem } from "../../test/mocks/fixtures";

/**
 * PROMPT-21 Part F: Estimate engine tests.
 * These tests verify the CURRENT implementation behavior.
 * Note: Waste factor applies only to materials (not labor/equipment).
 * Tax applies to materials only.
 */

describe("calculateLineItemPrice (current implementation)", () => {
  const catalog = makeCatalogItem({ code: "DRY-12-SF", tradeCode: "DRY", defaultWasteFactor: 10 });
  const price = makeRegionalPrice({ materialCost: 0.52, laborCost: 0.92, equipmentCost: 0.06 });

  it("applies waste factor to materials only; labor and equipment unchanged", () => {
    const result = calculateLineItemPrice(catalog, price, 100);
    // M with 10% waste: 0.52 * 1.10 = 0.572 → round2 = 0.57
    // L, E unchanged
    // unitPrice = 0.57 + 0.92 + 0.06 = 1.55
    expect(result.unitPriceBreakdown.materialCost).toBeCloseTo(0.57, 2);
    expect(result.unitPriceBreakdown.laborCost).toBe(0.92);
    expect(result.unitPriceBreakdown.equipmentCost).toBe(0.06);
    expect(result.unitPriceBreakdown.unitPrice).toBeCloseTo(1.55, 2);
  });

  it("calculates total price = unitPrice x quantity", () => {
    const result = calculateLineItemPrice(catalog, price, 200);
    expect(result.totalPrice).toBeCloseTo(1.55 * 200, 2);
  });

  it("uses 0 waste when catalog item has no defaultWasteFactor", () => {
    const noWaste = makeCatalogItem({ defaultWasteFactor: 0 });
    const result = calculateLineItemPrice(noWaste, price, 100);
    expect(result.unitPriceBreakdown.wasteFactor).toBe(0);
    expect(result.unitPriceBreakdown.unitPrice).toBeCloseTo(1.50, 2);
  });

  it("allows overriding the waste factor", () => {
    const result = calculateLineItemPrice(catalog, price, 100, 15);
    // M with 15% waste: 0.52 * 1.15 = 0.598 → round2 = 0.60
    // unitPrice = 0.60 + 0.92 + 0.06 = 1.58
    expect(result.unitPriceBreakdown.wasteFactor).toBe(15);
    expect(result.unitPriceBreakdown.unitPrice).toBeCloseTo(1.58, 2);
  });

  it("returns correct code, description, unit, tradeCode from catalog", () => {
    const result = calculateLineItemPrice(catalog, price, 50);
    expect(result.code).toBe("DRY-12-SF");
    expect(result.unit).toBe("SF");
    expect(result.tradeCode).toBe("DRY");
  });

  it("handles zero quantity gracefully", () => {
    const result = calculateLineItemPrice(catalog, price, 0);
    expect(result.totalPrice).toBe(0);
    expect(result.quantity).toBe(0);
  });
});

describe("calculateEstimateTotals (current implementation)", () => {
  it("sums material, labor, equipment across all items", () => {
    const items: PricedLineItem[] = [
      makePricedItem({ tradeCode: "DRY", quantity: 100 }),
      makePricedItem({ tradeCode: "PNT", quantity: 200, code: "PNT-WALL-SF" }),
    ];
    const totals = calculateEstimateTotals(items);
    expect(totals.subtotalMaterial).toBeGreaterThan(0);
    expect(totals.subtotalLabor).toBeGreaterThan(0);
    expect(totals.subtotal).toBeGreaterThan(0);
    expect(totals.subtotal).toBeCloseTo(
      totals.subtotalMaterial + totals.subtotalLabor + totals.subtotalEquipment,
      2
    );
  });

  it("applies tax to materials only (not full subtotal)", () => {
    const items: PricedLineItem[] = [makePricedItem({ tradeCode: "DRY" })];
    const totals = calculateEstimateTotals(items, 0.10);
    // Tax is on materials only
    expect(totals.taxAmount).toBeCloseTo(totals.subtotalMaterial * 0.1, 2);
  });

  it("defaults to 8% tax when not specified", () => {
    const items: PricedLineItem[] = [makePricedItem({ tradeCode: "DRY" })];
    const totals = calculateEstimateTotals(items);
    expect(totals.taxAmount).toBeCloseTo(totals.subtotalMaterial * 0.08, 2);
  });

  it("qualifies for O&P with 3+ trades", () => {
    const items: PricedLineItem[] = [
      makePricedItem({ tradeCode: "DRY" }),
      makePricedItem({ tradeCode: "PNT", code: "PNT-WALL-SF" }),
      makePricedItem({ tradeCode: "RFG", code: "RFG-SHIN" }),
    ];
    const totals = calculateEstimateTotals(items);
    expect(totals.qualifiesForOP).toBe(true);
    expect(totals.overheadAmount).toBeGreaterThan(0);
    expect(totals.profitAmount).toBeGreaterThan(0);
  });
});

describe("validateEstimate", () => {
  it("returns valid when items have no issues", async () => {
    const items: PricedLineItem[] = [makePricedItem({ tradeCode: "DRY" })];
    const result = await validateEstimate(items);
    expect(result.valid).toBe(true);
  });

  it("errors on items with zero quantity", async () => {
    const items: PricedLineItem[] = [makePricedItem({ quantity: 0 })];
    const result = await validateEstimate(items);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("calculateDimVars", () => {
  it("computes basic room dimensions", () => {
    const dims = { length: 12, width: 10, height: 8 };
    const { beforeMW, afterMW } = calculateDimVars(dims);
    expect(beforeMW.C).toBe(120); // L * W
    expect(beforeMW.F).toBe(120);
    expect(beforeMW.W).toBe(352); // 2 * (12*8 + 10*8) = 352
  });

  it("reduces wall area when openings present", () => {
    const dims = { length: 12, width: 10, height: 8 };
    const openings = [
      {
        openingType: "door",
        widthFt: 3,
        heightFt: 6.67,
        quantity: 1,
        opensInto: null,
        goesToFloor: true,
        goesToCeiling: false,
      },
    ];
    const { afterMW } = calculateDimVars(dims, openings);
    expect(afterMW.W).toBeLessThan(352);
  });
});

describe("TRADE_CODES", () => {
  it("contains core trade codes", () => {
    expect(TRADE_CODES).toContain("DRY");
    expect(TRADE_CODES).toContain("RFG");
    expect(TRADE_CODES).toContain("PNT");
  });
});
