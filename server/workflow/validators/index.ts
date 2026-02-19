import { runExportGate } from "./exportGate";
import { runPhotoDamageGate } from "./photoDamageGate";
import { runScopeGate } from "./scopeGate";
import { runSketchGate } from "./sketchGate";
import type { GateResult } from "../types";

export async function runAllWorkflowGates(sessionId: number, peril: string): Promise<Record<GateResult["gate"], GateResult>> {
  const [sketch, photoDamage, scope, exportGate] = await Promise.all([
    runSketchGate(sessionId),
    runPhotoDamageGate(sessionId),
    runScopeGate(sessionId, peril),
    runExportGate(sessionId),
  ]);
  return { sketch, photoDamage, scope, export: exportGate };
}

export { runSketchGate, runPhotoDamageGate, runScopeGate, runExportGate };
