export class TimeoutError extends Error {
  override name = "TimeoutError";
}

function supportsAbortSignalAny(): boolean {
  return typeof AbortSignal !== "undefined" && typeof (AbortSignal as any).any === "function";
}

function combineSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const active = signals.filter(Boolean) as AbortSignal[];
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];

  if (supportsAbortSignalAny()) {
    return (AbortSignal as any).any(active) as AbortSignal;
  }

  // Fallback for environments without AbortSignal.any().
  const controller = new AbortController();
  for (const s of active) {
    if (s.aborted) {
      controller.abort();
      break;
    }
    s.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = 15000
): Promise<Response> {
  const timeoutController = new AbortController();

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      timeoutController.abort();
      reject(new TimeoutError(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const signal = combineSignals([init.signal, timeoutController.signal]);

  try {
    const fetchPromise = fetch(input, { ...init, signal });
    return (await Promise.race([fetchPromise, timeoutPromise])) as Response;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function readErrorMessage(res: Response): Promise<string> {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await res.json().catch(() => null);
    if (body && typeof body === "object" && "message" in body && typeof (body as any).message === "string") {
      return (body as any).message as string;
    }
  }

  const text = await res.text().catch(() => "");
  return text || res.statusText || "Request failed";
}

