# React Native Sketch Implementation Guide

Porting the Claims IQ sketch system (BFS floor plan editor) from React/SVG to React Native.

---

## 1. Layout Logic — Copy Directly

The `sketchLayout.ts` file is **pure TypeScript with zero DOM dependencies**. Copy it verbatim into your React Native project:

- `bfsLayout()` — takes rooms + adjacencies, returns `{x, y, w, h}` rectangles
- `hitTestWall()` — determines which wall a tap hit (for placing doors/windows)
- `normalizeDirection()` — maps direction strings to cardinal directions

These just do math, no React or browser APIs involved.

### Interfaces

```typescript
export interface LayoutRoom {
  room: {
    id: number;
    name: string;
    status: string;
    damageCount: number;
    photoCount: number;
    dimensions?: any;
    annotations?: any[];
  };
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Adjacency {
  id: number;
  roomIdA: number;
  roomIdB: number;
  wallDirectionA?: string | null;
  wallDirectionB?: string | null;
}
```

### BFS Layout Algorithm

```typescript
function normalizeDirection(dir: string | null | undefined): "north" | "south" | "east" | "west" | null {
  if (!dir) return null;
  const d = dir.toLowerCase();
  if (d === "north" || d === "rear") return "north";
  if (d === "south" || d === "front") return "south";
  if (d === "east" || d === "right") return "east";
  if (d === "west" || d === "left") return "west";
  return null;
}

export function bfsLayout(
  rooms: Array<{
    id: number; name: string; status?: string;
    damageCount?: number; photoCount?: number;
    dimensions?: any; annotations?: any[];
  }>,
  adjacencies: Adjacency[],
  scale: number,
  minW: number,
  minH: number,
): LayoutRoom[] {
  if (rooms.length === 0) return [];

  const normalizedRooms = rooms.map((room) => ({
    ...room,
    status: room.status ?? "pending",
    damageCount: room.damageCount ?? 0,
    photoCount: room.photoCount ?? 0,
  }));

  const roomMap = new Map<number, (typeof normalizedRooms)[0]>();
  for (const r of normalizedRooms) roomMap.set(r.id, r);

  const adjMap = new Map<number, Array<{ adj: Adjacency; otherId: number }>>();
  for (const a of adjacencies) {
    if (!roomMap.has(a.roomIdA) || !roomMap.has(a.roomIdB)) continue;
    if (!adjMap.has(a.roomIdA)) adjMap.set(a.roomIdA, []);
    if (!adjMap.has(a.roomIdB)) adjMap.set(a.roomIdB, []);
    adjMap.get(a.roomIdA)!.push({ adj: a, otherId: a.roomIdB });
    adjMap.get(a.roomIdB)!.push({ adj: a, otherId: a.roomIdA });
  }

  function getRoomSize(r: (typeof rooms)[0]): { w: number; h: number } {
    const d = r.dimensions as any;
    if (d?.length && d?.width) {
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

  const first = normalizedRooms[0];
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
        case "east":  nx = current.x + current.w; ny = current.y; break;
        case "west":  nx = current.x - otherSize.w; ny = current.y; break;
        case "south": nx = current.x; ny = current.y + current.h; break;
        case "north": nx = current.x; ny = current.y - otherSize.h; break;
        default:      nx = current.x + current.w; ny = current.y; break;
      }

      let hasCollision = false;
      for (const p of Array.from(placed.values())) {
        if (nx < p.x + p.w && nx + otherSize.w > p.x &&
            ny < p.y + p.h && ny + otherSize.h > p.y) {
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

  const placedArr = Array.from(placed.values());
  const unplaced = normalizedRooms.filter((r) => !placed.has(r.id));
  if (unplaced.length > 0) {
    const maxBfsY = placedArr.length > 0 ? Math.max(...placedArr.map((l) => l.y + l.h)) : 0;
    const gap = 6;
    let cx = 0;
    let cy = maxBfsY + (placedArr.length > 0 ? 18 : 0);
    let rowH = 0;

    for (const r of unplaced) {
      const size = getRoomSize(r);
      if (cx + size.w > 400 && cx > 0) {
        cx = 0;
        cy += rowH + gap;
        rowH = 0;
      }
      placed.set(r.id, { room: { ...r, status: r.status ?? "pending", damageCount: r.damageCount ?? 0, photoCount: r.photoCount ?? 0 }, x: cx, y: cy, w: size.w, h: size.h });
      cx += size.w + gap;
      rowH = Math.max(rowH, size.h);
    }
  }

  const all = Array.from(placed.values());
  const minX = Math.min(...all.map((l) => l.x));
  const minY = Math.min(...all.map((l) => l.y));
  return all.map((l) => ({ ...l, x: l.x - minX, y: l.y - minY }));
}
```

### Hit Test Wall

```typescript
export function hitTestWall(
  roomX: number, roomY: number, roomW: number, roomH: number,
  px: number, py: number, hitPadding: number
): { wall: "north" | "south" | "east" | "west"; offset: number } | null {
  const pad = hitPadding;

  if (py >= roomY - pad && py <= roomY + pad && px >= roomX && px <= roomX + roomW) {
    return { wall: "north", offset: (px - roomX) / roomW };
  }
  if (py >= roomY + roomH - pad && py <= roomY + roomH + pad && px >= roomX && px <= roomX + roomW) {
    return { wall: "south", offset: (px - roomX) / roomW };
  }
  if (px >= roomX + roomW - pad && px <= roomX + roomW + pad && py >= roomY && py <= roomY + roomH) {
    return { wall: "east", offset: (py - roomY) / roomH };
  }
  if (px >= roomX - pad && px <= roomX + pad && py >= roomY && py <= roomY + roomH) {
    return { wall: "west", offset: (py - roomY) / roomH };
  }

  return null;
}
```

---

## 2. Rendering — `react-native-svg` Translation

Install dependencies:

```bash
npx expo install react-native-svg react-native-gesture-handler
```

### SVG Element Mapping

| Web SVG          | React Native SVG                                     |
| ---------------- | ---------------------------------------------------- |
| `<svg>`          | `<Svg>`                                              |
| `<rect>`         | `<Rect>`                                             |
| `<text>`         | `<SvgText>` (alias to avoid conflict with RN `Text`) |
| `<circle>`       | `<Circle>`                                           |
| `<line>`         | `<Line>`                                             |
| `<path>`         | `<Path>`                                             |
| `<g>`            | `<G>`                                                |

### Constants

```typescript
const SCALE = 4;
const WALL_COLOR = "#334155";
const WALL_THICK = 3;
const WINDOW_COLOR = "#60A5FA";
const DAMAGE_COLOR = "#EF4444";
const SELECT_STROKE = "#C6A54E";
const HANDLE_COLOR = "#6366F1";
const HIT_PADDING = 12;
```

### Status Colors

```typescript
const STATUS_STYLES: Record<string, { fill: string; stroke: string; text: string }> = {
  complete:    { fill: "rgba(34,197,94,0.06)",  stroke: "#22C55E", text: "#166534" },
  completed:   { fill: "rgba(34,197,94,0.06)",  stroke: "#22C55E", text: "#166534" },
  in_progress: { fill: "rgba(119,99,183,0.08)", stroke: "#7763B7", text: "#4C3D8F" },
  not_started: { fill: "rgba(31,41,55,0.04)",   stroke: "#94A3B8", text: "#64748B" },
};
```

### SketchRenderer Component

```tsx
import React from 'react';
import Svg, {
  Rect, Text as SvgText, G, Circle, Line, Path
} from 'react-native-svg';

interface SketchRendererProps {
  layouts: LayoutRoom[];
  openings: OpeningData[];
  annotations: AnnotationData[];
  selection: SelectionState;
  viewBox: { x: number; y: number; w: number; h: number };
  ghostPreview?: GhostPreview | null;
  roomCosts?: Map<number, { total: number; count: number }>;
  onRoomPress?: (roomId: number) => void;
  onHandlePress?: (roomId: number, handle: string) => void;
  renderHandles?: boolean;
}

export function SketchRenderer({
  layouts, openings, annotations, selection, viewBox,
  ghostPreview, roomCosts, onRoomPress, onHandlePress,
  renderHandles = true,
}: SketchRendererProps) {
  const openingsByRoom = new Map<number, OpeningData[]>();
  for (const op of openings) {
    if (!openingsByRoom.has(op.roomId)) openingsByRoom.set(op.roomId, []);
    openingsByRoom.get(op.roomId)!.push(op);
  }

  return (
    <Svg viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`} style={{ flex: 1 }}>
      {ghostPreview && (
        <Rect
          x={ghostPreview.x} y={ghostPreview.y}
          width={ghostPreview.w} height={ghostPreview.h}
          fill="rgba(34,197,94,0.08)" stroke="#22C55E"
          strokeWidth={2} strokeDasharray="6,4"
        />
      )}

      {layouts.map((layout) => {
        const { roomId, x, y, w, h, room } = layout;
        const dims = room.dimensions as { length?: number; width?: number } | undefined;
        const roomLabel = room.name.length > 14
          ? room.name.substring(0, 13) + "…"
          : room.name;
        const isSelected = selection.selectedRoomId === roomId;
        const st = STATUS_STYLES[room.status] || STATUS_STYLES.not_started;
        const roomOpenings = openingsByRoom.get(roomId) || [];

        const wallLen = dims?.length || w / 4;
        const wallWid = dims?.width || h / 4;

        return (
          <G key={roomId} onPress={() => onRoomPress?.(roomId)}>
            {/* Room fill + stroke */}
            <Rect
              x={x} y={y} width={w} height={h}
              fill={st.fill}
              stroke={isSelected ? SELECT_STROKE : st.stroke}
              strokeWidth={isSelected ? 2.5 : WALL_THICK}
            />
            {isSelected && (
              <Rect
                x={x - 1} y={y - 1} width={w + 2} height={h + 2}
                fill="none" stroke={SELECT_STROKE}
                strokeWidth={1} strokeDasharray="4,2" opacity={0.5}
              />
            )}

            {/* Room label */}
            <SvgText
              x={x + w / 2} y={y + h * 0.4}
              textAnchor="middle" alignmentBaseline="central"
              fontSize={7} fontWeight="700" fill={st.text}
            >
              {roomLabel}
            </SvgText>

            {/* Dimensions */}
            {dims?.length && dims?.width && (
              <SvgText
                x={x + w / 2} y={y + h * 0.55}
                textAnchor="middle" alignmentBaseline="central"
                fontSize={5.5} fill="#6B7280"
              >
                {`${Math.round(dims.length * 10) / 10}'×${Math.round(dims.width * 10) / 10}'`}
              </SvgText>
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
                <G>
                  <Rect x={bx} y={by} width={badgeW} height={badgeH} rx={2} fill="#059669" opacity={0.9} />
                  <SvgText x={bx + badgeW / 2} y={by + badgeH / 2} textAnchor="middle"
                    alignmentBaseline="central" fontSize={5} fontWeight="700" fill="#FFFFFF">
                    {label}
                  </SvgText>
                </G>
              );
            })()}

            {/* Openings (doors, windows, missing walls) */}
            {roomOpenings.map((op) => (
              <ArchOpeningSymbol
                key={op.id}
                opening={op}
                wallLen={op.wallDirection === "north" || op.wallDirection === "south" ? wallLen : wallWid}
                roomX={x} roomY={y} roomW={w} roomH={h}
                isSelected={selection.selectedOpeningId === op.id}
              />
            ))}

            {/* Resize handles */}
            {renderHandles && isSelected && (
              <>
                {["n", "s", "e", "w", "nw", "ne", "sw", "se"].map((handle) => {
                  let hx: number, hy: number;
                  if (handle === "n")       { hx = x + w / 2; hy = y; }
                  else if (handle === "s")  { hx = x + w / 2; hy = y + h; }
                  else if (handle === "e")  { hx = x + w; hy = y + h / 2; }
                  else if (handle === "w")  { hx = x; hy = y + h / 2; }
                  else if (handle === "nw") { hx = x; hy = y; }
                  else if (handle === "ne") { hx = x + w; hy = y; }
                  else if (handle === "sw") { hx = x; hy = y + h; }
                  else                      { hx = x + w; hy = y + h; }

                  return (
                    <G key={handle} onPress={() => onHandlePress?.(roomId, handle)}>
                      <Rect x={hx - 12} y={hy - 12} width={24} height={24} fill="transparent" />
                      <Circle cx={hx} cy={hy} r={3} fill={HANDLE_COLOR} stroke="white" strokeWidth={1} />
                    </G>
                  );
                })}
              </>
            )}
          </G>
        );
      })}
    </Svg>
  );
}
```

---

## 3. Opening Symbols (Doors, Windows, Missing Walls)

```tsx
function getOpeningWallSide(opening: OpeningData): "north" | "south" | "east" | "west" {
  const d = (opening.wallDirection || "").toLowerCase();
  if (d === "north" || d === "rear") return "north";
  if (d === "south" || d === "front") return "south";
  if (d === "east" || d === "right") return "east";
  if (d === "west" || d === "left") return "west";
  return "north";
}

function ArchOpeningSymbol({
  opening, wallLen, roomX, roomY, roomW, roomH, isSelected,
}: {
  opening: OpeningData;
  wallLen: number;
  roomX: number; roomY: number; roomW: number; roomH: number;
  isSelected?: boolean;
}) {
  const wallSide = getOpeningWallSide(opening);
  const openW = opening.widthFt ?? opening.width ?? 3;
  const isHoriz = wallSide === "north" || wallSide === "south";
  const pxPerFt = isHoriz ? roomW / (wallLen || 1) : roomH / (wallLen || 1);
  const gapPx = Math.min(openW * pxPerFt, (isHoriz ? roomW : roomH) * 0.5);
  const pos = opening.positionOnWall ?? 0.5;
  const halfWall = WALL_THICK / 2;

  let gx: number, gy: number;
  if (isHoriz) {
    gx = roomX + (roomW - gapPx) * pos;
    gy = wallSide === "north" ? roomY : roomY + roomH;
  } else {
    gx = wallSide === "west" ? roomX : roomX + roomW;
    gy = roomY + (roomH - gapPx) * pos;
  }

  const isDoor = ["door", "french_door", "sliding_door", "standard_door"].includes(opening.openingType);
  const isWindow = opening.openingType === "window";
  const isMissing = ["missing_wall", "pass_through", "archway", "cased_opening"].includes(opening.openingType);
  const isOverhead = opening.openingType === "overhead_door";

  if (isMissing) {
    return isHoriz
      ? <Rect x={gx} y={gy - halfWall} width={gapPx} height={WALL_THICK} fill="white" />
      : <Rect x={gx - halfWall} y={gy} width={WALL_THICK} height={gapPx} fill="white" />;
  }

  if (isDoor) {
    const arcR = gapPx * 0.8;
    if (isHoriz) {
      const sweepInward = wallSide === "north" ? 1 : -1;
      return (
        <G>
          <Rect x={gx} y={gy - halfWall} width={gapPx} height={WALL_THICK} fill="white" />
          <Path
            d={`M ${gx},${gy} A ${arcR} ${arcR} 0 0 ${sweepInward > 0 ? 1 : 0} ${gx + gapPx},${gy + arcR * sweepInward}`}
            fill="none" stroke={WALL_COLOR} strokeWidth={0.6} strokeDasharray="2,1.5"
          />
          <Line x1={gx} y1={gy} x2={gx} y2={gy + arcR * sweepInward * 0.3} stroke={WALL_COLOR} strokeWidth={0.5} />
        </G>
      );
    }
    const sweepInward = wallSide === "west" ? 1 : -1;
    return (
      <G>
        <Rect x={gx - halfWall} y={gy} width={WALL_THICK} height={gapPx} fill="white" />
        <Path
          d={`M ${gx},${gy} A ${arcR} ${arcR} 0 0 ${sweepInward > 0 ? 0 : 1} ${gx + arcR * sweepInward},${gy + gapPx}`}
          fill="none" stroke={WALL_COLOR} strokeWidth={0.6} strokeDasharray="2,1.5"
        />
        <Line x1={gx} y1={gy} x2={gx + arcR * sweepInward * 0.3} y2={gy} stroke={WALL_COLOR} strokeWidth={0.5} />
      </G>
    );
  }

  if (isWindow) {
    if (isHoriz) {
      return (
        <G>
          <Rect x={gx} y={gy - halfWall} width={gapPx} height={WALL_THICK} fill="white" />
          <Line x1={gx + 1} y1={gy - 1} x2={gx + gapPx - 1} y2={gy - 1} stroke={WINDOW_COLOR} strokeWidth={0.6} />
          <Line x1={gx + 1} y1={gy} x2={gx + gapPx - 1} y2={gy} stroke={WINDOW_COLOR} strokeWidth={0.8} />
          <Line x1={gx + 1} y1={gy + 1} x2={gx + gapPx - 1} y2={gy + 1} stroke={WINDOW_COLOR} strokeWidth={0.6} />
        </G>
      );
    }
    return (
      <G>
        <Rect x={gx - halfWall} y={gy} width={WALL_THICK} height={gapPx} fill="white" />
        <Line x1={gx - 1} y1={gy + 1} x2={gx - 1} y2={gy + gapPx - 1} stroke={WINDOW_COLOR} strokeWidth={0.6} />
        <Line x1={gx} y1={gy + 1} x2={gx} y2={gy + gapPx - 1} stroke={WINDOW_COLOR} strokeWidth={0.8} />
        <Line x1={gx + 1} y1={gy + 1} x2={gx + 1} y2={gy + gapPx - 1} stroke={WINDOW_COLOR} strokeWidth={0.6} />
      </G>
    );
  }

  if (isOverhead) {
    return isHoriz
      ? (
        <G>
          <Rect x={gx} y={gy - halfWall} width={gapPx} height={WALL_THICK} fill="white" />
          <Line x1={gx + 1} y1={gy} x2={gx + gapPx - 1} y2={gy} stroke={WALL_COLOR} strokeWidth={1} strokeDasharray="3,2" />
        </G>
      )
      : (
        <G>
          <Rect x={gx - halfWall} y={gy} width={WALL_THICK} height={gapPx} fill="white" />
          <Line x1={gx} y1={gy + 1} x2={gx} y2={gy + gapPx - 1} stroke={WALL_COLOR} strokeWidth={1} strokeDasharray="3,2" />
        </G>
      );
  }

  return null;
}
```

---

## 4. Gesture Handling

The web version uses `onPointerDown/Move/Up` with `setPointerCapture`. In React Native, use `react-native-gesture-handler`:

### Coordinate Conversion

```typescript
function screenToSvg(
  screenX: number, screenY: number,
  viewBox: { x: number; y: number; w: number; h: number },
  containerLayout: { width: number; height: number },
) {
  const ratioX = viewBox.w / containerLayout.width;
  const ratioY = viewBox.h / containerLayout.height;
  return {
    x: viewBox.x + screenX * ratioX,
    y: viewBox.y + screenY * ratioY,
  };
}
```

### Pan and Zoom Gestures

```tsx
import { GestureDetector, Gesture } from 'react-native-gesture-handler';

const panGesture = Gesture.Pan()
  .onUpdate((e) => {
    const ratioX = viewBox.w / containerWidth;
    const ratioY = viewBox.h / containerHeight;
    setViewBox(prev => ({
      ...prev,
      x: prev.x - e.changeX * ratioX,
      y: prev.y - e.changeY * ratioY,
    }));
  });

const pinchGesture = Gesture.Pinch()
  .onUpdate((e) => {
    const newW = baseViewBox.w / e.scale;
    const newH = baseViewBox.h / e.scale;
    setViewBox(prev => ({
      x: prev.x + (prev.w - newW) / 2,
      y: prev.y + (prev.h - newH) / 2,
      w: newW,
      h: newH,
    }));
  });

const tapGesture = Gesture.Tap()
  .onEnd((e) => {
    const svgPoint = screenToSvg(e.x, e.y, viewBox, containerLayout);
    const hitRoom = layouts.find(l =>
      svgPoint.x >= l.x && svgPoint.x <= l.x + l.w &&
      svgPoint.y >= l.y && svgPoint.y <= l.y + l.h
    );
    if (hitRoom) setSelectedRoomId(hitRoom.roomId);
    else setSelectedRoomId(null);
  });

const composed = Gesture.Race(
  tapGesture,
  Gesture.Simultaneous(panGesture, pinchGesture)
);
```

### Resize via Drag on Handles

```tsx
const resizeGesture = Gesture.Pan()
  .onStart((e) => {
    const svgPoint = screenToSvg(e.x, e.y, viewBox, containerLayout);
    const hit = hitTestResizeHandle(svgPoint, selectedRoom, layouts);
    if (hit) {
      setDragMode("resize");
      setDragHandle(hit.handle);
      setDragRoomId(hit.roomId);
      setDragRoomStart({
        length: selectedRoom.dimensions.length,
        width: selectedRoom.dimensions.width,
      });
    }
  })
  .onUpdate((e) => {
    if (dragMode !== "resize") return;
    const SCALE = 4;
    const deltaFt = {
      x: (e.changeX * viewBox.w / containerWidth) / SCALE,
      y: (e.changeY * viewBox.h / containerHeight) / SCALE,
    };

    setDragDimensions(prev => {
      const current = prev[dragRoomId] || { ...dragRoomStart };
      let newL = current.length;
      let newW = current.width;

      if (dragHandle.includes("e")) newL += deltaFt.x;
      if (dragHandle.includes("w")) newL -= deltaFt.x;
      if (dragHandle.includes("s")) newW += deltaFt.y;
      if (dragHandle.includes("n")) newW -= deltaFt.y;

      newL = Math.max(3, newL);
      newW = Math.max(3, newW);

      return { ...prev, [dragRoomId]: { length: newL, width: newW } };
    });
  })
  .onEnd(() => {
    if (dragMode === "resize" && dragDimensions[dragRoomId]) {
      const d = dragDimensions[dragRoomId];
      const newL = Math.round(d.length * 10) / 10;
      const newW = Math.round(d.width * 10) / 10;
      persistRoomDimensions(dragRoomId, newL, newW);
    }
    setDragMode("none");
    setDragRoomId(null);
  });
```

---

## 5. Drag Dimensions Pattern (Snap-back Prevention)

The local `dragDimensions` override pattern works identically in React Native. Clear it only when server data arrives:

```typescript
const [dragDimensions, setDragDimensions] = useState<Record<number, { length: number; width: number }>>({});

useEffect(() => {
  setDragDimensions({});
}, [structureRooms]);

const effectiveRooms = useMemo(() => {
  return interiorRooms.map(r => {
    const over = dragDimensions[r.id];
    if (!over) return r;
    return {
      ...r,
      dimensions: { ...r.dimensions, length: over.length, width: over.width },
    };
  });
}, [interiorRooms, dragDimensions]);
```

---

## 6. Elevation Views

Front/rear elevations use a rectangular wall + triangular (gabled) roof. Left/right use a trapezoidal (hipped) roof.

```tsx
function ElevationView({ side, wallW, wallH, roofH }: {
  side: "front" | "rear" | "left" | "right";
  wallW: number; wallH: number; roofH: number;
}) {
  const wx = 0;
  const wy = roofH;
  const isFrontRear = side === "front" || side === "rear";

  return (
    <G>
      {/* Wall */}
      <Rect x={wx} y={wy} width={wallW} height={wallH}
        fill="#F8FAFC" stroke={WALL_COLOR} strokeWidth={2} />

      {/* Roof */}
      {isFrontRear ? (
        <Path
          d={`M ${wx - 4},${wy} L ${wx + wallW / 2},${wy - roofH} L ${wx + wallW + 4},${wy} Z`}
          fill="#E2E8F0" stroke={WALL_COLOR} strokeWidth={1.5}
        />
      ) : (
        <Path
          d={`M ${wx - 4},${wy} L ${wx + 10},${wy - roofH} L ${wx + wallW - 10},${wy - roofH} L ${wx + wallW + 4},${wy} Z`}
          fill="#E2E8F0" stroke={WALL_COLOR} strokeWidth={1.5}
        />
      )}

      {/* Ground line */}
      <Line x1={wx - 8} y1={wy + wallH} x2={wx + wallW + 8} y2={wy + wallH}
        stroke="#94A3B8" strokeWidth={1} strokeDasharray="4,3" />
    </G>
  );
}
```

---

## 7. Data Types Reference

```typescript
interface OpeningData {
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

interface AnnotationData {
  id: number;
  roomId: number;
  annotationType: string;
  label: string;
  value?: string | null;
  position?: { x?: number; y?: number } | null;
}

interface SelectionState {
  selectedRoomId: number | null;
  selectedOpeningId: number | null;
  selectedAnnotationId: number | null;
}

interface GhostPreview {
  x: number; y: number; w: number; h: number;
  wall: "north" | "south" | "east" | "west";
}
```

---

## 8. Component Structure

```
src/
  lib/
    sketchLayout.ts           # copy verbatim from web
  components/
    SketchRenderer.tsx         # pure SVG rendering (react-native-svg)
    SketchEditor.tsx           # state + gestures + API calls
    PropertySketch.tsx         # read-only multi-section overview
    ArchOpeningSymbol.tsx      # door/window/missing wall symbols
    ElevationView.tsx          # exterior elevation rendering
```

---

## 9. Key Differences Summary

| Concept                | Web (React)                           | React Native                                     |
| ---------------------- | ------------------------------------- | ------------------------------------------------ |
| SVG rendering          | Native `<svg>` elements               | `react-native-svg` components (capitalized)       |
| Text baseline          | `dominantBaseline="middle"`           | `alignmentBaseline="central"`                     |
| Touch prevention       | CSS `touchAction: "none"`             | Gesture handler config                            |
| Pointer capture        | `setPointerCapture` on element        | Not needed — gesture handler manages              |
| Pan/zoom               | `onPointerDown/Move/Up` + math        | `Gesture.Pan()` + `Gesture.Pinch()`               |
| Room tap               | `onPointerDown` → hit test            | `Gesture.Tap()` → `screenToSvg()` → hit test     |
| Resize drag            | Pointer events + `dragDimensions`     | `Gesture.Pan()` + same `dragDimensions` state     |
| Fonts                  | CSS `@import` or `<link>`             | `expo-font` or native linking                     |
| ViewBox                | String attribute on `<svg>`           | String prop on `<Svg>`                            |
| Cursor styles          | CSS `cursor: pointer` etc.            | Not applicable in React Native                    |
