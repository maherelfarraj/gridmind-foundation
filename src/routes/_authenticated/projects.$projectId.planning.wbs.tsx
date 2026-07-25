// P-072 — WBS builder workspace.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FolderTree, Plus, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import {
  createWbsItem,
  deleteWbsItem,
  getWbsAccess,
  listCurrenciesForWbs,
  listWbsTree,
  reparentWbsItem,
  updateWbsItem,
  type WbsItemRow,
} from "@/lib/wbs.functions";
import {
  wbsAccessQueryOptions,
  wbsCurrenciesQueryOptions,
  wbsErrorMessage,
  wbsTreeQueryOptions,
} from "@/lib/wbs-query";
import type { WbsCreateInput, WbsUpdateInput } from "@/lib/wbs-rules";

import { WbsTree } from "@/components/planning/wbs-tree";
import { WbsDetailForm } from "@/components/planning/wbs-detail-form";
import { IfcImportDialog } from "@/components/planning/ifc-import-dialog";
import { TaskAlignmentPanel } from "@/components/planning/task-alignment-panel";

export const Route = createFileRoute("/_authenticated/projects/$projectId/planning/wbs")({
  head: () => ({
    meta: [
      { title: "WBS Builder — GridMind EPC" },
      {
        name: "description",
        content: "Build the project WBS and align schedule tasks to disciplines.",
      },
      { property: "og:title", content: "WBS Builder — GridMind EPC" },
      {
        property: "og:description",
        content: "Build the project WBS and align schedule tasks to disciplines.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  pendingComponent: WbsPagePending,
  errorComponent: WbsPageError,
  component: WbsPage,
});

function WbsPage() {
  const { projectId } = Route.useParams();
  const queryClient = useQueryClient();

  const listFn = useServerFn(listWbsTree);
  const accessFn = useServerFn(getWbsAccess);
  const currenciesFn = useServerFn(listCurrenciesForWbs);

  const treeQuery = useSuspenseQuery(wbsTreeQueryOptions(listFn, projectId));
  const accessQuery = useSuspenseQuery(wbsAccessQueryOptions(accessFn));
  const currenciesQuery = useSuspenseQuery(wbsCurrenciesQueryOptions(currenciesFn));

  const canWrite = accessQuery.data.canWrite;
  const items = treeQuery.data;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const selected = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId],
  );

  const createFn = useServerFn(createWbsItem);
  const updateFn = useServerFn(updateWbsItem);
  const reparentFn = useServerFn(reparentWbsItem);
  const deleteFn = useServerFn(deleteWbsItem);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["wbs", "tree", projectId] });

  const createMut = useMutation({
    mutationFn: (input: WbsCreateInput) => createFn({ data: input }),
    onSuccess: (row) => {
      toast.success(`Created ${row.code} — ${row.name}`);
      setSelectedId(row.id);
      invalidate();
    },
    onError: (e) => toast.error(wbsErrorMessage(e)),
  });

  const updateMut = useMutation({
    mutationFn: (input: WbsUpdateInput) => updateFn({ data: input }),
    onSuccess: (row) => {
      toast.success(`Saved ${row.code}`);
      invalidate();
    },
    onError: (e) => toast.error(wbsErrorMessage(e)),
  });

  const reparentMut = useMutation({
    mutationFn: (input: { id: string; parent_id: string | null; sort_order: number }) =>
      reparentFn({ data: input }),
    onSuccess: () => {
      toast.success("Moved");
      invalidate();
    },
    onError: (e) => toast.error(wbsErrorMessage(e)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: (result, id) => {
      if (result.ok) {
        toast.success("Deleted");
        if (selectedId === id) setSelectedId(null);
        invalidate();
      } else {
        toast.error(
          `Blocked: ${result.counts.children} child item(s) and ${result.counts.tasks} task(s) still reference this node.`,
        );
      }
    },
    onError: (e) => toast.error(wbsErrorMessage(e)),
  });

  const handleQuickAddRoot = () => {
    const rootCount = items.filter((i) => i.parent_id === null).length;
    const nextCode = String(rootCount + 1);
    createMut.mutate({
      projectId,
      parent_id: null,
      code: nextCode,
      name: "New root item",
      item_type: "phase",
      sort_order: rootCount,
    });
  };

  const handleAddChild = (parent: WbsItemRow) => {
    const siblings = items.filter((i) => i.parent_id === parent.id);
    const childIndex = siblings.length + 1;
    const nextCode = `${parent.code}.${childIndex}`;
    createMut.mutate({
      projectId,
      parent_id: parent.id,
      code: nextCode,
      name: "New item",
      item_type: parent.item_type === "phase" ? "package" : "task_group",
      discipline: parent.discipline ?? null,
      sort_order: siblings.length,
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FolderTree size={18} className="text-muted-foreground" aria-hidden />
          <h2 className="font-display text-lg font-semibold text-foreground">
            Work Breakdown Structure
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setImportOpen(true)}
            disabled={!canWrite}
          >
            <Upload size={14} aria-hidden />
            Import IFC packages
          </Button>
          <Button
            size="sm"
            onClick={handleQuickAddRoot}
            disabled={!canWrite || createMut.isPending}
          >
            <Plus size={14} aria-hidden />
            Add root item
          </Button>
        </div>
      </header>

      {!canWrite && (
        <Card className="border-border bg-card p-3 text-sm text-muted-foreground">
          You have read-only access to the WBS. Ask a project or company admin for write access.
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="border-border bg-card p-3">
          {items.length === 0 ? (
            <div className="flex flex-col items-start gap-2 p-4">
              <p className="text-sm text-muted-foreground">
                No WBS items yet. Import IFC packages or add a root item to get started.
              </p>
            </div>
          ) : (
            <WbsTree
              items={items}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onAddChild={canWrite ? handleAddChild : undefined}
              onDelete={canWrite ? (id) => deleteMut.mutate(id) : undefined}
              onReparent={
                canWrite
                  ? (id, parent_id, sort_order) => reparentMut.mutate({ id, parent_id, sort_order })
                  : undefined
              }
              busy={createMut.isPending || deleteMut.isPending || reparentMut.isPending}
            />
          )}
        </Card>

        <Card className="border-border bg-card p-4">
          <WbsDetailForm
            key={selected?.id ?? "empty"}
            item={selected}
            currencies={currenciesQuery.data}
            canWrite={canWrite}
            saving={updateMut.isPending}
            onSave={(patch) => selected && updateMut.mutate({ id: selected.id, patch })}
          />
        </Card>
      </div>

      <TaskAlignmentPanel projectId={projectId} items={items} />

      <IfcImportDialog
        projectId={projectId}
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => {
          invalidate();
        }}
      />
    </div>
  );
}

function WbsPagePending() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function WbsPageError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <Card className="border-destructive/40 bg-card p-4">
      <p className="text-sm text-foreground">
        Couldn&rsquo;t load the WBS: {wbsErrorMessage(error)}
      </p>
      <Button variant="outline" size="sm" className="mt-3" onClick={() => reset()}>
        Retry
      </Button>
    </Card>
  );
}
