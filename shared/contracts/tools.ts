import type { ToolErrorEnvelope } from "./errors";

export type ToolResult<T> = {
  success: boolean;
  data?: T;
  error?: ToolErrorEnvelope;
  meta?: {
    tool?: string;
    callId?: string;
    normalizedArgs?: unknown;
    workflow?: { phase: string; stepId: string };
  };
};

export const toolSuccess = <T>(tool: string, data: T, meta: Omit<NonNullable<ToolResult<T>["meta"]>, "tool"> = {}): ToolResult<T> => ({
  success: true,
  data,
  meta: { ...meta, tool },
});

export const toolFailure = (
  tool: string,
  error: ToolErrorEnvelope,
  meta: Omit<NonNullable<ToolResult<never>["meta"]>, "tool"> = {},
): ToolResult<never> => ({
  success: false,
  error,
  meta: { ...meta, tool },
});
