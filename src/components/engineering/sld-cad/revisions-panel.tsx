// P-145 — Revision timeline, compare mode, as-built and markup review dock.
import { useMemo, useState } from "react";
import { CloudCog, FileDown, GitCompare, History, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useAddMarkup,
  useAsDesignedAsBuilt,
  useCreateRevision,
  useExportRevisionDiff,
  useMarkAsBuilt,
  useResolveMarkup,
  useRevisionDiff,
  useSldRevisions,
} from "@/lib/sld-revisions-query";
import { useCanvasStore } from "@/lib/sld/canvas-store";

type Props = { drawingId: string; canEdit: boolean };

export function RevisionsPanel({ drawingId, canEdit }: Props) {
  const revisions = useSldRevisions(drawingId);
  const create = useCreateRevision(drawingId);
  const asBuilt = useMarkAsBuilt(drawingId);
  const exportDiff = useExportRevisionDiff();
  const addMarkup = useAddMarkup(drawingId);
  const resolveMarkup = useResolveMarkup(drawingId);

  const selection = useCanvasStore((s) => s.selection);
  const objects = useCanvasStore((s) => s.objects);
  const markups = useCanvasStore((s) => s.markups);

  const [issueReason, setIssueReason] = useState("");
  const [note, setNote] = useState("");
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);

  const rows = (revisions.data as any)?.revisions ?? [];
  const drawing = (revisions.data as any)?.drawing;
  const locked = Boolean(drawing?.locked);
  const hasAsBuiltPair = rows.some((r: any) => r.status === "as_built");

  const diff = useRevisionDiff(drawingId, a, b);
  const abDiff = useAsDesignedAsBuilt(drawingId, hasAsBuiltPair);
  const totals = (diff.data as any)?.totals;

  const selectedPoints = useMemo(
    () => objects.filter((o) => selection.includes(o.id)).map((o) => ({ x: o.x, y: o.y })),
    [objects, selection],
  );

  return (
    <div className="space-y-4 text-sm">
      <section className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <History className="size-3.5" /> Revision timeline
        </div>
        {revisions.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading revisions…</p>
        ) : rows.length === 0 ? (
          <EmptyState title="No revisions yet" description="Issue a revision to start history." />
        ) : (
          <ul className="space-y-1">
            {rows.map((r: any) => (
              <li
                key={r.id}
                className="rounded-md border border-border bg-card px-2 py-1.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">Rev {r.revision_code}</span>
                  <StatusBadge status={r.status} />
                </div>
                {r.issue_reason ? (
                  <p className="mt-0.5 text-muted-foreground">{r.issue_reason}</p>
                ) : null}
                <p className="mt-0.5 text-muted-foreground">
                  {r.issued_by_name ?? r.created_by_name ?? "—"} ·{" "}
                  {new Date(r.issued_at ?? r.created_at).toLocaleDateString()}
                  {r.is_current ? " · current" : ""}
                </p>
                {r.markup_count > 0 ? (
                  <Badge variant="outline" className="mt-1">
                    {r.open_markups} open / {r.markup_count} markups
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canEdit ? (
        <section className="space-y-2 border-t border-border pt-3">
          <Label htmlFor="issue-reason" className="text-xs">
            Issue reason
          </Label>
          <Input
            id="issue-reason"
            value={issueReason}
            onChange={(e) => setIssueReason(e.target.value)}
            placeholder="e.g. Client comments incorporated"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={create.isPending || locked}
              onClick={() => create.mutate({ issueReason, reason: "revision" })}
            >
              <Plus className="size-3.5" /> New revision
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={asBuilt.isPending}
              onClick={() => asBuilt.mutate()}
            >
              Mark as-built
            </Button>
          </div>
          {locked ? (
            <p className="text-xs text-muted-foreground">
              Drawing is locked — only an as-built revision can be created.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <GitCompare className="size-3.5" /> Compare revisions
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Select value={a ?? undefined} onValueChange={setA}>
            <SelectTrigger>
              <SelectValue placeholder="From" />
            </SelectTrigger>
            <SelectContent>
              {rows.map((r: any) => (
                <SelectItem key={r.id} value={r.id}>
                  Rev {r.revision_code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={b ?? undefined} onValueChange={setB}>
            <SelectTrigger>
              <SelectValue placeholder="To" />
            </SelectTrigger>
            <SelectContent>
              {rows.map((r: any) => (
                <SelectItem key={r.id} value={r.id}>
                  Rev {r.revision_code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {diff.isFetching ? <p className="text-xs text-muted-foreground">Comparing…</p> : null}
        {totals ? (
          <div className="space-y-1 rounded-md border border-border p-2 text-xs">
            <p>
              <span className="text-primary">+{totals.added} added</span> ·{" "}
              <span className="text-destructive">−{totals.removed} removed</span> · {totals.moved}{" "}
              moved
            </p>
            <p className="text-muted-foreground">
              {totals.propertyChanged} property · {totals.tagChanged} tag ·{" "}
              {totals.connectionChanged} connection changes
            </p>
            {(diff.data as any)?.identical ? (
              <p className="text-muted-foreground">Graph hashes identical — no model change.</p>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={!a || !b || exportDiff.isPending}
              onClick={() => a && b && exportDiff.mutate({ revisionIdA: a, revisionIdB: b })}
            >
              <FileDown className="size-3.5" /> Export CSV
            </Button>
          </div>
        ) : null}

        {(abDiff.data as any)?.available ? (
          <div className="space-y-1 rounded-md border border-border p-2 text-xs">
            <p className="font-medium">As-designed vs as-built</p>
            <p className="text-muted-foreground">
              Rev {(abDiff.data as any).a.revision_code} → {(abDiff.data as any).b.revision_code}:{" "}
              {(abDiff.data as any).totals.added} added, {(abDiff.data as any).totals.removed}{" "}
              removed, {(abDiff.data as any).totals.moved} moved
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={exportDiff.isPending}
              onClick={() =>
                exportDiff.mutate({
                  revisionIdA: (abDiff.data as any).a.id,
                  revisionIdB: (abDiff.data as any).b.id,
                })
              }
            >
              <FileDown className="size-3.5" /> Export comparison
            </Button>
          </div>
        ) : null}
      </section>

      <section className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <CloudCog className="size-3.5" /> Clouds &amp; markups
        </div>
        {canEdit ? (
          <div className="space-y-2">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Markup note"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={selection.length === 0 || addMarkup.isPending}
              onClick={() => {
                addMarkup.mutate({
                  markup: {
                    id: crypto.randomUUID(),
                    kind: "cloud",
                    points: selectedPoints,
                    note,
                    linked_object_ids: selection,
                  },
                });
                setNote("");
              }}
            >
              Cloud selection ({selection.length})
            </Button>
          </div>
        ) : null}

        {markups.length === 0 ? (
          <p className="text-xs text-muted-foreground">No markups on this revision.</p>
        ) : (
          <ul className="space-y-1">
            {markups.map((m) => (
              <li key={m.id} className="rounded-md border border-border px-2 py-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium capitalize">{m.kind}</span>
                  <StatusBadge status={m.status} />
                </div>
                {m.note ? <p className="mt-0.5">{m.note}</p> : null}
                <p className="mt-0.5 text-muted-foreground">
                  {m.author_name ?? "—"} · {m.linked_object_ids.length} linked
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-1 h-6 px-2"
                  disabled={resolveMarkup.isPending}
                  onClick={() =>
                    resolveMarkup.mutate({
                      markupId: m.id,
                      status: m.status === "open" ? "resolved" : "open",
                    })
                  }
                >
                  {m.status === "open" ? "Resolve" : "Reopen"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
