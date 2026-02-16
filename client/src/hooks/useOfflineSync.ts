import { useEffect, useRef, useCallback } from "react";
import { useOnlineStatus } from "./useOnlineStatus";
import {
  getPendingMutations,
  removeMutation,
  markRetry,
} from "@/lib/offlineQueue";
import { useToast } from "@/hooks/use-toast";
import { logger } from "@/lib/logger";

/** Interval between sync attempts when online (ms) */
const SYNC_INTERVAL = 10000; // 10 seconds

/** Hook that processes the offline mutation queue when online */
export function useOfflineSync() {
  const { isOnline } = useOnlineStatus();
  const { toast } = useToast();
  const isProcessingRef = useRef(false);

  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || !navigator.onLine) return;
    isProcessingRef.current = true;

    try {
      const pending = await getPendingMutations();
      if (pending.length === 0) {
        isProcessingRef.current = false;
        return;
      }

      let successCount = 0;
      let failCount = 0;

      for (const mutation of pending) {
        try {
          const response = await fetch(mutation.url, {
            method: mutation.method,
            headers: {
              "Content-Type": "application/json",
              ...mutation.headers,
            },
            body: mutation.body ? JSON.stringify(mutation.body) : undefined,
            signal: AbortSignal.timeout(15000),
          });

          if (response.ok) {
            await removeMutation(mutation.id);
            successCount++;
          } else if (response.status >= 400 && response.status < 500) {
            // Client error — don't retry (bad data)
            await removeMutation(mutation.id);
            failCount++;
            logger.warn(
              "OfflineSync",
              `Offline mutation dropped (${response.status}): ${mutation.label}`
            );
          } else {
            // Server error — retry later
            const willRetry = await markRetry(mutation.id);
            if (!willRetry) failCount++;
          }
        } catch {
          // Network error — stop processing, wait for next interval
          break;
        }
      }

      if (successCount > 0) {
        toast({
          title: "Changes synced",
          description: `${successCount} offline change${successCount !== 1 ? "s" : ""} saved to server.`,
        });
      }
      if (failCount > 0) {
        toast({
          title: "Some changes failed",
          description: `${failCount} change${failCount !== 1 ? "s" : ""} could not be synced and ${failCount !== 1 ? "were" : "was"} dropped.`,
          variant: "destructive",
        });
      }
    } finally {
      isProcessingRef.current = false;
    }
  }, [toast]);

  useEffect(() => {
    if (isOnline) {
      processQueue();
    }
  }, [isOnline, processQueue]);

  useEffect(() => {
    if (!isOnline) return;

    const interval = setInterval(processQueue, SYNC_INTERVAL);
    return () => clearInterval(interval);
  }, [isOnline, processQueue]);

  return { processQueue };
}
