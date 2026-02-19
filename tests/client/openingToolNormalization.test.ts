import { describe, expect, it } from "vitest";
import { normalizeOpeningDimensions, normalizeWallDirection, parseFeetValue } from "@/lib/openingToolNormalization";

describe("parseFeetValue", () => {
  it("parses inches into feet", () => {
    expect(parseFeetValue("36 inches")).toBe(3);
    expect(parseFeetValue("80 in")).toBeCloseTo(6.6667, 3);
  });

  it("parses feet and inches combinations", () => {
    expect(parseFeetValue("6'8\"")).toBeCloseTo(6.6667, 3);
    expect(parseFeetValue("6 ft 6 in")).toBe(6.5);
  });

  it("accepts numeric values as feet", () => {
    expect(parseFeetValue(80)).toBe(80);
    expect(parseFeetValue("6 feet")).toBe(6);
  });
});

describe("normalizeOpeningDimensions", () => {
  it("maps legacy width/height aliases to widthFt/heightFt", () => {
    const normalized = normalizeOpeningDimensions(
      { width: "36 inches", height: "6 feet" },
      { widthFt: 3, heightFt: 7 },
    );

    expect(normalized).toEqual({ widthFt: 3, heightFt: 6 });
  });

  it("prefers explicit widthFt/heightFt", () => {
    const normalized = normalizeOpeningDimensions(
      { widthFt: "2.5 ft", heightFt: "6'8\"", width: "4 ft", height: "8 ft" },
      { widthFt: 3, heightFt: 7 },
    );

    expect(normalized.widthFt).toBe(2.5);
    expect(normalized.heightFt).toBeCloseTo(6.6667, 3);
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
