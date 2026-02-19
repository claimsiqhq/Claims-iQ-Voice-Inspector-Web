import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { RoomPolygon, DimensionProvenance } from "@/lib/types/roomPolygon";
import { rectanglePolygon } from "@/lib/polygonBuilder";

// ── Types ──────────────────────────────────────────
interface RoomData {
  id: number;
  name: string;
  status: string;
  damageCount: number;
  photoCount: number;
  roomType?: string;
  dimensions?: {
    length?: number;
    width?: number;
    height?: number;
    dimVars?: {
      W: number;
      F: number;
      PF: number;
      C: number;
      V: number;
      LW: number;
      SW: number;
      HH: number;
      SH: number;
      PC: number;
      LL: number;
      R: number;
      SQ: number;
    };
  };
  polygon?: RoomPolygon | { points: Array<{ x: number; y: number }>; boundingBox?: { width: number; height: number } };
  dimensionProvenance?: DimensionProvenance;
  structure?: string;
}

interface AdjacencyData {
  id: number;
  roomIdA: number;
  roomIdB: number;
  wallDirectionA?: string;
  wallDirectionB?: string;
  sharedWallLengthFt?: number;
  openingId?: number;
}

interface OpeningData {
  id: number;
  roomId: number;
  openingType: string;
  wallDirection?: string;
  widthFt: number;
  heightFt: number;
  quantity: number;
  opensInto?: string;
  goesToFloor?: boolean;
}

interface FloorPlanSketchProps {
  rooms: RoomData[];
  adjacencies?: AdjacencyData[];
  openings?: OpeningData[];
  currentRoomId: number | null;
  onRoomClick?: (roomId: number) => void;
  className?: string;
}

// ── Constants ──────────────────────────────────────
const PIXELS_PER_FOOT = 4;
const MIN_ROOM_PX = 40;
const WALL_THICKNESS = 3;
const PADDING = 16;
const SVG_WIDTH = 280;

const STATUS_COLORS = {
  not_started: { fill: "rgba(31,41,55,0.6)", stroke: "#374151", text: "#9CA3AF" },
  in_progress: { fill: "rgba(119,99,183,0.15)", stroke: "#7763B7", text: "#C4B5FD" },
  complete: { fill: "rgba(34,197,94,0.1)", stroke: "#22C55E", text: "#86EFAC" },
  flagged: { fill: "rgba(198,165,78,0.1)", stroke: "#C6A54E", text: "#C6A54E" },
};

const OPENING_SYMBOLS: Record<string, (x: number, y: number, w: number, isVertical: boolean) => React.ReactNode> = {
  standard_door: (x, y, w, isVert) => {
    const radius = w * 0.8;
    if (isVert) {
      return (
        <g key={`door-${x}-${y}`}>
          <line x1={x} y1={y} x2={x} y2={y + w} stroke="transparent" strokeWidth={WALL_THICKNESS + 2} />
          <path d={`M ${x} ${y} A ${radius} ${radius} 0 0 1 ${x + radius} ${y + w * 0.5}`}
            fill="none" stroke="#9CA3AF" strokeWidth={0.8} strokeDasharray="2,1" />
        </g>
      );
    }
    return (
      <g key={`door-${x}-${y}`}>
        <line x1={x} y1={y} x2={x + w} y2={y} stroke="transparent" strokeWidth={WALL_THICKNESS + 2} />
        <path d={`M ${x} ${y} A ${radius} ${radius} 0 0 0 ${x + w * 0.5} ${y - radius}`}
          fill="none" stroke="#9CA3AF" strokeWidth={0.8} strokeDasharray="2,1" />
      </g>
    );
  },
  door: (x, y, w, isVert) => OPENING_SYMBOLS.standard_door(x, y, w, isVert),
  window: (x, y, w, isVert) => {
    if (isVert) {
      return (
        <g key={`win-${x}-${y}`}>
          <line x1={x - 1} y1={y + 1} x2={x - 1} y2={y + w - 1} stroke="#60A5FA" strokeWidth={0.5} />
          <line x1={x} y1={y + 1} x2={x} y2={y + w - 1} stroke="#60A5FA" strokeWidth={0.8} />
          <line x1={x + 1} y1={y + 1} x2={x + 1} y2={y + w - 1} stroke="#60A5FA" strokeWidth={0.5} />
        </g>
      );
    }
    return (
      <g key={`win-${x}-${y}`}>
        <line x1={x + 1} y1={y - 1} x2={x + w - 1} y2={y - 1} stroke="#60A5FA" strokeWidth={0.5} />
        <line x1={x + 1} y1={y} x2={x + w - 1} y2={y} stroke="#60A5FA" strokeWidth={0.8} />
        <line x1={x + 1} y1={y + 1} x2={x + w - 1} y2={y + 1} stroke="#60A5FA" strokeWidth={0.5} />
      </g>
    );
  },
  overhead_door: (x, y, w, isVert) => {
    if (isVert) {
      return <line key={`ohd-${x}-${y}`} x1={x} y1={y} x2={x} y2={y + w} stroke="#9CA3AF" strokeWidth={1} strokeDasharray="4,2" />;
    }
    return <line key={`ohd-${x}-${y}`} x1={x} y1={y} x2={x + w} y2={y} stroke="#9CA3AF" strokeWidth={1} strokeDasharray="4,2" />;
  },
};

interface PositionedRoom {
  room: RoomData;
  x: number;
  y: number;
  w: number;
  h: number;
}

function getRoomPixelSize(room: RoomData): { w: number; h: number } {
  const poly = room.polygon as RoomPolygon | undefined;
  if (poly?.boundingBox) {
    return {
      w: Math.max(poly.boundingBox.width * PIXELS_PER_FOOT, MIN_ROOM_PX),
      h: Math.max(poly.boundingBox.height * PIXELS_PER_FOOT, MIN_ROOM_PX),
    };
  }
  const dims = room.dimensions;
  if (dims?.length && dims?.width) {
    return {
      w: Math.max(dims.length * PIXELS_PER_FOOT, MIN_ROOM_PX),
      h: Math.max(dims.width * PIXELS_PER_FOOT, MIN_ROOM_PX),
    };
  }
  return { w: MIN_ROOM_PX + 16, h: MIN_ROOM_PX + 6 };
}

function getRoomPolygon(room: RoomData): RoomPolygon | null {
  const poly = room.polygon as RoomPolygon | { points: Array<{ x: number; y: number }>; boundingBox?: { width: number; height: number } } | undefined;
  if (poly?.points && poly.points.length >= 3) {
    const bb = poly.boundingBox || (() => {
      const xs = poly.points.map((p) => p.x);
      const ys = poly.points.map((p) => p.y);
      return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    })();
    return {
      points: poly.points,
      origin: { x: 0, y: 0 },
      boundingBox: bb,
      shapeType: "custom",
      openingEdges: Array.from({ length: poly.points.length }, (_, i) => i),
    };
  }
  const dims = room.dimensions;
  if (dims?.length && dims?.width) {
    return rectanglePolygon(dims.length, dims.width);
  }
  return null;
}

function layoutRoomsWithAdjacency(
  roomList: RoomData[],
  adjacencies: AdjacencyData[],
  maxWidth: number
): PositionedRoom[] {
  if (roomList.length === 0) return [];

  const positioned: Map<number, PositionedRoom> = new Map();
  const roomById = new Map(roomList.map((r) => [r.id, r]));

  const first = roomList[0];
  const firstSize = getRoomPixelSize(first);
  positioned.set(first.id, { room: first, x: PADDING, y: PADDING, w: firstSize.w, h: firstSize.h });

  const queue: number[] = [first.id];
  const visited = new Set<number>([first.id]);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const current = positioned.get(currentId)!;

    const relatedAdjs = adjacencies.filter(
      (a) =>
        (a.roomIdA === currentId || a.roomIdB === currentId) &&
        roomById.has(a.roomIdA) &&
        roomById.has(a.roomIdB)
    );

    for (const adj of relatedAdjs) {
      const otherId = adj.roomIdA === currentId ? adj.roomIdB : adj.roomIdA;
      if (visited.has(otherId)) continue;

      const otherRoom = roomById.get(otherId);
      if (!otherRoom) continue;

      const otherSize = getRoomPixelSize(otherRoom);
      const wallDir = adj.roomIdA === currentId ? adj.wallDirectionA : adj.wallDirectionB;

      let newX = current.x;
      let newY = current.y;

      switch (wallDir) {
        case "east":
        case "right":
          newX = current.x + current.w;
          break;
        case "west":
        case "left":
          newX = current.x - otherSize.w;
          break;
        case "south":
        case "rear":
          newY = current.y + current.h;
          break;
        case "north":
        case "front":
          newY = current.y - otherSize.h;
          break;
        default:
          newX = current.x + current.w;
      }

      let hasCollision = false;
      for (const placed of Array.from(positioned.values())) {
        if (
          newX < placed.x + placed.w &&
          newX + otherSize.w > placed.x &&
          newY < placed.y + placed.h &&
          newY + otherSize.h > placed.y
        ) {
          hasCollision = true;
          break;
        }
      }

      if (!hasCollision) {
        positioned.set(otherId, { room: otherRoom, x: newX, y: newY, w: otherSize.w, h: otherSize.h });
        visited.add(otherId);
        queue.push(otherId);
      }
    }
  }

  const unplaced = roomList.filter((r) => !positioned.has(r.id));
  if (unplaced.length > 0) {
    let maxY = 0;
    for (const p of Array.from(positioned.values())) {
      maxY = Math.max(maxY, p.y + p.h);
    }

    let curX = PADDING;
    let curY = maxY + 12;
    let rowH = 0;

    for (const room of unplaced) {
      const size = getRoomPixelSize(room);
      if (curX + size.w + PADDING > maxWidth && curX > PADDING) {
        curX = PADDING;
        curY += rowH + 4;
        rowH = 0;
      }
      positioned.set(room.id, { room, x: curX, y: curY, w: size.w, h: size.h });
      curX += size.w + 4;
      rowH = Math.max(rowH, size.h);
    }
  }

  let minX = Infinity,
    minY = Infinity;
  for (const p of Array.from(positioned.values())) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
  }
  const offsetX = PADDING - minX;
  const offsetY = PADDING - minY;
  const result: PositionedRoom[] = [];
  for (const p of Array.from(positioned.values())) {
    result.push({ ...p, x: p.x + offsetX, y: p.y + offsetY });
  }

  return result;
}

function RoomRect({
  room,
  x,
  y,
  w,
  h,
  isCurrent,
  openings,
  onClick,
}: {
  room: RoomData;
  x: number;
  y: number;
  w: number;
  h: number;
  isCurrent: boolean;
  openings: OpeningData[];
  onClick?: () => void;
}) {
  const dims = room.dimensions;
  const dv = dims?.dimVars;
  const polygon = getRoomPolygon(room);
  const colors = isCurrent
    ? { fill: "rgba(198,165,78,0.15)", stroke: "#C6A54E", text: "#C6A54E" }
    : STATUS_COLORS[room.status as keyof typeof STATUS_COLORS] || STATUS_COLORS.not_started;

  const hasDimensionDefaults =
    room.dimensionProvenance &&
    Object.values(room.dimensionProvenance).some((v) => v === "defaulted");
  const strokeDasharray = hasDimensionDefaults ? "4,4" : room.status === "not_started" ? "4,3" : "none";

  const displayName = room.name.length > 16 ? room.name.substring(0, 15) + "…" : room.name;
  const dimText = dims?.length && dims?.width ? `${dims.length}'×${dims.width}'` : null;
  const sfText = dv?.F ? `${dv.F} SF` : dims?.length && dims?.width ? `${dims.length * dims.width} SF` : null;

  const renderShape = () => {
    if (polygon && polygon.points.length > 2) {
      const scaleX = w / polygon.boundingBox.width;
      const scaleY = h / polygon.boundingBox.height;
      const pointsStr = polygon.points
        .map((p) => `${x + p.x * scaleX},${y + p.y * scaleY}`)
        .join(" ");
      return (
        <motion.polygon
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          points={pointsStr}
          fill={colors.fill}
          stroke={colors.stroke}
          strokeWidth={isCurrent ? WALL_THICKNESS : WALL_THICKNESS - 1}
          strokeDasharray={strokeDasharray}
        />
      );
    }
    return (
      <motion.rect
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        x={x}
        y={y}
        width={w}
        height={h}
        fill={colors.fill}
        stroke={colors.stroke}
        strokeWidth={isCurrent ? WALL_THICKNESS : WALL_THICKNESS - 1}
        strokeDasharray={strokeDasharray}
      />
    );
  };

  return (
    <g onClick={onClick} style={{ cursor: onClick ? "pointer" : "default" }}>
      {renderShape()}

      {hasDimensionDefaults && (
        <g>
          <rect
            x={x + w * 0.02}
            y={y + h * 0.02}
            width={20}
            height={14}
            fill="#ffc107"
            rx={3}
            opacity={0.9}
          />
          <text
            x={x + w * 0.02 + 10}
            y={y + h * 0.02 + 10}
            fontSize="8"
            fontWeight="bold"
            textAnchor="middle"
            fill="#333"
          >
            ⚠
          </text>
        </g>
      )}

      <text
        x={x + w / 2}
        y={y + h / 2 - (dimText ? 5 : 0)}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="7"
        fontFamily="Work Sans, sans-serif"
        fontWeight="600"
        fill={colors.text}
      >
        {displayName}
      </text>

      {dimText && (
        <text
          x={x + w / 2}
          y={y + h / 2 + 5}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="5.5"
          fontFamily="Space Mono, monospace"
          fill="#6B7280"
        >
          {dimText}
        </text>
      )}

      {sfText && h > 35 && (
        <text
          x={x + w / 2}
          y={y + h / 2 + 12}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="5"
          fontFamily="Space Mono, monospace"
          fill="#4B5563"
        >
          {sfText}
        </text>
      )}

      {room.damageCount > 0 && (
        <>
          <circle cx={x + w - 6} cy={y + 6} r={5} fill="#EF4444" opacity={0.9} />
          <text x={x + w - 6} y={y + 6.5} textAnchor="middle" dominantBaseline="middle" fontSize="5.5" fill="white" fontWeight="bold">
            {room.damageCount}
          </text>
        </>
      )}

      {room.photoCount > 0 && (
        <>
          <circle cx={x + 6} cy={y + h - 6} r={4} fill="rgba(119,99,183,0.8)" />
          <text x={x + 6} y={y + h - 5.5} textAnchor="middle" dominantBaseline="middle" fontSize="5" fill="white" fontWeight="bold">
            {room.photoCount}
          </text>
        </>
      )}

      {openings.map((opening, i) => {
        const openingPx = opening.widthFt * PIXELS_PER_FOOT;
        const symbol = OPENING_SYMBOLS[opening.openingType] || OPENING_SYMBOLS.standard_door;
        const wallDir = opening.wallDirection || "south";

        let ox: number, oy: number;
        const isVert = wallDir === "east" || wallDir === "west" || wallDir === "right" || wallDir === "left";

        if (wallDir === "north" || wallDir === "front") {
          ox = x + w / 2 - openingPx / 2 + i * 4;
          oy = y;
        } else if (wallDir === "south" || wallDir === "rear") {
          ox = x + w / 2 - openingPx / 2 + i * 4;
          oy = y + h;
        } else if (wallDir === "east" || wallDir === "right") {
          ox = x + w;
          oy = y + h / 2 - openingPx / 2 + i * 4;
        } else {
          ox = x;
          oy = y + h / 2 - openingPx / 2 + i * 4;
        }

        return symbol ? symbol(ox, oy, Math.min(openingPx, isVert ? h * 0.6 : w * 0.6), isVert) : null;
      })}
    </g>
  );
}

export default function FloorPlanSketch({
  rooms,
  adjacencies = [],
  openings = [],
  currentRoomId,
  onRoomClick,
  className,
}: FloorPlanSketchProps) {
  const structureGroups = useMemo(() => {
    const groups: Record<string, { interior: RoomData[]; exterior: RoomData[] }> = {};
    for (const room of rooms) {
      const structure = room.structure || "Main Dwelling";
      if (!groups[structure]) groups[structure] = { interior: [], exterior: [] };
      if (room.roomType?.startsWith("exterior_")) {
        groups[structure].exterior.push(room);
      } else {
        groups[structure].interior.push(room);
      }
    }
    return Object.entries(groups).map(([name, { interior, exterior }]) => ({
      name,
      interior,
      exterior,
    }));
  }, [rooms]);

  const openingsByRoom = useMemo(() => {
    const map: Record<number, OpeningData[]> = {};
    for (const o of openings) {
      if (!map[o.roomId]) map[o.roomId] = [];
      map[o.roomId].push(o);
    }
    return map;
  }, [openings]);

  if (rooms.length === 0) {
    return (
      <div className={cn("bg-primary/5 rounded-lg border border-primary/15 p-4", className)}>
        <p className="text-[10px] uppercase tracking-widest text-purple-300/50 mb-2">Live Sketch</p>
        <div className="h-24 flex items-center justify-center">
          <p className="text-xs text-purple-300/30">Rooms will appear as they're created</p>
        </div>
      </div>
    );
  }

  let runningY = 0;
  const sections: Array<{
    label: string;
    sublabel: string;
    yOffset: number;
    positioned: PositionedRoom[];
    sectionHeight: number;
  }> = [];

  for (const group of structureGroups) {
    for (const [sublabel, roomList] of [["EXTERIOR", group.exterior], ["INTERIOR", group.interior]] as const) {
      if (roomList.length === 0) continue;

      const roomIds = new Set(roomList.map((r) => r.id));
      const groupAdjs = adjacencies.filter((a) => roomIds.has(a.roomIdA) && roomIds.has(a.roomIdB));

      const positioned = layoutRoomsWithAdjacency(roomList, groupAdjs, SVG_WIDTH);

      let maxY = 0;
      for (const p of positioned) {
        maxY = Math.max(maxY, p.y + p.h);
      }
      const sectionHeight = maxY + PADDING;

      sections.push({
        label: group.name,
        sublabel,
        yOffset: runningY,
        positioned,
        sectionHeight,
      });
      runningY += sectionHeight + 20;
    }
  }

  const totalHeight = runningY + 4;

  return (
    <div className={cn("bg-primary/5 rounded-lg border border-primary/15 overflow-hidden", className)} data-testid="floor-plan-sketch">
      <div className="px-3 py-2 border-b border-primary/15 flex justify-between items-center">
        <p className="text-[10px] uppercase tracking-widest text-purple-300/50">Live Sketch</p>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500/60" />
            <span className="text-[8px] text-purple-300/40">Done</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-purple-500/60" />
            <span className="text-[8px] text-purple-300/40">Active</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-gray-500/40" />
            <span className="text-[8px] text-purple-300/40">Pending</span>
          </span>
        </div>
      </div>

      <svg viewBox={`0 0 ${SVG_WIDTH} ${totalHeight}`} className="w-full" style={{ maxHeight: 450 }}>
        {sections.map((section, si) => (
          <g key={si} transform={`translate(0, ${section.yOffset})`}>
            <text x={PADDING} y={10} fontSize="7" fontFamily="Space Mono, monospace" fill="rgba(157,139,191,0.4)" fontWeight="600">
              {section.label.toUpperCase()}
            </text>
            <text x={SVG_WIDTH - PADDING} y={10} fontSize="6" fontFamily="Space Mono, monospace" fill="rgba(157,139,191,0.3)" textAnchor="end">
              {section.sublabel}
            </text>

            {section.positioned.map(({ room, x, y, w, h }) => (
              <RoomRect
                key={room.id}
                room={room}
                x={x}
                y={y + 14}
                w={w}
                h={h}
                isCurrent={room.id === currentRoomId}
                openings={openingsByRoom[room.id] || []}
                onClick={() => onRoomClick?.(room.id)}
              />
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}
