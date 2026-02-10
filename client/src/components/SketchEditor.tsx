/**
 * Touch-first, on-canvas interior sketch editor.
 * Uses BFS layout. Tool modes: Select, Add Door, Add Window, Add Damage.
 * Resize handles, click-to-place openings, damage markers. Undo/redo with persistence.
 */
import React, { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { MousePointer2, DoorOpen, Square, AlertTriangle, RotateCcw, RotateCw, ZoomIn, ZoomOut, Maximize2, Move } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SketchRenderer, type LayoutRect, type OpeningData, type AnnotationData } from "./SketchRenderer";
import { bfsLayout, hitTestWall, type Adjacency } from "@/lib/sketchLayout";

interface RoomData {
  id: number;
  name: string;
  status: string;
  damageCount: number;
  photoCount: number;
  roomType?: string;
  dimensions?: { length?: number; width?: number; height?: number; dimVars?: any };
  viewType?: string;
  parentRoomId?: number | null;
}

interface SketchEditorProps {
  rooms: RoomData[];
  sessionId: number;
  currentRoomId: number | null;
  onRoomSelect?: (roomId: number) => void;
  onRoomUpdate?: () => void;
  onAddRoom?: () => void;
  onEditRoom?: (roomId: number) => void;
  className?: string;
  getAuthHeaders: () => Promise<Record<string, string>>;
}

type ToolMode = "select" | "add_door" | "add_window" | "add_damage";
type DragMode = "none" | "pan" | "resize" | "opening_drag";

type HistoryEntry =
  | { type: "resize"; roomId: number; length: number; width: number }
  | { type: "add_opening"; openingId: number }
  | { type: "add_annotation"; annotationId: number }
  | { type: "move_opening"; openingId: number; positionOnWall: number };

const SCALE = 4;
const MIN_W = 44;
const MIN_H = 32;
const HIT_PADDING = 12;
const HANDLE_SIZE = 8;

function categorizeInterior(rooms: RoomData[]): RoomData[] {
  return rooms.filter((r) => {
    if (r.parentRoomId) return false;
    const vt = r.viewType || "";
    const rt = r.roomType || "";
    if (vt === "roof_plan" || rt === "exterior_roof_slope") return false;
    if (vt === "elevation" || rt.startsWith("exterior_elevation_")) return false;
    if (vt === "exterior_other" || (rt.startsWith("exterior_") && !rt.includes("elevation") && !rt.includes("roof"))) return false;
    return true;
  });
}

export default function SketchEditor({
  rooms,
  sessionId,
  currentRoomId,
  onRoomSelect,
  onRoomUpdate,
  onAddRoom,
  onEditRoom,
  className,
  getAuthHeaders,
}: SketchEditorProps) {
  const queryClient = useQueryClient();
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [tool, setTool] = useState<ToolMode>("select");
  const [viewBox, setViewBox] = useState({ x: -20, y: -20, w: 520, h: 400 });
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [selectedOpeningId, setSelectedOpeningId] = useState<number | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<number | null>(null);

  const [dragMode, setDragMode] = useState<DragMode>("none");
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragRoomId, setDragRoomId] = useState<number | null>(null);
  const [dragHandle, setDragHandle] = useState<string>("");
  const [dragRoomStart, setDragRoomStart] = useState({ length: 0, width: 0, w: 0, h: 0 });
  const [dragOpeningId, setDragOpeningId] = useState<number | null>(null);
  const [dragOpeningStart, setDragOpeningStart] = useState(0);

  const [dragDimensions, setDragDimensions] = useState<Record<number, { length: number; width: number }>>({});
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const { data: adjacencyData } = useQuery<Adjacency[]>({
    queryKey: [`/api/sessions/${sessionId}/adjacencies`],
    enabled: !!sessionId,
    refetchInterval: 10000,
  });
  const { data: openingsData } = useQuery<OpeningData[]>({
    queryKey: [`/api/inspection/${sessionId}/openings`],
    enabled: !!sessionId,
    refetchInterval: 10000,
  });

  const interiorRooms = useMemo(() => categorizeInterior(rooms), [rooms]);
  const adjacencies = adjacencyData || [];
  const allOpenings = openingsData || [];

  const effectiveRooms = useMemo(() => {
    return interiorRooms.map((r) => {
      const over = dragDimensions[r.id];
      const dims = over ? { ...r.dimensions, length: over.length, width: over.width } : r.dimensions;
      return { ...r, dimensions: dims };
    });
  }, [interiorRooms, dragDimensions]);

  const layouts = useMemo(() => {
    const adjForInterior = adjacencies.filter(
      (a) => interiorRooms.some((r) => r.id === a.roomIdA) && interiorRooms.some((r) => r.id === a.roomIdB)
    );
    const placed = bfsLayout(
      effectiveRooms.map((r) => ({ id: r.id, name: r.name, status: r.status, damageCount: r.damageCount, photoCount: r.photoCount, dimensions: r.dimensions })),
      adjForInterior,
      SCALE,
      MIN_W,
      MIN_H
    );
    const minX = Math.min(...placed.map((l) => l.x));
    const minY = Math.min(...placed.map((l) => l.y));
    return placed.map((l) => ({
      roomId: l.room.id,
      x: l.x - minX,
      y: l.y - minY,
      w: l.w,
      h: l.h,
      room: l.room,
    })) as LayoutRect[];
  }, [effectiveRooms, adjacencies, interiorRooms]);

  const openingsByRoom = useMemo(() => {
    const m = new Map<number, OpeningData[]>();
    for (const o of allOpenings) {
      const op: OpeningData = {
        id: o.id,
        roomId: o.roomId,
        openingType: o.openingType || "door",
        wallDirection: o.wallDirection,
        positionOnWall: o.positionOnWall ?? 0.5,
        widthFt: o.widthFt ?? o.width ?? 3,
        heightFt: o.heightFt ?? o.height ?? 7,
      };
      if (!m.has(op.roomId)) m.set(op.roomId, []);
      m.get(op.roomId)!.push(op);
    }
    return m;
  }, [allOpenings]);

  const [annotationsByRoom, setAnnotationsByRoom] = useState<Record<number, AnnotationData[]>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const byRoom: Record<number, AnnotationData[]> = {};
      for (const r of interiorRooms) {
        try {
          const headers = await getAuthHeaders();
          const res = await fetch(`/api/inspection/${sessionId}/rooms/${r.id}/annotations`, { headers });
          if (!res.ok || cancelled) continue;
          const list: any[] = await res.json();
          byRoom[r.id] = list.map((a) => ({
            id: a.id,
            roomId: a.roomId || r.id,
            annotationType: a.annotationType || "damage",
            label: a.label || "",
            value: a.value,
            position: a.position,
          }));
        } catch {
          /* ignore */
        }
      }
      if (!cancelled) setAnnotationsByRoom(byRoom);
    })();
    return () => { cancelled = true; };
  }, [sessionId, interiorRooms, getAuthHeaders]);

  const allAnnotations = useMemo(() => Object.values(annotationsByRoom).flat(), [annotationsByRoom]);

  const getSvgPoint = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      const scaleX = viewBox.w / rect.width;
      const scaleY = viewBox.h / rect.height;
      return {
        x: viewBox.x + (clientX - rect.left) * scaleX,
        y: viewBox.y + (clientY - rect.top) * scaleY,
      };
    },
    [viewBox]
  );

  const layoutByRoomId = useMemo(() => {
    const m = new Map<number, LayoutRect>();
    for (const l of layouts) m.set(l.roomId, l);
    return m;
  }, [layouts]);

  const pushHistory = useCallback((entry: HistoryEntry) => {
    setHistory((prev) => [...prev.slice(-49), entry]);
  }, []);

  const performUndo = useCallback(async () => {
    const entry = history[history.length - 1];
    if (!entry) return;
    setHistory((prev) => prev.slice(0, -1));
    try {
      const headers = await getAuthHeaders();
      if (entry.type === "resize") {
        await fetch(`/api/rooms/${entry.roomId}/dimensions`, {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ length: entry.length, width: entry.width }),
        });
      } else if (entry.type === "add_opening") {
        const op = allOpenings.find((o) => o.id === entry.openingId);
        if (op) {
          await fetch(`/api/inspection/${sessionId}/rooms/${op.roomId}/openings/${entry.openingId}`, {
            method: "DELETE",
            headers: await getAuthHeaders(),
          });
        }
      } else if (entry.type === "add_annotation") {
        await fetch(`/api/inspection/${sessionId}/annotations/${entry.annotationId}`, {
          method: "DELETE",
          headers: await getAuthHeaders(),
        });
      } else if (entry.type === "move_opening") {
        const op = allOpenings.find((o) => o.id === entry.openingId);
        if (op) {
          await fetch(`/api/inspection/${sessionId}/rooms/${op.roomId}/openings/${entry.openingId}`, {
            method: "PATCH",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ positionOnWall: entry.positionOnWall }),
          });
        }
      }
      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/hierarchy`] });
      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/openings`] });
      onRoomUpdate?.();
    } catch (e) {
      console.error("Undo failed:", e);
    }
  }, [history, sessionId, allOpenings, getAuthHeaders, queryClient, onRoomUpdate]);

  const persistRoomDimensions = useCallback(
    async (roomId: number, length: number, width: number) => {
      const room = interiorRooms.find((r) => r.id === roomId);
      const height = room?.dimensions?.height || 8;
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`/api/rooms/${roomId}/dimensions`, {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ length, width, height }),
        });
        if (res.ok) {
          queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/hierarchy`] });
          onRoomUpdate?.();
        }
      } catch (e) {
        console.error("Failed to persist room dimensions:", e);
      }
    },
    [interiorRooms, sessionId, getAuthHeaders, queryClient, onRoomUpdate]
  );

  const persistOpeningPosition = useCallback(
    async (openingId: number, positionOnWall: number) => {
      const op = allOpenings.find((o) => o.id === openingId);
      if (!op) return;
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`/api/inspection/${sessionId}/rooms/${op.roomId}/openings/${openingId}`, {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ positionOnWall }),
        });
        if (res.ok) {
          queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/openings`] });
          onRoomUpdate?.();
        }
      } catch (e) {
        console.error("Failed to persist opening position:", e);
      }
    },
    [sessionId, allOpenings, getAuthHeaders, queryClient, onRoomUpdate]
  );

  const handleSvgPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const svgPt = getSvgPoint(e.clientX, e.clientY);

      if (tool === "add_door" || tool === "add_window") {
        for (const layout of layouts) {
          const hit = hitTestWall(layout.x, layout.y, layout.w, layout.h, svgPt.x, svgPt.y, HIT_PADDING);
          if (hit) {
            const offset = hit.offset;
            const roomId = layout.roomId;
            const openingType = tool === "add_door" ? "door" : "window";
            (async () => {
              try {
                const headers = await getAuthHeaders();
                const res = await fetch(`/api/inspection/${sessionId}/rooms/${roomId}/openings`, {
                  method: "POST",
                  headers: { ...headers, "Content-Type": "application/json" },
                  body: JSON.stringify({
                    openingType,
                    wallDirection: hit.wall,
                    positionOnWall: offset,
                    widthFt: 3,
                    heightFt: openingType === "door" ? 6.8 : 4,
                  }),
                });
                if (res.ok) {
                  const created = await res.json();
                  pushHistory({ type: "add_opening", openingId: created.id });
                  queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/openings`] });
                  onRoomUpdate?.();
                }
              } catch (err) {
                console.error("Create opening error:", err);
              }
            })();
            return;
          }
        }
        return;
      }

      if (tool === "add_damage") {
        for (const layout of layouts) {
          if (svgPt.x >= layout.x && svgPt.x <= layout.x + layout.w && svgPt.y >= layout.y && svgPt.y <= layout.y + layout.h) {
            const roomId = layout.roomId;
            const pos = { x: (svgPt.x - layout.x) / layout.w, y: (svgPt.y - layout.y) / layout.h };
            (async () => {
              try {
                const headers = await getAuthHeaders();
                const res = await fetch(`/api/inspection/${sessionId}/rooms/${roomId}/annotations`, {
                  method: "POST",
                  headers: { ...headers, "Content-Type": "application/json" },
                  body: JSON.stringify({
                    annotationType: "damage",
                    label: "Damage",
                    value: "moderate",
                    position: pos,
                  }),
                });
                if (res.ok) {
                  const created = await res.json();
                  pushHistory({ type: "add_annotation", annotationId: created.id });
                  setAnnotationsByRoom((prev) => {
                    const list = prev[roomId] || [];
                    const ann: AnnotationData = {
                      id: created.id,
                      roomId,
                      annotationType: "damage",
                      label: "Damage",
                      value: "moderate",
                      position: pos,
                    };
                    return { ...prev, [roomId]: [...list, ann] };
                  });
                  queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/hierarchy`] });
                  onRoomUpdate?.();
                }
              } catch (err) {
                console.error("Create annotation error:", err);
              }
            })();
            return;
          }
        }
        return;
      }

      if (tool === "select") {
        setSelectedOpeningId(null);
        setSelectedAnnotationId(null);
        for (const layout of layouts) {
          if (selectedRoomId === layout.roomId) {
            const hs = HANDLE_SIZE;
            const { x, y, w, h } = layout;
            if (svgPt.x >= x + w - hs && svgPt.y >= y + h - hs && svgPt.x <= x + w + hs && svgPt.y <= y + h + hs) {
              setDragMode("resize");
              setDragRoomId(layout.roomId);
              setDragHandle("se");
              setDragRoomStart({
                length: (layout.room.dimensions as any)?.length || w / SCALE,
                width: (layout.room.dimensions as any)?.width || h / SCALE,
                w: layout.w,
                h: layout.h,
              });
              (e.target as Element)?.setPointerCapture?.(e.pointerId);
              return;
            }
            if (svgPt.x >= x - hs && svgPt.y >= y + h - hs && svgPt.x <= x + hs && svgPt.y <= y + h + hs) {
              setDragMode("resize");
              setDragRoomId(layout.roomId);
              setDragHandle("sw");
              setDragRoomStart({
                length: (layout.room.dimensions as any)?.length || w / SCALE,
                width: (layout.room.dimensions as any)?.width || h / SCALE,
                w: layout.w,
                h: layout.h,
              });
              (e.target as Element)?.setPointerCapture?.(e.pointerId);
              return;
            }
            if (svgPt.x >= x + w - hs && svgPt.y >= y - hs && svgPt.x <= x + w + hs && svgPt.y <= y + hs) {
              setDragMode("resize");
              setDragRoomId(layout.roomId);
              setDragHandle("ne");
              setDragRoomStart({
                length: (layout.room.dimensions as any)?.length || w / SCALE,
                width: (layout.room.dimensions as any)?.width || h / SCALE,
                w: layout.w,
                h: layout.h,
              });
              (e.target as Element)?.setPointerCapture?.(e.pointerId);
              return;
            }
            if (svgPt.x >= x - hs && svgPt.y >= y - hs && svgPt.x <= x + hs && svgPt.y <= y + hs) {
              setDragMode("resize");
              setDragRoomId(layout.roomId);
              setDragHandle("nw");
              setDragRoomStart({
                length: (layout.room.dimensions as any)?.length || w / SCALE,
                width: (layout.room.dimensions as any)?.width || h / SCALE,
                w: layout.w,
                h: layout.h,
              });
              (e.target as Element)?.setPointerCapture?.(e.pointerId);
              return;
            }
            if (svgPt.x >= x + w - hs && svgPt.y >= y + h * 0.3 && svgPt.x <= x + w + hs && svgPt.y <= y + h * 0.7) {
              setDragMode("resize");
              setDragRoomId(layout.roomId);
              setDragHandle("e");
              setDragRoomStart({
                length: (layout.room.dimensions as any)?.length || w / SCALE,
                width: (layout.room.dimensions as any)?.width || h / SCALE,
                w: layout.w,
                h: layout.h,
              });
              (e.target as Element)?.setPointerCapture?.(e.pointerId);
              return;
            }
            if (svgPt.x >= x - hs && svgPt.y >= y + h * 0.3 && svgPt.x <= x + hs && svgPt.y <= y + h * 0.7) {
              setDragMode("resize");
              setDragRoomId(layout.roomId);
              setDragHandle("w");
              setDragRoomStart({
                length: (layout.room.dimensions as any)?.length || w / SCALE,
                width: (layout.room.dimensions as any)?.width || h / SCALE,
                w: layout.w,
                h: layout.h,
              });
              (e.target as Element)?.setPointerCapture?.(e.pointerId);
              return;
            }
            if (svgPt.y >= y - hs && svgPt.y <= y + hs && svgPt.x >= x + w * 0.3 && svgPt.x <= x + w * 0.7) {
              setDragMode("resize");
              setDragRoomId(layout.roomId);
              setDragHandle("n");
              setDragRoomStart({
                length: (layout.room.dimensions as any)?.length || w / SCALE,
                width: (layout.room.dimensions as any)?.width || h / SCALE,
                w: layout.w,
                h: layout.h,
              });
              (e.target as Element)?.setPointerCapture?.(e.pointerId);
              return;
            }
            if (svgPt.y >= y + h - hs && svgPt.y <= y + h + hs && svgPt.x >= x + w * 0.3 && svgPt.x <= x + w * 0.7) {
              setDragMode("resize");
              setDragRoomId(layout.roomId);
              setDragHandle("s");
              setDragRoomStart({
                length: (layout.room.dimensions as any)?.length || w / SCALE,
                width: (layout.room.dimensions as any)?.width || h / SCALE,
                w: layout.w,
                h: layout.h,
              });
              (e.target as Element)?.setPointerCapture?.(e.pointerId);
              return;
            }
          }

          if (svgPt.x >= layout.x && svgPt.x <= layout.x + layout.w && svgPt.y >= layout.y && svgPt.y <= layout.y + layout.h) {
            setSelectedRoomId(layout.roomId);
            onRoomSelect?.(layout.roomId);
            return;
          }
        }
        setSelectedRoomId(null);
        setDragStart({ x: e.clientX, y: e.clientY });
        setDragMode("pan");
        (e.target as Element)?.setPointerCapture?.(e.pointerId);
      }
    },
    [
      tool,
      getSvgPoint,
      layouts,
      selectedRoomId,
      sessionId,
      pushHistory,
      getAuthHeaders,
      queryClient,
      onRoomUpdate,
      onRoomSelect,
    ]
  );

  const handleRoomPointerDown = useCallback(
    (roomId: number) => {
      if (tool === "select") {
        setSelectedRoomId(roomId);
        setSelectedOpeningId(null);
        setSelectedAnnotationId(null);
        onRoomSelect?.(roomId);
      }
    },
    [tool, onRoomSelect]
  );

  const handleOpeningPointerDown = useCallback(
    (openingId: number, e: React.PointerEvent) => {
      if (tool === "select") {
        e.stopPropagation();
        const op = allOpenings.find((o) => o.id === openingId);
        if (!op) return;
        const oldPos = op.positionOnWall ?? 0.5;
        pushHistory({ type: "move_opening", openingId, positionOnWall: oldPos });
        setSelectedOpeningId(openingId);
        setSelectedAnnotationId(null);
        setSelectedRoomId(op.roomId);
        onRoomSelect?.(op.roomId);
        setDragOpeningId(openingId);
        setDragOpeningStart(oldPos);
        setDragMode("opening_drag");
        (e.target as Element)?.setPointerCapture?.(e.pointerId);
      }
    },
    [tool, allOpenings, onRoomSelect, pushHistory]
  );

  const handleAnnotationPointerDown = useCallback(
    (annotationId: number) => {
      if (tool === "select") {
        setSelectedAnnotationId(annotationId);
        const ann = allAnnotations.find((a) => a.id === annotationId);
        if (ann) setSelectedRoomId(ann.roomId);
      }
    },
    [tool, allAnnotations]
  );

  const handleHandlePointerDown = useCallback(
    (roomId: number, handle: string, e: React.PointerEvent) => {
      e.stopPropagation();
      const layout = layoutByRoomId.get(roomId);
      if (!layout) return;
      setDragMode("resize");
      setDragRoomId(roomId);
      setDragHandle(handle);
      setDragRoomStart({
        length: (layout.room.dimensions as any)?.length || layout.w / SCALE,
        width: (layout.room.dimensions as any)?.width || layout.h / SCALE,
        w: layout.w,
        h: layout.h,
      });
      (e.target as Element)?.setPointerCapture?.(e.pointerId);
    },
    [layoutByRoomId]
  );

  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (dragMode === "pan") {
        const svg = svgRef.current;
        const rect = svg?.getBoundingClientRect();
        if (!rect) return;
        const dx = (e.clientX - dragStart.x) * (viewBox.w / rect.width);
        const dy = (e.clientY - dragStart.y) * (viewBox.h / rect.height);
        setViewBox((prev) => ({ ...prev, x: prev.x - dx, y: prev.y - dy }));
        setDragStart({ x: e.clientX, y: e.clientY });
        return;
      }
      if (dragMode === "resize" && dragRoomId !== null) {
        const svgPt = getSvgPoint(e.clientX, e.clientY);
        const layout = layoutByRoomId.get(dragRoomId);
        if (!layout) return;
        const orig = dragRoomStart;
        const pxPerFt = layout.w / Math.max(orig.length, 1);
        const pyPerFt = layout.h / Math.max(orig.width, 1);
        let dL = 0,
          dW = 0;
        if (dragHandle.includes("e")) dL = (svgPt.x - (layout.x + layout.w)) / pxPerFt;
        if (dragHandle.includes("w")) dL = (layout.x - svgPt.x) / pxPerFt;
        if (dragHandle.includes("s")) dW = (svgPt.y - (layout.y + layout.h)) / pyPerFt;
        if (dragHandle.includes("n")) dW = (layout.y - svgPt.y) / pyPerFt;
        const newLength = Math.max(5, orig.length + dL);
        const newWidth = Math.max(5, orig.width + dW);
        setDragDimensions((prev) => ({ ...prev, [dragRoomId]: { length: newLength, width: newWidth } }));
        return;
      }
      if (dragMode === "opening_drag" && dragOpeningId !== null) {
        const svgPt = getSvgPoint(e.clientX, e.clientY);
        const op = allOpenings.find((o) => o.id === dragOpeningId);
        if (!op) return;
        const layout = layoutByRoomId.get(op.roomId);
        if (!layout) return;
        const wallDir = (op.wallDirection || "north").toLowerCase();
        const isHoriz = wallDir === "north" || wallDir === "south";
        const wallLen = isHoriz ? layout.w : layout.h;
        const coord = isHoriz ? svgPt.x - layout.x : svgPt.y - layout.y;
        const pos = Math.max(0, Math.min(1, coord / wallLen));
        persistOpeningPosition(dragOpeningId, Math.round(pos * 100) / 100);
      }
    };
    window.addEventListener("pointermove", handler);
    return () => window.removeEventListener("pointermove", handler);
  }, [
    dragMode,
    dragRoomId,
    dragHandle,
    dragOpeningId,
    dragRoomStart,
    dragStart,
    viewBox,
    getSvgPoint,
    layoutByRoomId,
    persistOpeningPosition,
    allOpenings,
  ]);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (dragMode === "resize" && dragRoomId !== null && dragDimensions[dragRoomId]) {
        const d = dragDimensions[dragRoomId];
        const newL = Math.round(d.length * 10) / 10;
        const newW = Math.round(d.width * 10) / 10;
        pushHistory({ type: "resize", roomId: dragRoomId, length: dragRoomStart.length, width: dragRoomStart.width });
        persistRoomDimensions(dragRoomId, newL, newW);
      }
      if (dragMode !== "none") {
        setDragMode("none");
        setDragRoomId(null);
        setDragOpeningId(null);
        setDragDimensions({});
      }
      (e.target as Element)?.releasePointerCapture?.(e.pointerId);
    },
    [dragMode, dragRoomId, dragDimensions, dragRoomStart, persistRoomDimensions, pushHistory]
  );

  const fitToContent = useCallback(() => {
    if (layouts.length === 0) return;
    const minX = Math.min(...layouts.map((l) => l.x)) - 40;
    const minY = Math.min(...layouts.map((l) => l.y)) - 40;
    const maxX = Math.max(...layouts.map((l) => l.x + l.w)) + 40;
    const maxY = Math.max(...layouts.map((l) => l.y + l.h)) + 40;
    setViewBox({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
  }, [layouts]);

  const allOpeningsList = useMemo(() => {
    const list: OpeningData[] = [];
    for (const layout of layouts) {
      const ops = openingsByRoom.get(layout.roomId) || [];
      for (const o of ops) {
        list.push({
          ...o,
          roomId: layout.roomId,
        });
      }
    }
    return list;
  }, [layouts, openingsByRoom]);

  const allAnnotationsList = useMemo(() => {
    const list: AnnotationData[] = [];
    for (const layout of layouts) {
      const anns = annotationsByRoom[layout.roomId] || [];
      for (const a of anns) {
        list.push({ ...a, roomId: layout.roomId });
      }
    }
    return list;
  }, [layouts, annotationsByRoom]);

  if (interiorRooms.length === 0) {
    return (
      <div className={cn("flex flex-col bg-white rounded-lg border border-slate-200 overflow-hidden", className)}>
        <div className="flex items-center justify-center p-8 text-slate-500 text-sm">
          No interior rooms. Add rooms first.
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col bg-white rounded-lg border border-slate-200 overflow-hidden", className)} data-testid="sketch-editor">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-100">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-widest text-slate-500 font-mono font-semibold">Sketch Editor</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setTool("select")}
            className={cn("p-1.5 rounded transition-colors", tool === "select" ? "bg-purple-100 text-purple-700" : "text-slate-400 hover:bg-slate-100")}
            title="Select & Resize"
            data-testid="tool-select"
          >
            <MousePointer2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setTool("add_door")}
            className={cn("p-1.5 rounded transition-colors", tool === "add_door" ? "bg-purple-100 text-purple-700" : "text-slate-400 hover:bg-slate-100")}
            title="Add Door"
            data-testid="tool-door"
          >
            <DoorOpen className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setTool("add_window")}
            className={cn("p-1.5 rounded transition-colors", tool === "add_window" ? "bg-purple-100 text-purple-700" : "text-slate-400 hover:bg-slate-100")}
            title="Add Window"
            data-testid="tool-window"
          >
            <Square className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setTool("add_damage")}
            className={cn("p-1.5 rounded transition-colors", tool === "add_damage" ? "bg-purple-100 text-purple-700" : "text-slate-400 hover:bg-slate-100")}
            title="Add Damage"
            data-testid="tool-damage"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-4 bg-slate-200 mx-1" />
          <button onClick={fitToContent} className="p-1.5 rounded text-slate-400 hover:bg-slate-100" title="Fit" data-testid="fit-content">
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          {onAddRoom && (
            <>
              <div className="w-px h-4 bg-slate-200 mx-1" />
              <button
                onClick={onAddRoom}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-green-700 bg-green-50 border border-green-200 hover:bg-green-100"
                data-testid="button-add-room-editor"
              >
                Room
              </button>
            </>
          )}
        </div>
      </div>

      <div
        className="relative flex-1 min-h-[400px] overflow-hidden"
        style={{ touchAction: "none" }}
        onPointerDown={handleSvgPointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={handlePointerUp}
      >
        <SketchRenderer
          ref={svgRef}
          layouts={layouts}
          openings={allOpeningsList}
          annotations={allAnnotationsList}
          selection={{
            selectedRoomId,
            selectedOpeningId,
            selectedAnnotationId,
          }}
          viewBox={viewBox}
          onRoomPointerDown={handleRoomPointerDown}
          onOpeningPointerDown={handleOpeningPointerDown}
          onAnnotationPointerDown={handleAnnotationPointerDown}
          onHandlePointerDown={handleHandlePointerDown}
          renderHandles={tool === "select"}
        />
      </div>
    </div>
  );
}
