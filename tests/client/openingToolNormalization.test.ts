import { describe, expect, it } from "vitest";
import { normalizeWallDirection, parseFeetValue } from "@/lib/openingToolNormalization";

describe("parseFeetValue", () => {
  it("parses inches into feet", () => {
    expect(parseFeetValue('36"')).toBe(3);
    expect(parseFeetValue("72 inches")).toBe(6);
  });

  it("parses feet and inches combinations", () => {
    expect(parseFeetValue("6' 8\"")).toBeCloseTo(6.666, 2);
    expect(parseFeetValue("6 ft 6 in")).toBe(6.5);
  });

  it("accepts numeric feet", () => {
    expect(parseFeetValue(7)).toBe(7);
    expect(parseFeetValue("6.5")).toBe(6.5);
  });
});

describe("normalizeWallDirection", () => {
  it("normalizes cardinal directions", () => {
    expect(normalizeWallDirection("North wall")).toBe("north");
    expect(normalizeWallDirection("E")).toBe("east");
  });

  it("normalizes elevation terms", () => {
    expect(normalizeWallDirection("rear")).toBe("rear");
    expect(normalizeWallDirection("back wall")).toBe("rear");
    expect(normalizeWallDirection("Left Side")).toBe("left");
  });
});
