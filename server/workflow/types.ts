import type { WorkflowPhase } from "@shared/contracts/workflow";

export type GateResultSummary = {
  ok: boolean;
  blockers: number;
  warnings: number;
  infos: number;
};

export type GateSeverity = "BLOCKER" | "WARNING" | "INFO";

export type GateIssue = {
  severity: GateSeverity;
  code: string;
  message: string;
  entity?: { type: "room" | "opening" | "lineItem" | "photo" | "elevation"; id?: string; name?: string };
  details?: unknown;
  suggestion?: string;
};

export type GateResult = {
  gate: "sketch" | "photoDamage" | "scope" | "export";
  ok: boolean;
  issues: GateIssue[];
  summary: { blockers: number; warnings: number; infos: number };
  computedAt: string;
  suggestedMissingScopeItems?: string[];
};

export type WorkflowState = {
  claimId: string;
  sessionId: string;
  peril: string;
  phase: WorkflowPhase;
  stepId: string;
  context: {
    structureId?: string;
    roomId?: string;
    elevationId?: string;
    currentView?: "interior" | "elevation" | "roof";
  };
  lastToolError?: {
    tool: string;
    code: string;
    message: string;
    details?: unknown;
    at: string;
  };
  lastValidatorSummary?: {
    sketch?: GateResultSummary;
    photoDamage?: GateResultSummary;
    scope?: GateResultSummary;
    export?: GateResultSummary;
    at: string;
  };
};
