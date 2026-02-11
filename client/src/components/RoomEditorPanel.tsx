import React, { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { X, Ruler, Trash2, Save, Plus, SquareIcon, ArrowUpDown } from "lucide-react";

interface RoomDimensions {
  length?: number;
  width?: number;
  height?: number;
}

interface Opening {
  id: number;
  openingType: string;
  widthFt: number;
  heightFt: number;
  quantity: number;
  wallDirection?: string;
}

interface RoomData {
  id: number;
  name: string;
  roomType?: string;
  viewType?: string;
  dimensions?: RoomDimensions;
  status: string;
  damageCount: number;
  photoCount: number;
  openings?: Opening[];
}

interface SurfaceCalc {
  floorSF: number;
  ceilingSF: number;
  grossWallSF: number;
  netWallSF: number;
  deductionSF: number;
  perimeterLF: number;
  longWallSF: number;
  shortWallSF: number;
}

function calcSurfaces(dims: RoomDimensions, openings?: Opening[]): SurfaceCalc {
  const L = dims.length || 0;
  const W = dims.width || 0;
  const H = dims.height || 8;
  const floorSF = L * W;
  const ceilingSF = L * W;
  const grossWallSF = (L + W) * 2 * H;
  const perimeterLF = (L + W) * 2;
  const longWallSF = Math.max(L, W) * H;
  const shortWallSF = Math.min(L, W) * H;
  const deductionSF = (openings || []).reduce(
    (sum, o) => sum + (o.widthFt || 0) * (o.heightFt || 0) * (o.quantity || 1), 0
  );
  const netWallSF = Math.max(0, grossWallSF - deductionSF);
  return { floorSF, ceilingSF, grossWallSF, netWallSF, deductionSF, perimeterLF, longWallSF, shortWallSF };
}

interface RoomEditorPanelProps {
  room: RoomData | null;
  sessionId: number;
  onClose: () => void;
  onSave?: () => void;
  onDelete?: (roomId: number) => void;
  getAuthHeaders: () => Promise<Record<string, string>>;
}

export default function RoomEditorPanel({ room, sessionId, onClose, onSave, onDelete, getAuthHeaders }: RoomEditorPanelProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: openingsData } = useQuery<Opening[]>({
    queryKey: [`/api/inspection/${sessionId}/rooms/${room?.id}/openings`],
    enabled: !!room?.id && !!sessionId,
  });
  const openings = openingsData || room?.openings || [];

  useEffect(() => {
    if (room) {
      setName(room.name || "");
      setLength(room.dimensions?.length?.toString() || "");
      setWidth(room.dimensions?.width?.toString() || "");
      setHeight(room.dimensions?.height?.toString() || "");
      setConfirmDelete(false);
    }
  }, [room]);

  const dims: RoomDimensions = {
    length: parseFloat(length) || undefined,
    width: parseFloat(width) || undefined,
    height: parseFloat(height) || undefined,
  };
  const hasDims = !!dims.length && !!dims.width;
  const surfaces = hasDims ? calcSurfaces(dims, openings) : null;

  const validateDim = (val: string, label: string): number | null => {
    if (!val) return null;
    const n = parseFloat(val);
    if (isNaN(n) || n <= 0) return null;
    if (n > 500) return null;
    return n;
  };

  const handleSave = useCallback(async () => {
    if (!room) return;
    const l = validateDim(length, "Length");
    const w = validateDim(width, "Width");
    const h = validateDim(height, "Height");
    if (length && !l) return;
    if (width && !w) return;
    if (height && !h) return;
    setSaving(true);
    try {
      const headers = await getAuthHeaders();
      const dimensions: RoomDimensions = {};
      if (l) dimensions.length = l;
      if (w) dimensions.width = w;
      if (h) dimensions.height = h;

      const res = await fetch(`/api/inspection/${sessionId}/rooms/${room.id}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ name, dimensions }),
      });
      if (!res.ok) {
        const text = await res.text();
        logger.error("RoomEditor", "Save room failed", { status: res.status, text });
        return;
      }

      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/hierarchy`] });
      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/rooms`] });
      onSave?.();
    } catch (e) {
      logger.error("RoomEditor", "Save room error", e);
    } finally {
      setSaving(false);
    }
  }, [room, sessionId, name, length, width, height, getAuthHeaders, queryClient, onSave]);

  const handleDelete = useCallback(async () => {
    if (!room) return;
    setDeleting(true);
    try {
      const headers = await getAuthHeaders();
      await fetch(`/api/inspection/${sessionId}/rooms/${room.id}`, {
        method: "DELETE",
        headers,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/hierarchy`] });
      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/rooms`] });
      onDelete?.(room.id);
      onClose();
    } catch (e) {
      logger.error("RoomEditor", "Delete room error", e);
    } finally {
      setDeleting(false);
    }
  }, [room, sessionId, getAuthHeaders, queryClient, onDelete, onClose]);

  if (!room) return null;

  const viewLabel = room.viewType === "interior" ? "Interior" :
    room.viewType === "roof_plan" ? "Roof" :
    room.viewType === "elevation" ? "Elevation" :
    room.viewType === "exterior_other" ? "Exterior" : room.viewType || "Interior";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose} data-testid="room-editor-overlay">
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-lg bg-white rounded-t-2xl shadow-2xl animate-in slide-in-from-bottom duration-300 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        data-testid="room-editor-panel"
      >
        <div className="sticky top-0 bg-white border-b border-slate-100 px-4 py-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <SquareIcon className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-mono uppercase tracking-wider text-slate-400">{viewLabel}</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors" data-testid="close-room-editor">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-4 space-y-5">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1.5 block">Room Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300 focus:border-purple-400 bg-slate-50"
              data-testid="input-room-name"
            />
          </div>

          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Ruler className="w-3.5 h-3.5 text-slate-400" />
              <label className="text-xs font-medium text-slate-500">Dimensions (feet)</label>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 block">Length</label>
                <input
                  type="number"
                  step="0.5"
                  min="0.1"
                  max="500"
                  value={length}
                  onChange={(e) => setLength(e.target.value)}
                  placeholder="0"
                  className={cn("w-full px-3 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300 text-center font-mono bg-slate-50", length && !validateDim(length, "") ? "border-red-300 bg-red-50" : "border-slate-200")}
                  data-testid="input-room-length"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 block">Width</label>
                <input
                  type="number"
                  step="0.5"
                  min="0.1"
                  max="500"
                  value={width}
                  onChange={(e) => setWidth(e.target.value)}
                  placeholder="0"
                  className={cn("w-full px-3 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300 text-center font-mono bg-slate-50", width && !validateDim(width, "") ? "border-red-300 bg-red-50" : "border-slate-200")}
                  data-testid="input-room-width"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 block">Height</label>
                <input
                  type="number"
                  step="0.5"
                  min="0.1"
                  max="500"
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                  placeholder="8"
                  className={cn("w-full px-3 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300 text-center font-mono bg-slate-50", height && !validateDim(height, "") ? "border-red-300 bg-red-50" : "border-slate-200")}
                  data-testid="input-room-height"
                />
              </div>
            </div>
          </div>

          {hasDims && surfaces && (
            <div className="bg-slate-50 rounded-xl border border-slate-200 p-4" data-testid="surface-area-panel">
              <div className="flex items-center gap-1.5 mb-3">
                <ArrowUpDown className="w-3.5 h-3.5 text-purple-500" />
                <span className="text-xs font-semibold text-slate-600">Surface Area Coverage</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                <SurfaceRow label="Floor SF" value={surfaces.floorSF} testId="surface-floor" />
                <SurfaceRow label="Ceiling SF" value={surfaces.ceilingSF} testId="surface-ceiling" />
                <SurfaceRow label="Gross Wall SF" value={surfaces.grossWallSF} testId="surface-gross-wall" />
                <SurfaceRow label="Net Wall SF" value={surfaces.netWallSF} highlight testId="surface-net-wall" />
                {surfaces.deductionSF > 0 && (
                  <SurfaceRow label="Opening Deductions" value={surfaces.deductionSF} negative testId="surface-deductions" />
                )}
                <SurfaceRow label="Perimeter LF" value={surfaces.perimeterLF} testId="surface-perimeter" />
                <SurfaceRow label="Long Wall SF" value={surfaces.longWallSF} testId="surface-long-wall" />
                <SurfaceRow label="Short Wall SF" value={surfaces.shortWallSF} testId="surface-short-wall" />
              </div>
            </div>
          )}

          {openings.length > 0 && (
            <div className="border border-slate-200 rounded-lg p-3">
              <span className="text-xs font-medium text-slate-500 mb-2 block">Openings ({openings.length})</span>
              <div className="space-y-1.5">
                {openings.map((op) => (
                  <div key={op.id} className="flex items-center justify-between text-xs bg-slate-50 rounded px-2.5 py-1.5">
                    <span className="text-slate-600 capitalize">{op.openingType.replace(/_/g, " ")}</span>
                    <span className="font-mono text-slate-400">
                      {op.widthFt}' × {op.heightFt}'{op.quantity > 1 ? ` ×${op.quantity}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>{room.damageCount} damage{room.damageCount !== 1 ? "s" : ""}</span>
            <span>·</span>
            <span>{room.photoCount} photo{room.photoCount !== 1 ? "s" : ""}</span>
            <span>·</span>
            <span className="capitalize">{room.status.replace(/_/g, " ")}</span>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 text-white text-sm font-semibold rounded-xl hover:bg-purple-700 disabled:opacity-50 transition-colors"
              data-testid="button-save-room"
            >
              <Save className="w-4 h-4" />
              {saving ? "Saving..." : "Save Changes"}
            </button>
            {confirmDelete ? (
              <div className="flex gap-1.5">
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-4 py-3 bg-red-600 text-white text-sm font-semibold rounded-xl hover:bg-red-700 disabled:opacity-50 transition-colors"
                  data-testid="button-confirm-delete-room"
                >
                  {deleting ? "..." : "Delete"}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-3 py-3 bg-slate-200 text-slate-600 text-sm rounded-xl hover:bg-slate-300 transition-colors"
                  data-testid="button-cancel-delete"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="px-4 py-3 border border-red-200 text-red-500 text-sm rounded-xl hover:bg-red-50 transition-colors"
                data-testid="button-delete-room"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SurfaceRow({ label, value, highlight, negative, testId }: {
  label: string; value: number; highlight?: boolean; negative?: boolean; testId?: string;
}) {
  return (
    <div className="flex items-center justify-between" data-testid={testId}>
      <span className={cn("text-xs", negative ? "text-red-400" : "text-slate-500")}>{label}</span>
      <span className={cn(
        "text-xs font-mono font-semibold",
        highlight ? "text-purple-700" : negative ? "text-red-500" : "text-slate-700"
      )}>
        {negative ? "−" : ""}{Math.round(value * 100) / 100}
      </span>
    </div>
  );
}

interface AddRoomPanelProps {
  sessionId: number;
  structureName?: string;
  onClose: () => void;
  onCreated?: () => void;
  onStructureCreated?: (name: string) => void;
  getAuthHeaders: () => Promise<Record<string, string>>;
}

interface ExistingRoom {
  id: number;
  name: string;
  viewType?: string;
  structure?: string;
}

interface StructureOption {
  id: number;
  name: string;
  structureType: string;
}

const STRUCTURE_TYPES = [
  { value: "dwelling", label: "Main / Dwelling" },
  { value: "garage", label: "Garage" },
  { value: "shed", label: "Shed" },
  { value: "fence", label: "Fence" },
  { value: "carport", label: "Carport" },
  { value: "other", label: "Other" },
];

const WALL_DIRECTIONS = [
  { value: "north", label: "North" },
  { value: "south", label: "South" },
  { value: "east", label: "East" },
  { value: "west", label: "West" },
];

const OPPOSITE_WALL: Record<string, string> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
};

export function AddRoomPanel({ sessionId, structureName, onClose, onCreated, onStructureCreated, getAuthHeaders }: AddRoomPanelProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [viewType, setViewType] = useState("interior");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("9");
  const [creating, setCreating] = useState(false);

  const [selectedStructureName, setSelectedStructureName] = useState(structureName || "Main Dwelling");
  const [showNewStructure, setShowNewStructure] = useState(false);
  const [newStructureName, setNewStructureName] = useState("");
  const [newStructureType, setNewStructureType] = useState("dwelling");
  const [creatingStructure, setCreatingStructure] = useState(false);

  const [adjacentToId, setAdjacentToId] = useState<number | null>(null);
  const [myWallDir, setMyWallDir] = useState("north");

  useEffect(() => {
    setSelectedStructureName(structureName || "Main Dwelling");
  }, [structureName]);

  const { data: hierarchyData } = useQuery<{ structures: StructureOption[] }>({
    queryKey: [`/api/inspection/${sessionId}/hierarchy`],
    enabled: !!sessionId,
  });
  const structureList = hierarchyData?.structures ?? [];

  const { data: existingRooms = [] } = useQuery<ExistingRoom[]>({
    queryKey: [`/api/inspection/${sessionId}/rooms`],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/inspection/${sessionId}/rooms`, { headers });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const interiorRooms = existingRooms.filter(
    (r) => (!r.viewType || r.viewType === "interior") && (r.structure || "Main Dwelling") === selectedStructureName
  );

  const handleCreateStructure = useCallback(async () => {
    if (!newStructureName.trim()) return;
    setCreatingStructure(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/inspection/${sessionId}/structures`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ name: newStructureName.trim(), structureType: newStructureType }),
      });
      if (!res.ok) return;
      const structure = await res.json();
      setSelectedStructureName(structure.name);
      setShowNewStructure(false);
      setNewStructureName("");
      setNewStructureType("dwelling");
      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/hierarchy`] });
      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/structures`] });
      onStructureCreated?.(structure.name);
    } catch (e) {
      logger.error("RoomEditor", "Create structure error", e);
    } finally {
      setCreatingStructure(false);
    }
  }, [sessionId, newStructureName, newStructureType, getAuthHeaders, queryClient, onStructureCreated]);

  const handleCreate = useCallback(async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const headers = await getAuthHeaders();
      const dimensions: RoomDimensions = {};
      if (length) dimensions.length = parseFloat(length);
      if (width) dimensions.width = parseFloat(width);
      if (height) dimensions.height = parseFloat(height);

      const res = await fetch(`/api/inspection/${sessionId}/rooms`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          structure: selectedStructureName || "Main Dwelling",
          viewType,
          dimensions: Object.keys(dimensions).length > 0 ? dimensions : undefined,
        }),
      });

      if (!res.ok) {
        logger.error("RoomEditor", "Room creation failed", { status: res.status });
        return;
      }

      const newRoom = await res.json();

      if (adjacentToId && newRoom?.id && viewType === "interior") {
        try {
          await fetch(`/api/sessions/${sessionId}/adjacencies`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({
              roomIdA: newRoom.id,
              roomIdB: adjacentToId,
              wallDirectionA: myWallDir,
              wallDirectionB: OPPOSITE_WALL[myWallDir] || "south",
            }),
          });
        } catch (adjErr) {
          logger.error("RoomEditor", "Adjacency creation error", adjErr);
        }
      }

      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/hierarchy`] });
      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/rooms`] });
      queryClient.invalidateQueries({ queryKey: [`/api/sessions/${sessionId}/adjacencies`] });
      onCreated?.();
      onClose();
    } catch (e) {
      logger.error("RoomEditor", "Create room error", e);
    } finally {
      setCreating(false);
    }
  }, [name, viewType, length, width, height, sessionId, selectedStructureName, getAuthHeaders, queryClient, onCreated, onClose, adjacentToId, myWallDir]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose} data-testid="add-room-overlay">
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-lg bg-white rounded-t-2xl shadow-2xl animate-in slide-in-from-bottom duration-300 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        data-testid="add-room-panel"
      >
        <div className="sticky top-0 bg-white border-b border-slate-100 px-4 py-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-green-500" />
            <span className="text-sm font-semibold text-slate-700">Add Room / Area</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100" data-testid="close-add-room">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1.5 block">Room Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Master Bedroom, Front Elevation"
              className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 bg-slate-50"
              autoFocus
              data-testid="input-new-room-name"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500 mb-1.5 block">Structure</label>
            <select
              value={showNewStructure ? "__new__" : selectedStructureName}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__new__") {
                  setShowNewStructure(true);
                } else {
                  setShowNewStructure(false);
                  setSelectedStructureName(v);
                }
              }}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200 bg-white"
              data-testid="select-structure"
            >
              {structureList.length === 0 && (
                <option value="Main Dwelling">Main Dwelling</option>
              )}
              {structureList.map((s) => (
                <option key={s.id} value={s.name}>{s.name}</option>
              ))}
              <option value="__new__">+ New structure…</option>
            </select>
            {showNewStructure && (
              <div className="mt-3 p-3 border border-slate-200 rounded-lg bg-slate-50/50 space-y-3">
                <div>
                  <label className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 block">Name</label>
                  <input
                    type="text"
                    value={newStructureName}
                    onChange={(e) => setNewStructureName(e.target.value)}
                    placeholder="e.g., Detached Garage, Shed"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200 bg-white"
                    data-testid="input-new-structure-name"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 block">Type</label>
                  <select
                    value={newStructureType}
                    onChange={(e) => setNewStructureType(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200 bg-white"
                    data-testid="select-new-structure-type"
                  >
                    {STRUCTURE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleCreateStructure}
                    disabled={creatingStructure || !newStructureName.trim()}
                    className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                    data-testid="button-create-structure"
                  >
                    {creatingStructure ? "Creating…" : "Create structure"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowNewStructure(false); setNewStructureName(""); setNewStructureType("dwelling"); }}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500 mb-1.5 block">Type</label>
            <div className="grid grid-cols-4 gap-2">
              {[
                { value: "interior", label: "Interior" },
                { value: "roof_plan", label: "Roof" },
                { value: "elevation", label: "Elevation" },
                { value: "exterior_other", label: "Exterior" },
              ].map((t) => (
                <button
                  key={t.value}
                  onClick={() => setViewType(t.value)}
                  className={cn(
                    "px-3 py-2 text-xs font-medium rounded-lg border transition-colors",
                    viewType === t.value
                      ? "bg-slate-800 text-white border-slate-800"
                      : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                  )}
                  data-testid={`button-viewtype-${t.value}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Ruler className="w-3.5 h-3.5 text-slate-400" />
              <label className="text-xs font-medium text-slate-500">Dimensions (feet)</label>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 block">Length</label>
                <input type="number" step="0.5" min="1" value={length} onChange={(e) => setLength(e.target.value)}
                  placeholder="12" className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 text-center font-mono bg-slate-50"
                  data-testid="input-new-room-length" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 block">Width</label>
                <input type="number" step="0.5" min="1" value={width} onChange={(e) => setWidth(e.target.value)}
                  placeholder="10" className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 text-center font-mono bg-slate-50"
                  data-testid="input-new-room-width" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 block">Height</label>
                <input type="number" step="0.5" min="1" value={height} onChange={(e) => setHeight(e.target.value)}
                  placeholder="9" className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 text-center font-mono bg-slate-50"
                  data-testid="input-new-room-height" />
              </div>
            </div>
          </div>

          {viewType === "interior" && interiorRooms.length > 0 && (
            <div className="border border-slate-200 rounded-xl p-3 bg-slate-50/50">
              <div className="flex items-center gap-1.5 mb-2">
                <ArrowUpDown className="w-3.5 h-3.5 text-indigo-500" />
                <label className="text-xs font-medium text-slate-600">Connect to Floor Plan</label>
                <span className="text-[10px] text-slate-400 ml-auto">optional</span>
              </div>

              <div className="mb-2.5">
                <label className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 block">Adjacent To</label>
                <select
                  value={adjacentToId ?? ""}
                  onChange={(e) => setAdjacentToId(e.target.value ? parseInt(e.target.value) : null)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200 bg-white"
                  data-testid="select-adjacent-room"
                >
                  <option value="">None — place independently</option>
                  {interiorRooms.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>

              {adjacentToId && (
                <div>
                  <label className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 block">
                    This room's wall that touches {interiorRooms.find(r => r.id === adjacentToId)?.name || "it"}
                  </label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {WALL_DIRECTIONS.map((d) => (
                      <button
                        key={d.value}
                        onClick={() => setMyWallDir(d.value)}
                        className={cn(
                          "px-2 py-1.5 text-[11px] font-medium rounded-lg border transition-colors",
                          myWallDir === d.value
                            ? "bg-indigo-600 text-white border-indigo-600"
                            : "bg-white text-slate-500 border-slate-200 hover:bg-indigo-50"
                        )}
                        data-testid={`button-wall-${d.value}`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1.5">
                    {interiorRooms.find(r => r.id === adjacentToId)?.name}'s {OPPOSITE_WALL[myWallDir]} wall will touch this room's {myWallDir} wall
                  </p>
                </div>
              )}
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={creating || !name.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors"
            data-testid="button-create-room"
          >
            <Plus className="w-4 h-4" />
            {creating ? "Creating..." : "Create Room"}
          </button>
        </div>
      </div>
    </div>
  );
}
