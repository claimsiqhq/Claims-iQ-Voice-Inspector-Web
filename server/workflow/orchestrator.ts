import { PHASE_ALLOWED_TOOLS, WORKFLOW_PHASES, WORKFLOW_STEPS, type WorkflowPhase } from "@shared/contracts/workflow";
import { toolFailure, type ToolResult } from "@shared/contracts/tools";
import { storage } from "../storage";
import { firstStepForPhase } from "./steps/default";
import type { GateResultSummary, WorkflowState } from "./types";
import { runAllWorkflowGates } from "./validators";

const phaseOrder = [...WORKFLOW_PHASES];

export function defaultWorkflowState(params: { claimId: string; sessionId: string; peril: string }): WorkflowState {
  return {
    ...params,
    phase: "inspection_setup",
    stepId: firstStepForPhase("inspection_setup"),
    context: { currentView: "interior" },
  };
}

export async function getWorkflowState(sessionId: number): Promise<WorkflowState | null> {
  const session = await storage.getInspectionSession(sessionId);
  return (session?.workflowStateJson as WorkflowState) || null;
}

export async function setWorkflowState(sessionId: number, patch: Partial<WorkflowState>): Promise<WorkflowState> {
  const existing = (await getWorkflowState(sessionId)) || defaultWorkflowState({ claimId: "", sessionId: String(sessionId), peril: "General" });
  const next = { ...existing, ...patch, context: { ...existing.context, ...(patch.context || {}) } };
  await storage.updateSession(sessionId, { workflowStateJson: next } as any);
  return next;
}

export async function initSessionWorkflow({ claimId, sessionId, peril }: { claimId: number; sessionId: number; peril: string }) {
  const state = defaultWorkflowState({ claimId: String(claimId), sessionId: String(sessionId), peril });
  await storage.updateSession(sessionId, { workflowStateJson: state } as any);
  return state;
}

export function getAllowedTools(state: WorkflowState): string[] {
  return PHASE_ALLOWED_TOOLS[state.phase] || [];
}

export function assertToolAllowed(state: WorkflowState, toolName: string) {
  if (!getAllowedTools(state).includes(toolName)) {
    throw new Error(`TOOL_NOT_ALLOWED:${toolName}:${state.phase}`);
  }
}

export function assertToolContext(state: WorkflowState, toolName: string, args: any) {
  if (["add_opening", "update_opening", "delete_opening"].includes(toolName) && !state.context.roomId && !args?.roomId && !args?.roomName) {
    throw new Error("MISSING_ROOM_CONTEXT");
  }
  return {
    roomId: args?.roomId ? String(args.roomId) : state.context.roomId,
    elevationId: args?.elevationId ? String(args.elevationId) : state.context.elevationId,
    currentView: args?.viewType || state.context.currentView,
  };
}

/**
 * Server-side authoritative tool validation.
 * Returns a ToolResult failure if the tool is not allowed in the current phase
 * or if required context is missing; otherwise returns null (caller proceeds).
 */
export async function validateToolForWorkflow(
  sessionId: number,
  toolName: string,
  args?: Record<string, unknown>,
): Promise<ToolResult<never> | null> {
  const state = await getWorkflowState(sessionId);
  if (!state) return null; // no workflow state yet — allow
  const allowed = getAllowedTools(state);
  if (!allowed.includes(toolName)) {
    return toolFailure(toolName, {
      type: "CONTEXT_ERROR",
      code: "TOOL_NOT_ALLOWED",
      message: `Tool "${toolName}" is not allowed in phase "${state.phase}".`,
      hint: `Allowed tools: ${allowed.join(", ")}. Call set_phase to advance.`,
    }, { workflow: { phase: state.phase, stepId: state.stepId } });
  }
  try {
    assertToolContext(state, toolName, args);
  } catch (e: any) {
    return toolFailure(toolName, {
      type: "CONTEXT_ERROR",
      code: "MISSING_CONTEXT",
      message: e.message || "Required context is missing for this tool.",
      hint: "Set the room/elevation context first with set_context.",
    }, { workflow: { phase: state.phase, stepId: state.stepId } });
  }
  return null;
}

export function onToolResult(state: WorkflowState, toolName: string, result: ToolResult<any>): WorkflowState {
  if (!result.success && result.error) {
    return { ...state, lastToolError: { tool: toolName, code: result.error.code, message: result.error.message, details: result.error.details, at: new Date().toISOString() } };
  }
  return state;
}

function toSummary(gate: { ok: boolean; summary: { blockers: number; warnings: number; infos: number } }): GateResultSummary {
  return { ok: gate.ok, blockers: gate.summary.blockers, warnings: gate.summary.warnings, infos: gate.summary.infos };
}

export async function runGates(state: WorkflowState) {
  const all = await runAllWorkflowGates(Number(state.sessionId), state.peril);
  return setWorkflowState(Number(state.sessionId), {
    lastValidatorSummary: {
      sketch: toSummary(all.sketch),
      photoDamage: toSummary(all.photoDamage),
      scope: toSummary(all.scope),
      export: toSummary(all.export),
      at: new Date().toISOString(),
    },
  });
}

export function canAdvance(state: WorkflowState): boolean {
  if (state.phase === "export") return false;
  if (state.lastValidatorSummary?.sketch && !state.lastValidatorSummary.sketch.ok && ["review", "export"].includes(state.phase)) return false;
  return true;
}

export function advance(state: WorkflowState): WorkflowState {
  if (!canAdvance(state)) return state;
  const idx = phaseOrder.indexOf(state.phase);
  const nextPhase = phaseOrder[Math.min(idx + 1, phaseOrder.length - 1)] as WorkflowPhase;
  return { ...state, phase: nextPhase, stepId: WORKFLOW_STEPS[nextPhase]?.[0] ?? `${nextPhase}.default` };
}
