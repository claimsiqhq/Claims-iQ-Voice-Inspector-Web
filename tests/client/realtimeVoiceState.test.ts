import { describe, expect, it, vi } from "vitest";
import { drainToolQueue, shouldQueueToolCall } from "@/lib/realtimeVoiceState";

describe("shouldQueueToolCall", () => {
  it("queues tool calls while agent is speaking", () => {
    expect(shouldQueueToolCall(true, false)).toBe(true);
  });

  it("never queues immediate tools", () => {
    expect(shouldQueueToolCall(true, true)).toBe(false);
  });

  it("never queues when agent is not speaking", () => {
    expect(shouldQueueToolCall(false, false)).toBe(false);
  });
});

describe("drainToolQueue", () => {
  it("drains queued tool calls in FIFO order", async () => {
    const queue = [
      { callId: "1", name: "tool_a", argsString: "{}", receivedAt: 10 },
      { callId: "2", name: "tool_b", argsString: "{}", receivedAt: 20 },
    ];
    const execute = vi.fn(async () => {});

    const drained = await drainToolQueue(queue, execute);

    expect(drained).toBe(2);
    expect(queue).toHaveLength(0);
    expect(execute.mock.calls[0][0].callId).toBe("1");
    expect(execute.mock.calls[1][0].callId).toBe("2");
  });
});
