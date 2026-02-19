/**
 * PROMPT-30 Part A: Polygon Builder
 * Factory functions for generating common and custom room shapes
 * All dimensions in feet; conversion to SVG units handled by renderer
 */

import type { RoomPolygon, Point } from "./types/roomPolygon";

/**
 * Build a standard rectangular room polygon
 */
export function rectanglePolygon(width: number, height: number): RoomPolygon {
  const points: Point[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];

  return {
    points,
    origin: { x: 0, y: 0 },
    boundingBox: { width, height },
    shapeType: "rectangle",
    openingEdges: [0, 1, 2, 3],
  };
}

/**
 * Build an L-shaped room polygon
 * wingPosition: 0 = right, 1 = bottom, 2 = left, 3 = top
 */
export function lShapePolygon(
  mainWidth: number,
  mainHeight: number,
  wingWidth: number,
  wingHeight: number,
  wingPosition: 0 | 1 | 2 | 3 = 0
): RoomPolygon {
  let points: Point[] = [];

  if (wingPosition === 0) {
    points = [
      { x: 0, y: 0 },
      { x: mainWidth, y: 0 },
      { x: mainWidth, y: mainHeight - wingHeight },
      { x: mainWidth + wingWidth, y: mainHeight - wingHeight },
      { x: mainWidth + wingWidth, y: mainHeight },
      { x: 0, y: mainHeight },
    ];
  } else if (wingPosition === 1) {
    points = [
      { x: 0, y: 0 },
      { x: mainWidth, y: 0 },
      { x: mainWidth, y: mainHeight },
      { x: mainWidth - wingWidth, y: mainHeight },
      { x: mainWidth - wingWidth, y: mainHeight + wingHeight },
      { x: 0, y: mainHeight + wingHeight },
    ];
  } else if (wingPosition === 2) {
    points = [
      { x: 0, y: 0 },
      { x: mainWidth, y: 0 },
      { x: mainWidth, y: mainHeight },
      { x: wingWidth, y: mainHeight },
      { x: wingWidth, y: mainHeight + wingHeight },
      { x: 0, y: mainHeight + wingHeight },
    ];
  } else {
    points = [
      { x: wingWidth, y: 0 },
      { x: mainWidth + wingWidth, y: 0 },
      { x: mainWidth + wingWidth, y: wingHeight },
      { x: mainWidth, y: wingHeight },
      { x: mainWidth, y: mainHeight + wingHeight },
      { x: 0, y: mainHeight + wingHeight },
    ];
  }

  const totalWidth = wingPosition === 0 || wingPosition === 3 ? mainWidth + wingWidth : mainWidth;
  const totalHeight = wingPosition === 1 || wingPosition === 2 ? mainHeight + wingHeight : mainHeight;

  return {
    points,
    origin: { x: 0, y: 0 },
    boundingBox: { width: totalWidth, height: totalHeight },
    shapeType: "l-shape",
    openingEdges: Array.from({ length: points.length }, (_, i) => i),
  };
}

/**
 * Build a T-shaped room polygon
 * capPosition: 0 = top, 1 = right, 2 = bottom, 3 = left
 */
export function tShapePolygon(
  stemWidth: number,
  stemHeight: number,
  capWidth: number,
  capHeight: number,
  capPosition: 0 | 1 | 2 | 3 = 0
): RoomPolygon {
  let points: Point[] = [];
  const stemOffset = (stemWidth - capWidth) / 2;

  if (capPosition === 0) {
    points = [
      { x: stemOffset, y: 0 },
      { x: stemOffset + capWidth, y: 0 },
      { x: stemOffset + capWidth, y: capHeight },
      { x: stemWidth, y: capHeight },
      { x: stemWidth, y: capHeight + stemHeight },
      { x: 0, y: capHeight + stemHeight },
      { x: 0, y: capHeight },
      { x: stemOffset, y: capHeight },
    ];
  } else if (capPosition === 2) {
    points = [
      { x: 0, y: 0 },
      { x: stemWidth, y: 0 },
      { x: stemWidth, y: stemHeight },
      { x: stemOffset + capWidth, y: stemHeight },
      { x: stemOffset + capWidth, y: stemHeight + capHeight },
      { x: stemOffset, y: stemHeight + capHeight },
      { x: stemOffset, y: stemHeight },
      { x: 0, y: stemHeight },
    ];
  } else if (capPosition === 1) {
    points = [
      { x: 0, y: stemOffset },
      { x: stemWidth, y: stemOffset },
      { x: stemWidth, y: stemOffset + capWidth },
      { x: stemWidth + capHeight, y: stemOffset + capWidth },
      { x: stemWidth + capHeight, y: 0 },
      { x: stemWidth, y: 0 },
      { x: stemWidth, y: stemOffset },
      { x: 0, y: stemOffset },
      { x: 0, y: stemOffset + capWidth },
      { x: stemWidth, y: stemOffset + capWidth },
    ];
  } else {
    points = [
      { x: capHeight, y: stemOffset },
      { x: stemWidth, y: stemOffset },
      { x: stemWidth, y: stemOffset + capWidth },
      { x: stemWidth + capHeight, y: stemOffset + capWidth },
      { x: stemWidth + capHeight, y: stemHeight },
      { x: 0, y: stemHeight },
      { x: 0, y: stemOffset + capWidth },
      { x: capHeight, y: stemOffset + capWidth },
      { x: capHeight, y: stemOffset },
      { x: 0, y: stemOffset },
    ];
  }

  const totalWidth = capPosition === 1 || capPosition === 3 ? stemWidth + capHeight : stemWidth;
  const totalHeight = capPosition === 0 || capPosition === 2 ? stemHeight + capHeight : stemHeight;

  return {
    points,
    origin: { x: 0, y: 0 },
    boundingBox: { width: totalWidth, height: totalHeight },
    shapeType: "t-shape",
    openingEdges: Array.from({ length: points.length }, (_, i) => i),
  };
}

/**
 * Build a custom polygon from arbitrary corner points
 */
export function customPolygon(points: Point[], _shapeLabel?: string): RoomPolygon {
  if (points.length < 3) {
    throw new Error("Custom polygon must have at least 3 points, got " + points.length);
  }

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  const normalizedPoints = points.map((p) => ({
    x: p.x - minX,
    y: p.y - minY,
  }));

  return {
    points: normalizedPoints,
    origin: { x: 0, y: 0 },
    boundingBox: { width: maxX - minX, height: maxY - minY },
    shapeType: "custom",
    openingEdges: Array.from({ length: normalizedPoints.length }, (_, i) => i),
  };
}

/**
 * Check if a polygon is convex
 */
export function isConvexPolygon(points: Point[]): boolean {
  if (points.length < 3) return false;
  const n = points.length;
  let sign: boolean | null = null;

  for (let i = 0; i < n; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const cross = (p2.x - p1.x) * (p3.y - p2.y) - (p2.y - p1.y) * (p3.x - p2.x);
    if (cross !== 0) {
      const isPositive = cross > 0;
      if (sign === null) sign = isPositive;
      else if (sign !== isPositive) return false;
    }
  }
  return true;
}

/**
 * Find the nearest edge to a given point
 */
export function nearestEdgeToPoint(
  polygon: RoomPolygon,
  point: Point
): { edgeIndex: number; distance: number } {
  let minDistance = Infinity;
  let nearestEdgeIndex = 0;

  for (let i = 0; i < polygon.points.length; i++) {
    const p1 = polygon.points[i];
    const p2 = polygon.points[(i + 1) % polygon.points.length];
    const dist = distancePointToLineSegment(point, p1, p2);
    if (dist < minDistance) {
      minDistance = dist;
      nearestEdgeIndex = i;
    }
  }
  return { edgeIndex: nearestEdgeIndex, distance: minDistance };
}

function distancePointToLineSegment(
  point: Point,
  lineStart: Point,
  lineEnd: Point
): number {
  const A = point.x - lineStart.x;
  const B = point.y - lineStart.y;
  const C = lineEnd.x - lineStart.x;
  const D = lineEnd.y - lineStart.y;
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  if (lenSq !== 0) param = dot / lenSq;

  let xx: number, yy: number;
  if (param < 0) {
    xx = lineStart.x;
    yy = lineStart.y;
  } else if (param > 1) {
    xx = lineEnd.x;
    yy = lineEnd.y;
  } else {
    xx = lineStart.x + param * C;
    yy = lineStart.y + param * D;
  }
  const dx = point.x - xx;
  const dy = point.y - yy;
  return Math.sqrt(dx * dx + dy * dy);
}
