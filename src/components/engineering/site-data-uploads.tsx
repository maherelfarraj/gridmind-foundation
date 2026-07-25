// P-052 — Site data uploads surface (dropzone + queue + list).
import { useCallback, useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CloudUpload, Download, FileWarning, Loader2, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ALLOWED_EXTENSIONS,
  SITE_DATA_CATEGORIES,
  SITE_DATA_CATEGORY_LABEL,
  SITE_DATA_MAX_BYTES,
  listSiteData,
  type SiteDataCategory,
  type SiteDataRow,
} from "@/lib/site-data.functions";
import {
  siteDataListQueryOptions,
  useDownloadSiteData,
  useRegisterSiteDataDocument,
  useUploadSiteData,
} from "@/lib/site-data-query";
import { SiteDataCategoryDialog } from "./site-data-category-dialog";

type QueueStatus = "pending" | "uploading" | "registering" | "done" | "error" | "rejected";

interface QueueItem {
  id: string;
  file: File;
  category: SiteDataCategory | null;
  title: string;
  tags: string[];
  metadata: Record<string, any>;
  status: QueueStatus;
  progress: number;
  error?: string;
}

const ACCEPT_STRING = ALLOWED_EXTENSIONS.join(",");

function formatBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function extAllowed(name: string): boolean {
  const idx = name.lastIndexOf(".");
  if (idx < 0) return false;
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(name.slice(idx).toLowerCase());
}

async function xhrPut(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    if (file.type) xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}

export function SiteDataUploads({ projectId }: { projectId: string }) {
  const listFn = useServerFn(listSiteData);
  const listQuery = useSuspenseQuery(siteDataListQueryOptions(listFn, projectId));
  const uploadMutation = useUploadSiteData();
  const registerMutation = useRegisterSiteDataDocument(projectId);
  const download = useDownloadSiteData();

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [pendingFile, setPendingFile] = useState<{
    id: string;
    file: File;
  } | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleFiles = useCallback((files: File[]) => {
    const next: QueueItem[] = [];
    let firstToConfigure: { id: string; file: File } | null = null;
    for (const file of files) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      if (!extAllowed(file.name)) {
        next.push({
          id,
          file,
          category: null,
          title: file.name,
          tags: [],
          metadata: {},
          status: "rejected",
          progress: 0,
          error: `Unsupported file type (allowed: ${ALLOWED_EXTENSIONS.join(", ")})`,
        });
        toast.error(`${file.name}: unsupported file type`);
        continue;
      }
      if (file.size > SITE_DATA_MAX_BYTES) {
        next.push({
          id,
          file,
          category: null,
          title: file.name,
          tags: [],
          metadata: {},
          status: "rejected",
          progress: 0,
          error: `File exceeds 50 MB limit (${formatBytes(file.size)})`,
        });
        toast.error(`${file.name}: exceeds 50 MB`);
        continue;
      }
      next.push({
        id,
        file,
        category: null,
        title: file.name.replace(/\.[^.]+$/, ""),
        tags: [],
        metadata: {},
        status: "pending",
        progress: 0,
      });
      if (!firstToConfigure) firstToConfigure = { id, file };
    }
    if (next.length > 0) setQueue((q) => [...next, ...q]);
    if (firstToConfigure) setPendingFile(firstToConfigure);
  }, []);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    handleFiles(files);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    handleFiles(files);
  };

  const runUpload = useCallback(
    async (item: QueueItem) => {
      setQueue((q) =>
        q.map((it) =>
          it.id === item.id ? { ...it, status: "uploading", progress: 0, error: undefined } : it,
        ),
      );
      try {
        const signed = await uploadMutation.mutateAsync({
          projectId,
          category: item.category!,
          fileName: item.file.name,
          fileSize: item.file.size,
          mimeType: item.file.type || null,
        });
        await xhrPut(signed.signedUrl, item.file, (pct) => {
          setQueue((q) => q.map((it) => (it.id === item.id ? { ...it, progress: pct } : it)));
        });
        setQueue((q) =>
          q.map((it) => (it.id === item.id ? { ...it, status: "registering", progress: 100 } : it)),
        );
        await registerMutation.mutateAsync({
          category: item.category!,
          storagePath: signed.path,
          fileName: item.file.name,
          fileSize: item.file.size,
          mimeType: item.file.type || null,
          title: item.title,
          tags: item.tags,
          metadata: item.metadata,
        });
        setQueue((q) => q.map((it) => (it.id === item.id ? { ...it, status: "done" } : it)));
        toast.success(`${item.file.name} uploaded`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        setQueue((q) =>
          q.map((it) => (it.id === item.id ? { ...it, status: "error", error: msg } : it)),
        );
        toast.error(`${item.file.name}: ${msg}`);
      }
    },
    [projectId, registerMutation, uploadMutation],
  );

  const handleConfigure = (
    id: string,
    payload: {
      category: SiteDataCategory;
      title: string;
      tags: string[];
      metadata: Record<string, any>;
    },
  ) => {
    setPendingFile(null);
    setQueue((q) =>
      q.map((it) =>
        it.id === id
          ? {
              ...it,
              category: payload.category,
              title: payload.title,
              tags: payload.tags,
              metadata: payload.metadata,
              status: "pending",
            }
          : it,
      ),
    );
    const item = queue.find((q) => q.id === id);
    if (item) {
      void runUpload({
        ...item,
        category: payload.category,
        title: payload.title,
        tags: payload.tags,
        metadata: payload.metadata,
      });
    }
  };

  const handleCancelDialog = (id: string) => {
    setPendingFile(null);
    setQueue((q) => q.filter((it) => it.id !== id));
  };

  const retryConfigure = (id: string) => {
    const item = queue.find((q) => q.id === id);
    if (item) setPendingFile({ id, file: item.file });
  };

  const removeFromQueue = (id: string) => {
    setQueue((q) => q.filter((it) => it.id !== id));
  };

  return (
    <div className="flex flex-col gap-6">
      <Dropzone
        active={dragActive}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        onInputChange={onInputChange}
      />

      {queue.length > 0 && (
        <QueueList
          items={queue}
          onRetry={(id) => {
            const it = queue.find((q) => q.id === id);
            if (it && it.category) void runUpload(it);
            else retryConfigure(id);
          }}
          onRemove={removeFromQueue}
        />
      )}

      <SiteDataList
        rows={listQuery.data}
        onDownload={(id) => download.mutate(id)}
        downloadingId={download.isPending ? (download.variables as string | undefined) : undefined}
      />

      {pendingFile && (
        <SiteDataCategoryDialog
          fileName={pendingFile.file.name}
          onCancel={() => handleCancelDialog(pendingFile.id)}
          onSubmit={(payload) => handleConfigure(pendingFile.id, payload)}
        />
      )}
    </div>
  );
}

function Dropzone({
  active,
  onDragOver,
  onDragLeave,
  onDrop,
  onInputChange,
}: {
  active: boolean;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <Card
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={
        "flex flex-col items-center justify-center gap-3 border-2 border-dashed p-10 text-center transition-colors " +
        (active ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/60")
      }
    >
      <CloudUpload size={32} className="text-muted-foreground" aria-hidden />
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-base font-semibold text-foreground">
          Drop site data files here
        </h3>
        <p className="text-sm text-muted-foreground">
          Accepts {ALLOWED_EXTENSIONS.join(", ")} — up to 50 MB per file.
        </p>
      </div>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary">
        Browse files
        <input
          type="file"
          className="sr-only"
          accept={ACCEPT_STRING}
          multiple
          onChange={onInputChange}
        />
      </label>
    </Card>
  );
}

function QueueList({
  items,
  onRetry,
  onRemove,
}: {
  items: QueueItem[];
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <Card className="border-border bg-card p-4">
      <h3 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Upload queue
      </h3>
      <ul className="flex flex-col divide-y divide-border">
        {items.map((it) => (
          <li
            key={it.id}
            className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-foreground">{it.file.name}</span>
                <span className="text-xs text-muted-foreground">{formatBytes(it.file.size)}</span>
                {it.category && (
                  <Badge variant="outline" className="text-xs">
                    {SITE_DATA_CATEGORY_LABEL[it.category]}
                  </Badge>
                )}
              </div>
              {(it.status === "uploading" || it.status === "registering") && (
                <Progress value={it.progress} className="h-1.5" />
              )}
              {it.error && <p className="text-xs text-destructive">{it.error}</p>}
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={it.status} />
              {(it.status === "error" || it.status === "rejected") && (
                <Button size="sm" variant="outline" onClick={() => onRetry(it.id)}>
                  <RefreshCw size={14} aria-hidden />
                  Retry
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                aria-label="Remove from queue"
                onClick={() => onRemove(it.id)}
              >
                <Trash2 size={14} aria-hidden />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function StatusBadge({ status }: { status: QueueStatus }) {
  switch (status) {
    case "pending":
      return <Badge variant="secondary">Waiting</Badge>;
    case "uploading":
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2 size={12} className="animate-spin" aria-hidden />
          Uploading
        </Badge>
      );
    case "registering":
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2 size={12} className="animate-spin" aria-hidden />
          Saving
        </Badge>
      );
    case "done":
      return <Badge className="bg-primary text-primary-foreground">Done</Badge>;
    case "error":
      return (
        <Badge variant="destructive" className="gap-1">
          <FileWarning size={12} aria-hidden />
          Error
        </Badge>
      );
    case "rejected":
      return (
        <Badge variant="destructive" className="gap-1">
          <FileWarning size={12} aria-hidden />
          Rejected
        </Badge>
      );
  }
}

function SiteDataList({
  rows,
  onDownload,
  downloadingId,
}: {
  rows: SiteDataRow[];
  onDownload: (id: string) => void;
  downloadingId?: string;
}) {
  const grouped = useMemo(() => rows, [rows]);

  if (grouped.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-2 border-dashed border-border bg-card p-10 text-center">
        <h3 className="font-display text-base font-semibold text-foreground">
          No site data uploaded yet
        </h3>
        <p className="text-sm text-muted-foreground">
          Drop DXF, topo or geotech files to get started.
        </p>
      </Card>
    );
  }

  return (
    <Card className="border-border bg-card">
      <div className="border-b border-border p-4">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Uploaded site data
        </h3>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Uploader</TableHead>
            <TableHead>Uploaded</TableHead>
            <TableHead>Size</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {grouped.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <div className="flex flex-col">
                  <span className="font-medium text-foreground">{r.title}</span>
                  <span className="text-xs text-muted-foreground">{r.file_name}</span>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{SITE_DATA_CATEGORY_LABEL[r.site_data_category]}</Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {r.uploader?.full_name ?? r.uploader?.email ?? "—"}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {new Date(r.created_at).toLocaleDateString()}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatBytes(r.file_size_bytes)}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onDownload(r.id)}
                  disabled={downloadingId === r.id}
                >
                  {downloadingId === r.id ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden />
                  ) : (
                    <Download size={14} aria-hidden />
                  )}
                  Download
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

export function SiteDataUploadsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

// Referenced from category set for exhaustive checks.
void SITE_DATA_CATEGORIES;
