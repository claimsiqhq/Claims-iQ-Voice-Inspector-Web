/**
 * Touch-first, on-canvas interior sketch editor.
 * Tool modes: Select, Add Room, Add Door, Add Window, Add Damage, Pan.
 * Resize handles, ghost preview for add room, opening/annotation editors, undo/redo.
 */
import React, { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { MousePointer2, DoorOpen, Square, AlertTriangle, Undo2, Redo2, ZoomIn, ZoomOut, Maximize2, Move, Plus, X, Trash2, Check, Loader2, Home, Layers, DollarSign, ChevronDown, ChevronUp, Zap } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SketchRenderer, type LayoutRect, type OpeningData, type AnnotationData, type GhostPreview, type RoomCostData } from "./SketchRenderer";
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
  structure?: string;
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
type ViewMode = "interior" | "elevations";
type ElevationSide = "front" | "left" | "right" | "rear";
const ELEVATION_SIDES: ElevationSide[] = ["front", "left", "right", "rear"];
const ELEVATION_ROOM_TYPES: Record<ElevationSide, string> = {
  front: "exterior_elevation_front",
  left: "exterior_elevation_left",
  right: "exterior_elevation_right",
  rear: "exterior_elevation_rear",
};
const ELEVATION_LABELS: Record<ElevationSide, string> = {
  front: "Front",
  left: "Left",
  right: "Right",
  rear: "Rear",
};

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

function categorizeByStructure(rooms: RoomData[], structureName?: string): RoomData[] {
  if (!structureName) return rooms.filter(r => !r.parentRoomId);
  return rooms.filter(r => !r.parentRoomId && (r.structure || "Main Dwelling") === structureName);
}

function categorizeInterior(rooms: RoomData[]): RoomData[] {
  return rooms.filter((r) => {
    if (r.parentRoomId) return false;
    const vt = (r.viewType || "").toLowerCase();
    const rt = (r.roomType || "").toLowerCase();
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
    const vt = (r.viewType || "").toLowerCase();
    const rt = (r.roomType || "").toLowerCase();
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

  const [viewMode, setViewMode] = useState<ViewMode>("interior");
  const [activeElevation, setActiveElevation] = useState<ElevationSide>("front");
  const [tool, setTool] = useState<ToolMode>("select");
  const [viewBox, setViewBox] = useState({ x: -20, y: -20, w: 520, h: 400 });
  const [elevViewBox, setElevViewBox] = useState({ x: -30, y: -60, w: 400, h: 300 });
  const elevSvgRef = useRef<SVGSVGElement | null>(null);
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

  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markSaving = useCallback(() => {
    setSaveStatus("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  const markSaved = useCallback(() => {
    setSaveStatus("saved");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => setSaveStatus("idle"), 2500);
  }, []);

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

  const { data: lineItemsByRoom, refetch: refetchLineItems } = useQuery<{
    byRoom: Record<string, { items: any[]; total: number; count: number }>;
    grandTotal: number;
  }>({
    queryKey: [`/api/inspection/${sessionId}/line-items/by-room`],
    enabled: !!sessionId,
    refetchInterval: 15000,
  });

  const [showEstimatePanel, setShowEstimatePanel] = useState(false);
  const [autoScopeLoading, setAutoScopeLoading] = useState(false);

  const roomCosts = useMemo(() => {
    const map = new Map<number, RoomCostData>();
    if (!lineItemsByRoom?.byRoom) return map;
    for (const [roomIdStr, data] of Object.entries(lineItemsByRoom.byRoom)) {
      map.set(parseInt(roomIdStr), { total: data.total, count: data.count });
    }
    return map;
  }, [lineItemsByRoom]);

  const handleAutoScopeRoom = useCallback(async (roomId: number) => {
    setAutoScopeLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/inspection/${sessionId}/scope/auto-scope-room`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ roomId }),
      });
      if (res.ok) {
        const result = await res.json();
        queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/line-items`] });
        queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/line-items/by-room`] });
        queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/scope/items`] });
        queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/estimate-summary`] });
        onRoomUpdate?.();
        logger.info("SketchEditor", `Auto-scope created ${result.created} items for room ${roomId}`);
      } else {
        const err = await res.json().catch(() => ({}));
        logger.error("SketchEditor", "Auto-scope failed", err);
      }
    } catch (e) {
      logger.error("SketchEditor", "Auto-scope error", e);
    } finally {
      setAutoScopeLoading(false);
    }
  }, [sessionId, getAuthHeaders, queryClient, onRoomUpdate]);

  const { data: hierarchyData } = useQuery<{ structures: { id: number; name: string; structureType: string; rooms: RoomData[] }[] }>({
    queryKey: [`/api/inspection/${sessionId}/hierarchy`],
    enabled: !!sessionId,
    refetchInterval: 10000,
  });

  const structureRooms = useMemo(() => {
    if (hierarchyData?.structures) {
      const struct = hierarchyData.structures.find(s => s.name === structureName) || hierarchyData.structures[0];
      if (struct && struct.rooms.length > 0) return struct.rooms as RoomData[];
    }
    return categorizeByStructure(rooms, structureName);
  }, [hierarchyData, structureName, rooms]);

  const interiorRooms = useMemo(() => categorizeInterior(structureRooms), [structureRooms]);
  const { elevations: elevationRooms } = useMemo(() => categorizeRoofElevExterior(structureRooms), [structureRooms]);
  const adjacencies = adjacencyData || [];
  const allOpenings = openingsData || [];

  const elevationRoomMap = useMemo(() => {
    const m: Record<ElevationSide, RoomData | null> = { front: null, left: null, right: null, rear: null };
    for (const r of elevationRooms) {
      const rt = r.roomType || r.name.toLowerCase();
      for (const side of ELEVATION_SIDES) {
        if (rt.includes(side)) { m[side] = r; break; }
      }
    }
    return m;
  }, [elevationRooms]);

  const activeElevRoom = elevationRoomMap[activeElevation];
  const activeElevOpenings = useMemo(() => {
    if (!activeElevRoom) return [];
    return allOpenings
      .filter((o: any) => o.roomId === activeElevRoom.id)
      .map((o: any): OpeningData => ({
        id: o.id,
        roomId: o.roomId,
        openingType: o.openingType || "door",
        wallDirection: o.wallDirection || "front",
        positionOnWall: o.positionOnWall ?? 0.5,
        widthFt: o.widthFt ?? o.width ?? 3,
        heightFt: o.heightFt ?? o.height ?? 7,
      }));
  }, [activeElevRoom, allOpenings]);

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
    markSaving();
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
      markSaved();
    } catch (e) {
      logger.error("SketchEditor", "Undo failed", e);
      setSaveStatus("idle");
    }
  }, [history, sessionId, allOpenings, getAuthHeaders, queryClient, onRoomUpdate, markSaving, markSaved]);

  const performRedo = useCallback(async () => {
    const entry = redoStack[redoStack.length - 1];
    if (!entry) return;
    setRedoStack((prev) => prev.slice(0, -1));
    setHistory((prev) => [...prev, entry]);
    markSaving();
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
      markSaved();
    } catch (e) {
      logger.error("SketchEditor", "Redo failed", e);
      setSaveStatus("idle");
    }
  }, [redoStack, sessionId, allOpenings, layoutByRoomId, getAuthHeaders, queryClient, onRoomUpdate, markSaving, markSaved]);

  const persistRoomDimensions = useCallback(
    async (roomId: number, length: number, width: number) => {
      const room = interiorRooms.find((r) => r.id === roomId);
      const height = room?.dimensions?.height || 8;
      markSaving();
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
          markSaved();
        }
      } catch (e) {
        logger.error("SketchEditor", "Failed to persist room dimensions", e);
        setSaveStatus("idle");
      }
    },
    [interiorRooms, sessionId, getAuthHeaders, queryClient, onRoomUpdate, markSaving, markSaved]
  );

  const confirmAddRoom = useCallback(async () => {
    if (!addRoomPopover) return;
    const { roomId: adjacentToId, wall } = addRoomPopover;
    const len = parseFloat(addRoomForm.length) || 12;
    const wid = parseFloat(addRoomForm.width) || 12;
    const name = addRoomForm.name.trim() || "New Room";
    setAddRoomPopover(null);
    setGhostPreview(null);
    markSaving();
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
      markSaved();
    } catch (e) {
      logger.error("SketchEditor", "Add room error", e);
      setSaveStatus("idle");
    }
  }, [addRoomPopover, addRoomForm, sessionId, structureName, getAuthHeaders, queryClient, onRoomUpdate, pushHistory, markSaving, markSaved]);

  const persistOpeningPosition = useCallback(
    async (openingId: number, positionOnWall: number) => {
      const op = allOpenings.find((o) => o.id === openingId);
      if (!op) return;
      markSaving();
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
          markSaved();
        }
      } catch (e) {
        logger.error("SketchEditor", "Failed to persist opening position", e);
        setSaveStatus("idle");
      }
    },
    [sessionId, allOpenings, getAuthHeaders, queryClient, onRoomUpdate, markSaving, markSaved]
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
              markSaving();
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
                  markSaved();
                }
              } catch (err) {
                logger.error("SketchEditor", "Create opening error", err);
                setSaveStatus("idle");
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
              markSaving();
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
                  markSaved();
                  onRoomUpdate?.();
                }
              } catch (err) {
                logger.error("SketchEditor", "Create annotation error", err);
                setSaveStatus("idle");
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
      markSaving,
      markSaved,
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

  const createElevation = useCallback(async (side: ElevationSide) => {
    markSaving();
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/inspection/${sessionId}/rooms`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${ELEVATION_LABELS[side]} Elevation`,
          structure: structureName,
          viewType: "elevation",
          roomType: ELEVATION_ROOM_TYPES[side],
          dimensions: { length: 40, height: 10 },
        }),
      });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/hierarchy`] });
        onRoomUpdate?.();
        markSaved();
      }
    } catch (e) {
      logger.error("SketchEditor", "Create elevation error", e);
      setSaveStatus("idle");
    }
  }, [sessionId, structureName, getAuthHeaders, queryClient, onRoomUpdate, markSaving, markSaved]);

  const getElevSvgPoint = useCallback(
    (clientX: number, clientY: number) => {
      const svg = elevSvgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      const scaleX = elevViewBox.w / rect.width;
      const scaleY = elevViewBox.h / rect.height;
      return {
        x: elevViewBox.x + (clientX - rect.left) * scaleX,
        y: elevViewBox.y + (clientY - rect.top) * scaleY,
      };
    },
    [elevViewBox]
  );

  const elevLayout = useMemo(() => {
    if (!activeElevRoom) return null;
    const dims = activeElevRoom.dimensions || {};
    const wallLenFt = dims.length || 40;
    const wallHtFt = dims.height || 10;
    const pxPerFt = SCALE;
    const wallW = wallLenFt * pxPerFt;
    const wallH = wallHtFt * pxPerFt;
    const groundY = wallH + 20;
    const wallTop = groundY - wallH;
    const wallLeft = 20;
    const sqFt = wallLenFt * wallHtFt;
    const rt = activeElevRoom.roomType || activeElevRoom.name.toLowerCase();
    const isFrontRear = rt.includes("front") || rt.includes("rear");
    const roofH = wallH * 0.45;
    return { wallLenFt, wallHtFt, pxPerFt, wallW, wallH, groundY, wallTop, wallLeft, sqFt, isFrontRear, roofH };
  }, [activeElevRoom]);

  const handleElevPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 || !activeElevRoom || !elevLayout) return;
      e.preventDefault();
      const pt = getElevSvgPoint(e.clientX, e.clientY);
      const { wallLeft, wallW, wallTop, wallH, groundY, wallLenFt, wallHtFt, pxPerFt } = elevLayout;

      if (tool === "add_door" || tool === "add_window") {
        if (pt.x >= wallLeft && pt.x <= wallLeft + wallW && pt.y >= wallTop && pt.y <= groundY) {
          const posOnWall = Math.max(0, Math.min(1, (pt.x - wallLeft) / wallW));
          const openingType = tool === "add_door" ? "door" : "window";
          (async () => {
            markSaving();
            try {
              const headers = await getAuthHeaders();
              const res = await fetch(`/api/inspection/${sessionId}/rooms/${activeElevRoom.id}/openings`, {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({
                  openingType,
                  wallDirection: "front",
                  positionOnWall: Math.round(posOnWall * 100) / 100,
                  widthFt: 3,
                  heightFt: openingType === "door" ? 6.8 : 4,
                }),
              });
              if (res.ok) {
                const created = await res.json();
                pushHistory({
                  type: "add_opening",
                  openingId: created.id,
                  create: { roomId: activeElevRoom.id, openingType, wallDirection: "front", positionOnWall: Math.round(posOnWall * 100) / 100, widthFt: 3, heightFt: openingType === "door" ? 6.8 : 4 },
                });
                queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/openings`] });
                onRoomUpdate?.();
                markSaved();
              }
            } catch (err) {
              logger.error("SketchEditor", "Create elev opening error", err);
              setSaveStatus("idle");
            }
          })();
        }
        return;
      }

      if (tool === "select") {
        for (const op of activeElevOpenings) {
          const opW = Math.min(op.widthFt * pxPerFt, wallW * 0.4);
          const opH = Math.min((op.heightFt || 7) * pxPerFt, wallH * 0.85);
          const isDoor = ["door", "french_door", "sliding_door", "standard_door"].includes(op.openingType);
          const opX = wallLeft + (op.positionOnWall ?? 0.5) * (wallW - opW);
          const opY = isDoor ? groundY - opH : wallTop + (wallH - opH) * 0.35;
          if (pt.x >= opX && pt.x <= opX + opW && pt.y >= opY && pt.y <= opY + opH) {
            setSelectedOpeningId(op.id);
            setOpeningEditor({
              opening: op,
              x: 0,
              y: 0,
            });
            setOpeningEditorForm({
              widthFt: String(op.widthFt || 3),
              heightFt: String(op.heightFt || 7),
              openingType: op.openingType,
            });
            return;
          }
        }

        if (pt.x >= wallLeft && pt.x <= wallLeft + wallW && pt.y >= wallTop && pt.y <= groundY) {
          setSelectedRoomId(activeElevRoom.id);
          onRoomSelect?.(activeElevRoom.id);
          return;
        }
        setSelectedRoomId(null);
        setSelectedOpeningId(null);

        setDragStart({ x: e.clientX, y: e.clientY });
        setDragMode("pan");
        (e.target as Element)?.setPointerCapture?.(e.pointerId);
        return;
      }

      if (tool === "pan") {
        setDragStart({ x: e.clientX, y: e.clientY });
        setDragMode("pan");
        (e.target as Element)?.setPointerCapture?.(e.pointerId);
      }
    },
    [tool, activeElevRoom, elevLayout, activeElevOpenings, getElevSvgPoint, sessionId, getAuthHeaders, queryClient, onRoomUpdate, onRoomSelect, pushHistory, markSaving, markSaved]
  );

  const handleElevPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragMode === "pan") {
        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;
        setDragStart({ x: e.clientX, y: e.clientY });
        const svg = elevSvgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        setElevViewBox((v) => ({
          ...v,
          x: v.x - dx * (v.w / rect.width),
          y: v.y - dy * (v.h / rect.height),
        }));
      }
    },
    [dragMode, dragStart]
  );

  const handleElevPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (dragMode !== "none") {
        setDragMode("none");
      }
      (e.target as Element)?.releasePointerCapture?.(e.pointerId);
    },
    [dragMode]
  );

  const fitElevation = useCallback(() => {
    if (!elevLayout) return;
    const { wallLeft, wallW, wallTop, roofH, groundY } = elevLayout;
    setElevViewBox({
      x: wallLeft - 40,
      y: wallTop - roofH - 30,
      w: wallW + 80,
      h: (groundY - wallTop + roofH) + 60,
    });
  }, [elevLayout]);

  useEffect(() => {
    if (viewMode === "elevations" && elevLayout) {
      fitElevation();
    }
  }, [viewMode, activeElevation, activeElevRoom?.id]);

  const hasAnyRooms = interiorRooms.length > 0 || elevationRooms.length > 0;

  if (!hasAnyRooms) {
    return (
      <div className={cn("flex flex-col bg-white rounded-lg border border-slate-200 overflow-hidden", className)}>
        <div className="flex items-center justify-center p-8 text-slate-500 text-sm flex-col gap-2">
          <span>No rooms yet. Add rooms first.</span>
          <span className="text-[10px] text-red-400 font-mono">
            DEBUG: props.rooms={rooms.length}, hierarchyRooms={hierarchyRooms.length}, interior={interiorRooms.length}, elev={elevationRooms.length}, struct="{structureName}", hierarchy={hierarchyData ? `${hierarchyData.structures?.length} structs` : "loading"}
          </span>
        </div>
      </div>
    );
  }

  const isElevView = viewMode === "elevations";
  const zoomIn = () => isElevView ? setElevViewBox((v) => ({ ...v, w: v.w * 0.8, h: v.h * 0.8 })) : setViewBox((v) => ({ ...v, w: v.w * 0.8, h: v.h * 0.8 }));
  const zoomOut = () => isElevView ? setElevViewBox((v) => ({ ...v, w: v.w * 1.25, h: v.h * 1.25 })) : setViewBox((v) => ({ ...v, w: v.w * 1.25, h: v.h * 1.25 }));
  const fitView = isElevView ? fitElevation : fitToContent;

  return (
    <div className={cn("flex flex-col bg-white rounded-lg border border-slate-200 overflow-hidden", className)} data-testid="sketch-editor">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-200/60 rounded p-0.5 gap-0.5" data-testid="view-mode-toggle">
            <button
              onClick={() => { setViewMode("interior"); setTool("select"); setSelectedOpeningId(null); setSelectedRoomId(null); }}
              className={cn("flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold transition-colors",
                !isElevView ? "bg-white text-purple-700 shadow-sm" : "text-slate-500 hover:text-slate-700")}
              data-testid="view-mode-interior"
            >
              <Home className="w-3 h-3" />
              Interior
            </button>
            <button
              onClick={() => { setViewMode("elevations"); setTool("select"); setSelectedOpeningId(null); setSelectedRoomId(null); setAddRoomPopover(null); setGhostPreview(null); }}
              className={cn("flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold transition-colors",
                isElevView ? "bg-white text-purple-700 shadow-sm" : "text-slate-500 hover:text-slate-700")}
              data-testid="view-mode-elevations"
            >
              <Layers className="w-3 h-3" />
              Elevations
            </button>
          </div>
          {isElevView && (
            <div className="flex gap-0.5 ml-1" data-testid="elevation-side-tabs">
              {ELEVATION_SIDES.map((side) => (
                <button
                  key={side}
                  onClick={() => { setActiveElevation(side); setSelectedOpeningId(null); setOpeningEditor(null); }}
                  className={cn("px-2 py-1 rounded text-[10px] font-medium transition-colors",
                    activeElevation === side ? "bg-purple-100 text-purple-700" : "text-slate-400 hover:text-slate-600 hover:bg-slate-100")}
                  data-testid={`elev-tab-${side}`}
                >
                  {ELEVATION_LABELS[side]}
                  {elevationRoomMap[side] && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setTool("select")}
            className={cn("p-1.5 rounded transition-colors", tool === "select" ? "bg-purple-100 text-purple-700" : "text-slate-400 hover:bg-slate-100")}
            title="Select"
            data-testid="tool-select"
          >
            <MousePointer2 className="w-3.5 h-3.5" />
          </button>
          {!isElevView && (
            <button
              onClick={() => { setTool("add_room"); setAddRoomPopover(null); setGhostPreview(null); }}
              className={cn("p-1.5 rounded transition-colors", tool === "add_room" ? "bg-purple-100 text-purple-700" : "text-slate-400 hover:bg-slate-100")}
              title="Add Room"
              data-testid="tool-add-room"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
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
          {!isElevView && (
            <button
              onClick={() => setTool("add_damage")}
              className={cn("p-1.5 rounded transition-colors", tool === "add_damage" ? "bg-purple-100 text-purple-700" : "text-slate-400 hover:bg-slate-100")}
              title="Add Damage"
              data-testid="tool-damage"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
            </button>
          )}
          <div className="w-px h-4 bg-slate-200 mx-1" />
          <button
            onClick={() => setTool("pan")}
            className={cn("p-1.5 rounded transition-colors", tool === "pan" ? "bg-purple-100 text-purple-700" : "text-slate-400 hover:bg-slate-100")}
            title="Pan"
            data-testid="tool-pan"
          >
            <Move className="w-3.5 h-3.5" />
          </button>
          <button onClick={zoomIn} className="p-1.5 rounded text-slate-400 hover:bg-slate-100" title="Zoom In" data-testid="zoom-in">
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button onClick={zoomOut} className="p-1.5 rounded text-slate-400 hover:bg-slate-100" title="Zoom Out" data-testid="zoom-out">
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={performUndo}
            disabled={history.length === 0}
            className="p-1.5 rounded text-slate-400 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Undo"
            data-testid="undo"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={performRedo}
            disabled={redoStack.length === 0}
            className="p-1.5 rounded text-slate-400 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Redo"
            data-testid="redo"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={fitView} className="p-1.5 rounded text-slate-400 hover:bg-slate-100" title="Fit" data-testid="fit-content">
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-4 bg-slate-200 mx-1" />
          <div className="flex items-center gap-1 text-[10px] min-w-[70px]" data-testid="autosave-status">
            {saveStatus === "saving" && (
              <>
                <Loader2 className="w-3 h-3 text-amber-500 animate-spin" />
                <span className="text-amber-600">Saving...</span>
              </>
            )}
            {saveStatus === "saved" && (
              <>
                <Check className="w-3 h-3 text-green-500" />
                <span className="text-green-600">Autosaved</span>
              </>
            )}
            {saveStatus === "idle" && (
              <span className="text-slate-400">Autosave on</span>
            )}
          </div>
        </div>
      </div>

      {/* Add Room popover (interior only) */}
      {!isElevView && addRoomPopover && (
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
          {(() => {
            const cost = roomCosts.get(roomInspector.roomId);
            return cost && cost.total > 0 ? (
              <div className="mt-2 flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 px-2 py-1 rounded">
                <DollarSign className="w-3 h-3" />
                <span className="font-semibold">${cost.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <span className="text-emerald-500">({cost.count} items)</span>
              </div>
            ) : null;
          })()}
          <button
            onClick={() => handleAutoScopeRoom(roomInspector.roomId)}
            disabled={autoScopeLoading}
            className="w-full mt-2 px-2 py-1.5 text-xs bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50 flex items-center justify-center gap-1"
            data-testid="button-auto-scope"
          >
            {autoScopeLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            Auto-Scope Room
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
                markSaving();
                await fetch(`/api/inspection/${sessionId}/rooms/${prev.roomId}/openings/${prev.id}`, {
                  method: "PATCH",
                  headers: { ...headers, "Content-Type": "application/json" },
                  body: JSON.stringify({ widthFt: parseFloat(openingEditorForm.widthFt) || 3, heightFt: parseFloat(openingEditorForm.heightFt) || 6.8, openingType: openingEditorForm.openingType }),
                });
                queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/openings`] });
                setOpeningEditor(null);
                onRoomUpdate?.();
                markSaved();
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
                markSaving();
                await fetch(`/api/inspection/${sessionId}/rooms/${op.roomId}/openings/${op.id}`, { method: "DELETE", headers: await getAuthHeaders() });
                queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/openings`] });
                setOpeningEditor(null);
                setSelectedOpeningId(null);
                onRoomUpdate?.();
                markSaved();
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
                markSaving();
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
                markSaved();
              }}
              className="flex-1 px-2 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700"
            >
              Save
            </button>
            <button
              onClick={async () => {
                const ann = annotationEditor.annotation;
                pushHistory({ type: "delete_annotation", annotationId: ann.id, roomId: ann.roomId, prev: ann });
                markSaving();
                await fetch(`/api/inspection/${sessionId}/annotations/${ann.id}`, { method: "DELETE", headers: await getAuthHeaders() });
                setAnnotationsByRoom((p) => ({ ...p, [ann.roomId]: (p[ann.roomId] || []).filter((a) => a.id !== ann.id) }));
                setAnnotationEditor(null);
                setSelectedAnnotationId(null);
                onRoomUpdate?.();
                markSaved();
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
        {!isElevView ? (
          <>
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
                roomCosts={roomCosts}
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
          </>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            {!activeElevRoom ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8" data-testid="create-elevation-prompt">
                <Layers className="w-10 h-10 text-slate-300" />
                <p className="text-sm text-slate-500 text-center">
                  No <span className="font-semibold">{ELEVATION_LABELS[activeElevation]}</span> elevation exists yet.
                </p>
                <button
                  onClick={() => createElevation(activeElevation)}
                  className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                  data-testid="button-create-elevation"
                >
                  Create {ELEVATION_LABELS[activeElevation]} Elevation
                </button>
              </div>
            ) : elevLayout ? (
              <div
                className="relative flex-1 min-h-[400px] overflow-hidden"
                style={{ touchAction: "none" }}
                onPointerDown={handleElevPointerDown}
                onPointerMove={handleElevPointerMove}
                onPointerUp={handleElevPointerUp}
                onPointerCancel={handleElevPointerUp}
                onLostPointerCapture={handleElevPointerUp}
                data-testid="elevation-canvas"
              >
                <svg
                  ref={elevSvgRef}
                  className="w-full h-full"
                  viewBox={`${elevViewBox.x} ${elevViewBox.y} ${elevViewBox.w} ${elevViewBox.h}`}
                  preserveAspectRatio="xMidYMid meet"
                >
                  <defs>
                    <pattern id="elevGrid" width="4" height="4" patternUnits="userSpaceOnUse">
                      <rect width="4" height="4" fill="none" />
                      <circle cx="0" cy="0" r="0.3" fill="#E2E8F0" />
                    </pattern>
                  </defs>
                  <rect x={elevViewBox.x} y={elevViewBox.y} width={elevViewBox.w} height={elevViewBox.h} fill="url(#elevGrid)" />

                  {(() => {
                    const { wallLeft, wallW, wallH, wallTop, groundY, isFrontRear, roofH, wallLenFt, wallHtFt, sqFt, pxPerFt } = elevLayout;
                    const wallRight = wallLeft + wallW;
                    return (
                      <g data-testid="elevation-drawing">
                        <line x1={wallLeft - 20} y1={groundY} x2={wallRight + 20} y2={groundY}
                          stroke="#78716C" strokeWidth={1.5} />
                        <line x1={wallLeft - 20} y1={groundY + 1} x2={wallRight + 20} y2={groundY + 1}
                          stroke="#D6D3D1" strokeWidth={0.5} />

                        <rect x={wallLeft} y={wallTop} width={wallW} height={wallH}
                          fill="rgba(119,99,183,0.06)" stroke="#7763B7" strokeWidth={1.5} />

                        {isFrontRear ? (
                          <polygon
                            points={`${wallLeft},${wallTop} ${wallLeft + wallW / 2},${wallTop - roofH} ${wallRight},${wallTop}`}
                            fill="rgba(120,53,15,0.06)" stroke="#92400E" strokeWidth={1} strokeLinejoin="round" />
                        ) : (
                          <polygon
                            points={`${wallLeft},${wallTop} ${wallLeft + wallW * 0.12},${wallTop - roofH} ${wallRight - wallW * 0.12},${wallTop - roofH} ${wallRight},${wallTop}`}
                            fill="rgba(120,53,15,0.06)" stroke="#92400E" strokeWidth={1} strokeLinejoin="round" />
                        )}

                        {activeElevOpenings.map((op) => {
                          const opW = Math.min(op.widthFt * pxPerFt, wallW * 0.4);
                          const opH = Math.min((op.heightFt || 7) * pxPerFt, wallH * 0.85);
                          const isDoor = ["door", "french_door", "sliding_door", "standard_door"].includes(op.openingType);
                          const isWindow = op.openingType === "window";
                          const opX = wallLeft + (op.positionOnWall ?? 0.5) * (wallW - opW);
                          const opY = isDoor ? groundY - opH : wallTop + (wallH - opH) * 0.35;
                          const isSelected = selectedOpeningId === op.id;

                          return (
                            <g key={op.id} style={{ cursor: "pointer" }}>
                              <rect x={opX} y={opY} width={opW} height={opH}
                                fill={isDoor ? "rgba(186,230,253,0.3)" : isWindow ? "rgba(186,230,253,0.5)" : "rgba(200,200,200,0.3)"}
                                stroke={isSelected ? "#6366F1" : "#0284C7"}
                                strokeWidth={isSelected ? 2 : 0.8}
                                rx={isWindow ? 1 : 0} />
                              {isDoor && (
                                <>
                                  <line x1={opX + opW / 2} y1={opY} x2={opX + opW / 2} y2={opY + opH}
                                    stroke="#0284C7" strokeWidth={0.4} />
                                  <circle cx={opX + opW * 0.35} cy={opY + opH * 0.5} r={1} fill="#0284C7" />
                                </>
                              )}
                              {isWindow && (
                                <>
                                  <line x1={opX} y1={opY + opH / 2} x2={opX + opW} y2={opY + opH / 2}
                                    stroke="#0284C7" strokeWidth={0.3} />
                                  <line x1={opX + opW / 2} y1={opY} x2={opX + opW / 2} y2={opY + opH}
                                    stroke="#0284C7" strokeWidth={0.3} />
                                </>
                              )}
                              <text x={opX + opW / 2} y={opY + opH + 5}
                                textAnchor="middle" fontSize="3.5" fontFamily="monospace" fill="#64748B">
                                {op.widthFt}' x {op.heightFt}'
                              </text>
                            </g>
                          );
                        })}

                        <text x={wallLeft + wallW / 2} y={wallTop + wallH / 2}
                          textAnchor="middle" dominantBaseline="middle"
                          fontSize="6" fontFamily="monospace" fontWeight="600" fill="#7763B7" opacity={0.5}>
                          {sqFt.toFixed(0)} SF
                        </text>

                        <text x={wallLeft + wallW / 2} y={groundY + 10}
                          textAnchor="middle" fontSize="5" fontFamily="monospace" fill="#78716C" fontWeight="600">
                          {wallLenFt}' wide
                        </text>
                        <g>
                          <line x1={wallLeft} y1={groundY + 5} x2={wallLeft} y2={groundY + 8} stroke="#78716C" strokeWidth={0.5} />
                          <line x1={wallLeft} y1={groundY + 6.5} x2={wallRight} y2={groundY + 6.5} stroke="#78716C" strokeWidth={0.3} />
                          <line x1={wallRight} y1={groundY + 5} x2={wallRight} y2={groundY + 8} stroke="#78716C" strokeWidth={0.5} />
                        </g>

                        <text x={wallLeft - 10} y={wallTop + wallH / 2}
                          textAnchor="middle" dominantBaseline="middle"
                          fontSize="5" fontFamily="monospace" fill="#78716C" fontWeight="600"
                          transform={`rotate(-90, ${wallLeft - 10}, ${wallTop + wallH / 2})`}>
                          {wallHtFt}' tall
                        </text>
                        <g>
                          <line x1={wallLeft - 5} y1={wallTop} x2={wallLeft - 3} y2={wallTop} stroke="#78716C" strokeWidth={0.5} />
                          <line x1={wallLeft - 4} y1={wallTop} x2={wallLeft - 4} y2={groundY} stroke="#78716C" strokeWidth={0.3} />
                          <line x1={wallLeft - 5} y1={groundY} x2={wallLeft - 3} y2={groundY} stroke="#78716C" strokeWidth={0.5} />
                        </g>

                        <text x={wallLeft + wallW / 2} y={wallTop - (isFrontRear ? roofH / 2 : roofH) + 3}
                          textAnchor="middle" fontSize="5" fontFamily="monospace" fontWeight="700" fill="#4C3D8F">
                          {ELEVATION_LABELS[activeElevation]} Elevation
                        </text>
                      </g>
                    );
                  })()}
                </svg>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Estimate Panel Toggle */}
      <div className="flex-shrink-0 border-t border-slate-200">
        <button
          onClick={() => setShowEstimatePanel(!showEstimatePanel)}
          className="w-full flex items-center justify-between px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 transition-colors"
          data-testid="button-toggle-estimate-panel"
        >
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-600" />
            <span>Estimate</span>
            {lineItemsByRoom?.grandTotal != null && lineItemsByRoom.grandTotal > 0 && (
              <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                ${lineItemsByRoom.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            )}
          </div>
          {showEstimatePanel ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>

        {showEstimatePanel && (
          <div className="max-h-[280px] overflow-y-auto bg-white divide-y divide-slate-100" data-testid="estimate-panel">
            {lineItemsByRoom?.byRoom && Object.keys(lineItemsByRoom.byRoom).length > 0 ? (
              Object.entries(lineItemsByRoom.byRoom).map(([roomIdStr, roomData]: [string, any]) => {
                const roomObj = rooms.find((r: RoomData) => String(r.id) === roomIdStr);
                const roomName = roomObj?.name || `Room ${roomIdStr}`;
                return (
                  <div key={roomIdStr} className="px-4 py-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-slate-700">{roomName}</span>
                      <span className="text-xs font-bold text-emerald-700">${roomData.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <div className="space-y-0.5">
                      {roomData.items.map((item: any, idx: number) => (
                        <div key={item.id || idx} className="flex items-center justify-between text-[11px] text-slate-500">
                          <span className="truncate mr-2">{item.description || item.catalogCode || "Line Item"}</span>
                          <span className="flex-shrink-0 tabular-nums">
                            {Number(item.quantity || 0).toFixed(2)} {item.unit || "SF"} × ${Number(item.unitPrice || 0).toFixed(2)} = ${(Number(item.quantity || 0) * Number(item.unitPrice || 0)).toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="px-4 py-6 text-center text-xs text-slate-400">
                No line items yet. Select a room and click "Auto-Scope Room" to generate estimates.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
