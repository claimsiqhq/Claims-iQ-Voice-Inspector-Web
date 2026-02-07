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
}

const SCALE = 6; // pixels per foot
const MIN_SIZE = 50; // minimum room rectangle size in pixels
const PADDING = 8;
const GAP = 6;

export default function FloorPlanSketch({ rooms, currentRoomId, onRoomClick, className }: FloorPlanSketchProps) {
  // Separate rooms by type: interior vs exterior
  const { interiorRooms, exteriorRooms } = useMemo(() => {
    const interior = rooms.filter(r => !r.roomType?.startsWith("exterior_"));
    const exterior = rooms.filter(r => r.roomType?.startsWith("exterior_"));
    return { interiorRooms: interior, exteriorRooms: exterior };
  }, [rooms]);

  // Calculate room rectangle dimensions (proportional to real dimensions where available)
  const getRoomSize = (room: RoomData) => {
    const dims = room.dimensions as any;
    if (dims?.length && dims?.width) {
      return {
        w: Math.max(dims.length * SCALE, MIN_SIZE),
        h: Math.max(dims.width * SCALE, MIN_SIZE),
      };
    }
    // Default size for rooms without dimensions
    return { w: MIN_SIZE + 20, h: MIN_SIZE + 10 };
  };

  // Simple bin-packing: arrange rooms in rows
  const layoutRooms = (roomList: RoomData[], maxWidth: number) => {
    const positioned: Array<{ room: RoomData; x: number; y: number; w: number; h: number }> = [];
    let currentX = PADDING;
    let currentY = PADDING;
    let rowHeight = 0;

    for (const room of roomList) {
      const size = getRoomSize(room);
      // If this room won't fit in the current row, start a new row
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
  };

  const SVG_WIDTH = 260;
  const interiorLayout = layoutRooms(interiorRooms, SVG_WIDTH);
  const exteriorLayout = layoutRooms(exteriorRooms, SVG_WIDTH);

  // Total height for the SVG
  const interiorSectionHeight = interiorRooms.length > 0 ? interiorLayout.totalHeight + 20 : 0;
  const exteriorSectionHeight = exteriorRooms.length > 0 ? exteriorLayout.totalHeight + 20 : 0;
  const totalHeight = interiorSectionHeight + exteriorSectionHeight + 10;

  if (rooms.length === 0) {
    return (
      <div className={cn("bg-white/5 rounded-lg border border-white/10 p-4", className)}>
        <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2">Floor Plan</p>
        <div className="h-24 flex items-center justify-center">
          <p className="text-xs text-white/20">Rooms will appear here as they're created</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("bg-white/5 rounded-lg border border-white/10 overflow-hidden", className)}>
      <div className="px-3 py-2 border-b border-white/10 flex justify-between items-center">
        <p className="text-[10px] uppercase tracking-widest text-white/40">Live Sketch</p>
        <p className="text-[10px] text-white/30">{rooms.length} area{rooms.length !== 1 ? "s" : ""}</p>
      </div>

      <svg
        viewBox={`0 0 ${SVG_WIDTH} ${totalHeight}`}
        className="w-full"
        style={{ maxHeight: 300 }}
      >
        {/* Interior Rooms Section */}
        {interiorRooms.length > 0 && (
          <g>
            <text x={PADDING} y={12} className="fill-white/30" fontSize="8" fontFamily="Space Mono, monospace">
              INTERIOR
            </text>
            {interiorLayout.positioned.map(({ room, x, y, w, h }) => {
              const isCurrent = room.id === currentRoomId;
              const dims = room.dimensions as any;

              return (
                <g
                  key={room.id}
                  onClick={() => onRoomClick?.(room.id)}
                  style={{ cursor: "pointer" }}
                >
                  {/* Room rectangle */}
                  <motion.rect
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    x={x}
                    y={y + 16}
                    width={w}
                    height={h}
                    rx={3}
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

                  {/* Room name */}
                  <text
                    x={x + w / 2}
                    y={y + 16 + h / 2 - (dims?.length ? 4 : 0)}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize="8"
                    fontFamily="Work Sans, sans-serif"
                    fontWeight="600"
                    fill={isCurrent ? "#C6A54E"
                      : room.status === "complete" ? "#86EFAC"
                      : room.status === "in_progress" ? "#C4B5FD"
                      : "#9CA3AF"}
                  >
                    {room.name.length > 12 ? room.name.substring(0, 11) + "…" : room.name}
                  </text>

                  {/* Dimensions if available */}
                  {dims?.length && dims?.width && (
                    <text
                      x={x + w / 2}
                      y={y + 16 + h / 2 + 8}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize="7"
                      fontFamily="Space Mono, monospace"
                      fill="#6B7280"
                    >
                      {dims.length}×{dims.width}
                    </text>
                  )}

                  {/* Damage count badge */}
                  {room.damageCount > 0 && (
                    <>
                      <circle cx={x + w - 6} cy={y + 22} r={6} fill="#EF4444" opacity={0.9} />
                      <text x={x + w - 6} y={y + 22} textAnchor="middle" dominantBaseline="middle" fontSize="7" fill="white" fontWeight="bold">
                        {room.damageCount}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </g>
        )}

        {/* Exterior Rooms Section */}
        {exteriorRooms.length > 0 && (
          <g transform={`translate(0, ${interiorSectionHeight})`}>
            <text x={PADDING} y={12} className="fill-white/30" fontSize="8" fontFamily="Space Mono, monospace">
              EXTERIOR
            </text>
            {exteriorLayout.positioned.map(({ room, x, y, w, h }) => {
              const isCurrent = room.id === currentRoomId;
              return (
                <g
                  key={room.id}
                  onClick={() => onRoomClick?.(room.id)}
                  style={{ cursor: "pointer" }}
                >
                  <motion.rect
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    x={x}
                    y={y + 16}
                    width={w}
                    height={h}
                    rx={3}
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
                  <text
                    x={x + w / 2}
                    y={y + 16 + h / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize="8"
                    fontFamily="Work Sans, sans-serif"
                    fontWeight="600"
                    fill={isCurrent ? "#C6A54E"
                      : room.status === "complete" ? "#86EFAC"
                      : "#9CA3AF"}
                  >
                    {room.name.length > 12 ? room.name.substring(0, 11) + "…" : room.name}
                  </text>
                  {room.damageCount > 0 && (
                    <>
                      <circle cx={x + w - 6} cy={y + 22} r={6} fill="#EF4444" opacity={0.9} />
                      <text x={x + w - 6} y={y + 22} textAnchor="middle" dominantBaseline="middle" fontSize="7" fill="white" fontWeight="bold">
                        {room.damageCount}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </g>
        )}
      </svg>
    </div>
  );
}
