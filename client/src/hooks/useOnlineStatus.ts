import { useState, useEffect, useCallback } from "react";

interface OnlineStatus {
  isOnline: boolean;
  /** Timestamp of last connectivity change */
  lastChanged: number;
  /** Number of pending offline mutations */
  pendingMutations: number;
  /** Force a connectivity check by pinging the health endpoint */
  checkConnectivity: () => Promise<boolean>;
}

export function useOnlineStatus(): OnlineStatus {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [lastChanged, setLastChanged] = useState(Date.now());
  const [pendingMutations, setPendingMutations] = useState(0);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setLastChanged(Date.now());
    };
    const handleOffline = () => {
      setIsOnline(false);
      setLastChanged(Date.now());
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    const updatePending = () => {
      const count = parseInt(
        localStorage.getItem("offline-queue-count") || "0",
        10
      );
      setPendingMutations(count);
    };

    updatePending();
    window.addEventListener("storage", updatePending);
    window.addEventListener("offline-queue-changed", updatePending);

    return () => {
      window.removeEventListener("storage", updatePending);
      window.removeEventListener("offline-queue-changed", updatePending);
    };
  }, []);

  const checkConnectivity = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch("/health", {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      const online = response.ok;
      setIsOnline(online);
      return online;
    } catch {
      setIsOnline(false);
      return false;
    }
  }, []);

  return { isOnline, lastChanged, pendingMutations, checkConnectivity };
}
