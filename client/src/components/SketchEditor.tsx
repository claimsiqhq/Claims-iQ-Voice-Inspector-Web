import React, { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Move, ZoomIn, ZoomOut, Grid3X3, Plus, RotateCcw, Maximize2, MousePointer2 } from "lucide-react";

interface OpeningData {
  id: number;
  openingType: string;
  wallIndex?: number | null;
  wallDirection?: string | null;
  widthFt?: number | null;
  heightFt?: number | null;
  quantity?: number;
  label?: string | null;
}

interface RoomData {
  id: number;
  name: string;
  status: string;
  damageCount: number;
  photoCount: number;
  roomType?: string;
  dimensions?: { length?: number; width?: number; height?: number };
  position?: { x: number; y: number };
  structure?: string;
  viewType?: string;
  shapeType?: string;
  parentRoomId?: number | null;
  attachmentType?: string | null;
  openingCount?: number;
}

interface SketchEditorProps {
  rooms: RoomData[];
  sessionId: number;
  currentRoomId: number | null;
  onRoomSelect?: (roomId: number) => void;
  onRoomUpdate?: (roomId: number, updates: { position?: { x: number; y: number }; dimensions?: { length?: number; width?: number; height?: number } }) => void;
  onAddRoom?: () => void;
  onClose?: () => void;
  className?: string;
  getAuthHeaders: () => Promise<Record<string, string>>;
}

const GRID_SIZE = 12;
const SCALE = 6;
const MIN_ROOM_W = 36;
const MIN_ROOM_H = 36;
const WALL_COLOR = "#334155";
const WALL_THICK = 2;
const HANDLE_SIZE = 8;
const FONT = "Work Sans, sans-serif";
const MONO = "Space Mono, monospace";

const STATUS_FILLS: Record<string, string> = {
  complete: "rgba(34,197,94,0.12)",
  completed: "rgba(34,197,94,0.12)",
  in_progress: "rgba(119,99,183,0.15)",
  not_started: "rgba(241,245,249,0.6)",
};

const STATUS_STROKES: Record<string, string> = {
  complete: "#22C55E",
  completed: "#22C55E",
  in_progress: "#7763B7",
  not_started: "#CBD5E1",
};

function snapToGrid(val: number, gridSize: number): number {
  return Math.round(val / gridSize) * gridSize;
}

function getRoomRect(room: RoomData, index: number) {
  const dims = room.dimensions;
  const w = Math.max((dims?.length || 10) * SCALE, MIN_ROOM_W);
  const h = Math.max((dims?.width || 10) * SCALE, MIN_ROOM_H);
  const pos = room.position;
  const defaultX = 60 + (index % 4) * (MIN_ROOM_W + 60);
  const defaultY = 60 + Math.floor(index / 4) * (MIN_ROOM_H + 60);
  const x = pos?.x ?? defaultX;
  const y = pos?.y ?? defaultY;
  return { x, y, w, h };
}

type DragMode = "none" | "move" | "resize-se" | "resize-sw" | "resize-ne" | "resize-nw" | "resize-e" | "resize-w" | "resize-n" | "resize-s" | "pan";

export default function SketchEditor({
  rooms,
  sessionId,
  currentRoomId,
  onRoomSelect,
  onRoomUpdate,
  onAddRoom,
  onClose,
  className,
  getAuthHeaders,
}: SketchEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [viewBox, setViewBox] = useState({ x: -20, y: -20, w: 800, h: 600 });
  const [zoom, setZoom] = useState(1);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [tool, setTool] = useState<"select" | "pan">("select");

  const [dragMode, setDragMode] = useState<DragMode>("none");
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragRoomStart, setDragRoomStart] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [dragRoomId, setDragRoomId] = useState<number | null>(null);

  const [localPositions, setLocalPositions] = useState<Record<number, { x: number; y: number; w: number; h: number }>>({});

  const [pendingSaves, setPendingSaves] = useState<Set<number>>(new Set());
  const [roomOpenings, setRoomOpenings] = useState<Record<number, OpeningData[]>>({});

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`/api/inspection/${sessionId}/openings`, { headers });
        if (!res.ok || cancelled) return;
        const allOpenings: any[] = await res.json();
        const byRoom: Record<number, OpeningData[]> = {};
        for (const o of allOpenings) {
          const rid = o.roomId;
          if (!byRoom[rid]) byRoom[rid] = [];
          byRoom[rid].push({
            id: o.id,
            openingType: o.openingType || o.opening_type || "door",
            wallIndex: o.wallIndex ?? o.wall_index ?? null,
            wallDirection: o.wallDirection ?? o.wall_direction ?? null,
            widthFt: o.widthFt ?? o.width_ft ?? o.width ?? 3,
            heightFt: o.heightFt ?? o.height_ft ?? o.height ?? 7,
            quantity: o.quantity || 1,
            label: o.label || null,
          });
        }
        if (!cancelled) setRoomOpenings(byRoom);
      } catch (e) { console.error("Failed to fetch openings:", e); }
    })();
    return () => { cancelled = true; };
  }, [sessionId, getAuthHeaders, rooms]);

  const editableRooms = useMemo(() =>
    rooms.filter(r => !r.parentRoomId),
    [rooms]
  );

  useEffect(() => {
    setLocalPositions(prev => {
      const next = { ...prev };
      editableRooms.forEach((room, idx) => {
        const dims = room.dimensions;
        const w = Math.max((dims?.length || 10) * SCALE, MIN_ROOM_W);
        const h = Math.max((dims?.width || 10) * SCALE, MIN_ROOM_H);
        const pos = room.position as { x: number; y: number } | undefined;
        if (next[room.id] && dragRoomId === room.id) {
          return;
        }
        if (pos?.x !== undefined && pos?.y !== undefined) {
          next[room.id] = { x: pos.x, y: pos.y, w, h };
        } else if (!next[room.id]) {
          next[room.id] = getRoomRect(room, idx);
        } else {
          next[room.id] = { ...next[room.id], w, h };
        }
      });
      const roomIds = new Set(editableRooms.map(r => r.id));
      for (const id of Object.keys(next)) {
        if (!roomIds.has(Number(id))) delete next[Number(id)];
      }
      return next;
    });
  }, [editableRooms, dragRoomId]);

  const getSvgPoint = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const scaleX = viewBox.w / rect.width;
    const scaleY = viewBox.h / rect.height;
    return {
      x: viewBox.x + (clientX - rect.left) * scaleX,
      y: viewBox.y + (clientY - rect.top) * scaleY,
    };
  }, [viewBox]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const svgPt = getSvgPoint(e.clientX, e.clientY);

    if (tool === "pan") {
      setDragMode("pan");
      setDragStart({ x: e.clientX, y: e.clientY });
      (e.target as Element)?.setPointerCapture?.(e.pointerId);
      return;
    }

    let hitRoom: number | null = null;
    let hitHandle: DragMode = "none";

    for (const room of editableRooms) {
      const rect = localPositions[room.id];
      if (!rect) continue;
      const { x, y, w, h } = rect;

      if (selectedRoomId === room.id) {
        const hs = HANDLE_SIZE / zoom;
        if (svgPt.x >= x + w - hs && svgPt.y >= y + h - hs && svgPt.x <= x + w + hs && svgPt.y <= y + h + hs) {
          hitRoom = room.id; hitHandle = "resize-se"; break;
        }
        if (svgPt.x >= x - hs && svgPt.y >= y + h - hs && svgPt.x <= x + hs && svgPt.y <= y + h + hs) {
          hitRoom = room.id; hitHandle = "resize-sw"; break;
        }
        if (svgPt.x >= x + w - hs && svgPt.y >= y - hs && svgPt.x <= x + w + hs && svgPt.y <= y + hs) {
          hitRoom = room.id; hitHandle = "resize-ne"; break;
        }
        if (svgPt.x >= x - hs && svgPt.y >= y - hs && svgPt.x <= x + hs && svgPt.y <= y + hs) {
          hitRoom = room.id; hitHandle = "resize-nw"; break;
        }
        if (svgPt.x >= x + w - hs && svgPt.y >= y + h * 0.3 && svgPt.x <= x + w + hs && svgPt.y <= y + h * 0.7) {
          hitRoom = room.id; hitHandle = "resize-e"; break;
        }
        if (svgPt.x >= x - hs && svgPt.y >= y + h * 0.3 && svgPt.x <= x - hs + hs * 2 && svgPt.y <= y + h * 0.7) {
          hitRoom = room.id; hitHandle = "resize-w"; break;
        }
        if (svgPt.y >= y - hs && svgPt.y <= y + hs && svgPt.x >= x + w * 0.3 && svgPt.x <= x + w * 0.7) {
          hitRoom = room.id; hitHandle = "resize-n"; break;
        }
        if (svgPt.y >= y + h - hs && svgPt.y <= y + h + hs && svgPt.x >= x + w * 0.3 && svgPt.x <= x + w * 0.7) {
          hitRoom = room.id; hitHandle = "resize-s"; break;
        }
      }

      if (svgPt.x >= x && svgPt.x <= x + w && svgPt.y >= y && svgPt.y <= y + h) {
        hitRoom = room.id;
        hitHandle = "move";
      }
    }

    if (hitRoom !== null) {
      const rect = localPositions[hitRoom]!;
      setDragRoomId(hitRoom);
      setDragMode(hitHandle);
      setDragStart(svgPt);
      setDragRoomStart({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
      setSelectedRoomId(hitRoom);
      onRoomSelect?.(hitRoom);
      (e.target as Element)?.setPointerCapture?.(e.pointerId);
    } else {
      setSelectedRoomId(null);
      if (e.shiftKey || e.metaKey) {
        setDragMode("pan");
        setDragStart({ x: e.clientX, y: e.clientY });
        (e.target as Element)?.setPointerCapture?.(e.pointerId);
      }
    }
  }, [tool, getSvgPoint, editableRooms, localPositions, selectedRoomId, zoom, onRoomSelect]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragMode === "none") return;

    if (dragMode === "pan") {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const dx = (e.clientX - dragStart.x) * (viewBox.w / rect.width);
      const dy = (e.clientY - dragStart.y) * (viewBox.h / rect.height);
      setViewBox(prev => ({ ...prev, x: prev.x - dx, y: prev.y - dy }));
      setDragStart({ x: e.clientX, y: e.clientY });
      return;
    }

    if (dragRoomId === null) return;
    const svgPt = getSvgPoint(e.clientX, e.clientY);
    const dx = svgPt.x - dragStart.x;
    const dy = svgPt.y - dragStart.y;

    setLocalPositions(prev => {
      const current = { ...prev };
      const orig = dragRoomStart;

      if (dragMode === "move") {
        const newX = showGrid ? snapToGrid(orig.x + dx, GRID_SIZE) : orig.x + dx;
        const newY = showGrid ? snapToGrid(orig.y + dy, GRID_SIZE) : orig.y + dy;
        current[dragRoomId] = { ...current[dragRoomId], x: newX, y: newY };
      } else {
        let newX = orig.x, newY = orig.y, newW = orig.w, newH = orig.h;

        if (dragMode.includes("e")) {
          newW = Math.max(MIN_ROOM_W, orig.w + dx);
        }
        if (dragMode.includes("w")) {
          const dw = Math.min(dx, orig.w - MIN_ROOM_W);
          newX = orig.x + dw;
          newW = orig.w - dw;
        }
        if (dragMode.includes("s")) {
          newH = Math.max(MIN_ROOM_H, orig.h + dy);
        }
        if (dragMode.includes("n")) {
          const dh = Math.min(dy, orig.h - MIN_ROOM_H);
          newY = orig.y + dh;
          newH = orig.h - dh;
        }

        if (showGrid) {
          newX = snapToGrid(newX, GRID_SIZE);
          newY = snapToGrid(newY, GRID_SIZE);
          newW = snapToGrid(newW, GRID_SIZE);
          newH = snapToGrid(newH, GRID_SIZE);
          newW = Math.max(MIN_ROOM_W, newW);
          newH = Math.max(MIN_ROOM_H, newH);
        }

        current[dragRoomId] = { x: newX, y: newY, w: newW, h: newH };
      }

      return current;
    });
  }, [dragMode, dragStart, dragRoomId, dragRoomStart, getSvgPoint, showGrid]);

  const persistRoom = useCallback(async (roomId: number) => {
    const pos = localPositions[roomId];
    if (!pos) return;

    const lengthFt = Math.round((pos.w / SCALE) * 10) / 10;
    const widthFt = Math.round((pos.h / SCALE) * 10) / 10;
    const room = editableRooms.find(r => r.id === roomId);
    const heightFt = room?.dimensions?.height || 8;

    setPendingSaves(prev => new Set(prev).add(roomId));
    try {
      const headers = await getAuthHeaders();
      await fetch(`/api/inspection/${sessionId}/rooms/${roomId}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          dimensions: { length: lengthFt, width: widthFt, height: heightFt },
          position: { x: pos.x, y: pos.y },
        }),
      });
      onRoomUpdate?.(roomId, {
        position: { x: pos.x, y: pos.y },
        dimensions: { length: lengthFt, width: widthFt, height: heightFt },
      });
    } catch (err) {
      console.error("Failed to save room position:", err);
    } finally {
      setPendingSaves(prev => {
        const next = new Set(prev);
        next.delete(roomId);
        return next;
      });
    }
  }, [localPositions, editableRooms, sessionId, getAuthHeaders, onRoomUpdate]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (dragMode !== "none" && dragMode !== "pan" && dragRoomId !== null) {
      persistRoom(dragRoomId);
    }
    setDragMode("none");
    setDragRoomId(null);
  }, [dragMode, dragRoomId, persistRoom]);

  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    if (dragMode !== "none" && dragMode !== "pan" && dragRoomId !== null) {
      persistRoom(dragRoomId);
    }
    setDragMode("none");
    setDragRoomId(null);
  }, [dragMode, dragRoomId, persistRoom]);

  const handleZoom = useCallback((direction: "in" | "out") => {
    setViewBox(prev => {
      const factor = direction === "in" ? 0.8 : 1.25;
      const newW = prev.w * factor;
      const newH = prev.h * factor;
      const cx = prev.x + prev.w / 2;
      const cy = prev.y + prev.h / 2;
      return { x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH };
    });
    setZoom(prev => direction === "in" ? prev * 1.25 : prev * 0.8);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      handleZoom(e.deltaY < 0 ? "in" : "out");
    } else {
      setViewBox(prev => ({
        ...prev,
        x: prev.x + e.deltaX * 0.5,
        y: prev.y + e.deltaY * 0.5,
      }));
    }
  }, [handleZoom]);

  const fitToContent = useCallback(() => {
    const rects = Object.values(localPositions);
    if (rects.length === 0) return;
    const minX = Math.min(...rects.map(r => r.x)) - 40;
    const minY = Math.min(...rects.map(r => r.y)) - 40;
    const maxX = Math.max(...rects.map(r => r.x + r.w)) + 40;
    const maxY = Math.max(...rects.map(r => r.y + r.h)) + 40;
    setViewBox({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
    setZoom(1);
  }, [localPositions]);

  useEffect(() => {
    if (editableRooms.length > 0 && Object.keys(localPositions).length > 0) {
      const hasAnyPosition = editableRooms.some(r => r.position?.x !== undefined);
      if (!hasAnyPosition) {
        setTimeout(fitToContent, 100);
      }
    }
  }, []);

  const gridSpacing = GRID_SIZE;

  return (
    <div className={cn("flex flex-col bg-white rounded-lg border border-slate-200 overflow-hidden", className)} data-testid="sketch-editor">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-100">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-widest text-slate-500 font-mono font-semibold">Sketch Editor</span>
          {pendingSaves.size > 0 && (
            <span className="text-[9px] text-amber-600 font-mono animate-pulse">saving...</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setTool("select")}
            className={cn("p-1.5 rounded transition-colors", tool === "select" ? "bg-purple-100 text-purple-700" : "text-slate-400 hover:bg-slate-100")}
            title="Select & Move"
            data-testid="tool-select"
          >
            <MousePointer2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setTool("pan")}
            className={cn("p-1.5 rounded transition-colors", tool === "pan" ? "bg-purple-100 text-purple-700" : "text-slate-400 hover:bg-slate-100")}
            title="Pan Canvas"
            data-testid="tool-pan"
          >
            <Move className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 bg-slate-200 mx-1" />

          <button onClick={() => handleZoom("in")} className="p-1.5 rounded text-slate-400 hover:bg-slate-100 transition-colors" title="Zoom In" data-testid="zoom-in">
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => handleZoom("out")} className="p-1.5 rounded text-slate-400 hover:bg-slate-100 transition-colors" title="Zoom Out" data-testid="zoom-out">
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button onClick={fitToContent} className="p-1.5 rounded text-slate-400 hover:bg-slate-100 transition-colors" title="Fit to Content" data-testid="fit-content">
            <Maximize2 className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 bg-slate-200 mx-1" />

          <button
            onClick={() => setShowGrid(!showGrid)}
            className={cn("p-1.5 rounded transition-colors", showGrid ? "bg-blue-100 text-blue-700" : "text-slate-400 hover:bg-slate-100")}
            title="Toggle Grid & Snap"
            data-testid="toggle-grid"
          >
            <Grid3X3 className="w-3.5 h-3.5" />
          </button>

          {onAddRoom && (
            <>
              <div className="w-px h-4 bg-slate-200 mx-1" />
              <button
                onClick={onAddRoom}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-green-700 bg-green-50 border border-green-200 hover:bg-green-100 transition-colors"
                data-testid="button-add-room-editor"
              >
                <Plus className="w-3 h-3" />
                Room
              </button>
            </>
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative flex-1 min-h-[400px] cursor-crosshair overflow-hidden"
        style={{ touchAction: "none" }}
      >
        <svg
          ref={svgRef}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          className="w-full h-full"
          style={{ minHeight: 400, cursor: tool === "pan" ? "grab" : dragMode === "move" ? "grabbing" : "default" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onLostPointerCapture={handlePointerCancel}
          onWheel={handleWheel}
        >
          <defs>
            <pattern id="editorGrid" width={gridSpacing} height={gridSpacing} patternUnits="userSpaceOnUse">
              <path d={`M ${gridSpacing} 0 L 0 0 0 ${gridSpacing}`} fill="none" stroke="#E2E8F0" strokeWidth={0.3} />
            </pattern>
            <pattern id="editorGridMajor" width={gridSpacing * 4} height={gridSpacing * 4} patternUnits="userSpaceOnUse">
              <path d={`M ${gridSpacing * 4} 0 L 0 0 0 ${gridSpacing * 4}`} fill="none" stroke="#CBD5E1" strokeWidth={0.5} />
            </pattern>
          </defs>

          {showGrid && (
            <>
              <rect x={viewBox.x - 200} y={viewBox.y - 200} width={viewBox.w + 400} height={viewBox.h + 400} fill="url(#editorGrid)" />
              <rect x={viewBox.x - 200} y={viewBox.y - 200} width={viewBox.w + 400} height={viewBox.h + 400} fill="url(#editorGridMajor)" />
            </>
          )}

          {editableRooms.map((room) => {
            const rect = localPositions[room.id];
            if (!rect) return null;
            const { x, y, w, h } = rect;
            const isSelected = selectedRoomId === room.id;
            const isCurrent = currentRoomId === room.id;
            const fill = STATUS_FILLS[room.status] || STATUS_FILLS.not_started;
            const stroke = isSelected ? "#7763B7" : isCurrent ? "#C6A54E" : STATUS_STROKES[room.status] || STATUS_STROKES.not_started;
            const strokeW = isSelected ? 2.5 : isCurrent ? 2 : WALL_THICK;

            const lengthFt = Math.round((w / SCALE) * 10) / 10;
            const widthFt = Math.round((h / SCALE) * 10) / 10;
            const heightFt = room.dimensions?.height || 8;
            const floorSF = Math.round(lengthFt * widthFt);
            const wallSF = Math.round((lengthFt + widthFt) * 2 * heightFt);

            return (
              <g key={room.id} data-testid={`sketch-room-${room.id}`}>
                <rect
                  x={x} y={y} width={w} height={h}
                  fill={fill} stroke={stroke} strokeWidth={strokeW}
                  rx={1}
                />

                <text x={x + w / 2} y={y + h * 0.28} textAnchor="middle" dominantBaseline="middle"
                  fontSize="8" fontFamily={FONT} fontWeight="600" fill="#334155"
                  style={{ pointerEvents: "none" }}>
                  {room.name.length > 16 ? room.name.substring(0, 15) + "\u2026" : room.name}
                </text>

                <text x={x + w / 2} y={y + h * 0.48} textAnchor="middle" dominantBaseline="middle"
                  fontSize="6.5" fontFamily={MONO} fill="#64748B"
                  style={{ pointerEvents: "none" }}>
                  {lengthFt}' × {widthFt}'
                </text>

                <text x={x + w / 2} y={y + h * 0.65} textAnchor="middle" dominantBaseline="middle"
                  fontSize="5" fontFamily={MONO} fill="#7C3AED"
                  style={{ pointerEvents: "none" }}>
                  Floor {floorSF} SF
                </text>

                <text x={x + w / 2} y={y + h * 0.78} textAnchor="middle" dominantBaseline="middle"
                  fontSize="5" fontFamily={MONO} fill="#0369A1"
                  style={{ pointerEvents: "none" }}>
                  Wall {wallSF} SF
                </text>

                {/* Opening markers (doors/windows) */}
                {(roomOpenings[room.id] || []).map((op, opIdx) => {
                  const dirMap: Record<string, number> = { north: 0, front: 0, east: 1, right: 1, south: 2, rear: 2, back: 2, west: 3, left: 3 };
                  const wallIdx = op.wallIndex ?? (op.wallDirection ? dirMap[op.wallDirection] ?? 0 : opIdx % 4);
                  const isHoriz = wallIdx === 0 || wallIdx === 2;
                  const opWidthPx = Math.min((op.widthFt || 3) * SCALE * 0.5, isHoriz ? w * 0.35 : h * 0.35);
                  const isDoor = op.openingType.includes("door") || op.openingType === "archway" || op.openingType === "cased_opening" || op.openingType === "pass_through";
                  const isWindow = op.openingType === "window";
                  const spacing = opIdx * (opWidthPx + 4);
                  const wallPos = 0.2 + (spacing / (isHoriz ? w : h)) * 0.6;

                  let ox: number, oy: number;
                  if (wallIdx === 0) { ox = x + w * wallPos; oy = y; }
                  else if (wallIdx === 1) { ox = x + w; oy = y + h * wallPos; }
                  else if (wallIdx === 2) { ox = x + w * wallPos; oy = y + h; }
                  else { ox = x; oy = y + h * wallPos; }

                  return (
                    <g key={`op-${op.id}`} style={{ pointerEvents: "none" }}>
                      {isHoriz ? (
                        <>
                          <rect x={ox - opWidthPx / 2} y={oy - 2} width={opWidthPx} height={4} fill="white" />
                          {isDoor ? (
                            <path d={`M${ox - opWidthPx / 2},${oy} A${opWidthPx / 2},${opWidthPx / 2} 0 0 ${wallIdx === 0 ? 1 : 0} ${ox + opWidthPx / 2},${oy}`}
                              fill="none" stroke="#7763B7" strokeWidth={0.6} strokeDasharray="2,1" />
                          ) : isWindow ? (
                            <>
                              <line x1={ox - opWidthPx / 2} y1={oy} x2={ox + opWidthPx / 2} y2={oy} stroke="#0EA5E9" strokeWidth={1.5} />
                              <line x1={ox - opWidthPx / 2 + 1} y1={oy - 1.5} x2={ox - opWidthPx / 2 + 1} y2={oy + 1.5} stroke="#0EA5E9" strokeWidth={0.6} />
                              <line x1={ox + opWidthPx / 2 - 1} y1={oy - 1.5} x2={ox + opWidthPx / 2 - 1} y2={oy + 1.5} stroke="#0EA5E9" strokeWidth={0.6} />
                            </>
                          ) : (
                            <line x1={ox - opWidthPx / 2} y1={oy} x2={ox + opWidthPx / 2} y2={oy} stroke="#F59E0B" strokeWidth={1} strokeDasharray="3,2" />
                          )}
                        </>
                      ) : (
                        <>
                          <rect x={ox - 2} y={oy - opWidthPx / 2} width={4} height={opWidthPx} fill="white" />
                          {isDoor ? (
                            <path d={`M${ox},${oy - opWidthPx / 2} A${opWidthPx / 2},${opWidthPx / 2} 0 0 ${wallIdx === 3 ? 1 : 0} ${ox},${oy + opWidthPx / 2}`}
                              fill="none" stroke="#7763B7" strokeWidth={0.6} strokeDasharray="2,1" />
                          ) : isWindow ? (
                            <>
                              <line x1={ox} y1={oy - opWidthPx / 2} x2={ox} y2={oy + opWidthPx / 2} stroke="#0EA5E9" strokeWidth={1.5} />
                              <line x1={ox - 1.5} y1={oy - opWidthPx / 2 + 1} x2={ox + 1.5} y2={oy - opWidthPx / 2 + 1} stroke="#0EA5E9" strokeWidth={0.6} />
                              <line x1={ox - 1.5} y1={oy + opWidthPx / 2 - 1} x2={ox + 1.5} y2={oy + opWidthPx / 2 - 1} stroke="#0EA5E9" strokeWidth={0.6} />
                            </>
                          ) : (
                            <line x1={ox} y1={oy - opWidthPx / 2} x2={ox} y2={oy + opWidthPx / 2} stroke="#F59E0B" strokeWidth={1} strokeDasharray="3,2" />
                          )}
                        </>
                      )}
                    </g>
                  );
                })}

                {/* Opening count badge */}
                {(roomOpenings[room.id]?.length || 0) > 0 && (
                  <>
                    <circle cx={x + 8} cy={y + 8} r={5.5} fill="#0EA5E9" opacity={0.9} />
                    <text x={x + 8} y={y + 8.5} textAnchor="middle" dominantBaseline="middle"
                      fontSize="5" fill="white" fontWeight="bold" style={{ pointerEvents: "none" }}>
                      {roomOpenings[room.id].reduce((sum, o) => sum + (o.quantity || 1), 0)}
                    </text>
                  </>
                )}

                {room.viewType && room.viewType !== "interior" && (
                  <text x={x + 4} y={y + h - 4} fontSize="4.5" fontFamily={FONT} fill="#94A3B8"
                    style={{ pointerEvents: "none", textTransform: "uppercase" as const, letterSpacing: "0.5px" }}>
                    {room.viewType}
                  </text>
                )}

                {room.damageCount > 0 && (
                  <>
                    <circle cx={x + w - 8} cy={y + 8} r={6} fill="#EF4444" opacity={0.9} />
                    <text x={x + w - 8} y={y + 8.5} textAnchor="middle" dominantBaseline="middle"
                      fontSize="6" fill="white" fontWeight="bold" style={{ pointerEvents: "none" }}>
                      {room.damageCount}
                    </text>
                  </>
                )}

                {/* Dimension labels on edges */}
                <text x={x + w / 2} y={y - 4} textAnchor="middle" fontSize="5.5" fontFamily={MONO} fill="#94A3B8"
                  style={{ pointerEvents: "none" }}>
                  {lengthFt}'
                </text>
                <g transform={`translate(${x - 4}, ${y + h / 2}) rotate(-90)`}>
                  <text x={0} y={0} textAnchor="middle" fontSize="5.5" fontFamily={MONO} fill="#94A3B8"
                    style={{ pointerEvents: "none" }}>
                    {widthFt}'
                  </text>
                </g>

                {/* Dimension arrows top */}
                <line x1={x + 4} y1={y - 2} x2={x + w - 4} y2={y - 2} stroke="#94A3B8" strokeWidth={0.4} markerStart="url(#arrowL)" markerEnd="url(#arrowR)" />

                {/* Resize handles (only when selected) */}
                {isSelected && (
                  <>
                    {/* Corner handles */}
                    <rect x={x - HANDLE_SIZE / 2} y={y - HANDLE_SIZE / 2} width={HANDLE_SIZE} height={HANDLE_SIZE}
                      fill="white" stroke="#7763B7" strokeWidth={1.5} rx={1} style={{ cursor: "nw-resize" }} />
                    <rect x={x + w - HANDLE_SIZE / 2} y={y - HANDLE_SIZE / 2} width={HANDLE_SIZE} height={HANDLE_SIZE}
                      fill="white" stroke="#7763B7" strokeWidth={1.5} rx={1} style={{ cursor: "ne-resize" }} />
                    <rect x={x - HANDLE_SIZE / 2} y={y + h - HANDLE_SIZE / 2} width={HANDLE_SIZE} height={HANDLE_SIZE}
                      fill="white" stroke="#7763B7" strokeWidth={1.5} rx={1} style={{ cursor: "sw-resize" }} />
                    <rect x={x + w - HANDLE_SIZE / 2} y={y + h - HANDLE_SIZE / 2} width={HANDLE_SIZE} height={HANDLE_SIZE}
                      fill="white" stroke="#7763B7" strokeWidth={1.5} rx={1} style={{ cursor: "se-resize" }} />

                    {/* Edge handles */}
                    <rect x={x + w / 2 - HANDLE_SIZE / 2} y={y - HANDLE_SIZE / 2} width={HANDLE_SIZE} height={HANDLE_SIZE / 2}
                      fill="white" stroke="#7763B7" strokeWidth={1} rx={1} style={{ cursor: "n-resize" }} />
                    <rect x={x + w / 2 - HANDLE_SIZE / 2} y={y + h} width={HANDLE_SIZE} height={HANDLE_SIZE / 2}
                      fill="white" stroke="#7763B7" strokeWidth={1} rx={1} style={{ cursor: "s-resize" }} />
                    <rect x={x - HANDLE_SIZE / 2} y={y + h / 2 - HANDLE_SIZE / 2} width={HANDLE_SIZE / 2} height={HANDLE_SIZE}
                      fill="white" stroke="#7763B7" strokeWidth={1} rx={1} style={{ cursor: "w-resize" }} />
                    <rect x={x + w} y={y + h / 2 - HANDLE_SIZE / 2} width={HANDLE_SIZE / 2} height={HANDLE_SIZE}
                      fill="white" stroke="#7763B7" strokeWidth={1} rx={1} style={{ cursor: "e-resize" }} />

                    {/* Selection outline */}
                    <rect x={x - 1} y={y - 1} width={w + 2} height={h + 2}
                      fill="none" stroke="#7763B7" strokeWidth={0.5} strokeDasharray="4,2" rx={1} />
                  </>
                )}
              </g>
            );
          })}

          <defs>
            <marker id="arrowL" markerWidth="4" markerHeight="4" refX="0" refY="2" orient="auto">
              <path d="M4,0 L0,2 L4,4" fill="none" stroke="#94A3B8" strokeWidth={0.5} />
            </marker>
            <marker id="arrowR" markerWidth="4" markerHeight="4" refX="4" refY="2" orient="auto">
              <path d="M0,0 L4,2 L0,4" fill="none" stroke="#94A3B8" strokeWidth={0.5} />
            </marker>
          </defs>
        </svg>

        {/* Status bar */}
        <div className="absolute bottom-0 left-0 right-0 px-3 py-1.5 bg-white/80 backdrop-blur-sm border-t border-slate-100 flex items-center justify-between">
          <span className="text-[10px] font-mono text-slate-400">
            {editableRooms.length} room{editableRooms.length !== 1 ? "s" : ""}
            {selectedRoomId && (() => {
              const pos = localPositions[selectedRoomId];
              if (!pos) return "";
              const lFt = Math.round((pos.w / SCALE) * 10) / 10;
              const wFt = Math.round((pos.h / SCALE) * 10) / 10;
              return ` · ${lFt}' × ${wFt}' = ${Math.round(lFt * wFt)} SF`;
            })()}
          </span>
          <span className="text-[10px] font-mono text-slate-300">
            {showGrid ? `Grid ${GRID_SIZE}px · Snap on` : "Free position"}
          </span>
        </div>
      </div>
    </div>
  );
}
