// P-087 — Wire up sync triggers: window online, 60s interval, Background Sync.
import { registerDefaultDispatchers } from "@/lib/offline/dispatch";
import { syncQueue } from "@/lib/offline/queue";

const INTERVAL_MS = 60_000;

let started = false;

/** Idempotent bootstrap; safe to call more than once. Client-only. */
export function startOfflineTriggers() {
  if (started) return;
  if (typeof window === "undefined") return;
  started = true;

  registerDefaultDispatchers();

  let intervalId: ReturnType<typeof setInterval> | null = null;

  const kick = () => {
    // Fire-and-forget; syncQueue guards against overlap internally.
    void syncQueue().catch(() => {});
  };

  const startInterval = () => {
    if (intervalId != null) return;
    intervalId = setInterval(kick, INTERVAL_MS);
  };
  const stopInterval = () => {
    if (intervalId == null) return;
    clearInterval(intervalId);
    intervalId = null;
  };

  window.addEventListener("online", kick);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopInterval();
    } else {
      startInterval();
      kick();
    }
  });
  window.addEventListener("focus", kick);

  if (!document.hidden) startInterval();

  // Best-effort Background Sync — graceful no-op on unsupported browsers.
  if ("serviceWorker" in navigator && "SyncManager" in window) {
    navigator.serviceWorker.ready
      .then((reg) => {
        const anyReg = reg as unknown as {
          sync?: { register: (tag: string) => Promise<void> };
        };
        return anyReg.sync?.register("gridmind-field-sync");
      })
      .catch(() => {
        /* not supported — fall back to interval + online triggers */
      });
  }

  // Initial drain.
  kick();
}
