/**
 * PROMPT-30 Part A: RoomPolygon type definitions
 * Supports arbitrary polygonal room shapes for accurate sketch rendering
 */

export interface Point {
  x: number;
  y: number;
}

export interface BoundingBox {
  width: number;
  height: number;
}

export interface RoomPolygon {
  /**
   * SVG polygon points array: list of (x, y) coordinates
   * Coordinates are relative to origin; SVG will render as closed path
   */
  points: Point[];

  /**
   * Reference corner (typically top-left) used by layout algorithm
   * All room coordinates in sketch space are relative to this origin
   */
  origin: Point;

  /**
   * Bounding box dimensions for layout and collision detection
   * Used by sketchLayout.ts to position rooms without overlap
   */
  boundingBox: BoundingBox;

  /**
   * Shape classification for rendering hints and UI labels
   * Helps identify whether room is standard rectangular, L-shaped, etc.
   */
  shapeType: "rectangle" | "l-shape" | "t-shape" | "custom";

  /**
   * Array of edge indices that can accept openings (doors, windows)
   * Each edge is defined by points[i] to points[(i+1) % points.length]
   * Empty array means no openings supported (rare)
   */
  openingEdges: number[];
}

export interface DimensionProvenance {
  length: "measured" | "estimated" | "defaulted";
  width: "measured" | "estimated" | "defaulted";
  height: "measured" | "estimated" | "defaulted";
}

export interface RoomForPolygon {
  id: string | number;
  name: string;
  length: number;
  width: number;
  height: number;
  polygon?: RoomPolygon;

  dimensionProvenance?: DimensionProvenance;

  damageCount?: number;
  openings?: Opening[];
}

export interface Opening {
  id: string | number;
  type: "door" | "window";
  edgeIndex: number;
  positionOnEdge: number;
  width?: number;
  height?: number;
}
