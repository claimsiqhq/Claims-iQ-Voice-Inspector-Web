import { WORKFLOW_STEPS, type WorkflowPhase } from "@shared/contracts/workflow";

export const firstStepForPhase = (phase: WorkflowPhase) => WORKFLOW_STEPS[phase][0] ?? `${phase}.default`;
