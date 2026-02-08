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

const STATUS_STYLES = {
  complete: { fill: "rgba(34,197,94,0.08)", stroke: "#22C55E", text: "#166534", dash: "" },
  in_progress: { fill: "rgba(119,99,183,0.10)", stroke: "#7763B7", text: "#4C3D8F", dash: "" },
  not_started: { fill: "rgba(241,245,249,0.5)", stroke: "#94A3B8", text: "#64748B", dash: "4,2" },
};
const CURRENT_STROKE = "#C6A54E";
const WALL_COLOR = "#334155";
const DIM_COLOR = "#94A3B8";
const LABEL_COLOR = "#475569";
const HEADER_COLOR = "#64748B";
const SECTION_COLOR = "#94A3B8";
const DAMAGE_COLOR = "#EF4444";
const PHOTO_COLOR = "rgba(119,99,183,0.7)";

function getStyle(room: RoomData, isCurrent: boolean) {
  const s = STATUS_STYLES[room.status as keyof typeof STATUS_STYLES] || STATUS_STYLES.not_started;
  return {
    fill: s.fill,
    stroke: isCurrent ? CURRENT_STROKE : s.stroke,
    strokeWidth: isCurrent ? 2 : 1,
    dash: s.dash,
    text: isCurrent ? CURRENT_STROKE : s.text,
  };
}

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

function DimTick({ x1, y1, x2, y2, label, outside = 8 }: { x1: number; y1: number; x2: number; y2: number; label: string; outside?: number }) {
  const horiz = Math.abs(y2 - y1) < 2;
  const tick = 3;
  if (horiz) {
    const dy = y1 + outside;
    return (
      <g>
        <line x1={x1} y1={dy - tick} x2={x1} y2={dy + tick} stroke={DIM_COLOR} strokeWidth={0.4} />
        <line x1={x1} y1={dy} x2={x2} y2={dy} stroke={DIM_COLOR} strokeWidth={0.4} />
        <line x1={x2} y1={dy - tick} x2={x2} y2={dy + tick} stroke={DIM_COLOR} strokeWidth={0.4} />
        <text x={(x1 + x2) / 2} y={dy - 2} textAnchor="middle" fontSize="5" fontFamily={MONO} fill={DIM_COLOR}>{label}</text>
      </g>
    );
  }
  const dx = x1 + outside;
  return (
    <g>
      <line x1={dx - tick} y1={y1} x2={dx + tick} y2={y1} stroke={DIM_COLOR} strokeWidth={0.4} />
      <line x1={dx} y1={y1} x2={dx} y2={y2} stroke={DIM_COLOR} strokeWidth={0.4} />
      <line x1={dx - tick} y1={y2} x2={dx + tick} y2={y2} stroke={DIM_COLOR} strokeWidth={0.4} />
      <text x={dx + 3} y={(y1 + y2) / 2} textAnchor="start" dominantBaseline="middle" fontSize="5" fontFamily={MONO} fill={DIM_COLOR}>{label}</text>
    </g>
  );
}

interface StructureGroup {
  name: string;
  interior: RoomData[];
  roofSlopes: RoomData[];
  elevations: RoomData[];
  otherExterior: RoomData[];
}

function categorizeRooms(rooms: RoomData[]): StructureGroup[] {
  const map: Record<string, StructureGroup> = {};
  for (const r of rooms) {
    const s = r.structure || "Main Dwelling";
    if (!map[s]) map[s] = { name: s, interior: [], roofSlopes: [], elevations: [], otherExterior: [] };
    const rt = r.roomType || "";
    if (rt.startsWith("exterior_elevation_")) map[s].elevations.push(r);
    else if (rt === "exterior_roof_slope") map[s].roofSlopes.push(r);
    else if (rt.startsWith("exterior_")) map[s].otherExterior.push(r);
    else map[s].interior.push(r);
  }
  return Object.values(map);
}

function FloorPlanSection({ rooms, svgW, scale, currentRoomId, onRoomClick }: {
  rooms: RoomData[]; svgW: number; scale: number; currentRoomId: number | null; onRoomClick?: (id: number) => void;
}) {
  const minW = 44;
  const minH = 32;
  const wallT = 2.5;
  const margin = 14;
  const usable = svgW - margin * 2;

  const sized = rooms.map(r => {
    const d = r.dimensions as any;
    const w = d?.length ? Math.max(d.length * scale, minW) : minW + 8;
    const h = d?.width ? Math.max(d.width * scale, minH) : minH;
    return { room: r, w, h };
  });

  const laid: Array<{ room: RoomData; x: number; y: number; w: number; h: number }> = [];
  let cx = 0, cy = 0, rowH = 0;

  for (const { room, w, h } of sized) {
    if (cx + w > usable && cx > 0) {
      cx = 0;
      cy += rowH;
      rowH = 0;
    }
    laid.push({ room, x: cx, y: cy, w, h });
    cx += w;
    rowH = Math.max(rowH, h);
  }

  const totalW = Math.max(...laid.map(l => l.x + l.w));
  const totalH = cy + rowH;
  const offsetX = (svgW - totalW) / 2;
  const sectionH = totalH + margin + 10;

  return {
    height: sectionH,
    render: (yOff: number) => (
      <g key="floorplan" transform={`translate(0, ${yOff})`}>
        <text x={8} y={9} fontSize="6" fontFamily={MONO} fontWeight="700" fill={SECTION_COLOR} letterSpacing="0.8">FLOOR PLAN</text>
        <text x={svgW - 8} y={9} textAnchor="end" fontSize="5" fontFamily={MONO} fill={SECTION_COLOR} opacity={0.6}>{rooms.length} rooms</text>
        <line x1={8} y1={12} x2={svgW - 8} y2={12} stroke={SECTION_COLOR} strokeWidth={0.3} />

        <g transform={`translate(${offsetX}, 16)`}>
          <rect x={-wallT} y={-wallT} width={totalW + wallT * 2} height={totalH + wallT * 2}
            fill="none" stroke={WALL_COLOR} strokeWidth={wallT} />

          {laid.map(({ room, x, y, w, h }, i) => {
            const isCurrent = room.id === currentRoomId;
            const st = getStyle(room, isCurrent);
            const dims = room.dimensions as any;
            const name = room.name.length > 14 ? room.name.substring(0, 13) + "…" : room.name;
            const hasDims = dims?.length && dims?.width;

            return (
              <g key={room.id} onClick={() => onRoomClick?.(room.id)} style={{ cursor: onRoomClick ? "pointer" : "default" }}>
                <rect x={x} y={y} width={w} height={h}
                  fill={st.fill} stroke={st.stroke} strokeWidth={st.strokeWidth}
                  strokeDasharray={st.dash || undefined} />

                {i > 0 && x > 0 && laid[i - 1]?.y === y && (
                  <g>
                    <rect x={x - 1} y={y + h / 2 - 4} width={2} height={8} fill="white" />
                    <line x1={x} y1={y + h / 2 - 4} x2={x} y2={y + h / 2 + 4}
                      stroke={WALL_COLOR} strokeWidth={0.4} strokeDasharray="1.5,1" />
                  </g>
                )}

                <text x={x + w / 2} y={y + h / 2 - (hasDims ? 4 : 0)}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize="6.5" fontFamily={FONT} fontWeight="600" fill={st.text}>
                  {name}
                </text>

                {hasDims && (
                  <text x={x + w / 2} y={y + h / 2 + 5}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize="5" fontFamily={MONO} fill={DIM_COLOR}>
                    {dims.length}' × {dims.width}'
                  </text>
                )}

                <Badges room={room} x={x} y={y} w={w} />
              </g>
            );
          })}

          {laid.length > 0 && laid[0].room.dimensions && (
            <DimTick x1={0} y1={totalH} x2={totalW} y2={totalH}
              label={`${Math.round(totalW / scale)}'`} outside={10} />
          )}
        </g>
      </g>
    ),
  };
}

function RoofPlanSection({ slopes, svgW, currentRoomId, onRoomClick }: {
  slopes: RoomData[]; svgW: number; currentRoomId: number | null; onRoomClick?: (id: number) => void;
}) {
  const pw = Math.min(svgW * 0.6, 180);
  const ph = pw * 0.6;
  const ox = (svgW - pw) / 2;
  const sectionH = ph + 32;

  const quadrants: Record<string, { x: number; y: number; anchor: "start" | "middle" | "end" }> = {
    north: { x: pw / 2, y: 10, anchor: "middle" },
    south: { x: pw / 2, y: ph - 6, anchor: "middle" },
    east: { x: pw - 8, y: ph / 2, anchor: "end" },
    west: { x: 8, y: ph / 2, anchor: "start" },
    front: { x: pw / 2, y: ph - 6, anchor: "middle" },
    rear: { x: pw / 2, y: 10, anchor: "middle" },
    left: { x: 8, y: ph / 2, anchor: "start" },
    right: { x: pw - 8, y: ph / 2, anchor: "end" },
  };

  function getSlopePosition(room: RoomData, idx: number) {
    const n = room.name.toLowerCase();
    for (const [key, pos] of Object.entries(quadrants)) {
      if (n.includes(key)) return pos;
    }
    const fallback = [quadrants.north, quadrants.east, quadrants.south, quadrants.west];
    return fallback[idx % 4];
  }

  return {
    height: sectionH,
    render: (yOff: number) => (
      <g key="roofplan" transform={`translate(0, ${yOff})`}>
        <text x={8} y={9} fontSize="6" fontFamily={MONO} fontWeight="700" fill={SECTION_COLOR} letterSpacing="0.8">ROOF PLAN</text>
        <text x={svgW - 8} y={9} textAnchor="end" fontSize="5" fontFamily={MONO} fill={SECTION_COLOR} opacity={0.6}>{slopes.length} slopes</text>
        <line x1={8} y1={12} x2={svgW - 8} y2={12} stroke={SECTION_COLOR} strokeWidth={0.3} />

        <g transform={`translate(${ox}, 16)`}>
          <rect x={0} y={0} width={pw} height={ph}
            fill="rgba(120,53,15,0.03)" stroke="#92400E" strokeWidth={1} />

          <line x1={pw * 0.2} y1={ph / 2} x2={pw * 0.8} y2={ph / 2}
            stroke="#B45309" strokeWidth={1.5} />
          <text x={pw / 2} y={ph / 2 - 4} textAnchor="middle" fontSize="5" fontFamily={MONO} fill="#B45309">RIDGE</text>

          <line x1={0} y1={0} x2={pw * 0.2} y2={ph / 2} stroke="#92400E" strokeWidth={0.5} strokeDasharray="3,2" />
          <line x1={pw} y1={0} x2={pw * 0.8} y2={ph / 2} stroke="#92400E" strokeWidth={0.5} strokeDasharray="3,2" />
          <line x1={0} y1={ph} x2={pw * 0.2} y2={ph / 2} stroke="#92400E" strokeWidth={0.5} strokeDasharray="3,2" />
          <line x1={pw} y1={ph} x2={pw * 0.8} y2={ph / 2} stroke="#92400E" strokeWidth={0.5} strokeDasharray="3,2" />

          {slopes.map((slope, i) => {
            const pos = getSlopePosition(slope, i);
            const isCurrent = slope.id === currentRoomId;
            const label = slope.name.length > 14 ? slope.name.substring(0, 13) + "…" : slope.name;
            const dims = slope.dimensions as any;

            return (
              <g key={slope.id} onClick={() => onRoomClick?.(slope.id)} style={{ cursor: onRoomClick ? "pointer" : "default" }}>
                <text x={pos.x} y={pos.y} textAnchor={pos.anchor}
                  fontSize="6" fontFamily={FONT} fontWeight="600"
                  fill={isCurrent ? CURRENT_STROKE : LABEL_COLOR}>
                  {label}
                </text>
                <text x={pos.x} y={pos.y + 8} textAnchor={pos.anchor}
                  fontSize="4.5" fontFamily={MONO} fill={DIM_COLOR}>
                  {dims?.pitch ? `${dims.pitch}/12 pitch` : dims?.length && dims?.width ? `${dims.length}' × ${dims.width}'` : "slope"}
                </text>
                {slope.damageCount > 0 && (
                  <>
                    <circle cx={pos.x + (pos.anchor === "start" ? 50 : pos.anchor === "end" ? -50 : 35)} cy={pos.y - 3} r={4} fill={DAMAGE_COLOR} opacity={0.9} />
                    <text x={pos.x + (pos.anchor === "start" ? 50 : pos.anchor === "end" ? -50 : 35)} y={pos.y - 2.5} textAnchor="middle" dominantBaseline="middle" fontSize="4.5" fill="white" fontWeight="bold">{slope.damageCount}</text>
                  </>
                )}
              </g>
            );
          })}
        </g>
      </g>
    ),
  };
}

function ElevationsSection({ elevations, svgW, expanded, currentRoomId, onRoomClick }: {
  elevations: RoomData[]; svgW: number; expanded: boolean; currentRoomId: number | null; onRoomClick?: (id: number) => void;
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
          const label = elev.name.length > 16 ? elev.name.substring(0, 15) + "…" : elev.name;

          const wallH = itemH * 0.5;
          const roofH = itemH * 0.28;
          const groundY = ey + itemH;
          const wallTop = groundY - wallH;
          const wallLeft = ex + itemW * 0.1;
          const wallRight = ex + itemW * 0.9;
          const wallW = wallRight - wallLeft;

          const rt = elev.roomType || elev.name.toLowerCase();
          const isFrontRear = rt.includes("front") || rt.includes("rear");

          return (
            <g key={elev.id} onClick={() => onRoomClick?.(elev.id)} style={{ cursor: onRoomClick ? "pointer" : "default" }}>
              <text x={ex + itemW / 2} y={ey + 7} textAnchor="middle"
                fontSize="6" fontFamily={FONT} fontWeight="600" fill={st.text}>
                {label}
              </text>

              <line x1={ex} y1={groundY} x2={ex + itemW} y2={groundY}
                stroke="#78716C" strokeWidth={1} />

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

function OtherExteriorSection({ items, svgW, expanded, currentRoomId, onRoomClick }: {
  items: RoomData[]; svgW: number; expanded: boolean; currentRoomId: number | null; onRoomClick?: (id: number) => void;
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
          const label = item.name.length > 14 ? item.name.substring(0, 13) + "…" : item.name;

          return (
            <g key={item.id} onClick={() => onRoomClick?.(item.id)} style={{ cursor: onRoomClick ? "pointer" : "default" }}>
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
                  {dims.length}'{dims.width ? ` × ${dims.width}'` : " LF"}
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

export default function FloorPlanSketch({ rooms, currentRoomId, onRoomClick, className, expanded }: FloorPlanSketchProps) {
  const structures = useMemo(() => categorizeRooms(rooms), [rooms]);
  const svgW = expanded ? 520 : 260;
  const scale = expanded ? 4 : 3;

  const layout = useMemo(() => {
    const sections: Array<{ height: number; render: (y: number) => React.ReactNode }> = [];
    let y = 6;

    for (const group of structures) {
      if (structures.length > 1 || group.name !== "Main Dwelling") {
        const headerY = y;
        sections.push({
          height: 16,
          render: (yOff: number) => (
            <g key={`hdr-${group.name}`} transform={`translate(0, ${yOff})`}>
              <text x={svgW / 2} y={10} textAnchor="middle" fontSize="7" fontFamily={FONT}
                fontWeight="700" fill={HEADER_COLOR} letterSpacing="0.5">
                {group.name.toUpperCase()}
              </text>
              <line x1={8} y1={14} x2={svgW - 8} y2={14} stroke={HEADER_COLOR} strokeWidth={0.5} />
            </g>
          ),
        });
        y += 16;
      }

      if (group.interior.length > 0) {
        const sec = FloorPlanSection({ rooms: group.interior, svgW, scale, currentRoomId, onRoomClick });
        sections.push(sec);
        y += sec.height + 6;
      }

      if (group.roofSlopes.length > 0) {
        const sec = RoofPlanSection({ slopes: group.roofSlopes, svgW, currentRoomId, onRoomClick });
        sections.push(sec);
        y += sec.height + 6;
      }

      if (group.elevations.length > 0) {
        const sec = ElevationsSection({ elevations: group.elevations, svgW, expanded: !!expanded, currentRoomId, onRoomClick });
        sections.push(sec);
        y += sec.height + 6;
      }

      if (group.otherExterior.length > 0) {
        const sec = OtherExteriorSection({ items: group.otherExterior, svgW, expanded: !!expanded, currentRoomId, onRoomClick });
        sections.push(sec);
        y += sec.height + 6;
      }
    }

    return { sections, totalHeight: y + 4 };
  }, [structures, svgW, scale, currentRoomId, onRoomClick, expanded]);

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

  let runningY = 0;

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
        viewBox={`0 0 ${svgW} ${layout.totalHeight}`}
        className="w-full"
        style={expanded ? undefined : { maxHeight: 500 }}
      >
        <defs>
          <pattern id="sketchGrid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#F1F5F9" strokeWidth={0.3} />
          </pattern>
        </defs>
        <rect width={svgW} height={layout.totalHeight} fill="url(#sketchGrid)" />

        {layout.sections.map((sec, i) => {
          const thisY = runningY;
          runningY += sec.height + 6;
          return sec.render(thisY);
        })}
      </svg>
    </div>
  );
}
