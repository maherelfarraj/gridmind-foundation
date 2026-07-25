// P-089 — QA/QC heatmap by area × discipline.
import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { HeatmapGrid } from "@/components/qaqc/heatmap-grid";
import { errorMessage, qaqcHeatmapQueryOptions, qaqcProjectsQueryOptions } from "@/lib/qaqc-query";
import type { QaqcDiscipline } from "@/lib/qaqc.rules";

export const Route = createFileRoute("/_authenticated/qaqc/heatmap")({
  head: () => ({
    meta: [
      { title: "QA/QC heatmap — GridMind EPC" },
      {
        name: "description",
        content: "Inspection heatmap by area and discipline with fail-rate tints and rework KPI.",
      },
      { property: "og:title", content: "QA/QC heatmap" },
      {
        property: "og:description",
        content: "Spot problem areas at a glance.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HeatmapPage,
});

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function HeatmapPage() {
  const navigate = useNavigate();
  const projectsQuery = useQuery(qaqcProjectsQueryOptions());
  const defaultFrom = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return isoDate(d);
  }, []);
  const defaultTo = useMemo(() => isoDate(new Date()), []);

  const [projectId, setProjectId] = useState<string>("");
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  // auto-select first project once loaded
  const projects = projectsQuery.data ?? [];
  if (!projectId && projects.length > 0) {
    // note: setState inside render is safe if condition eventually false
    // but prefer defer via microtask
    queueMicrotask(() => setProjectId(projects[0].id));
  }

  const heatmapQuery = useQuery(qaqcHeatmapQueryOptions(projectId, from, to));
  const summary = heatmapQuery.data;

  const drill = (area: string, discipline: QaqcDiscipline) => {
    navigate({
      to: "/qaqc/inspections",
      search: { projectId, discipline, area, from, to },
    });
  };

  return (
    <div className="page-shell">
      <PageHeader
        title="Quality heatmap"
        description="Inspection heatmap by area and discipline with fail-rate tints."
      />

      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-4">
          <div className="md:col-span-2 flex flex-col gap-1">
            <Label className="text-xs">Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <KpiGrid columns={4}>
        <KpiTile
          icon={ClipboardCheck}
          label="Total"
          value={summary ? summary.totals.total.toString() : "—"}
          isLoading={heatmapQuery.isLoading}
        />
        <KpiTile
          icon={TrendingUp}
          label="Rework %"
          value={summary ? `${Math.round(summary.totals.reworkPct * 100)}%` : "—"}
          isLoading={heatmapQuery.isLoading}
          status={summary && summary.totals.reworkPct > 0.15 ? "bad" : "neutral"}
        />
        <KpiTile
          icon={TrendingUp}
          label="Pass %"
          value={summary ? `${Math.round(summary.totals.passPct * 100)}%` : "—"}
          isLoading={heatmapQuery.isLoading}
        />
        <KpiTile
          icon={ClipboardCheck}
          label="Open"
          value={summary ? String(summary.totals.pending + summary.totals.conditional) : "—"}
          isLoading={heatmapQuery.isLoading}
        />
      </KpiGrid>

      {heatmapQuery.isError ? (
        <Card>
          <CardContent className="p-4 text-sm text-destructive">
            <div>{errorMessage(heatmapQuery.error)}</div>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => heatmapQuery.refetch()}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {!projectId ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Select a project to see its inspection heatmap.
          </CardContent>
        </Card>
      ) : heatmapQuery.isLoading ? (
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : summary ? (
        <HeatmapGrid data={summary} onCellClick={drill} />
      ) : null}
    </div>
  );
}
