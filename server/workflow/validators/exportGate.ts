import { storage } from "../../storage";
import { runSketchGate } from "./sketchGate";
import { runScopeGate } from "./scopeGate";
import { runPhotoDamageGate } from "./photoDamageGate";
import type { GateIssue, GateResult } from "../types";

function summarize(issues: GateIssue[]): GateResult {
  const summary = {
    blockers: issues.filter((i) => i.severity === "BLOCKER").length,
    warnings: issues.filter((i) => i.severity === "WARNING").length,
    infos: issues.filter((i) => i.severity === "INFO").length,
  };
  return { gate: "export", ok: summary.blockers === 0, issues, summary, computedAt: new Date().toISOString() };
}

export async function runExportGate(sessionId: number): Promise<GateResult> {
  const issues: GateIssue[] = [];
  const session = await storage.getInspectionSession(sessionId);
  if (!session) {
    issues.push({ severity: "BLOCKER", code: "EXPORT_SESSION_MISSING", message: "Inspection session not found." });
    return summarize(issues);
  }
  const claim = await storage.getClaim(session.claimId);
  if (!claim?.claimNumber || !claim?.propertyAddress) {
    issues.push({ severity: "BLOCKER", code: "EXPORT_REQUIRED_CLAIM_DATA", message: "Claim identifiers/address missing." });
  }

  const [sketch, scope, photo] = await Promise.all([
    runSketchGate(sessionId),
    runScopeGate(sessionId, claim?.perilType || ""),
    runPhotoDamageGate(sessionId),
  ]);
  if (!sketch.ok) {
    issues.push({ severity: "BLOCKER", code: "EXPORT_SKETCH_BLOCKER", message: "Sketch gate has blockers.", details: sketch.summary });
  }
  if (scope.issues.some((i) => i.code === "SCOPE_DAMAGE_UNCOVERED")) {
    issues.push({ severity: "WARNING", code: "EXPORT_SCOPE_COVERAGE_WARN", message: "Some confirmed damages do not have scope lines." });
  }
  for (const pi of photo.issues) {
    issues.push({ severity: "WARNING", code: `EXPORT_PHOTO_${pi.code}`, message: pi.message, entity: pi.entity });
  }

  return summarize(issues);
}
