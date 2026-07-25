// P-087 — React hook: live mirror of the local IndexedDB queue.
import { useCallback, useEffect, useState } from "react";

import { listAllMutations, type QueuedMutation } from "@/lib/offline/db";
import { subscribe } from "@/lib/offline/queue";

interface UseOfflineQueueState {
  rows: QueuedMutation[];
  loading: boolean;
  online: boolean;
  counts: { pending: number; syncing: number; synced: number; failed: number };
  refresh: () => Promise<void>;
}

function computeCounts(rows: QueuedMutation[]) {
  const counts = { pending: 0, syncing: 0, synced: 0, failed: 0 };
  for (const r of rows) counts[r.status]++;
  return counts;
}

export function useOfflineQueue(): UseOfflineQueueState {
  const [rows, setRows] = useState<QueuedMutation[]>([]);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  const refresh = useCallback(async () => {
    try {
      const all = await listAllMutations();
      setRows(all);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsub = subscribe(() => {
      void refresh();
    });
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      unsub();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [refresh]);

  return {
    rows,
    loading,
    online,
    counts: computeCounts(rows),
    refresh,
  };
}
