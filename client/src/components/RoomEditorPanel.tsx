import React, { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
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
        console.error("Save room failed:", res.status, text);
        return;
      }

      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/hierarchy`] });
      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/rooms`] });
      onSave?.();
    } catch (e) {
      console.error("Save room error:", e);
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
      console.error("Delete room error:", e);
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
  getAuthHeaders: () => Promise<Record<string, string>>;
}

export function AddRoomPanel({ sessionId, structureName, onClose, onCreated, getAuthHeaders }: AddRoomPanelProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [viewType, setViewType] = useState("interior");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = useCallback(async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const headers = await getAuthHeaders();
      const dimensions: RoomDimensions = {};
      if (length) dimensions.length = parseFloat(length);
      if (width) dimensions.width = parseFloat(width);
      if (height) dimensions.height = parseFloat(height);

      await fetch(`/api/inspection/${sessionId}/rooms`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          structure: structureName || "Main Dwelling",
          viewType,
          dimensions: Object.keys(dimensions).length > 0 ? dimensions : undefined,
        }),
      });

      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/hierarchy`] });
      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/rooms`] });
      onCreated?.();
      onClose();
    } catch (e) {
      console.error("Create room error:", e);
    } finally {
      setCreating(false);
    }
  }, [name, viewType, length, width, height, sessionId, structureName, getAuthHeaders, queryClient, onCreated, onClose]);

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
              <label className="text-xs font-medium text-slate-500">Dimensions (feet) — optional</label>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 block">Length</label>
                <input type="number" step="0.5" min="0" value={length} onChange={(e) => setLength(e.target.value)}
                  placeholder="0" className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 text-center font-mono bg-slate-50"
                  data-testid="input-new-room-length" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 block">Width</label>
                <input type="number" step="0.5" min="0" value={width} onChange={(e) => setWidth(e.target.value)}
                  placeholder="0" className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 text-center font-mono bg-slate-50"
                  data-testid="input-new-room-width" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 block">Height</label>
                <input type="number" step="0.5" min="0" value={height} onChange={(e) => setHeight(e.target.value)}
                  placeholder="8" className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 text-center font-mono bg-slate-50"
                  data-testid="input-new-room-height" />
              </div>
            </div>
          </div>

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
