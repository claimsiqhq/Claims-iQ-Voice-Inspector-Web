/**
 * Service worker extension for offline mutation queue processing.
 * Imported by the Workbox-generated service worker via importScripts.
 */

function openIndexedDB() {
  return new Promise((resolve) => {
    const request = indexedDB.open("claims-iq-offline", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

function getAllFromIndex(index) {
  return new Promise((resolve) => {
    const request = index.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => resolve([]);
  });
}

async function processOfflineQueue() {
  const db = await openIndexedDB();
  if (!db) return;

  try {
    const tx = db.transaction("mutation-queue", "readonly");
    const store = tx.objectStore("mutation-queue");
    const index = store.index("timestamp");
    const mutations = await getAllFromIndex(index);

    for (const mutation of mutations) {
      try {
        const response = await fetch(mutation.url, {
          method: mutation.method,
          headers: {
            "Content-Type": "application/json",
            ...mutation.headers,
          },
          body: mutation.body ? JSON.stringify(mutation.body) : undefined,
        });

        if (response.ok || (response.status >= 400 && response.status < 500)) {
          const deleteTx = db.transaction("mutation-queue", "readwrite");
          deleteTx.objectStore("mutation-queue").delete(mutation.id);
          await new Promise((res, rej) => {
            deleteTx.oncomplete = res;
            deleteTx.onerror = rej;
          });
        }
      } catch {
        break;
      }
    }
  } finally {
    db.close();
  }
}

self.addEventListener("sync", (event) => {
  if (event.tag === "offline-mutation-sync") {
    event.waitUntil(processOfflineQueue());
  }
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "PROCESS_QUEUE") {
    event.waitUntil(processOfflineQueue());
  }
});
