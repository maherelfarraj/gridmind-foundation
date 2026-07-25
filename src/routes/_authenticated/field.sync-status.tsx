// P-087 — Sync status: view + retry/discard queued mutations.
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  RefreshCw,
  Trash2,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useOfflineQueue } from "@/hooks/use-offline-queue";
import type { QueuedMutation } from "@/lib/offline/db";
import { discardMutation, retryMutation, syncQueue } from "@/lib/offline/queue";

export const Route = createFileRoute("/_authenticated/field/sync-status")({
  head: () => ({
    meta: [
      { title: "Sync status — GridMind EPC" },
      {
        name: "description",
        content:
          "Pending, retrying, and failed field mutations queued on this device.",
      },
      { property: "og:title", content: "Sync status — GridMind EPC" },
      {
        property: "og:description",
        content: "Manage the local offline sync queue.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SyncStatusPage,
});

function SyncStatusPage() {
  const { rows, loading, online, counts } = useOfflineQueue();

  const runSync = async () => {
    const res = await syncQueue();
    if (res.synced > 0) toast.success(`${res.synced} synced`);
    if (res.failed > 0) toast.error(`${res.failed} failed`);
    if (res.synced === 0 && res.failed === 0 && res.attempted === 0) {
      toast(online ? "Nothing to sync" : "Still offline");
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Field
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <h1 className="font-display text-2xl font-semibold text-foreground">
            Sync status
          </h1>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={runSync}
            disabled={!online}
          >
            <RefreshCw className="mr-1 h-4 w-4" aria-hidden />
            Sync now
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {online ? (
            "Online — pending changes drain automatically."
          ) : (
            <span className="inline-flex items-center gap-1 text-warning-foreground">
              <WifiOff className="h-4 w-4" aria-hidden />
              Offline — queued changes will sync when you reconnect.
            </span>
          )}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatChip label="Pending" value={counts.pending} tone="warning" />
        <StatChip label="Syncing" value={counts.syncing} tone="muted" />
        <StatChip label="Failed" value={counts.failed} tone="destructive" />
        <StatChip label="Synced" value={counts.synced} tone="success" />
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-muted/30 p-8 text-center">
          <CheckCircle2
            className="mx-auto mb-3 h-8 w-8 text-muted-foreground"
            aria-hidden
          />
          <p className="text-sm text-muted-foreground">
            All caught up — nothing to sync.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <QueueEntryCard key={r.clientIdempotencyKey} row={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

function StatChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "warning" | "destructive" | "success" | "muted";
}) {
  const classes =
    tone === "warning"
      ? "bg-warning/10 text-warning-foreground"
      : tone === "destructive"
        ? "bg-destructive/10 text-destructive"
        : tone === "success"
          ? "bg-accent/10 text-accent-foreground"
          : "bg-muted text-muted-foreground";
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-3">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-sm font-semibold ${classes}`}
        >
          {value}
        </span>
      </CardContent>
    </Card>
  );
}

function QueueEntryCard({ row }: { row: QueuedMutation }) {
  const onRetry = async () => {
    await retryMutation(row.clientIdempotencyKey);
  };
  const onDiscard = async () => {
    await discardMutation(row.clientIdempotencyKey);
    toast("Discarded");
  };
  return (
    <Card>
      <CardHeader className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 pb-2">
        <CardTitle className="min-w-0 truncate text-sm font-medium">
          {row.entity}.{row.action}
        </CardTitle>
        <StatusBadge row={row} />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">
          Queued{" "}
          <time dateTime={new Date(row.createdAt).toISOString()}>
            {new Date(row.createdAt).toLocaleString()}
          </time>
          {" · "}
          {row.attempts} attempt{row.attempts === 1 ? "" : "s"}
          {row.photoRefs?.length ? ` · ${row.photoRefs.length} photo(s)` : ""}
        </p>
        {row.error && (
          <p className="rounded-sm bg-destructive/5 px-2 py-1 text-xs text-destructive">
            {row.error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {row.existingRoute && (
            <Button asChild variant="outline" size="sm">
              <Link to={row.existingRoute}>View existing</Link>
            </Button>
          )}
          {row.status !== "synced" && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />
              Retry
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onDiscard}>
            <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden />
            Discard
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ row }: { row: QueuedMutation }) {
  if (row.status === "failed") {
    return (
      <Badge variant="destructive" className="capitalize">
        <AlertTriangle className="mr-1 h-3 w-3" aria-hidden />
        Failed
      </Badge>
    );
  }
  if (row.status === "synced") {
    return (
      <Badge className="capitalize">
        <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden />
        Synced
      </Badge>
    );
  }
  if (row.status === "syncing") {
    return (
      <Badge variant="secondary" className="capitalize">
        <CloudUpload className="mr-1 h-3 w-3" aria-hidden />
        Syncing
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="capitalize">
      Pending
    </Badge>
  );
}
