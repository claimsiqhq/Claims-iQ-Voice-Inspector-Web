import { openDB, type IDBPDatabase } from "idb";

interface QueuedMutation {
  id: string;
  method: string;
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
  timestamp: number;
  retryCount: number;
  /** Max retries before dropping */
  maxRetries: number;
  /** Descriptive label for UI display */
  label: string;
}

const DB_NAME = "claims-iq-offline";
const DB_VERSION = 1;
const STORE_NAME = "mutation-queue";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("timestamp", "timestamp");
        }
      },
    });
  }
  return dbPromise;
}

/** Add a mutation to the offline queue */
export async function enqueueMutation(
  mutation: Omit<QueuedMutation, "id" | "timestamp" | "retryCount">
): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const entry: QueuedMutation = {
    ...mutation,
    id,
    timestamp: Date.now(),
    retryCount: 0,
  };
  await db.add(STORE_NAME, entry);
  await updateQueueCount();
  await requestBackgroundSync();
  return id;
}

/** Get all pending mutations, ordered by timestamp */
export async function getPendingMutations(): Promise<QueuedMutation[]> {
  const db = await getDb();
  return db.getAllFromIndex(STORE_NAME, "timestamp");
}

/** Remove a successfully processed mutation */
export async function removeMutation(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_NAME, id);
  await updateQueueCount();
}

/** Increment retry count, or remove if max retries exceeded */
export async function markRetry(id: string): Promise<boolean> {
  const db = await getDb();
  const entry = await db.get(STORE_NAME, id);
  if (!entry) return false;

  entry.retryCount += 1;
  if (entry.retryCount >= entry.maxRetries) {
    await db.delete(STORE_NAME, id);
    await updateQueueCount();
    return false; // Dropped
  }

  await db.put(STORE_NAME, entry);
  return true; // Will retry
}

/** Get count of pending mutations */
export async function getQueueCount(): Promise<number> {
  const db = await getDb();
  return db.count(STORE_NAME);
}

/** Update localStorage count for cross-component reactivity */
async function updateQueueCount() {
  const count = await getQueueCount();
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("offline-queue-count", String(count));
    window.dispatchEvent(new Event("offline-queue-changed"));
  }
}

/** Clear entire queue (use for debugging/reset) */
export async function clearQueue(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE_NAME);
  await updateQueueCount();
}

/** Request background sync via service worker (if supported) */
export async function requestBackgroundSync(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const sync = (registration as any).sync;
    if (sync) {
      await sync.register("offline-mutation-sync");
    }
  } catch {
    // Background sync not supported or permission denied — fallback to polling
  }
}
