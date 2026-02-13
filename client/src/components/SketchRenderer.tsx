/**
 * Pure rendering component for interior floor plan.
 * Receives roomRects, openings, annotations, selection state.
 * No side effects, no mutation, minimal event handlers (only pass-through).
 */
import React from "react";

const FONT = "Work Sans, sans-serif";
const MONO = "Space Mono, monospace";
const WALL_COLOR = "#334155";
const WALL_THICK = 3;
const WINDOW_COLOR = "#60A5FA";
const DAMAGE_COLOR = "#EF4444";
const SELECT_STROKE = "#C6A54E";
const HANDLE_COLOR = "#6366F1";
const HIT_PADDING = 12;

export interface LayoutRect {
  roomId: number;
  x: number;
  y: number;
  w: number;
  h: number;
  room: { id: number; name: string; status: string; dimensions?: any };
}

export interface OpeningData {
  id: number;
  roomId: number;
  openingType: string;
  wallDirection?: string | null;
  positionOnWall?: number;
  widthFt?: number | null;
  width?: number;
  heightFt?: number | null;
  height?: number;
}

export interface AnnotationData {
  id: number;
  roomId: number;
  annotationType: string;
  label: string;
  value?: string | null;
  position?: { x?: number; y?: number } | null;
}

export interface SelectionState {
  selectedRoomId: number | null;
  selectedOpeningId: number | null;
  selectedAnnotationId: number | null;
}

export interface GhostPreview {
  x: number;
  y: number;
  w: number;
  h: number;
  wall: "north" | "south" | "east" | "west";
}

type WallSide = "north" | "south" | "east" | "west";

function getOpeningWallSide(opening: OpeningData): WallSide {
  const d = (opening.wallDirection || "").toLowerCase();
  if (d === "north" || d === "rear") return "north";
  if (d === "south" || d === "front") return "south";
  if (d === "east" || d === "right") return "east";
  if (d === "west" || d === "left") return "west";
  return "north";
}

function ArchOpeningSymbol({
  opening,
  wallSide,
  wallLen,
  roomX,
  roomY,
  roomW,
  roomH,
  isSelected,
  onPointerDown,
}: {
  opening: OpeningData;
  wallSide: WallSide;
  wallLen: number;
  roomX: number;
  roomY: number;
  roomW: number;
  roomH: number;
  isSelected?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
}) {
  const openW = opening.widthFt ?? opening.width ?? 3;
  const pxPerFt = wallSide === "north" || wallSide === "south" ? roomW / (wallLen || 1) : roomH / (wallLen || 1);
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

  const hitW = Math.max(gapPx, 20);
  const hitH = Math.max(WALL_THICK + HIT_PADDING, 24);

  const common = (
    <g
      onPointerDown={onPointerDown}
      style={{ cursor: onPointerDown ? "pointer" : "default", touchAction: "none" }}
    >
      {isSelected && (
        <rect
          x={isHoriz ? gx - 2 : gx - halfWall - 4}
          y={isHoriz ? gy - halfWall - 4 : gy - 2}
          width={isHoriz ? gapPx + 4 : WALL_THICK + 8}
          height={isHoriz ? WALL_THICK + 8 : gapPx + 4}
          fill="rgba(99,102,241,0.2)"
          stroke={HANDLE_COLOR}
          strokeWidth={1}
        />
      )}
    </g>
  );

  if (isMissing) {
    if (isHoriz) {
      return (
        <g>
          {common}
          <rect x={gx} y={gy - halfWall} width={gapPx} height={WALL_THICK} fill="white" stroke="none" />
        </g>
      );
    }
    return (
      <g>
        {common}
        <rect x={gx - halfWall} y={gy} width={WALL_THICK} height={gapPx} fill="white" stroke="none" />
      </g>
    );
  }

  if (isDoor) {
    const arcR = gapPx * 0.8;
    if (isHoriz) {
      const cy = gy;
      const sweepInward = wallSide === "north" ? 1 : -1;
      return (
        <g>
          {common}
          <rect x={gx} y={cy - halfWall} width={gapPx} height={WALL_THICK} fill="white" stroke="none" />
          <path
            d={`M ${gx},${cy} A ${arcR} ${arcR} 0 0 ${sweepInward > 0 ? 1 : 0} ${gx + gapPx},${cy + arcR * sweepInward}`}
            fill="none"
            stroke={WALL_COLOR}
            strokeWidth={0.6}
            strokeDasharray="2,1.5"
          />
          <line x1={gx} y1={cy} x2={gx} y2={cy + arcR * sweepInward * 0.3} stroke={WALL_COLOR} strokeWidth={0.5} />
        </g>
      );
    }
    const cx = gx;
    const sweepInward = wallSide === "west" ? 1 : -1;
    return (
      <g>
        {common}
        <rect x={cx - halfWall} y={gy} width={WALL_THICK} height={gapPx} fill="white" stroke="none" />
        <path
          d={`M ${cx},${gy} A ${arcR} ${arcR} 0 0 ${sweepInward > 0 ? 0 : 1} ${cx + arcR * sweepInward},${gy + gapPx}`}
          fill="none"
          stroke={WALL_COLOR}
          strokeWidth={0.6}
          strokeDasharray="2,1.5"
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
          {common}
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
        {common}
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
          {common}
          <rect x={gx} y={cy - halfWall} width={gapPx} height={WALL_THICK} fill="white" stroke="none" />
          <line x1={gx + 1} y1={cy} x2={gx + gapPx - 1} y2={cy} stroke={WALL_COLOR} strokeWidth={1} strokeDasharray="3,2" />
        </g>
      );
    }
    const cx = gx;
    return (
      <g>
        {common}
        <rect x={cx - halfWall} y={gy} width={WALL_THICK} height={gapPx} fill="white" stroke="none" />
        <line x1={cx} y1={gy + 1} x2={cx} y2={gy + gapPx - 1} stroke={WALL_COLOR} strokeWidth={1} strokeDasharray="3,2" />
      </g>
    );
  }

  return null;
}

const STATUS_STYLES: Record<string, { fill: string; stroke: string; text: string }> = {
  complete: { fill: "rgba(34,197,94,0.06)", stroke: "#22C55E", text: "#166534" },
  completed: { fill: "rgba(34,197,94,0.06)", stroke: "#22C55E", text: "#166534" },
  in_progress: { fill: "rgba(119,99,183,0.08)", stroke: "#7763B7", text: "#4C3D8F" },
  not_started: { fill: "rgba(31,41,55,0.04)", stroke: "#94A3B8", text: "#64748B" },
};

export interface RoomCostData {
  total: number;
  count: number;
}

export interface SketchRendererProps {
  layouts: LayoutRect[];
  openings: OpeningData[];
  annotations: AnnotationData[];
  selection: SelectionState;
  viewBox: { x: number; y: number; w: number; h: number };
  ghostPreview?: GhostPreview | null;
  roomCosts?: Map<number, RoomCostData>;
  onRoomPointerDown?: (roomId: number, e: React.PointerEvent) => void;
  onOpeningPointerDown?: (openingId: number, e: React.PointerEvent) => void;
  onAnnotationPointerDown?: (annotationId: number, e: React.PointerEvent) => void;
  onHandlePointerDown?: (roomId: number, handle: string, e: React.PointerEvent) => void;
  renderHandles?: boolean;
}

export const SketchRenderer = React.forwardRef<SVGSVGElement, SketchRendererProps>(function SketchRenderer({
  layouts,
  openings,
  annotations,
  selection,
  viewBox,
  ghostPreview,
  roomCosts,
  onRoomPointerDown,
  onOpeningPointerDown,
  onAnnotationPointerDown,
  onHandlePointerDown,
  renderHandles = true,
}, ref) {
  const openingsByRoom = new Map<number, OpeningData[]>();
  for (const op of openings) {
    if (!openingsByRoom.has(op.roomId)) openingsByRoom.set(op.roomId, []);
    openingsByRoom.get(op.roomId)!.push(op);
  }

  const annotationsByRoom = new Map<number, AnnotationData[]>();
  for (const ann of annotations) {
    if (!annotationsByRoom.has(ann.roomId)) annotationsByRoom.set(ann.roomId, []);
    annotationsByRoom.get(ann.roomId)!.push(ann);
  }

  return (
    <svg
      ref={ref}
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
      className="w-full h-full"
      style={{ touchAction: "none" }}
    >
      {ghostPreview && (
        <rect
          x={ghostPreview.x}
          y={ghostPreview.y}
          width={ghostPreview.w}
          height={ghostPreview.h}
          fill="rgba(34,197,94,0.08)"
          stroke="#22C55E"
          strokeWidth={2}
          strokeDasharray="6,4"
        />
      )}
      {layouts.map((layout) => {
        const { roomId, x, y, w, h, room } = layout;
        const dims = room.dimensions as { length?: number; width?: number } | undefined;
        const roomLabel = room.name.length > 14 ? room.name.substring(0, 13) + "…" : room.name;
        const isSelected = selection.selectedRoomId === roomId;
        const st = STATUS_STYLES[room.status] || STATUS_STYLES.not_started;

        const roomOpenings = openingsByRoom.get(roomId) || [];
        const roomAnnotations = annotationsByRoom.get(roomId) || [];
        const wallLen = dims?.length || w / 4;
        const wallWid = dims?.width || h / 4;

        return (
          <g key={roomId}>
            {/* Room fill + stroke */}
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill={st.fill}
              stroke={isSelected ? SELECT_STROKE : st.stroke}
              strokeWidth={isSelected ? 2.5 : WALL_THICK}
              onPointerDown={(e) => onRoomPointerDown?.(roomId, e)}
              style={{ cursor: onRoomPointerDown ? "pointer" : "default", touchAction: "none" }}
            />
            {isSelected && (
              <rect
                x={x - 1}
                y={y - 1}
                width={w + 2}
                height={h + 2}
                fill="none"
                stroke={SELECT_STROKE}
                strokeWidth={1}
                strokeDasharray="4,2"
                opacity={0.5}
              />
            )}

            {/* Room label */}
            <text
              x={x + w / 2}
              y={y + h * 0.4}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="7"
              fontFamily={FONT}
              fontWeight="700"
              fill={st.text}
            >
              {roomLabel}
            </text>
            {dims?.length && dims?.width && (
              <text
                x={x + w / 2}
                y={y + h * 0.55}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="5.5"
                fontFamily={MONO}
                fill="#6B7280"
              >
                {dims.length}'×{dims.width}'
              </text>
            )}

            {/* Cost badge */}
            {roomCosts?.get(roomId) && roomCosts.get(roomId)!.total > 0 && (() => {
              const cost = roomCosts.get(roomId)!;
              const label = cost.total >= 1000
                ? `$${(cost.total / 1000).toFixed(1)}k`
                : `$${Math.round(cost.total)}`;
              const badgeW = Math.max(label.length * 3.5 + 6, 22);
              const badgeH = 9;
              const bx = x + w - badgeW - 3;
              const by = y + 3;
              return (
                <g data-testid={`cost-badge-${roomId}`}>
                  <rect x={bx} y={by} width={badgeW} height={badgeH} rx={2} fill="#059669" opacity={0.9} />
                  <text x={bx + badgeW / 2} y={by + badgeH / 2} textAnchor="middle" dominantBaseline="central"
                    fontSize="5" fontFamily={MONO} fontWeight="700" fill="#FFFFFF">
                    {label}
                  </text>
                </g>
              );
            })()}

            {/* Openings */}
            {roomOpenings.map((op) => {
              const wallSide = getOpeningWallSide(op);
              const wallLength = wallSide === "north" || wallSide === "south" ? wallLen : wallWid;
              return (
                <ArchOpeningSymbol
                  key={op.id}
                  opening={op}
                  wallSide={wallSide}
                  wallLen={wallLength}
                  roomX={x}
                  roomY={y}
                  roomW={w}
                  roomH={h}
                  isSelected={selection.selectedOpeningId === op.id}
                  onPointerDown={onOpeningPointerDown ? (e) => { e.stopPropagation(); onOpeningPointerDown(op.id, e); } : undefined}
                />
              );
            })}

            {/* Damage annotations (positioned) */}
            {roomAnnotations.map((ann) => {
              const pos = ann.position as { x?: number; y?: number } | undefined;
              const px = pos?.x != null ? x + w * (typeof pos.x === "number" && pos.x <= 1 ? pos.x : pos.x / 100) : x + w * 0.5;
              const py = pos?.y != null ? y + h * (typeof pos.y === "number" && pos.y <= 1 ? pos.y : pos.y / 100) : y + h * 0.5;
              const isSelected = selection.selectedAnnotationId === ann.id;
              return (
                <g
                  key={ann.id}
                  onPointerDown={onAnnotationPointerDown ? (e) => { e.stopPropagation(); onAnnotationPointerDown(ann.id, e); } : undefined}
                  style={{ cursor: onAnnotationPointerDown ? "pointer" : "default" }}
                >
                  <circle
                    cx={px}
                    cy={py}
                    r={isSelected ? 8 : 6}
                    fill={DAMAGE_COLOR}
                    stroke={isSelected ? HANDLE_COLOR : "white"}
                    strokeWidth={isSelected ? 2 : 1}
                  />
                  <text x={px} y={py - 10} textAnchor="middle" fontSize="5" fontFamily={MONO} fill={DAMAGE_COLOR} fontWeight="600">
                    {ann.label}
                  </text>
                </g>
              );
            })}

            {/* Resize handles (when room selected) — 24×24 hit area for touch, 3×3 visible to match wall thickness */}
            {renderHandles && isSelected && onHandlePointerDown && (
              <>
                {["n", "s", "e", "w", "nw", "ne", "sw", "se"].map((handle) => {
                  let hx: number, hy: number;
                  const hitSz = 12;
                  if (handle === "n") { hx = x + w / 2; hy = y; }
                  else if (handle === "s") { hx = x + w / 2; hy = y + h; }
                  else if (handle === "e") { hx = x + w; hy = y + h / 2; }
                  else if (handle === "w") { hx = x; hy = y + h / 2; }
                  else if (handle === "nw") { hx = x; hy = y; }
                  else if (handle === "ne") { hx = x + w; hy = y; }
                  else if (handle === "sw") { hx = x; hy = y + h; }
                  else { hx = x + w; hy = y + h; }
                  const half = WALL_THICK / 2;
                  return (
                    <g
                      key={handle}
                      onPointerDown={(e) => { e.stopPropagation(); onHandlePointerDown(roomId, handle, e); }}
                      style={{ cursor: "pointer", touchAction: "none" }}
                    >
                      <rect x={hx - hitSz} y={hy - hitSz} width={hitSz * 2} height={hitSz * 2} fill="transparent" />
                      <rect
                        x={hx - half}
                        y={hy - half}
                        width={WALL_THICK}
                        height={WALL_THICK}
                        fill={HANDLE_COLOR}
                        stroke="white"
                        strokeWidth={0.5}
                        style={{ pointerEvents: "none" }}
                      />
                    </g>
                  );
                })}
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
});
