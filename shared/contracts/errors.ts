export type ToolErrorType = "VALIDATION_ERROR" | "CONTEXT_ERROR" | "API_ERROR" | "RUNTIME_ERROR";

export type ToolErrorEnvelope = {
  type: ToolErrorType;
  code: string;
  message: string;
  details?: unknown;
  hint?: string;
  retriable?: boolean;
};
