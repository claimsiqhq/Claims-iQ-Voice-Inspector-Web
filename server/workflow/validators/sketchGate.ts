import { storage } from "../../storage";
import type { GateIssue, GateResult } from "../types";

const dist = (a: any, b: any) => Math.hypot((b.x ?? 0) - (a.x ?? 0), (b.y ?? 0) - (a.y ?? 0));

function summarize(gate: GateResult["gate"], issues: GateIssue[]): GateResult {
  const summary = {
    blockers: issues.filter((i) => i.severity === "BLOCKER").length,
    warnings: issues.filter((i) => i.severity === "WARNING").length,
    infos: issues.filter((i) => i.severity === "INFO").length,
  };
  return { gate, ok: summary.blockers === 0, issues, summary, computedAt: new Date().toISOString() };
}

export async function runSketchGate(sessionId: number): Promise<GateResult> {
  const [rooms, openings] = await Promise.all([storage.getRooms(sessionId), storage.getOpeningsForSession(sessionId)]);
  const issues: GateIssue[] = [];

  for (const room of rooms) {
    const poly = Array.isArray(room.polygon) ? (room.polygon as any[]) : [];
    if (poly.length > 0 && poly.length < 3) {
      issues.push({ severity: "BLOCKER", code: "SKETCH_TOO_FEW_VERTICES", message: `Room ${room.name} polygon has < 3 vertices`, entity: { type: "room", id: String(room.id), name: room.name } });
    }
    if (poly.some((p) => Number.isNaN(Number(p?.x)) || Number.isNaN(Number(p?.y)))) {
      issues.push({ severity: "BLOCKER", code: "SKETCH_NAN_COORD", message: `Room ${room.name} has invalid coordinates`, entity: { type: "room", id: String(room.id), name: room.name } });
    }
    const edges = poly.length;
    for (const o of openings.filter((op) => op.roomId === room.id)) {
      if (o.wallIndex != null && (o.wallIndex < 0 || o.wallIndex >= edges)) {
        issues.push({ severity: "BLOCKER", code: "OPENING_WALL_INDEX_RANGE", message: `Opening wallIndex out of range for ${room.name}`, entity: { type: "opening", id: String(o.id) } });
      }
      if ((o.widthFt ?? 0) <= 0 || (o.heightFt ?? 0) <= 0) {
        issues.push({ severity: "BLOCKER", code: "OPENING_INVALID_DIMS", message: `Opening ${o.id} width/height must be > 0`, entity: { type: "opening", id: String(o.id) } });
      }
      if (o.wallIndex != null && edges > 1) {
        const a = poly[o.wallIndex];
        const b = poly[(o.wallIndex + 1) % edges];
        if (a && b && o.widthFt && o.widthFt > dist(a, b)) {
          issues.push({ severity: "WARNING", code: "OPENING_WIDER_THAN_WALL", message: `Opening ${o.id} wider than wall segment`, entity: { type: "opening", id: String(o.id) } });
        }
      }
    }
    if (room.viewType === "elevation" && !(room.dimensions as any)?.height) {
      issues.push({ severity: "WARNING", code: "ELEVATION_MISSING_HEIGHT", message: `Elevation ${room.name} has no wall height`, entity: { type: "elevation", id: String(room.id), name: room.name } });
    }
  }

  return summarize("sketch", issues);
}
