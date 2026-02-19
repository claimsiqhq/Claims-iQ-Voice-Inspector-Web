import { storage } from "../../storage";
import type { GateIssue, GateResult } from "../types";

function summarize(issues: GateIssue[], suggestedMissingScopeItems: string[] = []): GateResult {
  const summary = {
    blockers: issues.filter((i) => i.severity === "BLOCKER").length,
    warnings: issues.filter((i) => i.severity === "WARNING").length,
    infos: issues.filter((i) => i.severity === "INFO").length,
  };
  return { gate: "scope", ok: summary.blockers === 0, issues, summary, computedAt: new Date().toISOString(), suggestedMissingScopeItems };
}

export async function runScopeGate(sessionId: number, peril = ""): Promise<GateResult> {
  const [damages, items, rooms] = await Promise.all([
    storage.getDamagesForSession(sessionId),
    storage.getLineItems(sessionId),
    storage.getRooms(sessionId),
  ]);
  const issues: GateIssue[] = [];
  const suggestions: string[] = [];

  const confirmedDamages = damages.filter((d) => (d.severity || "").toLowerCase() !== "none");
  for (const d of confirmedDamages) {
    const linked = items.some((li) => li.roomId === d.roomId && (li.description || "").toLowerCase().includes((d.damageType || "").toLowerCase()));
    if (!linked) {
      issues.push({ severity: "WARNING", code: "SCOPE_DAMAGE_UNCOVERED", message: `Damage ${d.id} has no matching line item`, entity: { type: "lineItem", id: String(d.id) } });
      suggestions.push(`Add scope line for ${d.damageType || "damage"} in room ${d.roomId}`);
    }
  }

  const seen = new Set<string>();
  for (const li of items) {
    const key = `${li.category || ""}:${li.roomId || 0}`;
    if (seen.has(key)) {
      issues.push({ severity: "WARNING", code: "SCOPE_DUPLICATE_LINE", message: `Duplicate line item ${li.category} in room ${li.roomId}`, entity: { type: "lineItem", id: String(li.id) } });
    }
    seen.add(key);
    if (!(li as any).provenance) {
      issues.push({ severity: "INFO", code: "SCOPE_PROVENANCE_MISSING", message: `Line item ${li.id} missing provenance`, entity: { type: "lineItem", id: String(li.id) } });
    }
  }

  if (peril.toLowerCase() === "hail" && rooms.filter((r) => r.viewType === "roof_plan").length === 0) {
    issues.push({ severity: "WARNING", code: "SCOPE_HAIL_ROOF_EXPECTED", message: "Hail peril but no roof facets captured." });
  }

  return summarize(issues, suggestions);
}
