// P-057 — BOM route.
import { Suspense, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PackageSearch } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  getBomSnapshot,
  getMyBomRoles,
  listBomSnapshots,
  type BomLineRow,
} from "@/lib/bom.functions";
import {
  bomRolesQueryOptions,
  bomSnapshotDetailQueryOptions,
  bomSnapshotsQueryOptions,
  useGenerateBom,
  useReleaseBom,
} from "@/lib/bom-query";
import { BomHeader } from "@/components/engineering/bom-header";
import { BomTable } from "@/components/engineering/bom-table";
import { BOM_CATEGORY_LABEL } from "@/lib/calculators/bom";

export const Route = createFileRoute("/_authenticated/projects/$projectId/engineering/bom")({
  head: () => ({
    meta: [
      { title: "Bill of materials — GridMind EPC" },
      {
        name: "description",
        content: "Generate a preliminary BOM from the project's engineering configuration.",
      },
      { property: "og:title", content: "Bill of materials — GridMind EPC" },
      {
        property: "og:description",
        content: "Generate a preliminary BOM from the project's engineering configuration.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BomPage,
  errorComponent: ({ error }) => (
    <Card>
      <CardContent className="py-8 text-sm text-destructive">
        {error instanceof Error ? error.message : "Failed to load BOM."}
      </CardContent>
    </Card>
  ),
});

function BomPage() {
  const { projectId } = Route.useParams();
  return (
    <Suspense fallback={<Skeleton />}>
      <BomWorkspace projectId={projectId} />
    </Suspense>
  );
}

function BomWorkspace({ projectId }: { projectId: string }) {
  const listFn = useServerFn(listBomSnapshots);
  const detailFn = useServerFn(getBomSnapshot);
  const rolesFn = useServerFn(getMyBomRoles);

  const { data: snapshots } = useSuspenseQuery(bomSnapshotsQueryOptions(listFn, projectId));
  const { data: roles } = useSuspenseQuery(bomRolesQueryOptions(rolesFn, projectId));

  const [selectedId, setSelectedId] = useState<string | undefined>();
  useEffect(() => {
    if (!selectedId && snapshots.length > 0) setSelectedId(snapshots[0].id);
    if (selectedId && !snapshots.find((s) => s.id === selectedId)) {
      setSelectedId(snapshots[0]?.id);
    }
  }, [snapshots, selectedId]);

  const { data: detail } = useSuspenseQuery(bomSnapshotDetailQueryOptions(detailFn, selectedId));

  const generate = useGenerateBom(projectId);
  const release = useReleaseBom(selectedId ?? "", projectId);

  const project = { id: projectId };
  void project;

  const readOnly =
    !roles.canWrite ||
    !detail ||
    detail.snapshot.status === "released" ||
    detail.snapshot.status === "superseded";

  const csvHref = useMemo(() => (detail ? buildCsv(detail.lines) : null), [detail]);

  const onExport = () => {
    if (!csvHref || !detail) return;
    const a = document.createElement("a");
    a.href = csvHref;
    a.download = `bom-v${detail.snapshot.version}.csv`;
    a.click();
  };

  return (
    <div className="space-y-6">
      <BomHeader
        snapshots={snapshots}
        selectedId={selectedId}
        onSelect={setSelectedId}
        detail={detail}
        canWrite={roles.canWrite}
        canRelease={roles.canRelease}
        generating={generate.isPending}
        releasing={release.isPending}
        onGenerate={() => generate.mutate()}
        onRelease={() => release.mutate()}
        onExport={onExport}
      />

      {snapshots.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon={PackageSearch}
              title="No BOM yet"
              description="Generate a preliminary BOM from the archetype configuration."
              action={
                <Button onClick={() => generate.mutate()} disabled={!roles.canWrite || generate.isPending}>
                  {generate.isPending ? "Generating…" : "Generate BOM"}
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : detail ? (
        <BomTable
          snapshotId={detail.snapshot.id}
          projectId={projectId}
          lines={detail.lines}
          readOnly={readOnly}
        />
      ) : (
        <Skeleton />
      )}
    </div>
  );
}

function Skeleton() {
  return <div className="h-64 animate-pulse rounded-md border border-border bg-muted/40" />;
}

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsv(lines: BomLineRow[]): string {
  const header = [
    "category",
    "item",
    "spec",
    "unit",
    "qty",
    "buffer_pct",
    "qty_buffered",
    "unit_cost",
    "notes",
  ];
  const rows = lines.map((l) =>
    [
      BOM_CATEGORY_LABEL[l.category] ?? l.category,
      l.item,
      l.spec ?? "",
      l.unit,
      l.qty,
      l.buffer_pct,
      l.qty_buffered,
      l.unit_cost ?? "",
      l.notes ?? "",
    ]
      .map(csvEscape)
      .join(","),
  );
  const text = [header.join(","), ...rows].join("\n");
  return `data:text/csv;charset=utf-8,${encodeURIComponent(text)}`;
}
