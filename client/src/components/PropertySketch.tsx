import React, { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";

/* ─── Types ─── */

interface RoomData {
  id: number;
  name: string;
  status: string;
  damageCount: number;
  photoCount: number;
  roomType?: string;
  dimensions?: { length?: number; width?: number; height?: number };
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
  label?: string;
  opensInto?: string;
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
  className?: string;
  expanded?: boolean;
}

/* ─── Constants ─── */

const FONT = "Work Sans, sans-serif";
const MONO = "Space Mono, monospace";
const WALL_COLOR = "#334155";
const WALL_THICK = 2.5;
const DIM_COLOR = "#94A3B8";
const DAMAGE_COLOR = "#EF4444";
const PHOTO_COLOR = "rgba(119,99,183,0.7)";
const SECTION_COLOR = "#94A3B8";
const CURRENT_STROKE = "#C6A54E";
const ANNOTATION_COLOR = "#D97706";

const STATUS_STYLES = {
  complete: { fill: "rgba(34,197,94,0.08)", stroke: "#22C55E", text: "#166534", dash: "" },
  completed: { fill: "rgba(34,197,94,0.08)", stroke: "#22C55E", text: "#166534", dash: "" },
  in_progress: { fill: "rgba(119,99,183,0.10)", stroke: "#7763B7", text: "#4C3D8F", dash: "" },
  not_started: { fill: "rgba(241,245,249,0.5)", stroke: "#94A3B8", text: "#64748B", dash: "4,2" },
};

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

function truncate(text: string, max: number) {
  return text.length > max ? text.substring(0, max - 1) + "\u2026" : text;
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

/* ─── Opening rendering on walls ─── */

function WallOpenings({ openings, x, y, w, h }: { openings: Opening[]; x: number; y: number; w: number; h: number }) {
  if (!openings || openings.length === 0) return null;

  return (
    <>
      {openings.map((op) => {
        const scale = 3;
        const opW = Math.min(op.width * scale, w * 0.4);
        const isHoriz = op.wallIndex === 0 || op.wallIndex === 2;
        const isDoor = op.openingType === "door" || op.openingType === "french_door" || op.openingType === "sliding_door";
        const pos = op.positionOnWall ?? 0.5;

        let ox: number, oy: number, ow: number, oh: number;

        if (isHoriz) {
          ow = opW;
          oh = 3;
          ox = x + (w - opW) * pos;
          oy = op.wallIndex === 0 ? y - 1.5 : y + h - 1.5;
        } else {
          ow = 3;
          oh = opW;
          ox = op.wallIndex === 3 ? x - 1.5 : x + w - 1.5;
          oy = y + (h - opW) * pos;
        }

        return (
          <g key={op.id}>
            <rect x={ox} y={oy} width={ow} height={oh} fill="white" stroke="none" />
            {isDoor ? (
              <line
                x1={isHoriz ? ox : ox + ow / 2}
                y1={isHoriz ? oy + oh / 2 : oy}
                x2={isHoriz ? ox + ow : ox + ow / 2}
                y2={isHoriz ? oy + oh / 2 : oy + oh}
                stroke={WALL_COLOR} strokeWidth={0.5} strokeDasharray="2,1"
              />
            ) : (
              <>
                <line
                  x1={isHoriz ? ox + 1 : ox + ow / 2}
                  y1={isHoriz ? oy + oh / 2 : oy + 1}
                  x2={isHoriz ? ox + ow - 1 : ox + ow / 2}
                  y2={isHoriz ? oy + oh / 2 : oy + oh - 1}
                  stroke={WALL_COLOR} strokeWidth={0.8}
                />
                <line
                  x1={isHoriz ? ox + 1 : ox + 1}
                  y1={isHoriz ? oy + 1 : oy + 1}
                  x2={isHoriz ? ox + ow - 1 : ox + ow - 1}
                  y2={isHoriz ? oy + oh - 1 : oy + oh - 1}
                  stroke={WALL_COLOR} strokeWidth={0.4}
                />
              </>
            )}
          </g>
        );
      })}
    </>
  );
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

/* ─── Sub-area rendering ─── */

function SubAreaBlock({ sub, parentX, parentY, parentW, parentH, idx, currentRoomId, onRoomClick }: {
  sub: RoomData; parentX: number; parentY: number; parentW: number; parentH: number; idx: number;
  currentRoomId: number | null; onRoomClick?: (id: number) => void;
}) {
  const isCurrent = sub.id === currentRoomId;
  const st = getStyle(sub, isCurrent);
  const dims = sub.dimensions as any;
  const sw = dims?.length ? Math.max(dims.length * 3, 24) : 24;
  const sh = dims?.width ? Math.max(dims.width * 3, 16) : 16;

  // Position sub-areas along the right side of the parent, stacked vertically
  const sx = parentX + parentW;
  const sy = parentY + idx * (sh + 4);

  return (
    <g onClick={() => onRoomClick?.(sub.id)} style={{ cursor: onRoomClick ? "pointer" : "default" }}>
      {/* Connection line to parent */}
      <line x1={parentX + parentW} y1={sy + sh / 2} x2={sx} y2={sy + sh / 2}
        stroke={st.stroke} strokeWidth={0.5} strokeDasharray="2,1" />

      <rect x={sx} y={sy} width={sw} height={sh}
        fill={st.fill} stroke={st.stroke} strokeWidth={st.strokeWidth}
        strokeDasharray={st.dash || undefined} />

      <text x={sx + sw / 2} y={sy + sh / 2 - 1}
        textAnchor="middle" dominantBaseline="middle"
        fontSize="5" fontFamily={FONT} fontWeight="500" fill={st.text}>
        {truncate(sub.name, 12)}
      </text>

      {sub.attachmentType && (
        <text x={sx + sw / 2} y={sy + sh / 2 + 5}
          textAnchor="middle" dominantBaseline="middle"
          fontSize="3.5" fontFamily={MONO} fill={DIM_COLOR}>
          {sub.attachmentType}
        </text>
      )}
    </g>
  );
}

/* ─── Interior Floor Plan Section ─── */

function InteriorSection({ rooms, svgW, scale, currentRoomId, onRoomClick }: {
  rooms: HierarchyRoom[]; svgW: number; scale: number; currentRoomId: number | null; onRoomClick?: (id: number) => void;
}) {
  const minW = 44;
  const minH = 32;
  const margin = 14;
  const usable = svgW - margin * 2;
  const subAreaExtra = 30; // extra space for sub-areas on the right

  const sized = rooms.map(r => {
    const d = r.dimensions as any;
    const hasSubs = (r.subAreas?.length || 0) > 0;
    const w = d?.length ? Math.max(d.length * scale, minW) : minW + 8;
    const h = d?.width ? Math.max(d.width * scale, minH) : minH;
    return { room: r, w: w + (hasSubs ? subAreaExtra : 0), baseW: w, h };
  });

  const laid: Array<{ room: HierarchyRoom; x: number; y: number; w: number; baseW: number; h: number }> = [];
  let cx = 0, cy = 0, rowH = 0;

  for (const { room, w, baseW, h } of sized) {
    if (cx + w > usable && cx > 0) {
      cx = 0;
      cy += rowH + 4;
      rowH = 0;
    }
    laid.push({ room, x: cx, y: cy, w, baseW, h });
    cx += w + 2;
    rowH = Math.max(rowH, h);
  }

  if (laid.length === 0) return { height: 0, render: () => null };

  const totalW = Math.max(...laid.map(l => l.x + l.w));
  const totalH = cy + rowH;
  const offsetX = (svgW - totalW) / 2;
  const sectionH = totalH + 28;

  return {
    height: sectionH,
    render: (yOff: number) => (
      <g key="interior" transform={`translate(0, ${yOff})`}>
        <text x={8} y={9} fontSize="6" fontFamily={MONO} fontWeight="700" fill={SECTION_COLOR} letterSpacing="0.8">INTERIOR</text>
        <text x={svgW - 8} y={9} textAnchor="end" fontSize="5" fontFamily={MONO} fill={SECTION_COLOR} opacity={0.6}>{rooms.length} rooms</text>
        <line x1={8} y1={12} x2={svgW - 8} y2={12} stroke={SECTION_COLOR} strokeWidth={0.3} />

        <g transform={`translate(${offsetX}, 16)`}>
          {/* Outer wall */}
          <rect x={-WALL_THICK} y={-WALL_THICK} width={totalW + WALL_THICK * 2} height={totalH + WALL_THICK * 2}
            fill="none" stroke={WALL_COLOR} strokeWidth={WALL_THICK} />

          {laid.map(({ room, x, y, baseW, h }) => {
            const isCurrent = room.id === currentRoomId;
            const st = getStyle(room, isCurrent);
            const dims = room.dimensions as any;
            const name = truncate(room.name, 14);
            const hasDims = dims?.length && dims?.width;

            return (
              <g key={room.id}>
                {/* Room rectangle */}
                <g onClick={() => onRoomClick?.(room.id)} style={{ cursor: onRoomClick ? "pointer" : "default" }}>
                  <rect x={x} y={y} width={baseW} height={h}
                    fill={st.fill} stroke={st.stroke} strokeWidth={st.strokeWidth}
                    strokeDasharray={st.dash || undefined} />

                  <text x={x + baseW / 2} y={y + h / 2 - (hasDims ? 4 : 0)}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize="6.5" fontFamily={FONT} fontWeight="600" fill={st.text}>
                    {name}
                  </text>

                  {hasDims && (
                    <text x={x + baseW / 2} y={y + h / 2 + 5}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize="5" fontFamily={MONO} fill={DIM_COLOR}>
                      {dims.length}' \u00D7 {dims.width}'
                    </text>
                  )}

                  <Badges room={room} x={x} y={y} w={baseW} />
                </g>

                {/* Openings on walls */}
                <WallOpenings openings={room.openings || []} x={x} y={y} w={baseW} h={h} />

                {/* Annotations */}
                <AnnotationMarkers annotations={room.annotations || []} x={x} y={y} w={baseW} h={h} />

                {/* Sub-areas */}
                {room.subAreas?.map((sub, si) => (
                  <SubAreaBlock key={sub.id} sub={sub} parentX={x} parentY={y} parentW={baseW} parentH={h}
                    idx={si} currentRoomId={currentRoomId} onRoomClick={onRoomClick} />
                ))}
              </g>
            );
          })}
        </g>
      </g>
    ),
  };
}

/* ─── Roof Plan Section ─── */

function RoofPlanSection({ slopes, svgW, currentRoomId, onRoomClick }: {
  slopes: HierarchyRoom[]; svgW: number; currentRoomId: number | null; onRoomClick?: (id: number) => void;
}) {
  const pw = Math.min(svgW * 0.6, 180);
  const ph = pw * 0.6;
  const ox = (svgW - pw) / 2;
  const sectionH = ph + 32;

  const quadrants: Record<string, { x: number; y: number; anchor: "start" | "middle" | "end" }> = {
    north: { x: pw / 2, y: 12, anchor: "middle" },
    south: { x: pw / 2, y: ph - 8, anchor: "middle" },
    east: { x: pw - 10, y: ph / 2, anchor: "end" },
    west: { x: 10, y: ph / 2, anchor: "start" },
    front: { x: pw / 2, y: ph - 8, anchor: "middle" },
    rear: { x: pw / 2, y: 12, anchor: "middle" },
    left: { x: 10, y: ph / 2, anchor: "start" },
    right: { x: pw - 10, y: ph / 2, anchor: "end" },
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
        <text x={svgW - 8} y={9} textAnchor="end" fontSize="5" fontFamily={MONO} fill={SECTION_COLOR} opacity={0.6}>{slopes.length} facets</text>
        <line x1={8} y1={12} x2={svgW - 8} y2={12} stroke={SECTION_COLOR} strokeWidth={0.3} />

        <g transform={`translate(${ox}, 16)`}>
          {/* Roof outline */}
          <rect x={0} y={0} width={pw} height={ph}
            fill="rgba(120,53,15,0.03)" stroke="#92400E" strokeWidth={1} />

          {/* Ridge line */}
          <line x1={pw * 0.2} y1={ph / 2} x2={pw * 0.8} y2={ph / 2}
            stroke="#B45309" strokeWidth={1.5} />
          <text x={pw / 2} y={ph / 2 - 4} textAnchor="middle" fontSize="5" fontFamily={MONO} fill="#B45309">RIDGE</text>

          {/* Hip/valley lines */}
          <line x1={0} y1={0} x2={pw * 0.2} y2={ph / 2} stroke="#92400E" strokeWidth={0.5} strokeDasharray="3,2" />
          <line x1={pw} y1={0} x2={pw * 0.8} y2={ph / 2} stroke="#92400E" strokeWidth={0.5} strokeDasharray="3,2" />
          <line x1={0} y1={ph} x2={pw * 0.2} y2={ph / 2} stroke="#92400E" strokeWidth={0.5} strokeDasharray="3,2" />
          <line x1={pw} y1={ph} x2={pw * 0.8} y2={ph / 2} stroke="#92400E" strokeWidth={0.5} strokeDasharray="3,2" />

          {slopes.map((slope, i) => {
            const pos = getSlopePosition(slope, i);
            const isCurrent = slope.id === currentRoomId;
            const label = truncate(slope.name, 14);
            const pitchText = slope.pitch ? `${slope.pitch} pitch` : "";
            const facetText = slope.facetLabel || "";
            const subText = [facetText, pitchText].filter(Boolean).join(" \u2022 ") || "slope";

            return (
              <g key={slope.id} onClick={() => onRoomClick?.(slope.id)} style={{ cursor: onRoomClick ? "pointer" : "default" }}>
                <text x={pos.x} y={pos.y} textAnchor={pos.anchor}
                  fontSize="6" fontFamily={FONT} fontWeight="600"
                  fill={isCurrent ? CURRENT_STROKE : "#475569"}>
                  {label}
                </text>
                <text x={pos.x} y={pos.y + 8} textAnchor={pos.anchor}
                  fontSize="4.5" fontFamily={MONO} fill={DIM_COLOR}>
                  {subText}
                </text>

                {/* Damage badge */}
                {slope.damageCount > 0 && (
                  <>
                    <circle cx={pos.x + (pos.anchor === "start" ? 50 : pos.anchor === "end" ? -50 : 35)} cy={pos.y - 3} r={4} fill={DAMAGE_COLOR} opacity={0.9} />
                    <text x={pos.x + (pos.anchor === "start" ? 50 : pos.anchor === "end" ? -50 : 35)} y={pos.y - 2.5} textAnchor="middle" dominantBaseline="middle" fontSize="4.5" fill="white" fontWeight="bold">{slope.damageCount}</text>
                  </>
                )}

                {/* Annotations (hail count, pitch) */}
                {(slope as HierarchyRoom).annotations?.slice(0, 2).map((ann, ai) => (
                  <text key={ann.id}
                    x={pos.x} y={pos.y + 16 + ai * 8}
                    textAnchor={pos.anchor}
                    fontSize="4.5" fontFamily={MONO} fill={ANNOTATION_COLOR} fontWeight="600">
                    {ann.label}: {ann.value}
                  </text>
                ))}
              </g>
            );
          })}
        </g>
      </g>
    ),
  };
}

/* ─── Elevations Section ─── */

function ElevationsSection({ elevations, svgW, expanded, currentRoomId, onRoomClick }: {
  elevations: HierarchyRoom[]; svgW: number; expanded: boolean; currentRoomId: number | null; onRoomClick?: (id: number) => void;
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
            <g key={elev.id} onClick={() => onRoomClick?.(elev.id)} style={{ cursor: onRoomClick ? "pointer" : "default" }}>
              <text x={ex + itemW / 2} y={ey + 7} textAnchor="middle"
                fontSize="6" fontFamily={FONT} fontWeight="600" fill={st.text}>
                {label}
              </text>

              {/* Ground line */}
              <line x1={ex} y1={groundY} x2={ex + itemW} y2={groundY} stroke="#78716C" strokeWidth={1} />

              {/* Wall */}
              <rect x={wallLeft} y={wallTop} width={wallW} height={wallH}
                fill={st.fill} stroke={st.stroke} strokeWidth={st.strokeWidth}
                strokeDasharray={st.dash || undefined} />

              {/* Roof */}
              {isFrontRear ? (
                <polygon
                  points={`${wallLeft},${wallTop} ${wallLeft + wallW / 2},${wallTop - roofH} ${wallRight},${wallTop}`}
                  fill="rgba(120,53,15,0.04)" stroke={st.stroke} strokeWidth={0.8} strokeLinejoin="round" />
              ) : (
                <polygon
                  points={`${wallLeft},${wallTop} ${wallLeft + wallW * 0.15},${wallTop - roofH} ${wallRight - wallW * 0.15},${wallTop - roofH} ${wallRight},${wallTop}`}
                  fill="rgba(120,53,15,0.04)" stroke={st.stroke} strokeWidth={0.8} strokeLinejoin="round" />
              )}

              {/* Openings on elevation wall */}
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

              {/* Dimension labels */}
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

function OtherExteriorSection({ items, svgW, expanded, currentRoomId, onRoomClick }: {
  items: HierarchyRoom[]; svgW: number; expanded: boolean; currentRoomId: number | null; onRoomClick?: (id: number) => void;
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
    // Skip sub-areas — they'll be rendered as children of their parent
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

export default function PropertySketch({ sessionId, rooms, currentRoomId, onRoomClick, className, expanded }: PropertySketchProps) {
  const [activeStructure, setActiveStructure] = useState<string | null>(null);

  // Fetch hierarchy data for rich rendering (openings, annotations, sub-areas)
  const { data: hierarchyData } = useQuery<{ structures: StructureData[] }>({
    queryKey: [`/api/inspection/${sessionId}/hierarchy`],
    enabled: !!sessionId,
    refetchInterval: 10000,
  });

  // Build structure list from hierarchy data, or fall back to room data
  const structures = useMemo(() => {
    if (hierarchyData?.structures && hierarchyData.structures.length > 0) {
      return hierarchyData.structures;
    }

    // Fallback: group rooms by structure name
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

  // Determine which structure to display
  const currentStructureName = activeStructure || structures[0]?.name || "Main Dwelling";
  const currentStructureData = structures.find(s => s.name === currentStructureName) || structures[0];
  const structureRooms = currentStructureData?.rooms || [];

  // Categorize rooms for the current structure
  const categories = useMemo(() => categorizeRooms(structureRooms), [structureRooms]);

  const svgW = expanded ? 520 : 260;
  const scale = expanded ? 4 : 3;

  const layout = useMemo(() => {
    const sections: Array<{ height: number; render: (y: number) => React.ReactNode }> = [];

    if (categories.interior.length > 0) {
      const sec = InteriorSection({ rooms: categories.interior, svgW, scale, currentRoomId, onRoomClick });
      sections.push(sec);
    }

    if (categories.roofSlopes.length > 0) {
      const sec = RoofPlanSection({ slopes: categories.roofSlopes, svgW, currentRoomId, onRoomClick });
      sections.push(sec);
    }

    if (categories.elevations.length > 0) {
      const sec = ElevationsSection({ elevations: categories.elevations, svgW, expanded: !!expanded, currentRoomId, onRoomClick });
      sections.push(sec);
    }

    if (categories.otherExterior.length > 0) {
      const sec = OtherExteriorSection({ items: categories.otherExterior, svgW, expanded: !!expanded, currentRoomId, onRoomClick });
      sections.push(sec);
    }

    let totalH = 6;
    for (const sec of sections) {
      totalH += sec.height + 6;
    }

    return { sections, totalHeight: totalH + 4 };
  }, [categories, svgW, scale, currentRoomId, onRoomClick, expanded]);

  // Compute total rooms across all structures
  const totalRooms = structures.reduce((sum, s) => sum + s.rooms.length, 0);

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
      {/* Header with structure tabs */}
      <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/50">
        <div className="flex justify-between items-center mb-1">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono font-semibold">Property Sketch</p>
          <p className="text-[10px] text-slate-400 font-mono">
            {structures.length > 1 ? `${structures.length} structures \u00B7 ` : ""}
            {totalRooms} area{totalRooms !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Structure tabs */}
        {structures.length > 1 && (
          <div className="flex gap-1 mt-1.5 overflow-x-auto">
            {structures.map((s) => (
              <button
                key={s.name}
                onClick={() => setActiveStructure(s.name)}
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

      {/* SVG Sketch */}
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

        {layout.sections.map((sec) => {
          const thisY = runningY;
          runningY += sec.height + 6;
          return sec.render(thisY);
        })}
      </svg>
    </div>
  );
}
