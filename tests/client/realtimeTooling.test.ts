import { describe, expect, it, vi } from "vitest";
import { buildToolError, sendRealtimeToolRoundTrip } from "@/lib/realtimeTooling";

describe("buildToolError", () => {
  it("creates structured retryable error payloads", () => {
    const error = buildToolError(
      "API_ERROR",
      "Failed to add opening",
      { status: 422, missing: ["widthFt"] },
      "Retry with widthFt and heightFt.",
    );

    expect(error).toEqual({
      success: false,
      errorType: "API_ERROR",
      message: "Failed to add opening",
      details: { status: 422, missing: ["widthFt"] },
      hint: "Retry with widthFt and heightFt.",
    });
  });
});

describe("sendRealtimeToolRoundTrip", () => {
  it("always emits function_call_output then response.create", () => {
    const send = vi.fn();

    sendRealtimeToolRoundTrip(send, "call_123", { success: true, openingId: 10 });

    expect(send).toHaveBeenCalledTimes(2);
    const firstPayload = JSON.parse(send.mock.calls[0][0]);
    const secondPayload = JSON.parse(send.mock.calls[1][0]);

    expect(firstPayload.type).toBe("conversation.item.create");
    expect(firstPayload.item.type).toBe("function_call_output");
    expect(firstPayload.item.call_id).toBe("call_123");
    expect(JSON.parse(firstPayload.item.output)).toEqual({ success: true, openingId: 10 });
    expect(secondPayload).toEqual({ type: "response.create" });
  });
});
