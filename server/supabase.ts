import { createClient } from "@supabase/supabase-js";
import { logger } from "./logger";

const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const SUPABASE_FETCH_TIMEOUT_MS = Number.parseInt(process.env.SUPABASE_FETCH_TIMEOUT_MS || "15000", 10);

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables");
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

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = SUPABASE_FETCH_TIMEOUT_MS): Promise<Response> {
  const timeoutController = new AbortController();

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      timeoutController.abort();
      reject(new Error(`Supabase request timed out after ${timeoutMs}ms`));
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

export const supabase = createClient(supabaseUrl, supabaseKey, {
  global: {
    // Prevent auth/storage calls from hanging forever on network issues.
    fetch: (input, init) => fetchWithTimeout(input, init),
  },
  auth: {
    // Server-side client: don't persist sessions.
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

export const DOCUMENTS_BUCKET = "claim-documents";
export const PHOTOS_BUCKET = "inspection-photos";

export async function ensureStorageBuckets() {
  const { data: buckets } = await supabase.storage.listBuckets();
  const bucketNames = buckets?.map((b) => b.name) || [];

  if (!bucketNames.includes(DOCUMENTS_BUCKET)) {
    await supabase.storage.createBucket(DOCUMENTS_BUCKET, {
      public: false,
      fileSizeLimit: 50 * 1024 * 1024,
      allowedMimeTypes: ["application/pdf"],
    });
    logger.info("Supabase", `Created storage bucket: ${DOCUMENTS_BUCKET}`);
  }

  if (!bucketNames.includes(PHOTOS_BUCKET)) {
    await supabase.storage.createBucket(PHOTOS_BUCKET, {
      public: false,
      fileSizeLimit: 25 * 1024 * 1024,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/heic", "image/webp"],
    });
    logger.info("Supabase", `Created storage bucket: ${PHOTOS_BUCKET}`);
  }
}
