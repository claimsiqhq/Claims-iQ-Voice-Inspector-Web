import { describe, it, expect } from "vitest";
import {
  rectanglePolygon,
  lShapePolygon,
  tShapePolygon,
  customPolygon,
  isConvexPolygon,
} from "../client/src/lib/polygonBuilder";

describe("polygonBuilder", () => {
  it("creates rectangle polygon", () => {
    const p = rectanglePolygon(10, 12);
    expect(p.shapeType).toBe("rectangle");
    expect(p.points).toHaveLength(4);
    expect(p.boundingBox).toEqual({ width: 10, height: 12 });
    expect(p.openingEdges).toHaveLength(4);
  });

  it("creates L-shape polygon", () => {
    const p = lShapePolygon(10, 8, 4, 4, 0);
    expect(p.shapeType).toBe("l-shape");
    expect(p.points.length).toBeGreaterThan(4);
    expect(p.boundingBox.width).toBe(14);
    expect(p.boundingBox.height).toBe(8);
  });

  it("creates T-shape polygon", () => {
    const p = tShapePolygon(10, 6, 4, 3, 0);
    expect(p.shapeType).toBe("t-shape");
    expect(p.points.length).toBe(8);
  });

  it("creates custom polygon from points", () => {
    const p = customPolygon([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }]);
    expect(p.shapeType).toBe("custom");
    expect(p.points).toHaveLength(3);
    expect(p.boundingBox).toEqual({ width: 5, height: 5 });
  });

  it("throws for custom polygon with < 3 points", () => {
    expect(() => customPolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toThrow();
  });

  it("rectangle is convex", () => {
    const p = rectanglePolygon(10, 10);
    expect(isConvexPolygon(p.points)).toBe(true);
  });
});
