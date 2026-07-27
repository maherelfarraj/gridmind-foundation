// P-190 — Affected systems checklist with entity deep links and a thread drawer.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Network, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { ThreadGraph } from "@/components/thread/thread-graph";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { getEntityThread } from "@/lib/digital-thread/thread.functions";
import type { AffectedSystem } from "@/lib/moc.rules";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Deep link for an affected entity, when the app has a screen for its type. */
export function entityHref(entityType: string, entityId: string): string | null {
  if (!UUID_RE.test(entityId)) return null;
  switch (entityType) {
    case "purchase_order":
      return `/procurement/pos/${entityId}`;
    case "rfq":
      return `/procurement/rfqs/${entityId}`;
    case "drawing":
    case "drawing_register":
      return `/engineering/drawings/${entityId}`;
    case "sld_drawing":
      return `/engineering/sld/${entityId}`;
    case "ncr":
      return `/quality/ncrs/${entityId}`;
    case "rfi":
      return `/engineering/rfis/${entityId}`;
    case "work_order":
      return `/om/work-orders/${entityId}`;
    case "project":
      return `/projects/${entityId}`;
    default:
      return null;
  }
}

function ThreadDrawer({
  entityType,
  entityId,
  onClose,
}: {
  entityType: string;
  entityId: string;
  onClose: () => void;
}) {
  const fetchThread = useServerFn(getEntityThread);
  const query = useQuery({
    queryKey: ["moc", "thread", entityType, entityId],
    queryFn: () => fetchThread({ data: { entityType, entityId, depth: 2 } }),
  });

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Digital thread — {entityType.replaceAll("_", " ")}</SheetTitle>
        </SheetHeader>
        <div className="mt-4">
          {query.isPending ? <Skeleton className="h-64 w-full" /> : null}
          {query.isError ? (
            <EmptyState
              title="Could not load the thread"
              description="Something went wrong reading linked records."
              action={
                <Button variant="outline" onClick={() => void query.refetch()}>
                  Retry
                </Button>
              }
            />
          ) : null}
          {query.data && query.data.graph.nodes.length > 0 ? (
            <ThreadGraph graph={query.data.graph} />
          ) : null}
          {query.data && query.data.graph.nodes.length === 0 ? (
            <EmptyState
              icon={Network}
              title="No linked records"
              description="This entity has no digital-thread links yet."
              compact
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function AffectedSystems({
  rows,
  editable,
  onChange,
}: {
  rows: AffectedSystem[];
  editable: boolean;
  onChange: (next: AffectedSystem[]) => void;
}) {
  const [thread, setThread] = useState<{ type: string; id: string } | null>(null);

  const update = (index: number, patch: Partial<AffectedSystem>) =>
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-3">
      {rows.length === 0 && !editable ? (
        <EmptyState
          icon={Network}
          title="No affected systems listed"
          description="Nothing was recorded as impacted by this change."
          compact
        />
      ) : null}

      <ul className="space-y-2">
        {rows.map((row, index) => (
          <li
            key={`${row.system}-${index}`}
            className="grid gap-2 rounded-md border border-border bg-card p-3 md:grid-cols-[1fr_1fr_1fr_2fr_auto]"
          >
            {editable ? (
              <>
                <Input
                  aria-label="System"
                  placeholder="System"
                  value={row.system}
                  onChange={(e) => update(index, { system: e.target.value })}
                />
                <Input
                  aria-label="Entity type"
                  placeholder="Entity type"
                  value={row.entity_type}
                  onChange={(e) => update(index, { entity_type: e.target.value })}
                />
                <Input
                  aria-label="Entity id"
                  placeholder="Entity id"
                  value={row.entity_id}
                  onChange={(e) => update(index, { entity_id: e.target.value })}
                />
                <Input
                  aria-label="Note"
                  placeholder="Note"
                  value={row.note}
                  onChange={(e) => update(index, { note: e.target.value })}
                />
              </>
            ) : (
              <>
                <span className="text-sm font-medium text-foreground">{row.system || "—"}</span>
                <span className="text-sm text-muted-foreground">
                  {row.entity_type.replaceAll("_", " ") || "—"}
                </span>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {row.entity_id || "—"}
                </span>
                <span className="text-sm text-muted-foreground">{row.note}</span>
              </>
            )}
            <div className="flex items-center gap-2">
              {row.entity_id && entityHref(row.entity_type, row.entity_id) ? (
                <Button asChild size="sm" variant="outline">
                  <Link to={entityHref(row.entity_type, row.entity_id)!}>Open</Link>
                </Button>
              ) : null}
              {row.entity_id && UUID_RE.test(row.entity_id) ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setThread({ type: row.entity_type, id: row.entity_id })}
                >
                  <Network className="mr-1 size-4" aria-hidden />
                  Thread
                </Button>
              ) : null}
              {editable ? (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove row"
                  onClick={() => onChange(rows.filter((_, i) => i !== index))}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {editable ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onChange([...rows, { system: "", entity_type: "", entity_id: "", note: "" }])
          }
        >
          <Plus className="mr-1 size-4" aria-hidden />
          Add affected system
        </Button>
      ) : null}

      {thread ? (
        <ThreadDrawer
          entityType={thread.type}
          entityId={thread.id}
          onClose={() => setThread(null)}
        />
      ) : null}
    </div>
  );
}
