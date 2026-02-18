import { describe, it, expect, vi } from "vitest";
import { fetchWithTimeout, TimeoutError } from "@/lib/fetchWithTimeout";

describe("fetchWithTimeout", () => {
  it("rejects with TimeoutError when deadline exceeded", async () => {
    vi.useFakeTimers();

    // Simulate a request that never resolves (e.g. stalled TCP connection).
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {}) as unknown as Promise<Response>)
    );

    const promise = fetchWithTimeout("https://example.com/test", {}, 100);

    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).rejects.toBeInstanceOf(TimeoutError);

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns the response when fetch resolves in time", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok", { status: 200 })));

    const res = await fetchWithTimeout("https://example.com/test", {}, 1000);
    expect(res.status).toBe(200);

    vi.unstubAllGlobals();
  });
});

