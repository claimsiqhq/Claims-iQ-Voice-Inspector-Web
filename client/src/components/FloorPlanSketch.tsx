import React, { useMemo } from "react";
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

const FONT = "Work Sans, sans-serif";
const MONO = "Space Mono, monospace";

const STATUS_COLORS: Record<string, { fill: string; stroke: string; text: string; bg: string }> = {
  complete: { fill: "rgba(34,197,94,0.06)", stroke: "#22C55E", text: "#166534", bg: "#DCFCE7" },
  in_progress: { fill: "rgba(119,99,183,0.08)", stroke: "#7763B7", text: "#4C3D8F", bg: "#EDE9FE" },
  not_started: { fill: "rgba(241,245,249,0.4)", stroke: "#CBD5E1", text: "#64748B", bg: "#F1F5F9" },
};
const ACTIVE_STROKE = "#C6A54E";
const WALL = "#334155";
const DIM = "#94A3B8";
const MUTED = "#64748B";
const DMG = "#EF4444";

function sc(room: RoomData, active: boolean) {
  const c = STATUS_COLORS[room.status] || STATUS_COLORS.not_started;
  return active ? { ...c, stroke: ACTIVE_STROKE, text: ACTIVE_STROKE } : c;
}

function dimLabel(d: any): string {
  if (!d) return "";
  const parts: string[] = [];
  if (d.length && d.width) parts.push(`${d.length}' × ${d.width}'`);
  else if (d.length) parts.push(`${d.length}' LF`);
  if (d.height) parts.push(`${d.height}'h`);
  return parts.join("  ");
}

interface StructureData {
  name: string;
  interior: RoomData[];
  exterior: RoomData[];
}

function groupByStructure(rooms: RoomData[]): StructureData[] {
  const map: Record<string, StructureData> = {};
  for (const r of rooms) {
    const s = r.structure || "Main Dwelling";
    if (!map[s]) map[s] = { name: s, interior: [], exterior: [] };
    const rt = r.roomType || "";
    if (rt.startsWith("exterior_")) map[s].exterior.push(r);
    else map[s].interior.push(r);
  }
  return Object.values(map);
}

function layoutRooms(rooms: RoomData[], maxW: number, scale: number) {
  const MIN_W = 48;
  const MIN_H = 34;

  const sized = rooms.map(r => {
    const d = r.dimensions as any;
    return {
      room: r,
      w: d?.length ? Math.max(d.length * scale, MIN_W) : MIN_W + 6,
      h: d?.width ? Math.max(d.width * scale, MIN_H) : MIN_H,
    };
  });

  const placed: Array<{ room: RoomData; x: number; y: number; w: number; h: number }> = [];
  let cx = 0, cy = 0, rowH = 0;

  for (const { room, w, h } of sized) {
    if (cx + w > maxW && cx > 0) {
      cx = 0;
      cy += rowH;
      rowH = 0;
    }
    placed.push({ room, x: cx, y: cy, w, h });
    cx += w;
    rowH = Math.max(rowH, h);
  }

  const totalW = placed.length > 0 ? Math.max(...placed.map(p => p.x + p.w)) : 0;
  const totalH = placed.length > 0 ? cy + rowH : 0;
  return { placed, totalW, totalH };
}

function FloorPlanSVG({ rooms, svgW, scale, currentRoomId, onRoomClick }: {
  rooms: RoomData[]; svgW: number; scale: number; currentRoomId: number | null; onRoomClick?: (id: number) => void;
}) {
  const margin = 14;
  const wallT = 2;
  const { placed, totalW, totalH } = layoutRooms(rooms, svgW - margin * 2, scale);

  if (totalW === 0 || totalH === 0) return null;

  const ox = (svgW - totalW) / 2;

  const interiorWalls: React.ReactNode[] = [];
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    for (let j = i + 1; j < placed.length; j++) {
      const q = placed[j];
      if (Math.abs(p.x + p.w - q.x) < 0.5 && p.y < q.y + q.h && q.y < p.y + p.h) {
        const wy1 = Math.max(p.y, q.y);
        const wy2 = Math.min(p.y + p.h, q.y + q.h);
        interiorWalls.push(<line key={`w-v-${i}-${j}`} x1={q.x} y1={wy1} x2={q.x} y2={wy2} stroke={WALL} strokeWidth={1} />);
      }
      if (Math.abs(p.y + p.h - q.y) < 0.5 && p.x < q.x + q.w && q.x < p.x + p.w) {
        const wx1 = Math.max(p.x, q.x);
        const wx2 = Math.min(p.x + p.w, q.x + q.w);
        interiorWalls.push(<line key={`w-h-${i}-${j}`} x1={wx1} y1={q.y} x2={wx2} y2={q.y} stroke={WALL} strokeWidth={1} />);
      }
    }
  }

  return (
    <g>
      <text x={8} y={10} fontSize="6" fontFamily={MONO} fontWeight="700" fill={MUTED} letterSpacing="0.8">
        INTERIOR ROOMS
      </text>
      <text x={svgW - 8} y={10} textAnchor="end" fontSize="5" fontFamily={MONO} fill={DIM}>
        {rooms.length} room{rooms.length !== 1 ? "s" : ""}
      </text>
      <line x1={8} y1={13} x2={svgW - 8} y2={13} stroke="#E2E8F0" strokeWidth={0.3} />

      <g transform={`translate(${ox}, ${margin + 6})`}>
        <rect x={-wallT} y={-wallT} width={totalW + wallT * 2} height={totalH + wallT * 2}
          fill="none" stroke={WALL} strokeWidth={wallT} />

        {placed.map(({ room, x, y, w, h }) => {
          const active = room.id === currentRoomId;
          const c = sc(room, active);
          const d = room.dimensions as any;
          const hasDims = d?.length && d?.width;
          const truncName = room.name.length > 15 ? room.name.slice(0, 14) + "…" : room.name;

          return (
            <g key={room.id}
              onClick={() => onRoomClick?.(room.id)}
              style={{ cursor: onRoomClick ? "pointer" : "default" }}>

              <rect x={x} y={y} width={w} height={h}
                fill={c.fill} stroke={c.stroke}
                strokeWidth={active ? 2 : 0.6}
                strokeDasharray={room.status === "not_started" ? "3,2" : undefined} />

              <text x={x + w / 2} y={y + h / 2 - (hasDims ? 3.5 : 0)}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={w < 50 ? "5.5" : "6.5"} fontFamily={FONT} fontWeight="600" fill={c.text}>
                {truncName}
              </text>

              {hasDims && (
                <text x={x + w / 2} y={y + h / 2 + 5}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize="5" fontFamily={MONO} fill={DIM}>
                  {d.length}' × {d.width}'
                </text>
              )}

              {room.damageCount > 0 && (
                <>
                  <circle cx={x + w - 7} cy={y + 7} r={4.5} fill={DMG} opacity={0.9} />
                  <text x={x + w - 7} y={y + 7.5} textAnchor="middle" dominantBaseline="middle"
                    fontSize="5" fill="white" fontWeight="bold">{room.damageCount}</text>
                </>
              )}
            </g>
          );
        })}

        {interiorWalls}
      </g>
    </g>
  );
}

function ExteriorRow({ room, x, y, w, active, onRoomClick }: {
  room: RoomData; x: number; y: number; w: number; active: boolean; onRoomClick?: (id: number) => void;
}) {
  const c = sc(room, active);
  const dims = dimLabel(room.dimensions);
  const rowH = 18;
  const typeLabel = (room.roomType || "").replace("exterior_", "").replace(/_/g, " ");
  const truncName = room.name.length > 20 ? room.name.slice(0, 19) + "…" : room.name;

  return (
    <g onClick={() => onRoomClick?.(room.id)} style={{ cursor: onRoomClick ? "pointer" : "default" }}>
      <rect x={x} y={y} width={w} height={rowH} rx={1.5}
        fill={c.fill} stroke={c.stroke} strokeWidth={active ? 1.5 : 0.5} />

      <circle cx={x + 9} cy={y + rowH / 2} r={3}
        fill={c.stroke} opacity={0.7} />
      <text x={x + 9} y={y + rowH / 2 + 0.5} textAnchor="middle" dominantBaseline="middle"
        fontSize="4" fill="white" fontWeight="bold">
        {room.status === "complete" ? "✓" : room.status === "in_progress" ? "●" : "○"}
      </text>

      <text x={x + 17} y={y + rowH / 2}
        dominantBaseline="middle" fontSize="6" fontFamily={FONT} fontWeight="500" fill={c.text}>
        {truncName}
      </text>

      {dims && (
        <text x={x + w - (room.damageCount > 0 ? 18 : 6)} y={y + rowH / 2}
          textAnchor="end" dominantBaseline="middle"
          fontSize="4.5" fontFamily={MONO} fill={DIM}>
          {dims}
        </text>
      )}

      {room.damageCount > 0 && (
        <>
          <circle cx={x + w - 8} cy={y + rowH / 2} r={4} fill={DMG} opacity={0.85} />
          <text x={x + w - 8} y={y + rowH / 2 + 0.5} textAnchor="middle" dominantBaseline="middle"
            fontSize="4.5" fill="white" fontWeight="bold">{room.damageCount}</text>
        </>
      )}
    </g>
  );
}

function ExteriorSection({ rooms, svgW, yStart, currentRoomId, onRoomClick }: {
  rooms: RoomData[]; svgW: number; yStart: number; currentRoomId: number | null; onRoomClick?: (id: number) => void;
}) {
  const categories = [
    { label: "ROOF", filter: (r: RoomData) => r.roomType === "exterior_roof_slope" },
    { label: "ELEVATIONS", filter: (r: RoomData) => (r.roomType || "").startsWith("exterior_elevation_") },
    { label: "OTHER EXTERIOR", filter: (r: RoomData) => {
      const rt = r.roomType || "";
      return rt.startsWith("exterior_") && rt !== "exterior_roof_slope" && !rt.startsWith("exterior_elevation_");
    }},
  ];

  const rowH = 18;
  const gap = 3;
  const catGap = 8;
  let cy = yStart;
  const elements: React.ReactNode[] = [];

  for (const cat of categories) {
    const items = rooms.filter(cat.filter);
    if (items.length === 0) continue;

    elements.push(
      <g key={`cat-${cat.label}`}>
        <text x={8} y={cy + 8} fontSize="5.5" fontFamily={MONO} fontWeight="700" fill={MUTED}
          letterSpacing="0.6">{cat.label}</text>
        <text x={svgW - 8} y={cy + 8} textAnchor="end" fontSize="4.5" fontFamily={MONO} fill={DIM}>
          {items.length} {items.length === 1 ? "area" : "areas"}
        </text>
        <line x1={8} y1={cy + 11} x2={svgW - 8} y2={cy + 11} stroke="#E2E8F0" strokeWidth={0.3} />
      </g>
    );
    cy += 14;

    for (const room of items) {
      elements.push(
        <ExteriorRow key={room.id} room={room} x={8} y={cy} w={svgW - 16}
          active={room.id === currentRoomId} onRoomClick={onRoomClick} />
      );
      cy += rowH + gap;
    }

    cy += catGap;
  }

  return { elements, totalHeight: cy - yStart };
}

export default function FloorPlanSketch({ rooms, currentRoomId, onRoomClick, className, expanded }: FloorPlanSketchProps) {
  const structures = useMemo(() => groupByStructure(rooms), [rooms]);
  const svgW = expanded ? 520 : 260;
  const scale = expanded ? 4 : 3;

  const rendered = useMemo(() => {
    const parts: React.ReactNode[] = [];
    let y = 4;

    for (const group of structures) {
      if (structures.length > 1 || group.name !== "Main Dwelling") {
        parts.push(
          <g key={`hdr-${group.name}`}>
            <text x={svgW / 2} y={y + 10} textAnchor="middle" fontSize="7" fontFamily={FONT}
              fontWeight="700" fill={MUTED} letterSpacing="0.5">
              {group.name.toUpperCase()}
            </text>
            <line x1={8} y1={y + 14} x2={svgW - 8} y2={y + 14} stroke={MUTED} strokeWidth={0.4} />
          </g>
        );
        y += 20;
      }

      if (group.interior.length > 0) {
        const fpMargin = 14;
        const { totalW, totalH } = layoutRooms(group.interior, svgW - fpMargin * 2, scale);
        if (totalW > 0 && totalH > 0) {
          parts.push(
            <g key={`fp-${group.name}`} transform={`translate(0, ${y})`}>
              <FloorPlanSVG rooms={group.interior} svgW={svgW} scale={scale}
                currentRoomId={currentRoomId} onRoomClick={onRoomClick} />
            </g>
          );
          y += totalH + fpMargin * 2 + 20;
        }
      }

      if (group.exterior.length > 0) {
        const ext = ExteriorSection({
          rooms: group.exterior, svgW, yStart: 0,
          currentRoomId, onRoomClick
        });
        parts.push(
          <g key={`ext-${group.name}`} transform={`translate(0, ${y})`}>
            {ext.elements}
          </g>
        );
        y += ext.totalHeight + 6;
      }
    }

    return { parts, totalHeight: y + 4 };
  }, [structures, svgW, scale, currentRoomId, onRoomClick]);

  if (rooms.length === 0) {
    return (
      <div className={cn("bg-slate-50 rounded-lg border border-slate-200 p-4", className)}>
        <p className="text-[10px] uppercase tracking-widest text-slate-400 mb-2 font-mono">Property Sketch</p>
        <div className="h-24 flex items-center justify-center">
          <p className="text-xs text-slate-300">Rooms will appear as they're created during inspection</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("bg-white rounded-lg border border-slate-200 overflow-hidden", className)} data-testid="floor-plan-sketch">
      <div className="px-3 py-2 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono font-semibold">Property Sketch</p>
        <p className="text-[10px] text-slate-400 font-mono">
          {structures.length > 1 ? `${structures.length} structures · ` : ""}
          {rooms.length} area{rooms.length !== 1 ? "s" : ""}
        </p>
      </div>

      <svg
        viewBox={`0 0 ${svgW} ${rendered.totalHeight}`}
        className="w-full"
        style={expanded ? undefined : { maxHeight: 500 }}
      >
        <defs>
          <pattern id="sketchGrid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#F1F5F9" strokeWidth={0.3} />
          </pattern>
        </defs>
        <rect width={svgW} height={rendered.totalHeight} fill="url(#sketchGrid)" />
        {rendered.parts}
      </svg>
    </div>
  );
}
