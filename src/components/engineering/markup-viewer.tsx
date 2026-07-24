// P-053 — Markup viewer: PDF/image preview + click-to-pin overlay + side panel.
// Uses <iframe> for PDFs and <img> for images; pins are overlaid on a positioned
// layer sized to the container. No pdfjs worker setup required.
import { useEffect, useMemo, useRef, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  getMyDrawingRoles,
  getRevisionDownloadUrl,
  listMarkups,
  type MarkupRow,
  type RevisionRow,
} from "@/lib/drawings.functions";
import {
  drawingRolesQueryOptions,
  markupsQueryOptions,
  useCreateMarkup,
  useUpdateMarkupStatus,
} from "@/lib/drawings-query";

const MARKUP_STATUSES = ["open", "accepted", "rejected", "resolved"] as const;
type MarkupStatus = (typeof MARKUP_STATUSES)[number];

const STATUS_BADGE: Record<MarkupStatus, string> = {
  open: "bg-accent/20 text-accent-foreground border-accent/40",
  accepted: "bg-primary/15 text-primary border-primary/40",
  rejected: "bg-destructive/15 text-destructive border-destructive/40",
  resolved: "bg-muted text-muted-foreground border-transparent",
};

interface Props {
  revision: RevisionRow;
  projectId: string;
}

export function MarkupViewer({ revision, projectId }: Props) {
  const rolesFn = useServerFn(getMyDrawingRoles);
  const markupsFn = useServerFn(listMarkups);
  const dlFn = useServerFn(getRevisionDownloadUrl);
  const { data: roles } = useSuspenseQuery(drawingRolesQueryOptions(rolesFn, projectId));
  const { data: markups } = useSuspenseQuery(markupsQueryOptions(markupsFn, revision.id));

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [comment, setComment] = useState("");
  const create = useCreateMarkup(revision.id);
  const viewerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    dlFn({ data: { revisionId: revision.id } })
      .then((res) => {
        if (!cancelled) setPreviewUrl(res.url);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Preview failed"));
    return () => {
      cancelled = true;
    };
  }, [revision.id, dlFn]);

  const mime = (revision.mime_type ?? "").toLowerCase();
  const isPdf = mime.includes("pdf") || revision.file_name?.toLowerCase().endsWith(".pdf");
  const isImage =
    mime.startsWith("image/") ||
    /\.(png|jpe?g|tiff?)$/i.test(revision.file_name ?? "");

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!roles.canWrite) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || y < 0 || x > 1 || y > 1) return;
    setPending({ x, y });
    setComment("");
  };

  const savePending = () => {
    if (!pending) return;
    create.mutate(
      {
        annotation: { coords: pending, comment, color: "hsl(var(--primary))", type: "pin" },
      },
      {
        onSuccess: () => {
          setPending(null);
          setComment("");
        },
      },
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Card className="relative overflow-hidden">
        <div
          ref={viewerRef}
          className="relative aspect-[4/3] w-full bg-muted"
          onClick={handleClick}
          role={roles.canWrite ? "button" : undefined}
          aria-label="Drawing preview — click to add a markup pin"
        >
          {previewUrl == null ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Loading preview…
            </div>
          ) : isPdf ? (
            <iframe
              src={previewUrl + "#toolbar=0&navpanes=0"}
              className="pointer-events-none h-full w-full"
              title="Drawing preview"
            />
          ) : isImage ? (
            <img
              src={previewUrl}
              alt="Drawing preview"
              className="pointer-events-none h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <p>Preview not available for this file type.</p>
              <a
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                Download to view
              </a>
            </div>
          )}
          {/* Overlay pins */}
          <div className="pointer-events-none absolute inset-0">
            {markups.map((m, i) => {
              const c = m.annotation?.coords;
              if (!c) return null;
              return (
                <Pin
                  key={m.id}
                  index={i + 1}
                  x={c.x}
                  y={c.y}
                  status={(m.status as MarkupStatus) ?? "open"}
                  comment={m.annotation?.comment ?? ""}
                />
              );
            })}
            {pending && (
              <div
                className="pointer-events-auto absolute -translate-x-1/2 -translate-y-full"
                style={{ left: `${pending.x * 100}%`, top: `${pending.y * 100}%` }}
              >
                <Popover open onOpenChange={(o) => !o && setPending(null)}>
                  <PopoverTrigger asChild>
                    <span className="inline-block h-6 w-6 rounded-full border-2 border-primary bg-primary/40" />
                  </PopoverTrigger>
                  <PopoverContent className="w-64" align="center">
                    <div className="flex flex-col gap-2">
                      <p className="text-xs font-medium">New markup</p>
                      <Textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        rows={3}
                        placeholder="Describe the issue…"
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setPending(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={savePending}
                          disabled={create.isPending || comment.trim().length === 0}
                        >
                          Add pin
                        </Button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            )}
          </div>
        </div>
        {roles.canWrite && (
          <p className="border-t border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            Click anywhere on the preview to add a markup pin.
          </p>
        )}
      </Card>
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Markups ({markups.length})
        </p>
        {markups.length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">
            No markups yet.
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {markups.map((m, i) => (
              <MarkupRow
                key={m.id}
                index={i + 1}
                markup={m}
                revisionId={revision.id}
                currentUserId={roles.canWrite ? "self" : null}
                canModerate={roles.canTransition}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Pin({
  index,
  x,
  y,
  status,
  comment,
}: {
  index: number;
  x: number;
  y: number;
  status: MarkupStatus;
  comment: string;
}) {
  const color =
    status === "accepted"
      ? "bg-primary text-primary-foreground"
      : status === "rejected"
        ? "bg-destructive text-destructive-foreground"
        : status === "resolved"
          ? "bg-muted text-muted-foreground"
          : "bg-accent text-accent-foreground";
  return (
    <div
      className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
      title={comment}
    >
      <span
        className={`inline-flex h-6 w-6 items-center justify-center rounded-full border border-border text-[10px] font-bold shadow ${color}`}
      >
        {index}
      </span>
    </div>
  );
}

function MarkupRow({
  index,
  markup,
  revisionId,
  canModerate,
}: {
  index: number;
  markup: MarkupRow;
  revisionId: string;
  currentUserId: string | null;
  canModerate: boolean;
}) {
  const update = useUpdateMarkupStatus(revisionId);
  return (
    <Card className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-foreground">
            {index}
          </span>
          <Badge className={STATUS_BADGE[markup.status]}>{markup.status}</Badge>
        </span>
        <span className="text-xs text-muted-foreground">
          {new Date(markup.created_at).toLocaleDateString()}
        </span>
      </div>
      <p className="text-sm text-foreground">{markup.annotation?.comment || "—"}</p>
      {markup.reviewer && (
        <p className="text-xs text-muted-foreground">
          by {markup.reviewer.full_name ?? markup.reviewer.email ?? "reviewer"}
        </p>
      )}
      {canModerate && (
        <div>
          <Select
            value={markup.status}
            onValueChange={(v) =>
              update.mutate({ markupId: markup.id, status: v as MarkupStatus })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MARKUP_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </Card>
  );
}
