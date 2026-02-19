export type ToolErrorType = "VALIDATION_ERROR" | "API_ERROR" | "RUNTIME_ERROR";

export interface ToolErrorPayload {
  success: false;
  errorType: ToolErrorType;
  message: string;
  details?: Record<string, unknown>;
  hint?: string;
}

export function buildToolError(
  errorType: ToolErrorType,
  message: string,
  details?: Record<string, unknown>,
  hint?: string,
): ToolErrorPayload {
  return {
    success: false,
    errorType,
    message,
    details,
    hint,
  };
}

export function sendRealtimeToolRoundTrip(
  sendFn: (payload: string) => void,
  callId: string,
  result: Record<string, unknown>,
): void {
  sendFunctionCallOutput(sendFn, callId, result);

  sendFn(JSON.stringify({ type: "response.create" }));
}

export function sendFunctionCallOutput(
  sendFn: (payload: string) => void,
  callId: string,
  result: Record<string, unknown>,
): void {
  sendFn(JSON.stringify({
    type: "conversation.item.create",
    item: {
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify(result),
    },
  }));
}
