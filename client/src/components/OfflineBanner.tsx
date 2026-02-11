import { useOnlineStatus } from "@/hooks/useOnlineStatus";

export function OfflineBanner() {
  const { isOnline, pendingMutations } = useOnlineStatus();

  if (isOnline && pendingMutations === 0) return null;

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-50 px-4 py-2 text-center text-sm font-medium transition-all duration-300 ${
        isOnline
          ? "bg-yellow-50 dark:bg-yellow-950/20 text-yellow-800 dark:text-yellow-200 border-b border-yellow-200 dark:border-yellow-800"
          : "bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-200 border-b border-red-200 dark:border-red-800"
      }`}
    >
      {!isOnline ? (
        <span>
          You are offline. Changes will be saved locally and synced when connectivity returns.
        </span>
      ) : (
        <span>
          Syncing {pendingMutations} pending change{pendingMutations !== 1 ? "s" : ""}...
        </span>
      )}
    </div>
  );
}
