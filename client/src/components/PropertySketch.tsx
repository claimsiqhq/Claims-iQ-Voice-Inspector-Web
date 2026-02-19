import React, { useMemo, useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Plus, ZoomIn, ZoomOut, Maximize2, Move } from "lucide-react";

/* ─── Types ─── */

interface RoomData {
  id: number;
  name: string;
  status: string;
  damageCount: number;
  photoCount: number;
  roomType?: string;
  dimensions?: { length?: number; width?: number; height?: number; dimVars?: { F?: number } };
  structure?: string;
  viewType?: string;
  shapeType?: string;
  parentRoomId?: number | null;
  attachmentType?: string | null;
  facetLabel?: string | null;
  pitch?: string | null;
  floor?: number;
}

interface Opening {
  id: number;
  openingType: string;
  wallIndex: number;
  positionOnWall?: number;
  width: number;
  height: number;
  widthFt?: number;
  heightFt?: number;
  label?: string;
  opensInto?: string;
  wallDirection?: string;
  roomId: number;
  quantity?: number;
  goesToFloor?: boolean;
  goesToCeiling?: boolean;
}

interface Adjacency {
  id: number;
  sessionId: number;
  roomIdA: number;
  roomIdB: number;
  wallDirectionA?: string | null;
  wallDirectionB?: string | null;
  sharedWallLengthFt?: number | null;
  openingId?: number | null;
}

interface Annotation {
  id: number;
  annotationType: string;
  label: string;
  value?: string;
  location?: string;
}

interface HierarchyRoom extends RoomData {
  subAreas?: RoomData[];
  openings?: Opening[];
  annotations?: Annotation[];
}

interface StructureData {
  id: number;
  name: string;
  structureType: string;
  rooms: HierarchyRoom[];
}

interface PropertySketchProps {
  sessionId: number | null;
  rooms: RoomData[];
  currentRoomId: number | null;
  onRoomClick?: (roomId: number) => void;
  onEditRoom?: (roomId: number) => void;
  onAddRoom?: () => void;
  className?: string;
  expanded?: boolean;
  showSurfaceAreas?: boolean;
  /** When set, only render these sections (e.g. ["roof","elevations","exterior"] for read-only non-interior) */
  sections?: ("interior" | "roof" | "elevations" | "exterior")[];
  /** When set, force which structure to display (e.g. when embedded in SketchEditor) */
  structureName?: string;
  /** When true, use compact header (for embedded read-only roof/elevation section) */
  compact?: boolean;
  /** When user switches structure via tabs, call with the selected structure name (e.g. to sync current structure in parent) */
  onStructureChange?: (structureName: string) => void;
}

function calcFloorSF(dims: any): number {
  if (dims?.dimVars?.F) return dims.dimVars.F;
  return (dims?.length || 0) * (dims?.width || 0);
}
function calcWallSF(dims: any): number {
  const L = dims?.length || 0;
  const W = dims?.width || 0;
  const H = dims?.height || 8;
  return (L + W) * 2 * H;
}
function calcCeilingSF(dims: any): number {
  return (dims?.length || 0) * (dims?.width || 0);
}
function fmtSF(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v).toString();
}
function fmtDimFt(ft: number): string {
  if (ft <= 0) return "";
  const whole = Math.floor(ft);
  const inches = Math.round((ft - whole) * 12);
  return inches > 0 ? `${whole}'${inches}"` : `${whole}'0"`;
}

/* ─── Constants ─── */

const FONT = "Work Sans, sans-serif";
const MONO = "Space Mono, monospace";
const WALL_COLOR = "#334155";
const WALL_THICK = 3;
const DIM_COLOR = "#94A3B8";
const DAMAGE_COLOR = "#EF4444";
const PHOTO_COLOR = "rgba(119,99,183,0.7)";
const SECTION_COLOR = "#94A3B8";
const CURRENT_STROKE = "#C6A54E";
const ANNOTATION_COLOR = "#D97706";
const WINDOW_COLOR = "#60A5FA";
const DIM_LINE_COLOR = "#94A3B8";
const DIM_TEXT_COLOR = "#64748B";
const HANDLE_SIZE = WALL_THICK;
const HANDLE_COLOR = CURRENT_STROKE;

const STATUS_STYLES: Record<string, { fill: string; stroke: string; text: string; dash: string }> = {
  complete: { fill: "rgba(34,197,94,0.06)", stroke: "#22C55E", text: "#166534", dash: "" },
  completed: { fill: "rgba(34,197,94,0.06)", stroke: "#22C55E", text: "#166534", dash: "" },
  in_progress: { fill: "rgba(119,99,183,0.08)", stroke: "#7763B7", text: "#4C3D8F", dash: "" },
  not_started: { fill: "rgba(31,41,55,0.04)", stroke: "#94A3B8", text: "#64748B", dash: "4,2" },
};

function getStyle(room: RoomData, isCurrent: boolean) {
  const s = STATUS_STYLES[room.status] || STATUS_STYLES.not_started;
  return {
    fill: s.fill,
    stroke: isCurrent ? CURRENT_STROKE : WALL_COLOR,
    strokeWidth: isCurrent ? 2.5 : WALL_THICK,
    dash: s.dash,
    text: isCurrent ? CURRENT_STROKE : s.text,
  };
}

function truncate(text: string, max: number) {
  return text.length > max ? text.substring(0, max - 1) + "\u2026" : text;
}

/* ─── Selection Handles ─── */

function SelectionHandles({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const hs = HANDLE_SIZE;
  const half = hs / 2;
  const positions = [
    { cx: x, cy: y },
    { cx: x + w / 2, cy: y },
    { cx: x + w, cy: y },
    { cx: x + w, cy: y + h / 2 },
    { cx: x + w, cy: y + h },
    { cx: x + w / 2, cy: y + h },
    { cx: x, cy: y + h },
    { cx: x, cy: y + h / 2 },
  ];
  return (
    <>
      {positions.map((p, i) => (
        <rect
          key={i}
          x={p.cx - half}
          y={p.cy - half}
          width={hs}
          height={hs}
          fill={HANDLE_COLOR}
          stroke="white"
          strokeWidth={0.4}
        />
      ))}
    </>
  );
}

/* ─── Badge helpers ─── */

function Badges({ room, x, y, w }: { room: RoomData; x: number; y: number; w: number }) {
  return (
    <>
      {room.damageCount > 0 && (
        <>
          <circle cx={x + w - 7} cy={y + 7} r={5} fill={DAMAGE_COLOR} opacity={0.9} />
          <text x={x + w - 7} y={y + 7.5} textAnchor="middle" dominantBaseline="middle" fontSize="5" fill="white" fontWeight="bold">{room.damageCount}</text>
        </>
      )}
      {room.photoCount > 0 && (
        <>
          <circle cx={x + w - 7} cy={y + (room.damageCount > 0 ? 17 : 7)} r={4} fill={PHOTO_COLOR} />
          <text x={x + w - 7} y={y + (room.damageCount > 0 ? 17.5 : 7.5)} textAnchor="middle" dominantBaseline="middle" fontSize="4.5" fill="white" fontWeight="bold">{room.photoCount}</text>
        </>
      )}
    </>
  );
}

/* ─── Architectural Opening Symbols ─── */

function ArchOpeningSymbol({ opening, wallSide, wallStart, wallLength, roomX, roomY, roomW, roomH }: {
  opening: Opening;
  wallSide: "north" | "south" | "east" | "west";
  wallStart: number;
  wallLength: number;
  roomX: number;
  roomY: number;
  roomW: number;
  roomH: number;
}) {
  const openW = (opening.widthFt || opening.width || 3);
  const pxPerFt = wallSide === "north" || wallSide === "south" ? roomW / (wallLength || 1) : roomH / (wallLength || 1);
  const gapPx = Math.min(openW * pxPerFt, (wallSide === "north" || wallSide === "south" ? roomW : roomH) * 0.5);
  const pos = opening.positionOnWall ?? 0.5;

  const isHoriz = wallSide === "north" || wallSide === "south";
  const isDoor = ["door", "french_door", "sliding_door", "standard_door"].includes(opening.openingType);
  const isWindow = opening.openingType === "window";
  const isOverhead = opening.openingType === "overhead_door";
  const isMissing = ["missing_wall", "pass_through", "archway", "cased_opening"].includes(opening.openingType);

  let gx: number, gy: number;

  if (isHoriz) {
    gx = roomX + (roomW - gapPx) * pos;
    gy = wallSide === "north" ? roomY : roomY + roomH;
  } else {
    gx = wallSide === "west" ? roomX : roomX + roomW;
    gy = roomY + (roomH - gapPx) * pos;
  }

  const halfWall = WALL_THICK / 2;

  if (isMissing) {
    if (isHoriz) {
      return (
        <rect x={gx} y={gy - halfWall} width={gapPx} height={WALL_THICK}
          fill="white" stroke="none" />
      );
    }
    return (
      <rect x={gx - halfWall} y={gy} width={WALL_THICK} height={gapPx}
        fill="white" stroke="none" />
    );
  }

  if (isDoor) {
    const arcR = gapPx * 0.8;
    if (isHoriz) {
      const cy = gy;
      const sweepInward = wallSide === "north" ? 1 : -1;
      return (
        <g>
          <rect x={gx} y={cy - halfWall} width={gapPx} height={WALL_THICK} fill="white" stroke="none" />
          <path
            d={`M ${gx},${cy} A ${arcR} ${arcR} 0 0 ${sweepInward > 0 ? 1 : 0} ${gx + gapPx},${cy + arcR * sweepInward}`}
            fill="none" stroke={WALL_COLOR} strokeWidth={0.6} strokeDasharray="2,1.5"
          />
          <line x1={gx} y1={cy} x2={gx} y2={cy + arcR * sweepInward * 0.3} stroke={WALL_COLOR} strokeWidth={0.5} />
        </g>
      );
    }
    const cx = gx;
    const sweepInward = wallSide === "west" ? 1 : -1;
    return (
      <g>
        <rect x={cx - halfWall} y={gy} width={WALL_THICK} height={gapPx} fill="white" stroke="none" />
        <path
          d={`M ${cx},${gy} A ${arcR} ${arcR} 0 0 ${sweepInward > 0 ? 0 : 1} ${cx + arcR * sweepInward},${gy + gapPx}`}
          fill="none" stroke={WALL_COLOR} strokeWidth={0.6} strokeDasharray="2,1.5"
        />
        <line x1={cx} y1={gy} x2={cx + arcR * sweepInward * 0.3} y2={gy} stroke={WALL_COLOR} strokeWidth={0.5} />
      </g>
    );
  }

  if (isWindow) {
    if (isHoriz) {
      const cy = gy;
      return (
        <g>
          <rect x={gx} y={cy - halfWall} width={gapPx} height={WALL_THICK} fill="white" stroke="none" />
          <line x1={gx + 1} y1={cy - 1} x2={gx + gapPx - 1} y2={cy - 1} stroke={WINDOW_COLOR} strokeWidth={0.6} />
          <line x1={gx + 1} y1={cy} x2={gx + gapPx - 1} y2={cy} stroke={WINDOW_COLOR} strokeWidth={0.8} />
          <line x1={gx + 1} y1={cy + 1} x2={gx + gapPx - 1} y2={cy + 1} stroke={WINDOW_COLOR} strokeWidth={0.6} />
        </g>
      );
    }
    const cx = gx;
    return (
      <g>
        <rect x={cx - halfWall} y={gy} width={WALL_THICK} height={gapPx} fill="white" stroke="none" />
        <line x1={cx - 1} y1={gy + 1} x2={cx - 1} y2={gy + gapPx - 1} stroke={WINDOW_COLOR} strokeWidth={0.6} />
        <line x1={cx} y1={gy + 1} x2={cx} y2={gy + gapPx - 1} stroke={WINDOW_COLOR} strokeWidth={0.8} />
        <line x1={cx + 1} y1={gy + 1} x2={cx + 1} y2={gy + gapPx - 1} stroke={WINDOW_COLOR} strokeWidth={0.6} />
      </g>
    );
  }

  if (isOverhead) {
    if (isHoriz) {
      const cy = gy;
      return (
        <g>
          <rect x={gx} y={cy - halfWall} width={gapPx} height={WALL_THICK} fill="white" stroke="none" />
          <line x1={gx + 1} y1={cy} x2={gx + gapPx - 1} y2={cy}
            stroke={WALL_COLOR} strokeWidth={1} strokeDasharray="3,2" />
        </g>
      );
    }
    const cx = gx;
    return (
      <g>
        <rect x={cx - halfWall} y={gy} width={WALL_THICK} height={gapPx} fill="white" stroke="none" />
        <line x1={cx} y1={gy + 1} x2={cx} y2={gy + gapPx - 1}
          stroke={WALL_COLOR} strokeWidth={1} strokeDasharray="3,2" />
      </g>
    );
  }

  return null;
}

/* ─── Annotation markers ─── */

function AnnotationMarkers({ annotations, x, y, w, h }: { annotations: Annotation[]; x: number; y: number; w: number; h: number }) {
  if (!annotations || annotations.length === 0) return null;

  return (
    <>
      {annotations.slice(0, 3).map((ann, i) => {
        const ax = x + 6;
        const ay = y + h - 6 - i * 9;
        const label = ann.annotationType === "hail_count" ? `\u25CF ${ann.value}`
          : ann.annotationType === "pitch" ? `${ann.value}`
          : ann.annotationType === "storm_direction" ? `\u2192 ${ann.value}`
          : ann.value || "";

        return (
          <g key={ann.id}>
            <rect x={ax - 2} y={ay - 5} width={Math.max(label.length * 3.5 + 4, 16)} height={8} rx={2}
              fill="rgba(217,119,6,0.12)" stroke={ANNOTATION_COLOR} strokeWidth={0.4} />
            <text x={ax} y={ay} fontSize="5" fontFamily={MONO} fill={ANNOTATION_COLOR} fontWeight="600">
              {label}
            </text>
          </g>
        );
      })}
    </>
  );
}

/* ─── BFS Adjacency Layout Engine ─── */

interface LayoutRoom {
  room: HierarchyRoom;
  x: number;
  y: number;
  w: number;
  h: number;
}

const DIRECTION_OPPOSITES: Record<string, string> = {
  north: "south", south: "north", east: "west", west: "east",
  front: "rear", rear: "front", left: "right", right: "left",
};

function normalizeDirection(dir: string | null | undefined): "north" | "south" | "east" | "west" | null {
  if (!dir) return null;
  const d = dir.toLowerCase();
  if (d === "north" || d === "rear") return "north";
  if (d === "south" || d === "front") return "south";
  if (d === "east" || d === "right") return "east";
  if (d === "west" || d === "left") return "west";
  return null;
}

function bfsLayout(
  rooms: HierarchyRoom[],
  adjacencies: Adjacency[],
  scale: number,
  minW: number,
  minH: number,
): LayoutRoom[] {
  if (rooms.length === 0) return [];

  const roomMap = new Map<number, HierarchyRoom>();
  for (const r of rooms) roomMap.set(r.id, r);

  const adjMap = new Map<number, Array<{ adj: Adjacency; otherId: number }>>();
  for (const a of adjacencies) {
    if (!roomMap.has(a.roomIdA) || !roomMap.has(a.roomIdB)) continue;
    if (!adjMap.has(a.roomIdA)) adjMap.set(a.roomIdA, []);
    if (!adjMap.has(a.roomIdB)) adjMap.set(a.roomIdB, []);
    adjMap.get(a.roomIdA)!.push({ adj: a, otherId: a.roomIdB });
    adjMap.get(a.roomIdB)!.push({ adj: a, otherId: a.roomIdA });
  }

  function getRoomSize(r: HierarchyRoom): { w: number; h: number } {
    const d = r.dimensions as any;
    if (d?.length && d?.width) {
      // Use proportional scaling: pick the larger scale factor that ensures
      // at least one dimension meets the minimum, then apply it to both
      // dimensions to preserve the aspect ratio.
      const scaleW = minW / (d.length * scale);
      const scaleH = minH / (d.width * scale);
      const needsUpscale = scaleW > 1 || scaleH > 1;
      if (needsUpscale) {
        const upscale = Math.max(scaleW, scaleH);
        return { w: d.length * scale * upscale, h: d.width * scale * upscale };
      }
      return { w: d.length * scale, h: d.width * scale };
    }
    const w = d?.length ? Math.max(d.length * scale, minW) : minW + 8;
    const h = d?.width ? Math.max(d.width * scale, minH) : minH;
    return { w, h };
  }

  const placed = new Map<number, LayoutRoom>();
  const queue: number[] = [];

  const first = rooms[0];
  const firstSize = getRoomSize(first);
  placed.set(first.id, { room: first, x: 0, y: 0, w: firstSize.w, h: firstSize.h });
  queue.push(first.id);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const current = placed.get(currentId)!;
    const neighbors = adjMap.get(currentId) || [];

    for (const { adj, otherId } of neighbors) {
      if (placed.has(otherId)) continue;

      const otherRoom = roomMap.get(otherId)!;
      const otherSize = getRoomSize(otherRoom);

      const dirA = currentId === adj.roomIdA
        ? normalizeDirection(adj.wallDirectionA)
        : normalizeDirection(adj.wallDirectionB);

      let nx: number, ny: number;

      switch (dirA) {
        case "east":
          nx = current.x + current.w;
          ny = current.y;
          break;
        case "west":
          nx = current.x - otherSize.w;
          ny = current.y;
          break;
        case "south":
          nx = current.x;
          ny = current.y + current.h;
          break;
        case "north":
          nx = current.x;
          ny = current.y - otherSize.h;
          break;
        default:
          nx = current.x + current.w;
          ny = current.y;
          break;
      }

      let hasCollision = false;
      const placedArr = Array.from(placed.values());
      for (let pi = 0; pi < placedArr.length; pi++) {
        const p = placedArr[pi];
        if (nx < p.x + p.w && nx + otherSize.w > p.x && ny < p.y + p.h && ny + otherSize.h > p.y) {
          hasCollision = true;
          break;
        }
      }

      if (!hasCollision) {
        placed.set(otherId, { room: otherRoom, x: nx, y: ny, w: otherSize.w, h: otherSize.h });
        queue.push(otherId);
      }
    }
  }

  return Array.from(placed.values());
}

function getOpeningWallSide(opening: Opening, room: HierarchyRoom): "north" | "south" | "east" | "west" {
  if (opening.wallDirection) {
    const norm = normalizeDirection(opening.wallDirection);
    if (norm) return norm;
  }
  if (opening.wallIndex !== undefined && opening.wallIndex !== null) {
    const sides: Array<"north" | "south" | "east" | "west"> = ["north", "east", "south", "west"];
    return sides[opening.wallIndex % 4];
  }
  return "north";
}

/* ─── Dimension Lines ─── */

function DimensionLines({ layouts, offsetX, offsetY }: { layouts: LayoutRoom[]; offsetX: number; offsetY: number }) {
  if (layouts.length === 0) return null;

  const dimOffset = 10;
  const tickLen = 3;
  const elements: React.ReactNode[] = [];

  const topRooms = [...layouts].sort((a, b) => a.y - b.y);
  const leftRooms = [...layouts].sort((a, b) => a.x - b.x);

  const topEdge = Math.min(...layouts.map(l => l.y));
  const leftEdge = Math.min(...layouts.map(l => l.x));

  const shownTop = new Set<string>();
  for (const l of topRooms) {
    if (l.y > topEdge + 2) continue;
    const d = l.room.dimensions as any;
    if (!d?.length) continue;
    const key = `${Math.round(l.x)}-${Math.round(l.w)}`;
    if (shownTop.has(key)) continue;
    shownTop.add(key);

    const y = l.y - dimOffset;
    const x1 = l.x;
    const x2 = l.x + l.w;
    elements.push(
      <g key={`dim-top-${l.room.id}`}>
        <line x1={x1} y1={l.y} x2={x1} y2={y} stroke={DIM_LINE_COLOR} strokeWidth={0.3} />
        <line x1={x2} y1={l.y} x2={x2} y2={y} stroke={DIM_LINE_COLOR} strokeWidth={0.3} />
        <line x1={x1} y1={y + tickLen} x2={x2} y2={y + tickLen} stroke={DIM_LINE_COLOR} strokeWidth={0.5} />
        <line x1={x1} y1={y + tickLen - 1.5} x2={x1} y2={y + tickLen + 1.5} stroke={DIM_LINE_COLOR} strokeWidth={0.5} />
        <line x1={x2} y1={y + tickLen - 1.5} x2={x2} y2={y + tickLen + 1.5} stroke={DIM_LINE_COLOR} strokeWidth={0.5} />
        <text x={(x1 + x2) / 2} y={y + tickLen - 2} textAnchor="middle" fontSize="4.5" fontFamily={MONO} fill={DIM_TEXT_COLOR}>
          {d.length}'
        </text>
      </g>
    );
  }

  const shownLeft = new Set<string>();
  for (const l of leftRooms) {
    if (l.x > leftEdge + 2) continue;
    const d = l.room.dimensions as any;
    if (!d?.width) continue;
    const key = `${Math.round(l.y)}-${Math.round(l.h)}`;
    if (shownLeft.has(key)) continue;
    shownLeft.add(key);

    const x = l.x - dimOffset;
    const y1 = l.y;
    const y2 = l.y + l.h;
    elements.push(
      <g key={`dim-left-${l.room.id}`}>
        <line x1={l.x} y1={y1} x2={x} y2={y1} stroke={DIM_LINE_COLOR} strokeWidth={0.3} />
        <line x1={l.x} y1={y2} x2={x} y2={y2} stroke={DIM_LINE_COLOR} strokeWidth={0.3} />
        <line x1={x + tickLen} y1={y1} x2={x + tickLen} y2={y2} stroke={DIM_LINE_COLOR} strokeWidth={0.5} />
        <line x1={x + tickLen - 1.5} y1={y1} x2={x + tickLen + 1.5} y2={y1} stroke={DIM_LINE_COLOR} strokeWidth={0.5} />
        <line x1={x + tickLen - 1.5} y1={y2} x2={x + tickLen + 1.5} y2={y2} stroke={DIM_LINE_COLOR} strokeWidth={0.5} />
        <text x={x + tickLen - 2} y={(y1 + y2) / 2} textAnchor="middle" fontSize="4.5" fontFamily={MONO} fill={DIM_TEXT_COLOR}
          transform={`rotate(-90, ${x + tickLen - 2}, ${(y1 + y2) / 2})`}>
          {d.width}'
        </text>
      </g>
    );
  }

  return <>{elements}</>;
}

/* ─── Interior Floor Plan Section ─── */

function InteriorSection({ rooms, svgW, scale, currentRoomId, onRoomClick, onEditRoom, showSurfaceAreas, adjacencies, openings }: {
  rooms: HierarchyRoom[]; svgW: number; scale: number; currentRoomId: number | null;
  onRoomClick?: (id: number) => void; onEditRoom?: (id: number) => void; showSurfaceAreas?: boolean;
  adjacencies: Adjacency[]; openings: Opening[];
}) {
  const minW = showSurfaceAreas ? 54 : 44;
  const minH = showSurfaceAreas ? 50 : 32;
  const margin = 20;
  const usable = svgW - margin * 2;

  const bfsPlaced = bfsLayout(rooms, adjacencies, scale, minW, minH);

  const placedIds = new Set(bfsPlaced.map(l => l.room.id));
  const unplaced = rooms.filter(r => !placedIds.has(r.id));

  const fallbackLayouts: LayoutRoom[] = [];
  if (unplaced.length > 0) {
    const maxBfsY = bfsPlaced.length > 0 ? Math.max(...bfsPlaced.map(l => l.y + l.h)) : 0;
    const gap = 6;
    let cx = 0;
    let cy = maxBfsY + (bfsPlaced.length > 0 ? 18 : 0);
    let rowH = 0;

    for (const r of unplaced) {
      const d = r.dimensions as any;
      let w: number, h: number;
      if (d?.length && d?.width) {
        const scaleW = minW / (d.length * scale);
        const scaleH = minH / (d.width * scale);
        const needsUpscale = scaleW > 1 || scaleH > 1;
        if (needsUpscale) {
          const upscale = Math.max(scaleW, scaleH);
          w = d.length * scale * upscale;
          h = d.width * scale * upscale;
        } else {
          w = d.length * scale;
          h = d.width * scale;
        }
      } else {
        w = d?.length ? Math.max(d.length * scale, minW) : minW + 10;
        h = d?.width ? Math.max(d.width * scale, minH) : minH + 6;
      }

      if (cx + w > usable && cx > 0) {
        cx = 0;
        cy += rowH + gap;
        rowH = 0;
      }
      fallbackLayouts.push({ room: r, x: cx, y: cy, w, h });
      cx += w + gap;
      rowH = Math.max(rowH, h);
    }
  }

  const allLayouts = [...bfsPlaced, ...fallbackLayouts];

  if (allLayouts.length === 0) return { height: 0, render: () => null };

  let minX = Math.min(...allLayouts.map(l => l.x));
  let minY = Math.min(...allLayouts.map(l => l.y));
  for (const l of allLayouts) {
    l.x -= minX;
    l.y -= minY;
  }

  const totalW = Math.max(...allLayouts.map(l => l.x + l.w));
  const totalH = Math.max(...allLayouts.map(l => l.y + l.h));

  const dimMargin = 18;
  const offsetX = (svgW - totalW) / 2 + dimMargin / 2;
  const sectionH = totalH + 28 + dimMargin;

  const openingsByRoom = new Map<number, Opening[]>();
  for (const op of openings) {
    if (!openingsByRoom.has(op.roomId)) openingsByRoom.set(op.roomId, []);
    openingsByRoom.get(op.roomId)!.push(op);
  }

  return {
    height: sectionH,
    render: (yOff: number) => (
      <g key="interior" transform={`translate(0, ${yOff})`}>
        <text x={8} y={9} fontSize="6" fontFamily={MONO} fontWeight="700" fill={SECTION_COLOR} letterSpacing="0.8">INTERIOR</text>
        <text x={svgW - 8} y={9} textAnchor="end" fontSize="5" fontFamily={MONO} fill={SECTION_COLOR} opacity={0.6}>{rooms.length} rooms</text>
        <line x1={8} y1={12} x2={svgW - 8} y2={12} stroke={SECTION_COLOR} strokeWidth={0.3} />

        <g transform={`translate(${offsetX}, ${16 + dimMargin / 2})`}>
          <DimensionLines layouts={allLayouts} offsetX={offsetX} offsetY={16 + dimMargin / 2} />

          {allLayouts.map(({ room, x, y, w, h }) => {
            const isCurrent = room.id === currentRoomId;
            const st = getStyle(room, isCurrent);
            const dims = room.dimensions as any;
            const roomLabel = truncate(room.name, 14);
            const hasDims = dims?.length && dims?.width;
            const floorSf = hasDims ? calcFloorSF(dims) : 0;
            const wallSf = hasDims ? calcWallSF(dims) : 0;
            const showSF = showSurfaceAreas && hasDims && floorSf > 0;
            const roomOpenings = openingsByRoom.get(room.id) || room.openings || [];
            const handleClick = () => {
              if (onEditRoom) onEditRoom(room.id);
              else if (onRoomClick) onRoomClick(room.id);
            };

            const labelY = showSF ? y + h * 0.22 : y + h * 0.4;
            const roomTall = h > 35;

            return (
              <g key={room.id}>
                <g onClick={handleClick} style={{ cursor: (onEditRoom || onRoomClick) ? "pointer" : "default" }}>
                  <rect x={x} y={y} width={w} height={h}
                    fill={st.fill} stroke={st.stroke} strokeWidth={st.strokeWidth}
                    strokeDasharray={st.dash || undefined} />

                  {isCurrent && (
                    <SelectionHandles x={x} y={y} w={w} h={h} />
                  )}

                  <text x={x + w / 2} y={labelY}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize="7" fontFamily={FONT} fontWeight="700" fill={st.text}>
                    {roomLabel}
                  </text>

                  {hasDims && (
                    <text x={x + w / 2} y={labelY + 9}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize="5.5" fontFamily={MONO} fill="#6B7280">
                      {dims.length}'\u00D7{dims.width}'
                    </text>
                  )}

                  {hasDims && roomTall && (
                    <text x={x + w / 2} y={labelY + 17}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize="5" fontFamily={MONO} fill="#4B5563">
                      {fmtSF(floorSf)} SF
                    </text>
                  )}

                  {showSF && (
                    <g>
                      <line x1={x + 4} y1={y + h * 0.50} x2={x + w - 4} y2={y + h * 0.50} stroke={DIM_COLOR} strokeWidth={0.3} strokeDasharray="2,1" />
                      <text x={x + 5} y={y + h * 0.62} fontSize="4.5" fontFamily={MONO} fill="#7C3AED" fontWeight="600">
                        Floor {fmtSF(floorSf)} SF
                      </text>
                      <text x={x + 5} y={y + h * 0.74} fontSize="4.5" fontFamily={MONO} fill="#0369A1" fontWeight="600">
                        Wall {fmtSF(wallSf)} SF
                      </text>
                      <text x={x + 5} y={y + h * 0.86} fontSize="4.5" fontFamily={MONO} fill="#047857" fontWeight="600">
                        Ceil {fmtSF(floorSf)} SF
                      </text>
                    </g>
                  )}

                  <Badges room={room} x={x} y={y} w={w} />
                </g>

                {roomOpenings.map((op) => {
                  const wallSide = getOpeningWallSide(op, room);
                  const wallLen = (wallSide === "north" || wallSide === "south")
                    ? (dims?.length || w / scale)
                    : (dims?.width || h / scale);
                  return (
                    <ArchOpeningSymbol
                      key={op.id}
                      opening={op}
                      wallSide={wallSide}
                      wallStart={0}
                      wallLength={wallLen}
                      roomX={x}
                      roomY={y}
                      roomW={w}
                      roomH={h}
                    />
                  );
                })}

                <AnnotationMarkers annotations={room.annotations || []} x={x} y={y} w={w} h={h} />
              </g>
            );
          })}
        </g>
      </g>
    ),
  };
}

/* ─── Roof Plan Section (Geometric) ─── */

function roofSlopeDir(name: string): "north" | "south" | "east" | "west" | null {
  const n = name.toLowerCase();
  if (n.includes("north") || n.includes("rear") || n.includes("back")) return "north";
  if (n.includes("south") || n.includes("front")) return "south";
  if (n.includes("east") || n.includes("right")) return "east";
  if (n.includes("west") || n.includes("left")) return "west";
  return null;
}

function RoofPlanSection({ slopes, svgW, currentRoomId, onRoomClick }: {
  slopes: HierarchyRoom[]; svgW: number; currentRoomId: number | null; onRoomClick?: (id: number) => void;
}) {
  type Dir = "north" | "south" | "east" | "west";

  /* 1 ─ Map slopes to compass directions */
  const dirSlopes = new Map<Dir, HierarchyRoom>();
  const unmapped: HierarchyRoom[] = [];
  for (const s of slopes) {
    const dir = roofSlopeDir(s.name);
    if (dir && !dirSlopes.has(dir)) dirSlopes.set(dir, s);
    else unmapped.push(s);
  }
  const allDirs: Dir[] = ["north", "south", "east", "west"];
  const freeDirs = allDirs.filter(d => !dirSlopes.has(d));
  for (let i = 0; i < unmapped.length && i < freeDirs.length; i++) {
    dirSlopes.set(freeDirs[i], unmapped[i]);
  }

  /* 2 ─ Determine roof type (hip vs gable) */
  const hasNS = dirSlopes.has("north") || dirSlopes.has("south");
  const hasEW = dirSlopes.has("east") || dirSlopes.has("west");
  // Explicit shapeType from any slope overrides inference
  const explicitHip = slopes.some(s => s.shapeType === "hip");
  const explicitGable = slopes.some(s => s.shapeType === "gable");
  const isHip = explicitHip || (!explicitGable && hasNS && hasEW && slopes.length >= 3);

  /* 3 ─ Compute building footprint (ft) from slope dimensions */
  let bldgW = 0; // east-west (eave of N/S slopes)
  let bldgD = 0; // north-south (eave of E/W slopes)
  dirSlopes.forEach((slope, dir) => {
    const d = slope.dimensions as any;
    if (!d?.length) return;
    if (dir === "north" || dir === "south") bldgW = Math.max(bldgW, d.length);
    else bldgD = Math.max(bldgD, d.length);
  });
  if (bldgW === 0 && bldgD === 0) { bldgW = 42; bldgD = 28; }
  else if (bldgW === 0) bldgW = bldgD * 1.5;
  else if (bldgD === 0) bldgD = bldgW * 0.65;

  /* 4 ─ SVG sizing (proportional to building aspect) */
  const maxPW = Math.min(svgW * 0.68, 210);
  const aspect = bldgW / bldgD;
  let pw: number, ph: number;
  if (aspect >= 1) {
    pw = maxPW;
    ph = pw / aspect;
    if (ph > maxPW * 0.7) { ph = maxPW * 0.7; pw = ph * aspect; }
  } else {
    ph = maxPW * 0.7;
    pw = ph * aspect;
    if (pw > maxPW) { pw = maxPW; ph = pw / aspect; }
  }
  pw = Math.max(pw, 100);
  ph = Math.max(ph, 60);
  const ox = (svgW - pw) / 2;

  /* 5 ─ Ridge geometry */
  const ridgeCy = ph / 2;
  let rX1: number, rX2: number;
  if (isHip) {
    const hipInset = Math.min(ph / 2, pw * 0.25);
    rX1 = hipInset; rX2 = pw - hipInset;
    if (rX2 <= rX1 + 2) { rX1 = pw / 2; rX2 = pw / 2; } // pyramid
  } else {
    rX1 = 0; rX2 = pw;
  }
  const ridgeLine = { x1: rX1, y1: ridgeCy, x2: rX2, y2: ridgeCy };
  const isPyramid = isHip && (rX2 - rX1) <= 2;

  /* 6 ─ Hip lines (corners → ridge endpoints) */
  const hipLines = isHip ? [
    { x1: 0, y1: 0, x2: rX1, y2: ridgeCy },
    { x1: pw, y1: 0, x2: rX2, y2: ridgeCy },
    { x1: 0, y1: ph, x2: rX1, y2: ridgeCy },
    { x1: pw, y1: ph, x2: rX2, y2: ridgeCy },
  ] : [];

  /* 7 ─ Facet polygons + label centers */
  type FI = { poly: string; cx: number; cy: number };
  const fm = new Map<Dir, FI>();
  if (isHip && !isPyramid) {
    fm.set("north", { poly: `0,0 ${pw},0 ${rX2},${ridgeCy} ${rX1},${ridgeCy}`, cx: pw / 2, cy: ridgeCy * 0.4 });
    fm.set("south", { poly: `0,${ph} ${pw},${ph} ${rX2},${ridgeCy} ${rX1},${ridgeCy}`, cx: pw / 2, cy: ph - ridgeCy * 0.4 });
    fm.set("east", { poly: `${pw},0 ${pw},${ph} ${rX2},${ridgeCy}`, cx: (pw + rX2) / 2, cy: ph / 2 });
    fm.set("west", { poly: `0,0 0,${ph} ${rX1},${ridgeCy}`, cx: rX1 / 2, cy: ph / 2 });
  } else if (isPyramid) {
    const cx = pw / 2, cy = ph / 2;
    fm.set("north", { poly: `0,0 ${pw},0 ${cx},${cy}`, cx: pw / 2, cy: cy * 0.38 });
    fm.set("south", { poly: `0,${ph} ${pw},${ph} ${cx},${cy}`, cx: pw / 2, cy: ph - cy * 0.38 });
    fm.set("east", { poly: `${pw},0 ${pw},${ph} ${cx},${cy}`, cx: pw - cx * 0.32, cy: ph / 2 });
    fm.set("west", { poly: `0,0 0,${ph} ${cx},${cy}`, cx: cx * 0.32, cy: ph / 2 });
  } else {
    fm.set("north", { poly: `0,0 ${pw},0 ${pw},${ph / 2} 0,${ph / 2}`, cx: pw / 2, cy: ph * 0.25 });
    fm.set("south", { poly: `0,${ph / 2} ${pw},${ph / 2} ${pw},${ph} 0,${ph}`, cx: pw / 2, cy: ph * 0.75 });
  }

  const dimOff = 10;
  const sectionH = ph + 56;

  return {
    height: sectionH,
    render: (yOff: number) => (
      <g key="roofplan" transform={`translate(0, ${yOff})`}>
        <text x={8} y={9} fontSize="6" fontFamily={MONO} fontWeight="700" fill={SECTION_COLOR} letterSpacing="0.8">ROOF PLAN</text>
        <text x={svgW - 8} y={9} textAnchor="end" fontSize="5" fontFamily={MONO} fill={SECTION_COLOR} opacity={0.6}>
          {slopes.length} facet{slopes.length !== 1 ? "s" : ""} {"\u2022"} {isHip ? "hip" : "gable"}
        </text>
        <line x1={8} y1={12} x2={svgW - 8} y2={12} stroke={SECTION_COLOR} strokeWidth={0.3} />

        <g transform={`translate(${ox}, 22)`}>
          {/* Clickable facet fill polygons */}
          {Array.from(dirSlopes.entries()).map(([dir, slope]) => {
            const fp = fm.get(dir);
            if (!fp) return null;
            const isCurrent = slope.id === currentRoomId;
            return (
              <polygon key={`fill-${slope.id}`} points={fp.poly}
                fill={isCurrent ? "rgba(198,165,78,0.12)" : "rgba(120,53,15,0.04)"}
                stroke="none"
                onClick={() => onRoomClick?.(slope.id)}
                style={{ cursor: onRoomClick ? "pointer" : "default" }} />
            );
          })}

          {/* Eave outline (building perimeter) */}
          <rect x={0} y={0} width={pw} height={ph} fill="none" stroke="#78350F" strokeWidth={2} />

          {/* Ridge line or point */}
          {!isPyramid && (
            <line x1={ridgeLine.x1} y1={ridgeLine.y1} x2={ridgeLine.x2} y2={ridgeLine.y2}
              stroke="#78350F" strokeWidth={2} />
          )}
          {isPyramid && <circle cx={rX1} cy={ridgeCy} r={2} fill="#78350F" />}
          <text x={(rX1 + rX2) / 2} y={ridgeCy - 5}
            textAnchor="middle" fontSize="4" fontFamily={MONO} fill="#78350F" fontWeight="600" letterSpacing="0.5">
            RIDGE
          </text>

          {/* Hip lines */}
          {hipLines.map((hl, i) => (
            <line key={`hip-${i}`} x1={hl.x1} y1={hl.y1} x2={hl.x2} y2={hl.y2}
              stroke="#92400E" strokeWidth={0.8} strokeDasharray="4,2" />
          ))}

          {/* Facet labels */}
          {Array.from(dirSlopes.entries()).map(([dir, slope]) => {
            const fp = fm.get(dir);
            if (!fp) return null;
            const isCurrent = slope.id === currentRoomId;
            const fl = slope.facetLabel || "";
            const pt = slope.pitch ? `${slope.pitch}` : "";
            const nm = truncate(slope.name, 12);
            const d = slope.dimensions as any;
            const area = (d?.length && d?.width) ? Math.round(d.length * d.width) : 0;

            return (
              <g key={`lbl-${slope.id}`}
                onClick={() => onRoomClick?.(slope.id)}
                style={{ cursor: onRoomClick ? "pointer" : "default" }}>
                <text x={fp.cx} y={fp.cy - 3} textAnchor="middle"
                  fontSize="5" fontFamily={FONT} fontWeight="600"
                  fill={isCurrent ? CURRENT_STROKE : "#475569"}>
                  {fl ? `${fl} ` : ""}{nm}
                </text>
                <text x={fp.cx} y={fp.cy + 5} textAnchor="middle"
                  fontSize="4" fontFamily={MONO} fill={DIM_COLOR}>
                  {[pt, area > 0 ? `${fmtSF(area)} SF` : ""].filter(Boolean).join(" \u2022 ")}
                </text>
                {slope.damageCount > 0 && (
                  <>
                    <circle cx={fp.cx + (dir === "east" || dir === "west" ? 0 : 22)} cy={fp.cy + (dir === "east" || dir === "west" ? -14 : -5)} r={4} fill={DAMAGE_COLOR} opacity={0.9} />
                    <text x={fp.cx + (dir === "east" || dir === "west" ? 0 : 22)} y={fp.cy + (dir === "east" || dir === "west" ? -14 : -5)}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize="4.5" fill="white" fontWeight="bold">{slope.damageCount}</text>
                  </>
                )}
                {(slope as HierarchyRoom).annotations?.slice(0, 1).map((ann) => (
                  <text key={ann.id} x={fp.cx} y={fp.cy + 12}
                    textAnchor="middle" fontSize="3.5" fontFamily={MONO} fill={ANNOTATION_COLOR} fontWeight="600">
                    {ann.label}: {ann.value}
                  </text>
                ))}
              </g>
            );
          })}

          {/* Bottom eave dimension (building width) */}
          {bldgW > 0 && (
            <g>
              <line x1={0} y1={ph + dimOff - 3} x2={0} y2={ph + dimOff + 3} stroke={DIM_LINE_COLOR} strokeWidth={0.4} />
              <line x1={pw} y1={ph + dimOff - 3} x2={pw} y2={ph + dimOff + 3} stroke={DIM_LINE_COLOR} strokeWidth={0.4} />
              <line x1={0} y1={ph + dimOff} x2={pw} y2={ph + dimOff} stroke={DIM_LINE_COLOR} strokeWidth={0.4} />
              <text x={pw / 2} y={ph + dimOff + 8} textAnchor="middle"
                fontSize="4.5" fontFamily={MONO} fill={DIM_TEXT_COLOR}>{fmtDimFt(bldgW)}</text>
            </g>
          )}
          {/* Left eave dimension (building depth) */}
          {bldgD > 0 && (
            <g>
              <line x1={-dimOff - 3} y1={0} x2={-dimOff + 3} y2={0} stroke={DIM_LINE_COLOR} strokeWidth={0.4} />
              <line x1={-dimOff - 3} y1={ph} x2={-dimOff + 3} y2={ph} stroke={DIM_LINE_COLOR} strokeWidth={0.4} />
              <line x1={-dimOff} y1={0} x2={-dimOff} y2={ph} stroke={DIM_LINE_COLOR} strokeWidth={0.4} />
              <text x={-dimOff - 2} y={ph / 2} textAnchor="middle"
                fontSize="4.5" fontFamily={MONO} fill={DIM_TEXT_COLOR}
                transform={`rotate(-90, ${-dimOff - 2}, ${ph / 2})`}>{fmtDimFt(bldgD)}</text>
            </g>
          )}

          {/* Compass indicator */}
          <g transform={`translate(${pw + 14}, 12)`}>
            <line x1={0} y1={8} x2={0} y2={-8} stroke={DIM_COLOR} strokeWidth={0.6} />
            <polygon points="0,-8 -2.5,-4 2.5,-4" fill={DIM_COLOR} />
            <text x={0} y={-11} textAnchor="middle" fontSize="4" fontFamily={MONO} fill={DIM_COLOR} fontWeight="700">N</text>
          </g>
        </g>
      </g>
    ),
  };
}

/* ─── Elevations Section ─── */

function ElevationsSection({ elevations, svgW, expanded, currentRoomId, onRoomClick, onEditRoom }: {
  elevations: HierarchyRoom[]; svgW: number; expanded: boolean; currentRoomId: number | null; onRoomClick?: (id: number) => void; onEditRoom?: (id: number) => void;
}) {
  const order = ["front", "left", "right", "rear"];
  const sorted = [...elevations].sort((a, b) => {
    const ai = order.findIndex(e => (a.roomType || a.name.toLowerCase()).includes(e));
    const bi = order.findIndex(e => (b.roomType || b.name.toLowerCase()).includes(e));
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const cols = expanded ? Math.min(sorted.length, 4) : Math.min(sorted.length, 2);
  const gap = 6;
  const itemW = (svgW - 16 - (cols - 1) * gap) / cols;
  const itemH = expanded ? 65 : 50;
  const rows = Math.ceil(sorted.length / cols);
  const sectionH = rows * (itemH + gap) + 18;

  return {
    height: sectionH,
    render: (yOff: number) => (
      <g key="elevations" transform={`translate(0, ${yOff})`}>
        <text x={8} y={9} fontSize="6" fontFamily={MONO} fontWeight="700" fill={SECTION_COLOR} letterSpacing="0.8">ELEVATIONS</text>
        <text x={svgW - 8} y={9} textAnchor="end" fontSize="5" fontFamily={MONO} fill={SECTION_COLOR} opacity={0.6}>{elevations.length} views</text>
        <line x1={8} y1={12} x2={svgW - 8} y2={12} stroke={SECTION_COLOR} strokeWidth={0.3} />

        {sorted.map((elev, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          const ex = 8 + col * (itemW + gap);
          const ey = 16 + row * (itemH + gap);
          const isCurrent = elev.id === currentRoomId;
          const st = getStyle(elev, isCurrent);
          const dims = elev.dimensions as any;
          const label = truncate(elev.name, 16);

          const wallH = itemH * 0.5;
          const roofH = itemH * 0.28;
          const groundY = ey + itemH;
          const wallTop = groundY - wallH;
          const wallLeft = ex + itemW * 0.1;
          const wallRight = ex + itemW * 0.9;
          const wallW = wallRight - wallLeft;

          const rt = elev.roomType || elev.name.toLowerCase();
          const isFrontRear = rt.includes("front") || rt.includes("rear");

          const elevOpenings = (elev as HierarchyRoom).openings || [];

          return (
            <g key={elev.id} onClick={() => { if (onEditRoom) onEditRoom(elev.id); else onRoomClick?.(elev.id); }} style={{ cursor: (onEditRoom || onRoomClick) ? "pointer" : "default" }}>
              <text x={ex + itemW / 2} y={ey + 7} textAnchor="middle"
                fontSize="6" fontFamily={FONT} fontWeight="600" fill={st.text}>
                {label}
              </text>

              <line x1={ex} y1={groundY} x2={ex + itemW} y2={groundY} stroke="#78716C" strokeWidth={1} />

              <rect x={wallLeft} y={wallTop} width={wallW} height={wallH}
                fill={st.fill} stroke={st.stroke} strokeWidth={st.strokeWidth}
                strokeDasharray={st.dash || undefined} />

              {isFrontRear ? (
                <polygon
                  points={`${wallLeft},${wallTop} ${wallLeft + wallW / 2},${wallTop - roofH} ${wallRight},${wallTop}`}
                  fill="rgba(120,53,15,0.04)" stroke={st.stroke} strokeWidth={0.8} strokeLinejoin="round" />
              ) : (
                <polygon
                  points={`${wallLeft},${wallTop} ${wallLeft + wallW * 0.15},${wallTop - roofH} ${wallRight - wallW * 0.15},${wallTop - roofH} ${wallRight},${wallTop}`}
                  fill="rgba(120,53,15,0.04)" stroke={st.stroke} strokeWidth={0.8} strokeLinejoin="round" />
              )}

              {elevOpenings.map((op) => {
                const opScale = wallW / (dims?.length || 40);
                const opW = Math.min(op.width * opScale, wallW * 0.25);
                const opH = Math.min(op.height * opScale, wallH * 0.7);
                const opX = wallLeft + (op.positionOnWall ?? 0.5) * (wallW - opW);
                const isDoor = op.openingType === "door" || op.openingType === "french_door" || op.openingType === "sliding_door";
                const opY = isDoor ? groundY - opH : wallTop + (wallH - opH) * 0.4;

                return (
                  <g key={op.id}>
                    <rect x={opX} y={opY} width={opW} height={opH}
                      fill="rgba(186,230,253,0.4)" stroke="#0284C7" strokeWidth={0.5} />
                    {isDoor && (
                      <line x1={opX + opW / 2} y1={opY} x2={opX + opW / 2} y2={opY + opH}
                        stroke="#0284C7" strokeWidth={0.3} />
                    )}
                  </g>
                );
              })}

              {dims?.height && (
                <text x={wallLeft - 3} y={wallTop + wallH / 2}
                  textAnchor="end" dominantBaseline="middle"
                  fontSize="4.5" fontFamily={MONO} fill={DIM_COLOR}>
                  {dims.height}'h
                </text>
              )}
              {dims?.length && (
                <text x={wallLeft + wallW / 2} y={groundY + 7}
                  textAnchor="middle" fontSize="4.5" fontFamily={MONO} fill={DIM_COLOR}>
                  {dims.length}'
                </text>
              )}

              <Badges room={elev} x={ex} y={ey} w={itemW} />
            </g>
          );
        })}
      </g>
    ),
  };
}

/* ─── Other Exterior Section ─── */

function OtherExteriorSection({ items, svgW, expanded, currentRoomId, onRoomClick, onEditRoom }: {
  items: HierarchyRoom[]; svgW: number; expanded: boolean; currentRoomId: number | null; onRoomClick?: (id: number) => void; onEditRoom?: (id: number) => void;
}) {
  const cols = expanded ? 3 : 2;
  const gap = 4;
  const itemW = (svgW - 16 - (cols - 1) * gap) / cols;
  const itemH = 22;
  const rows = Math.ceil(items.length / cols);
  const sectionH = rows * (itemH + gap) + 18;

  return {
    height: sectionH,
    render: (yOff: number) => (
      <g key="other" transform={`translate(0, ${yOff})`}>
        <text x={8} y={9} fontSize="6" fontFamily={MONO} fontWeight="700" fill={SECTION_COLOR} letterSpacing="0.8">OTHER EXTERIOR</text>
        <text x={svgW - 8} y={9} textAnchor="end" fontSize="5" fontFamily={MONO} fill={SECTION_COLOR} opacity={0.6}>{items.length} areas</text>
        <line x1={8} y1={12} x2={svgW - 8} y2={12} stroke={SECTION_COLOR} strokeWidth={0.3} />

        {items.map((item, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          const ix = 8 + col * (itemW + gap);
          const iy = 16 + row * (itemH + gap);
          const isCurrent = item.id === currentRoomId;
          const st = getStyle(item, isCurrent);
          const dims = item.dimensions as any;
          const label = truncate(item.name, 14);

          return (
            <g key={item.id} onClick={() => { if (onEditRoom) onEditRoom(item.id); else onRoomClick?.(item.id); }} style={{ cursor: (onEditRoom || onRoomClick) ? "pointer" : "default" }}>
              <rect x={ix} y={iy} width={itemW} height={itemH} rx={2}
                fill={st.fill} stroke={st.stroke} strokeWidth={st.strokeWidth}
                strokeDasharray={st.dash || undefined} />
              <text x={ix + 6} y={iy + itemH / 2 - (dims?.length ? 2 : 0)}
                dominantBaseline="middle" fontSize="6" fontFamily={FONT} fontWeight="500" fill={st.text}>
                {label}
              </text>
              {dims?.length && (
                <text x={ix + 6} y={iy + itemH / 2 + 6}
                  dominantBaseline="middle" fontSize="4.5" fontFamily={MONO} fill={DIM_COLOR}>
                  {dims.length}'{dims.width ? ` \u00D7 ${dims.width}'` : " LF"}
                </text>
              )}
              <Badges room={item} x={ix} y={iy} w={itemW} />
            </g>
          );
        })}
      </g>
    ),
  };
}

/* ─── Structure categorization ─── */

function categorizeRooms(rooms: HierarchyRoom[]): {
  interior: HierarchyRoom[];
  roofSlopes: HierarchyRoom[];
  elevations: HierarchyRoom[];
  otherExterior: HierarchyRoom[];
} {
  const result = { interior: [] as HierarchyRoom[], roofSlopes: [] as HierarchyRoom[], elevations: [] as HierarchyRoom[], otherExterior: [] as HierarchyRoom[] };

  for (const r of rooms) {
    if (r.parentRoomId) continue;

    const vt = r.viewType || "";
    const rt = r.roomType || "";

    if (vt === "roof_plan" || rt === "exterior_roof_slope") {
      result.roofSlopes.push(r);
    } else if (vt === "elevation" || rt.startsWith("exterior_elevation_")) {
      result.elevations.push(r);
    } else if (vt === "exterior_other" || (rt.startsWith("exterior_") && !rt.includes("elevation") && !rt.includes("roof"))) {
      result.otherExterior.push(r);
    } else {
      result.interior.push(r);
    }
  }

  return result;
}

/* ─── Main Component ─── */

export default function PropertySketch({ sessionId, rooms, currentRoomId, onRoomClick, onEditRoom, onAddRoom, className, expanded, showSurfaceAreas = true, sections: sectionsFilter, structureName: structureNameProp, compact, onStructureChange }: PropertySketchProps) {
  const [activeStructure, setActiveStructure] = useState<string | null>(null);

  const { data: hierarchyData } = useQuery<{ structures: StructureData[] }>({
    queryKey: [`/api/inspection/${sessionId}/hierarchy`],
    enabled: !!sessionId,
    refetchInterval: 10000,
  });

  const { data: adjacencyData } = useQuery<Adjacency[]>({
    queryKey: [`/api/sessions/${sessionId}/adjacencies`],
    enabled: !!sessionId,
    refetchInterval: 10000,
  });

  const { data: openingsData } = useQuery<Opening[]>({
    queryKey: [`/api/inspection/${sessionId}/openings`],
    enabled: !!sessionId,
    refetchInterval: 10000,
  });

  const adjacencies = adjacencyData || [];
  const allOpenings = openingsData || [];

  const structures = useMemo(() => {
    if (hierarchyData?.structures && hierarchyData.structures.length > 0) {
      return hierarchyData.structures;
    }

    const map: Record<string, StructureData> = {};
    for (const r of rooms) {
      const s = r.structure || "Main Dwelling";
      if (!map[s]) {
        map[s] = { id: 0, name: s, structureType: "dwelling", rooms: [r as HierarchyRoom] };
      } else {
        map[s].rooms.push(r as HierarchyRoom);
      }
    }
    return Object.values(map);
  }, [hierarchyData, rooms]);

  const currentStructureName = structureNameProp ?? activeStructure ?? structures[0]?.name ?? "Main Dwelling";
  const currentStructureData = structures.find(s => s.name === currentStructureName) || structures[0];
  const structureRooms = currentStructureData?.rooms || [];

  const categories = useMemo(() => categorizeRooms(structureRooms), [structureRooms]);

  const svgW = expanded ? 520 : 260;
  const scale = expanded ? 4 : 3;

  const layout = useMemo(() => {
    const sections: Array<{ height: number; render: (y: number) => React.ReactNode }> = [];
    const show = (key: "interior" | "roof" | "elevations" | "exterior") =>
      !sectionsFilter || sectionsFilter.includes(key);

    if (show("interior") && categories.interior.length > 0) {
      const sec = InteriorSection({
        rooms: categories.interior, svgW, scale, currentRoomId, onRoomClick, onEditRoom, showSurfaceAreas,
        adjacencies, openings: allOpenings,
      });
      sections.push(sec);
    }

    if (show("roof") && categories.roofSlopes.length > 0) {
      const sec = RoofPlanSection({ slopes: categories.roofSlopes, svgW, currentRoomId, onRoomClick });
      sections.push(sec);
    }

    if (show("elevations") && categories.elevations.length > 0) {
      const sec = ElevationsSection({ elevations: categories.elevations, svgW, expanded: !!expanded, currentRoomId, onRoomClick, onEditRoom });
      sections.push(sec);
    }

    if (show("exterior") && categories.otherExterior.length > 0) {
      const sec = OtherExteriorSection({ items: categories.otherExterior, svgW, expanded: !!expanded, currentRoomId, onRoomClick, onEditRoom });
      sections.push(sec);
    }

    let totalH = 6;
    for (const sec of sections) {
      totalH += sec.height + 6;
    }

    return { sections, totalHeight: totalH + 4 };
  }, [categories, svgW, scale, currentRoomId, onRoomClick, onEditRoom, showSurfaceAreas, expanded, adjacencies, allOpenings, sectionsFilter]);

  const totalRooms = structures.reduce((sum, s) => sum + s.rooms.length, 0);

  // Zoom/pan state for the non-edit view
  const [zoomViewBox, setZoomViewBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement | null>(null);

  const effectiveViewBox = zoomViewBox || { x: 0, y: 0, w: svgW, h: layout.totalHeight };

  const handleZoomIn = useCallback(() => {
    setZoomViewBox((prev) => {
      const v = prev || { x: 0, y: 0, w: svgW, h: layout.totalHeight };
      const nw = v.w * 0.8;
      const nh = v.h * 0.8;
      return { x: v.x + (v.w - nw) / 2, y: v.y + (v.h - nh) / 2, w: nw, h: nh };
    });
  }, [svgW, layout.totalHeight]);

  const handleZoomOut = useCallback(() => {
    setZoomViewBox((prev) => {
      const v = prev || { x: 0, y: 0, w: svgW, h: layout.totalHeight };
      const nw = v.w * 1.25;
      const nh = v.h * 1.25;
      return { x: v.x + (v.w - nw) / 2, y: v.y + (v.h - nh) / 2, w: nw, h: nh };
    });
  }, [svgW, layout.totalHeight]);

  const handleFitView = useCallback(() => {
    setZoomViewBox(null);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    setPanStart({ x: e.clientX, y: e.clientY });
    (e.target as Element)?.setPointerCapture?.(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const v = zoomViewBox || { x: 0, y: 0, w: svgW, h: layout.totalHeight };
    const dx = (e.clientX - panStart.x) * (v.w / rect.width);
    const dy = (e.clientY - panStart.y) * (v.h / rect.height);
    setZoomViewBox({ ...v, x: v.x - dx, y: v.y - dy });
    setPanStart({ x: e.clientX, y: e.clientY });
  }, [isPanning, panStart, zoomViewBox, svgW, layout.totalHeight]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    setIsPanning(false);
    (e.target as Element)?.releasePointerCapture?.(e.pointerId);
  }, []);

  if (sectionsFilter && sectionsFilter.length > 0 && layout.sections.length === 0) return null;

  if (totalRooms === 0 && rooms.length === 0) {
    return (
      <div className={cn("bg-slate-50 rounded-lg border border-slate-200 p-4", className)}>
        <p className="text-[10px] uppercase tracking-widest text-slate-400 mb-2 font-mono">Property Sketch</p>
        <div className="h-24 flex items-center justify-center">
          <p className="text-xs text-slate-300">Rooms will appear as they're created during inspection</p>
        </div>
      </div>
    );
  }

  let runningY = 6;

  return (
    <div className={cn("bg-white rounded-lg border border-slate-200 overflow-hidden", className)} data-testid="property-sketch">
      <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/50">
        <div className="flex justify-between items-center mb-1">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono font-semibold">
            {compact ? "Roof & Elevations (read-only)" : "Property Sketch"}
          </p>
          {!compact && (
          <div className="flex items-center gap-2">
            {!compact && (
              <div className="flex items-center gap-0.5">
                <button onClick={handleZoomIn} className="p-1 rounded text-slate-400 hover:bg-slate-100 transition-colors" title="Zoom In">
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button onClick={handleZoomOut} className="p-1 rounded text-slate-400 hover:bg-slate-100 transition-colors" title="Zoom Out">
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <button onClick={handleFitView} className="p-1 rounded text-slate-400 hover:bg-slate-100 transition-colors" title="Fit to Content">
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <p className="text-[10px] text-slate-400 font-mono">
              {structures.length > 1 ? `${structures.length} structures \u00B7 ` : ""}
              {totalRooms} area{totalRooms !== 1 ? "s" : ""}
            </p>
            {onAddRoom && (
              <button
                onClick={onAddRoom}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-green-700 bg-green-50 border border-green-200 hover:bg-green-100 transition-colors"
                data-testid="button-add-room"
              >
                <Plus className="w-3 h-3" />
                Add
              </button>
            )}
          </div>
          )}
        </div>

        {!compact && structures.length > 1 && (
          <div className="flex gap-1 mt-1.5 overflow-x-auto">
            {structures.map((s) => (
              <button
                key={s.name}
                onClick={() => {
                  setActiveStructure(s.name);
                  onStructureChange?.(s.name);
                }}
                className={cn(
                  "px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap transition-colors border",
                  currentStructureName === s.name
                    ? "bg-slate-800 text-white border-slate-800"
                    : "bg-white text-slate-500 border-slate-200 hover:bg-slate-100"
                )}
              >
                {s.name}
                <span className="ml-1 opacity-60">({s.rooms.length})</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <svg
        ref={svgRef}
        viewBox={`${effectiveViewBox.x} ${effectiveViewBox.y} ${effectiveViewBox.w} ${effectiveViewBox.h}`}
        className="w-full"
        style={{
          ...(expanded ? {} : { maxHeight: 500 }),
          userSelect: 'none',
          WebkitUserSelect: 'none',
          cursor: isPanning ? 'grabbing' : (zoomViewBox ? 'grab' : 'default'),
          touchAction: 'none',
        }}
        onPointerDown={!compact ? handlePointerDown : undefined}
        onPointerMove={!compact ? handlePointerMove : undefined}
        onPointerUp={!compact ? handlePointerUp : undefined}
        onPointerCancel={!compact ? handlePointerUp : undefined}
      >
        <defs>
          <pattern id="sketchGrid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#F1F5F9" strokeWidth={0.3} />
          </pattern>
        </defs>
        <rect width={svgW} height={layout.totalHeight} fill="url(#sketchGrid)" />

        {layout.sections.map((sec) => {
          const thisY = runningY;
          runningY += sec.height + 6;
          return sec.render(thisY);
        })}
      </svg>
    </div>
  );
}
