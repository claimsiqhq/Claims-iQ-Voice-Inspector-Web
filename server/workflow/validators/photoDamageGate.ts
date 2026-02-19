import { storage } from "../../storage";
import type { GateIssue, GateResult } from "../types";

function summarize(issues: GateIssue[]): GateResult {
  const summary = {
    blockers: issues.filter((i) => i.severity === "BLOCKER").length,
    warnings: issues.filter((i) => i.severity === "WARNING").length,
    infos: issues.filter((i) => i.severity === "INFO").length,
  };
  return { gate: "photoDamage", ok: summary.blockers === 0, issues, summary, computedAt: new Date().toISOString() };
}

export async function runPhotoDamageGate(sessionId: number): Promise<GateResult> {
  const [photos, damages] = await Promise.all([storage.getPhotos(sessionId), storage.getDamagesForSession(sessionId)]);
  const issues: GateIssue[] = [];

  if (photos.length > 0 && photos.every((p) => !p.analysis)) {
    issues.push({ severity: "WARNING", code: "PHOTO_ANALYSIS_MISSING", message: "Photos exist without analysis results." });
  }

  for (const p of photos) {
    if (!p.roomId) {
      issues.push({ severity: "WARNING", code: "PHOTO_ROOM_UNASSOCIATED", message: `Photo ${p.id} not linked to room`, entity: { type: "photo", id: String(p.id) } });
    }
    const confidence = Number((p.analysis as any)?.matchConfidence ?? 0);
    if (confidence > 0.8 && (p.matchesRequest ?? false) === false) {
      issues.push({ severity: "WARNING", code: "PHOTO_CONFIDENCE_GATE", message: `Photo ${p.id} high confidence but still requires confirmation`, entity: { type: "photo", id: String(p.id) } });
    }
  }

  if (damages.length === 0 && photos.some((p) => Array.isArray((p.analysis as any)?.damageVisible) && (p.analysis as any).damageVisible.length > 0)) {
    issues.push({ severity: "WARNING", code: "PHOTO_DAMAGE_MAPPING_LOW", message: "Damage hints in photo analysis but no mapped damage observations." });
  }

  return summarize(issues);
}
