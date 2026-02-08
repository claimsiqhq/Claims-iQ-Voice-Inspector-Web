import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface RoomData {
  id: number;
  name: string;
  status: string;
  damageCount: number;
  photoCount: number;
  roomType?: string;
  dimensions?: { length?: number; width?: number; height?: number };
  structure?: string;
}

interface FloorPlanSketchProps {
  rooms: RoomData[];
  currentRoomId: number | null;
  onRoomClick?: (roomId: number) => void;
  className?: string;
  expanded?: boolean;
}

const SCALE = 5;
const MIN_SIZE = 44;
const PADDING = 6;
const GAP = 4;
const SVG_WIDTH = 260;

const ROOM_ICON: Record<string, string> = {
  exterior_roof_slope: "△",
  exterior_elevation_front: "▣",
  exterior_elevation_left: "◧",
  exterior_elevation_right: "◨",
  exterior_elevation_rear: "▤",
  exterior_gutter: "⌐",
  exterior_garage_door: "⊞",
  exterior_porch: "⊡",
  exterior_deck: "⊡",
  exterior_fence: "⌇",
};

function getRoomSize(room: RoomData) {
  const dims = room.dimensions as any;
  if (dims?.length && dims?.width) {
    return {
      w: Math.max(dims.length * SCALE, MIN_SIZE),
      h: Math.max(dims.width * SCALE, MIN_SIZE),
    };
  }
  return { w: MIN_SIZE + 16, h: MIN_SIZE + 6 };
}

function layoutRooms(roomList: RoomData[], maxWidth: number) {
  const positioned: Array<{ room: RoomData; x: number; y: number; w: number; h: number }> = [];
  let currentX = PADDING;
  let currentY = PADDING;
  let rowHeight = 0;

  for (const room of roomList) {
    const size = getRoomSize(room);
    if (currentX + size.w + PADDING > maxWidth && currentX > PADDING) {
      currentX = PADDING;
      currentY += rowHeight + GAP;
      rowHeight = 0;
    }
    positioned.push({ room, x: currentX, y: currentY, w: size.w, h: size.h });
    currentX += size.w + GAP;
    rowHeight = Math.max(rowHeight, size.h);
  }
  return { positioned, totalHeight: currentY + rowHeight + PADDING };
}

function RoomRect({ room, x, y, w, h, isCurrent, onClick }: {
  room: RoomData; x: number; y: number; w: number; h: number; isCurrent: boolean; onClick?: () => void;
}) {
  const dims = room.dimensions as any;
  const icon = room.roomType ? ROOM_ICON[room.roomType] : undefined;
  const displayName = room.name.length > 14 ? room.name.substring(0, 13) + "…" : room.name;

  return (
    <g onClick={onClick} style={{ cursor: "pointer" }}>
      <motion.rect
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        x={x} y={y} width={w} height={h} rx={3}
        fill={room.status === "complete" ? "rgba(34,197,94,0.1)"
          : room.status === "in_progress" ? "rgba(119,99,183,0.15)"
          : "rgba(31,41,55,0.8)"}
        stroke={isCurrent ? "#C6A54E"
          : room.status === "complete" ? "#22C55E"
          : room.status === "in_progress" ? "#7763B7"
          : "#374151"}
        strokeWidth={isCurrent ? 2 : 1}
        strokeDasharray={room.status === "not_started" ? "3,3" : "none"}
      />
      {icon && (
        <text x={x + 5} y={y + 10} fontSize="8" fill="#6B7280" fontFamily="sans-serif">{icon}</text>
      )}
      <text
        x={x + w / 2} y={y + h / 2 - (dims?.length ? 4 : 0)}
        textAnchor="middle" dominantBaseline="middle"
        fontSize="7" fontFamily="Work Sans, sans-serif" fontWeight="600"
        fill={isCurrent ? "#C6A54E" : room.status === "complete" ? "#86EFAC" : room.status === "in_progress" ? "#C4B5FD" : "#9CA3AF"}
      >
        {displayName}
      </text>
      {dims?.length && dims?.width && (
        <text x={x + w / 2} y={y + h / 2 + 7} textAnchor="middle" dominantBaseline="middle" fontSize="6" fontFamily="Space Mono, monospace" fill="#6B7280">
          {dims.length}×{dims.width}
        </text>
      )}
      {room.damageCount > 0 && (
        <>
          <circle cx={x + w - 5} cy={y + 6} r={5} fill="#EF4444" opacity={0.9} />
          <text x={x + w - 5} y={y + 6} textAnchor="middle" dominantBaseline="middle" fontSize="6" fill="white" fontWeight="bold">
            {room.damageCount}
          </text>
        </>
      )}
      {room.photoCount > 0 && (
        <>
          <circle cx={x + 5} cy={y + h - 5} r={4} fill="rgba(119,99,183,0.7)" />
          <text x={x + 5} y={y + h - 5} textAnchor="middle" dominantBaseline="middle" fontSize="5" fill="white" fontWeight="bold">
            {room.photoCount}
          </text>
        </>
      )}
    </g>
  );
}

export default function FloorPlanSketch({ rooms, currentRoomId, onRoomClick, className, expanded }: FloorPlanSketchProps) {
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
      total: interior.length + exterior.length,
    }));
  }, [rooms]);

  if (rooms.length === 0) {
    return (
      <div className={cn("bg-primary/5 rounded-lg border border-primary/15 p-4", className)}>
        <p className="text-[10px] uppercase tracking-widest text-purple-300/50 mb-2">Live Sketch</p>
        <div className="h-24 flex items-center justify-center">
          <p className="text-xs text-purple-300/30">Rooms will appear here as they're created</p>
        </div>
      </div>
    );
  }

  let runningY = 0;
  const sections: Array<{ label: string; sublabel?: string; yOffset: number; positioned: ReturnType<typeof layoutRooms>["positioned"] }> = [];

  for (const group of structureGroups) {
    if (group.exterior.length > 0) {
      const layout = layoutRooms(group.exterior, SVG_WIDTH);
      sections.push({
        label: group.name,
        sublabel: "EXTERIOR",
        yOffset: runningY,
        positioned: layout.positioned,
      });
      runningY += layout.totalHeight + 22;
    }
    if (group.interior.length > 0) {
      const layout = layoutRooms(group.interior, SVG_WIDTH);
      sections.push({
        label: group.name,
        sublabel: "INTERIOR",
        yOffset: runningY,
        positioned: layout.positioned,
      });
      runningY += layout.totalHeight + 22;
    }
  }

  const totalHeight = runningY + 4;

  return (
    <div className={cn("bg-primary/5 rounded-lg border border-primary/15 overflow-hidden", className)} data-testid="floor-plan-sketch">
      <div className="px-3 py-2 border-b border-primary/15 flex justify-between items-center">
        <p className="text-[10px] uppercase tracking-widest text-purple-300/50">Live Sketch</p>
        <p className="text-[10px] text-purple-300/40">
          {structureGroups.length > 1 ? `${structureGroups.length} structures · ` : ""}
          {rooms.length} area{rooms.length !== 1 ? "s" : ""}
        </p>
      </div>

      <svg viewBox={`0 0 ${SVG_WIDTH} ${totalHeight}`} className="w-full" style={expanded ? undefined : { maxHeight: 400 }}>
        {sections.map((section, si) => (
          <g key={si} transform={`translate(0, ${section.yOffset})`}>
            <text x={PADDING} y={10} fontSize="7" fontFamily="Space Mono, monospace" fill="rgba(157,139,191,0.4)">
              {section.label.toUpperCase()}
            </text>
            {section.sublabel && (
              <text x={SVG_WIDTH - PADDING} y={10} fontSize="6" fontFamily="Space Mono, monospace" fill="rgba(157,139,191,0.3)" textAnchor="end">
                {section.sublabel}
              </text>
            )}
            {section.positioned.map(({ room, x, y, w, h }) => (
              <RoomRect
                key={room.id}
                room={room} x={x} y={y + 14} w={w} h={h}
                isCurrent={room.id === currentRoomId}
                onClick={() => onRoomClick?.(room.id)}
              />
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}
