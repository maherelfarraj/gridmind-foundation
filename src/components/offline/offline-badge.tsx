// P-087 — Header badge: online/offline + queued/failed counts.
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CloudUpload, WifiOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useOfflineQueue } from "@/hooks/use-offline-queue";

export function OfflineBadge() {
  const { online, counts } = useOfflineQueue();
  const pending = counts.pending + counts.syncing;
  const failed = counts.failed;

  if (online && pending === 0 && failed === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-1">
      {!online && (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-1 text-[11px] font-semibold uppercase text-warning-foreground"
          aria-label="Offline"
          title="Offline — changes will sync when you reconnect"
        >
          <WifiOff className="h-3.5 w-3.5" aria-hidden />
          Offline
        </span>
      )}
      {(pending > 0 || failed > 0) && (
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs"
          aria-label={`Queue: ${pending} pending, ${failed} failed`}
        >
          <Link to="/field/sync-status">
            {pending > 0 && (
              <span className="inline-flex items-center gap-1">
                <CloudUpload className="h-3.5 w-3.5" aria-hidden />
                {pending}
              </span>
            )}
            {failed > 0 && (
              <span className="ml-1 inline-flex items-center gap-1 text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                {failed}
              </span>
            )}
          </Link>
        </Button>
      )}
    </div>
  );
}
