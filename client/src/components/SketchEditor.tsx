/**
 * Touch-first, on-canvas interior sketch editor.
 * Tool modes: Select, Add Room, Add Door, Add Window, Add Damage, Pan.
 * Resize handles, ghost preview for add room, opening/annotation editors, undo/redo.
 */
import React, { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { MousePointer2, DoorOpen, Square, AlertTriangle, RotateCcw, RotateCw, ZoomIn, ZoomOut, Maximize2, Move, Plus, X, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SketchRenderer, type LayoutRect, type OpeningData, type AnnotationData, type GhostPreview } from "./SketchRenderer";
import PropertySketch from "./PropertySketch";
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
  structureName?: string;
  onRoomSelect?: (roomId: number) => void;
  onRoomUpdate?: () => void;
  onAddRoom?: () => void;
  onEditRoom?: (roomId: number) => void;
  className?: string;
  getAuthHeaders: () => Promise<Record<string, string>>;
}

type ToolMode = "select" | "add_room" | "add_door" | "add_window" | "add_damage" | "pan";
type DragMode = "none" | "pan" | "resize" | "opening_drag";

const OPPOSITE_WALL: Record<string, string> = { north: "south", south: "north", east: "west", west: "east" };

type HistoryEntry =
  | { type: "resize"; roomId: number; length: number; width: number; newLength?: number; newWidth?: number }
  | { type: "add_opening"; openingId: number; create?: { roomId: number; openingType: string; wallDirection: string; positionOnWall: number; widthFt: number; heightFt: number } }
  | { type: "delete_opening"; openingId: number; create: { roomId: number; openingType: string; wallDirection: string; positionOnWall: number; widthFt: number; heightFt: number } }
  | { type: "add_annotation"; annotationId: number; create?: { roomId: number; label: string; value: string | null; position: Record<string, number> } }
  | { type: "move_opening"; openingId: number; positionOnWall: number }
  | { type: "add_room"; roomId: number }
  | { type: "edit_opening"; openingId: number; prev: { widthFt: number; heightFt: number; openingType: string } }
  | { type: "edit_annotation"; annotationId: number; prev: { label: string; value: string | null } }
  | { type: "delete_annotation"; annotationId: number; roomId: number; prev: AnnotationData };

const SCALE = 4;
const MIN_W = 44;
const MIN_H = 32;
const HIT_PADDING = 12;
const HANDLE_SIZE = 12;

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

function categorizeRoofElevExterior(rooms: RoomData[]): { roofSlopes: RoomData[]; elevations: RoomData[]; otherExterior: RoomData[] } {
  const roofSlopes: RoomData[] = [];
  const elevations: RoomData[] = [];
  const otherExterior: RoomData[] = [];
  for (const r of rooms) {
    if (r.parentRoomId) continue;
    const vt = r.viewType || "";
    const rt = r.roomType || "";
    if (vt === "roof_plan" || rt === "exterior_roof_slope") roofSlopes.push(r);
    else if (vt === "elevation" || rt.startsWith("exterior_elevation_")) elevations.push(r);
    else if (vt === "exterior_other" || (rt.startsWith("exterior_") && !rt.includes("elevation") && !rt.includes("roof"))) otherExterior.push(r);
  }
  return { roofSlopes, elevations, otherExterior };
}

export default function SketchEditor({
  rooms,
  sessionId,
  currentRoomId,
  structureName = "Main Dwelling",
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
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);

  const [ghostPreview, setGhostPreview] = useState<GhostPreview | null>(null);
  const [addRoomPopover, setAddRoomPopover] = useState<{
    roomId: number;
    wall: "north" | "south" | "east" | "west";
    layout: LayoutRect;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [addRoomForm, setAddRoomForm] = useState({ name: "New Room", length: "12", width: "12" });

  const [roomInspector, setRoomInspector] = useState<{ roomId: number; name: string; length: string; width: string; height: string } | null>(null);
  const [openingEditor, setOpeningEditor] = useState<{ opening: OpeningData; x: number; y: number } | null>(null);
  const [openingEditorForm, setOpeningEditorForm] = useState({ widthFt: "3", heightFt: "6.8", openingType: "door" });
  const [annotationEditor, setAnnotationEditor] = useState<{ annotation: AnnotationData; x: number; y: number } | null>(null);
  const [annotationEditorForm, setAnnotationEditorForm] = useState({ label: "Damage", value: "moderate" });

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
    setRedoStack([]);
  }, []);

  const performUndo = useCallback(async () => {
    const entry = history[history.length - 1];
    if (!entry) return;
    setHistory((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, entry]);
    try {
      const headers = await getAuthHeaders();
      if (entry.type === "resize") {
        await fetch(`/api/rooms/${entry.roomId}/dimensions`, {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ length: entry.length, width: entry.width }),
        });
      } else if (entry.type === "edit_opening") {
        const op = allOpenings.find((o) => o.id === entry.openingId);
        if (op) {
          await fetch(`/api/inspection/${sessionId}/rooms/${op.roomId}/openings/${entry.openingId}`, {
            method: "PATCH",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ widthFt: entry.prev.widthFt, heightFt: entry.prev.heightFt, openingType: entry.prev.openingType }),
          });
        }
      } else if (entry.type === "edit_annotation") {
        await fetch(`/api/inspection/${sessionId}/annotations/${entry.annotationId}`, {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ label: entry.prev.label, value: entry.prev.value }),
        });
      } else if (entry.type === "delete_annotation") {
        await fetch(`/api/inspection/${sessionId}/rooms/${entry.roomId}/annotations`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            annotationType: entry.prev.annotationType,
            label: entry.prev.label,
            value: entry.prev.value ?? null,
            position: entry.prev.position,
          }),
        });
      } else if (entry.type === "add_opening") {
        const op = allOpenings.find((o) => o.id === entry.openingId);
        if (op) {
          await fetch(`/api/inspection/${sessionId}/rooms/${op.roomId}/openings/${entry.openingId}`, {
            method: "DELETE",
            headers: await getAuthHeaders(),
          });
        }
      } else if (entry.type === "delete_opening" && entry.create) {
        const { roomId, openingType, wallDirection, positionOnWall, widthFt, heightFt } = entry.create;
        await fetch(`/api/inspection/${sessionId}/rooms/${roomId}/openings`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ openingType, wallDirection, positionOnWall, widthFt, heightFt }),
        });
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
      } else if (entry.type === "add_room") {
        await fetch(`/api/inspection/${sessionId}/rooms/${entry.roomId}`, {
          method: "DELETE",
          headers: await getAuthHeaders(),
        });
      }
      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/hierarchy`] });
      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/openings`] });
      onRoomUpdate?.();
    } catch (e) {
      console.error("Undo failed:", e);
    }
  }, [history, sessionId, allOpenings, getAuthHeaders, queryClient, onRoomUpdate]);

  const performRedo = useCallback(async () => {
    const entry = redoStack[redoStack.length - 1];
    if (!entry) return;
    setRedoStack((prev) => prev.slice(0, -1));
    setHistory((prev) => [...prev, entry]);
    try {
      const headers = await getAuthHeaders();
      if (entry.type === "resize" && entry.newLength != null && entry.newWidth != null) {
        await fetch(`/api/rooms/${entry.roomId}/dimensions`, {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ length: entry.newLength, width: entry.newWidth }),
        });
      } else if (entry.type === "add_opening" && entry.create) {
        const { roomId, openingType, wallDirection, positionOnWall, widthFt, heightFt } = entry.create;
        await fetch(`/api/inspection/${sessionId}/rooms/${roomId}/openings`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ openingType, wallDirection, positionOnWall, widthFt, heightFt }),
        });
      } else if (entry.type === "add_annotation" && entry.create) {
        const { roomId, label, value, position } = entry.create;
        await fetch(`/api/inspection/${sessionId}/rooms/${roomId}/annotations`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ annotationType: "damage", label, value, position }),
        });
      } else if (entry.type === "move_opening") {
        const op = allOpenings.find((o) => o.id === entry.openingId);
        if (op) {
          const currentPos = op.positionOnWall ?? 0.5;
          await fetch(`/api/inspection/${sessionId}/rooms/${op.roomId}/openings/${entry.openingId}`, {
            method: "PATCH",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ positionOnWall: currentPos }),
          });
        }
      }
      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/hierarchy`] });
      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/openings`] });
      onRoomUpdate?.();
    } catch (e) {
      console.error("Redo failed:", e);
    }
  }, [redoStack, sessionId, allOpenings, layoutByRoomId, getAuthHeaders, queryClient, onRoomUpdate]);

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

  const confirmAddRoom = useCallback(async () => {
    if (!addRoomPopover) return;
    const { roomId: adjacentToId, wall } = addRoomPopover;
    const len = parseFloat(addRoomForm.length) || 12;
    const wid = parseFloat(addRoomForm.width) || 12;
    const name = addRoomForm.name.trim() || "New Room";
    setAddRoomPopover(null);
    setGhostPreview(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/inspection/${sessionId}/rooms`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          structure: structureName,
          viewType: "interior",
          dimensions: { length: len, width: wid, height: 8 },
        }),
      });
      if (!res.ok) return;
      const newRoom = await res.json();
      await fetch(`/api/sessions/${sessionId}/adjacencies`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          roomIdA: newRoom.id,
          roomIdB: adjacentToId,
          wallDirectionA: OPPOSITE_WALL[wall] || "south",
          wallDirectionB: wall,
        }),
      });
      pushHistory({ type: "add_room", roomId: newRoom.id });
      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/hierarchy`] });
      queryClient.invalidateQueries({ queryKey: [`/api/sessions/${sessionId}/adjacencies`] });
      onRoomUpdate?.();
    } catch (e) {
      console.error("Add room error:", e);
    }
  }, [addRoomPopover, addRoomForm, sessionId, structureName, getAuthHeaders, queryClient, onRoomUpdate, pushHistory]);

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

      if (tool === "add_room") {
        for (const layout of layouts) {
          const hit = hitTestWall(layout.x, layout.y, layout.w, layout.h, svgPt.x, svgPt.y, HIT_PADDING);
          if (hit) {
            const len = parseFloat(addRoomForm.length) || 12;
            const wid = parseFloat(addRoomForm.width) || 12;
            const newW = Math.max(len * SCALE, MIN_W);
            const newH = Math.max(wid * SCALE, MIN_H);
            let gx: number, gy: number;
            switch (hit.wall) {
              case "north": gx = layout.x; gy = layout.y - newH; break;
              case "south": gx = layout.x; gy = layout.y + layout.h; break;
              case "east": gx = layout.x + layout.w; gy = layout.y; break;
              case "west": gx = layout.x - newW; gy = layout.y; break;
              default: gx = layout.x; gy = layout.y - newH; break;
            }
            setGhostPreview({ x: gx, y: gy, w: newW, h: newH, wall: hit.wall });
            setAddRoomPopover({ roomId: layout.roomId, wall: hit.wall, layout, x: gx, y: gy, w: newW, h: newH });
            return;
          }
        }
        return;
      }

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
                  pushHistory({
                    type: "add_opening",
                    openingId: created.id,
                    create: { roomId, openingType, wallDirection: hit.wall, positionOnWall: offset, widthFt: 3, heightFt: openingType === "door" ? 6.8 : 4 },
                  });
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
                  pushHistory({
                    type: "add_annotation",
                    annotationId: created.id,
                    create: { roomId, label: "Damage", value: "moderate", position: pos },
                  });
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

      if (tool === "pan") {
        setDragStart({ x: e.clientX, y: e.clientY });
        setDragMode("pan");
        (e.target as Element)?.setPointerCapture?.(e.pointerId);
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
        setRoomInspector(null);
        setOpeningEditor(null);
        setAnnotationEditor(null);
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
        setOpeningEditor(null);
        setAnnotationEditor(null);
        const room = interiorRooms.find((r) => r.id === roomId);
        const dims = room?.dimensions as { length?: number; width?: number; height?: number } | undefined;
        setRoomInspector(room ? {
          roomId,
          name: room.name,
          length: String(dims?.length ?? ""),
          width: String(dims?.width ?? ""),
          height: String(dims?.height ?? 8),
        } : null);
        onRoomSelect?.(roomId);
      }
    },
    [tool, interiorRooms, onRoomSelect]
  );

  const pushedForOpeningDrag = useRef(false);

  const handleOpeningPointerDown = useCallback(
    (openingId: number, e: React.PointerEvent) => {
      if (tool === "select") {
        e.stopPropagation();
        const op = allOpenings.find((o) => o.id === openingId);
        if (!op) return;
        const oldPos = op.positionOnWall ?? 0.5;
        pushedForOpeningDrag.current = false;
        setSelectedOpeningId(openingId);
        setSelectedAnnotationId(null);
        setSelectedRoomId(op.roomId);
        setRoomInspector(null);
        setAnnotationEditor(null);
        const layout = layoutByRoomId.get(op.roomId);
        setOpeningEditor(layout ? { opening: op, x: layout.x + layout.w / 2, y: layout.y } : null);
        setOpeningEditorForm({
          widthFt: String(op.widthFt ?? op.width ?? 3),
          heightFt: String(op.heightFt ?? op.height ?? 6.8),
          openingType: op.openingType || "door",
        });
        setDragOpeningId(openingId);
        setDragOpeningStart(oldPos);
        setDragMode("opening_drag");
        (e.target as Element)?.setPointerCapture?.(e.pointerId);
      }
    },
    [tool, allOpenings, layoutByRoomId, onRoomSelect]
  );

  const handleAnnotationPointerDown = useCallback(
    (annotationId: number, e: React.PointerEvent) => {
      if (tool === "select") {
        e.stopPropagation();
        setSelectedAnnotationId(annotationId);
        setRoomInspector(null);
        setOpeningEditor(null);
        const ann = allAnnotations.find((a) => a.id === annotationId);
        if (ann) {
          setSelectedRoomId(ann.roomId);
          const layout = layoutByRoomId.get(ann.roomId);
          const pos = ann.position as { x?: number; y?: number } | undefined;
          const px = layout && pos?.x != null ? layout.x + layout.w * (pos.x <= 1 ? pos.x : pos.x / 100) : 0;
          const py = layout && pos?.y != null ? layout.y + layout.h * (pos.y <= 1 ? pos.y : pos.y / 100) : 0;
          setAnnotationEditor({ annotation: ann, x: px, y: py });
          setAnnotationEditorForm({ label: ann.label, value: ann.value ?? "moderate" });
        }
      }
    },
    [tool, allAnnotations, layoutByRoomId]
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
        const rounded = Math.round(pos * 100) / 100;
        if (!pushedForOpeningDrag.current) {
          pushedForOpeningDrag.current = true;
          pushHistory({ type: "move_opening", openingId: dragOpeningId, positionOnWall: dragOpeningStart });
        }
        persistOpeningPosition(dragOpeningId, rounded);
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
    dragOpeningStart,
    viewBox,
    getSvgPoint,
    layoutByRoomId,
    persistOpeningPosition,
    allOpenings,
    pushHistory,
  ]);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (dragMode === "resize" && dragRoomId !== null && dragDimensions[dragRoomId]) {
        const d = dragDimensions[dragRoomId];
        const newL = Math.round(d.length * 10) / 10;
        const newW = Math.round(d.width * 10) / 10;
        pushHistory({ type: "resize", roomId: dragRoomId, length: dragRoomStart.length, width: dragRoomStart.width, newLength: newL, newWidth: newW });
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
            onClick={() => { setTool("add_room"); setAddRoomPopover(null); setGhostPreview(null); }}
            className={cn("p-1.5 rounded transition-colors", tool === "add_room" ? "bg-purple-100 text-purple-700" : "text-slate-400 hover:bg-slate-100")}
            title="Add Room"
            data-testid="tool-add-room"
          >
            <Plus className="w-3.5 h-3.5" />
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
          <button
            onClick={() => setTool("pan")}
            className={cn("p-1.5 rounded transition-colors", tool === "pan" ? "bg-purple-100 text-purple-700" : "text-slate-400 hover:bg-slate-100")}
            title="Pan"
            data-testid="tool-pan"
          >
            <Move className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setViewBox((v) => ({ ...v, w: v.w * 0.8, h: v.h * 0.8 }))}
            className="p-1.5 rounded text-slate-400 hover:bg-slate-100"
            title="Zoom In"
            data-testid="zoom-in"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setViewBox((v) => ({ ...v, w: v.w * 1.25, h: v.h * 1.25 }))}
            className="p-1.5 rounded text-slate-400 hover:bg-slate-100"
            title="Zoom Out"
            data-testid="zoom-out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={performUndo}
            disabled={history.length === 0}
            className="p-1.5 rounded text-slate-400 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Undo"
            data-testid="undo"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={performRedo}
            disabled={redoStack.length === 0}
            className="p-1.5 rounded text-slate-400 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Redo"
            data-testid="redo"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
          <button onClick={fitToContent} className="p-1.5 rounded text-slate-400 hover:bg-slate-100" title="Fit" data-testid="fit-content">
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Add Room popover */}
      {addRoomPopover && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-white border border-slate-200 rounded-lg shadow-lg p-3 min-w-[200px]" onClick={(e) => e.stopPropagation()}>
          <div className="text-xs font-semibold text-slate-600 mb-2">New Room</div>
          <div className="space-y-2">
            <input
              type="text"
              value={addRoomForm.name}
              onChange={(e) => setAddRoomForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Room name"
              className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded"
            />
            <div className="flex gap-2">
              <input
                type="number"
                value={addRoomForm.length}
                onChange={(e) => {
                  const v = e.target.value;
                  setAddRoomForm((f) => ({ ...f, length: v }));
                  setAddRoomPopover((p) => {
                    if (!p) return null;
                    const len = parseFloat(v) || 12;
                    const wid = parseFloat(addRoomForm.width) || 12;
                    const nw = Math.max(len * SCALE, MIN_W);
                    const nh = Math.max(wid * SCALE, MIN_H);
                    const { layout, wall } = p;
                    let gx: number, gy: number;
                    switch (wall) {
                      case "north": gx = layout.x; gy = layout.y - nh; break;
                      case "south": gx = layout.x; gy = layout.y + layout.h; break;
                      case "east": gx = layout.x + layout.w; gy = layout.y; break;
                      case "west": gx = layout.x - nw; gy = layout.y; break;
                      default: gx = p.x; gy = p.y; break;
                    }
                    return { ...p, x: gx, y: gy, w: nw, h: nh };
                  });
                  setGhostPreview((g) => {
                    if (!g) return null;
                    const len = parseFloat(v) || 12;
                    const wid = parseFloat(addRoomForm.width) || 12;
                    return { ...g, w: Math.max(len * SCALE, MIN_W), h: Math.max(wid * SCALE, MIN_H) };
                  });
                }}
                placeholder="L (ft)"
                className="flex-1 px-2 py-1.5 text-sm border border-slate-200 rounded"
              />
              <input
                type="number"
                value={addRoomForm.width}
                onChange={(e) => {
                  const v = e.target.value;
                  setAddRoomForm((f) => ({ ...f, width: v }));
                  setAddRoomPopover((p) => {
                    if (!p) return null;
                    const len = parseFloat(addRoomForm.length) || 12;
                    const wid = parseFloat(v) || 12;
                    const nw = Math.max(len * SCALE, MIN_W);
                    const nh = Math.max(wid * SCALE, MIN_H);
                    const { layout, wall } = p;
                    let gx: number, gy: number;
                    switch (wall) {
                      case "north": gx = layout.x; gy = layout.y - nh; break;
                      case "south": gx = layout.x; gy = layout.y + layout.h; break;
                      case "east": gx = layout.x + layout.w; gy = layout.y; break;
                      case "west": gx = layout.x - nw; gy = layout.y; break;
                      default: gx = p.x; gy = p.y; break;
                    }
                    return { ...p, x: gx, y: gy, w: nw, h: nh };
                  });
                  setGhostPreview((g) => {
                    if (!g) return null;
                    const wid = parseFloat(v) || 12;
                    return { ...g, h: Math.max(wid * SCALE, MIN_H) };
                  });
                }}
                placeholder="W (ft)"
                className="flex-1 px-2 py-1.5 text-sm border border-slate-200 rounded"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={() => { setAddRoomPopover(null); setGhostPreview(null); }} className="flex-1 px-2 py-1.5 text-xs border border-slate-200 rounded hover:bg-slate-50">Cancel</button>
            <button onClick={confirmAddRoom} className="flex-1 px-2 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700" data-testid="confirm-add-room">Confirm</button>
          </div>
        </div>
      )}

      {/* Room inspector */}
      {roomInspector && selectedRoomId === roomInspector.roomId && (
        <div className="absolute top-14 left-3 z-10 bg-white border border-slate-200 rounded-lg shadow-lg p-3 min-w-[160px]" onClick={(e) => e.stopPropagation()}>
          <div className="text-xs font-semibold text-slate-600 mb-2">Room</div>
          <input type="text" value={roomInspector.name} onChange={(e) => setRoomInspector((r) => r ? { ...r, name: e.target.value } : null)} className="w-full px-2 py-1 text-sm border rounded mb-2" />
          <div className="flex gap-1 mb-2">
            <input type="number" value={roomInspector.length} onChange={(e) => setRoomInspector((r) => r ? { ...r, length: e.target.value } : null)} placeholder="L" className="w-14 px-1 py-1 text-xs border rounded" />
            <input type="number" value={roomInspector.width} onChange={(e) => setRoomInspector((r) => r ? { ...r, width: e.target.value } : null)} placeholder="W" className="w-14 px-1 py-1 text-xs border rounded" />
            <input type="number" value={roomInspector.height} onChange={(e) => setRoomInspector((r) => r ? { ...r, height: e.target.value } : null)} placeholder="H" className="w-14 px-1 py-1 text-xs border rounded" />
          </div>
          <button
            onClick={async () => {
              if (!roomInspector) return;
              const headers = await getAuthHeaders();
              await fetch(`/api/inspection/${sessionId}/rooms/${roomInspector.roomId}`, {
                method: "PATCH",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({
                  name: roomInspector.name,
                  dimensions: { length: parseFloat(roomInspector.length) || undefined, width: parseFloat(roomInspector.width) || undefined, height: parseFloat(roomInspector.height) || 8 },
                }),
              });
              await fetch(`/api/rooms/${roomInspector.roomId}/dimensions`, {
                method: "PATCH",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ length: parseFloat(roomInspector.length) || 12, width: parseFloat(roomInspector.width) || 12, height: parseFloat(roomInspector.height) || 8 }),
              });
              queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/hierarchy`] });
              onRoomUpdate?.();
            }}
            className="w-full px-2 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700"
          >
            Save
          </button>
        </div>
      )}

      {/* Opening editor */}
      {openingEditor && selectedOpeningId === openingEditor.opening.id && (
        <div className="absolute top-14 right-3 z-10 bg-white border border-slate-200 rounded-lg shadow-lg p-3 min-w-[160px]" onClick={(e) => e.stopPropagation()}>
          <div className="text-xs font-semibold text-slate-600 mb-2">Opening</div>
          <select value={openingEditorForm.openingType} onChange={(e) => setOpeningEditorForm((f) => ({ ...f, openingType: e.target.value }))} className="w-full px-2 py-1 text-sm border rounded mb-2">
            <option value="door">Door</option>
            <option value="window">Window</option>
          </select>
          <div className="flex gap-1 mb-2">
            <input type="number" value={openingEditorForm.widthFt} onChange={(e) => setOpeningEditorForm((f) => ({ ...f, widthFt: e.target.value }))} placeholder="W (ft)" className="w-14 px-1 py-1 text-xs border rounded" />
            <input type="number" value={openingEditorForm.heightFt} onChange={(e) => setOpeningEditorForm((f) => ({ ...f, heightFt: e.target.value }))} placeholder="H (ft)" className="w-14 px-1 py-1 text-xs border rounded" />
          </div>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                const headers = await getAuthHeaders();
                const prev = openingEditor.opening;
                pushHistory({ type: "edit_opening", openingId: prev.id, prev: { widthFt: prev.widthFt ?? prev.width ?? 3, heightFt: prev.heightFt ?? prev.height ?? 6.8, openingType: prev.openingType || "door" } });
                await fetch(`/api/inspection/${sessionId}/rooms/${prev.roomId}/openings/${prev.id}`, {
                  method: "PATCH",
                  headers: { ...headers, "Content-Type": "application/json" },
                  body: JSON.stringify({ widthFt: parseFloat(openingEditorForm.widthFt) || 3, heightFt: parseFloat(openingEditorForm.heightFt) || 6.8, openingType: openingEditorForm.openingType }),
                });
                queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/openings`] });
                setOpeningEditor(null);
                onRoomUpdate?.();
              }}
              className="flex-1 px-2 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700"
            >
              Save
            </button>
            <button
              onClick={async () => {
                const op = openingEditor.opening;
                const create = { roomId: op.roomId, openingType: op.openingType || "door", wallDirection: op.wallDirection || "north", positionOnWall: op.positionOnWall ?? 0.5, widthFt: op.widthFt ?? 3, heightFt: op.heightFt ?? 6.8 };
                pushHistory({ type: "delete_opening", openingId: op.id, create });
                await fetch(`/api/inspection/${sessionId}/rooms/${op.roomId}/openings/${op.id}`, { method: "DELETE", headers: await getAuthHeaders() });
                queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/openings`] });
                setOpeningEditor(null);
                setSelectedOpeningId(null);
                onRoomUpdate?.();
              }}
              className="p-1 text-red-600 hover:bg-red-50 rounded"
              title="Delete"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Annotation editor */}
      {annotationEditor && selectedAnnotationId === annotationEditor.annotation.id && (
        <div className="absolute top-14 right-3 z-10 bg-white border border-slate-200 rounded-lg shadow-lg p-3 min-w-[160px]" onClick={(e) => e.stopPropagation()}>
          <div className="text-xs font-semibold text-slate-600 mb-2">Damage</div>
          <input type="text" value={annotationEditorForm.label} onChange={(e) => setAnnotationEditorForm((f) => ({ ...f, label: e.target.value }))} placeholder="Label" className="w-full px-2 py-1 text-sm border rounded mb-2" />
          <input type="text" value={annotationEditorForm.value} onChange={(e) => setAnnotationEditorForm((f) => ({ ...f, value: e.target.value }))} placeholder="Severity" className="w-full px-2 py-1 text-sm border rounded mb-2" />
          <div className="flex gap-2">
            <button
              onClick={async () => {
                const ann = annotationEditor.annotation;
                const prev = { label: ann.label, value: ann.value ?? null };
                pushHistory({ type: "edit_annotation", annotationId: ann.id, prev });
                await fetch(`/api/inspection/${sessionId}/annotations/${ann.id}`, {
                  method: "PATCH",
                  headers: { ...(await getAuthHeaders()), "Content-Type": "application/json" },
                  body: JSON.stringify({ label: annotationEditorForm.label, value: annotationEditorForm.value || null }),
                });
                setAnnotationsByRoom((p) => {
                  const list = (p[ann.roomId] || []).map((a) => a.id === ann.id ? { ...a, label: annotationEditorForm.label, value: annotationEditorForm.value } : a);
                  return { ...p, [ann.roomId]: list };
                });
                setAnnotationEditor(null);
                onRoomUpdate?.();
              }}
              className="flex-1 px-2 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700"
            >
              Save
            </button>
            <button
              onClick={async () => {
                const ann = annotationEditor.annotation;
                pushHistory({ type: "delete_annotation", annotationId: ann.id, roomId: ann.roomId, prev: ann });
                await fetch(`/api/inspection/${sessionId}/annotations/${ann.id}`, { method: "DELETE", headers: await getAuthHeaders() });
                setAnnotationsByRoom((p) => ({ ...p, [ann.roomId]: (p[ann.roomId] || []).filter((a) => a.id !== ann.id) }));
                setAnnotationEditor(null);
                setSelectedAnnotationId(null);
                onRoomUpdate?.();
              }}
              className="p-1 text-red-600 hover:bg-red-50 rounded"
              title="Delete"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        <div
          className="relative flex-shrink-0 min-h-[400px] overflow-hidden"
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
            ghostPreview={ghostPreview}
            onRoomPointerDown={handleRoomPointerDown}
            onOpeningPointerDown={handleOpeningPointerDown}
            onAnnotationPointerDown={handleAnnotationPointerDown}
            onHandlePointerDown={handleHandlePointerDown}
            renderHandles={tool === "select"}
          />
        </div>
        <PropertySketch
          sessionId={sessionId}
          rooms={rooms}
          currentRoomId={selectedRoomId ?? currentRoomId}
          sections={["roof", "elevations", "exterior"]}
          structureName={structureName}
          compact
          className="flex-shrink-0 border-t border-slate-200"
        />
      </div>
    </div>
  );
}
