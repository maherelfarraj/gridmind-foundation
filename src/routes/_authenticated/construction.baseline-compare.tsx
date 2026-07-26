// P-180 — Baseline vs current schedule variance.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { GitCompare } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PanelState, ProjectSelect } from "@/components/construction/controls-shell";
import {
  getBaselineCompare,
  listControlsProjects,
  listProjectBaselines,
} from "@/lib/controls.functions";
import { SLIPPAGE_THRESHOLD_DAYS } from "@/lib/controls.rules";

export const Route = createFileRoute("/_authenticated/construction/baseline-compare")({
  head: () => ({
    meta: [
      { title: "Baseline compare · GridMind EPC" },
      {
        name: "description",
        content:
          "Compare the current schedule against a locked baseline: start/finish variance in days and progress delta.",
      },
      { property: "og:title", content: "Baseline compare · GridMind EPC" },
      {
        property: "og:description",
        content: "Locked-baseline variance analysis with slippage flags for construction delivery.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BaselineComparePage,
});

function VarianceChip({ days }: { days: number | null }) {
  if (days == null) return <span className="text-muted-foreground">—</span>;
  const slipping = days > SLIPPAGE_THRESHOLD_DAYS;
  return (
    <Badge variant={slipping ? "destructive" : days > 0 ? "secondary" : "outline"}>
      {days > 0 ? `+${days}` : days} d
    </Badge>
  );
}

function BaselineComparePage() {
  const [projectId, setProjectId] = useState("");
  const [baselineId, setBaselineId] = useState("");

  const projectsFn = useServerFn(listControlsProjects);
  const projects = useQuery({ queryKey: ["controls-projects"], queryFn: () => projectsFn() });
  const activeProject = projectId || (projects.data?.[0]?.id ?? "");

  const baselinesFn = useServerFn(listProjectBaselines);
  const baselines = useQuery({
    queryKey: ["controls-baselines", activeProject],
    queryFn: () => baselinesFn({ data: { projectId: activeProject } }),
    enabled: Boolean(activeProject),
  });
  const lockedBaselines = (baselines.data ?? []).filter((b) => b.locked);
  const activeBaseline = baselineId || (lockedBaselines[0]?.id ?? "");

  const compareFn = useServerFn(getBaselineCompare);
  const compare = useQuery({
    queryKey: ["baseline-compare", activeProject, activeBaseline],
    queryFn: () => compareFn({ data: { projectId: activeProject, baselineId: activeBaseline } }),
    enabled: Boolean(activeProject && activeBaseline),
  });

  const rows = compare.data?.rows ?? [];
  const slipping = rows.filter((r) => r.slipping).length;
  const worst = rows.reduce<number | null>(
    (m, r) => (r.finishVarianceDays == null ? m : Math.max(m ?? 0, r.finishVarianceDays)),
    null,
  );

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Baseline compare"
        description={`Current schedule versus a locked baseline. Slippage over ${SLIPPAGE_THRESHOLD_DAYS} days is flagged.`}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <ProjectSelect
          projects={projects.data ?? []}
          value={activeProject}
          onChange={setProjectId}
          loading={projects.isLoading}
        />
        <div className="w-full space-y-1 sm:w-72">
          <Label htmlFor="baseline" className="text-xs text-muted-foreground">
            Locked baseline
          </Label>
          <Select value={activeBaseline} onValueChange={setBaselineId}>
            <SelectTrigger id="baseline">
              <SelectValue placeholder="Select a locked baseline" />
            </SelectTrigger>
            <SelectContent>
              {lockedBaselines.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <KpiGrid>
        <KpiTile label="Tasks compared" value={String(rows.length)} />
        <KpiTile label="Slipping tasks" value={String(slipping)} />
        <KpiTile label="Worst finish variance" value={worst == null ? "—" : `${worst} d`} />
      </KpiGrid>

      <PanelState
        isLoading={compare.isLoading || baselines.isLoading || projects.isLoading}
        isError={compare.isError || baselines.isError}
        onRetry={() => void compare.refetch()}
        isEmpty={!compare.isLoading && rows.length === 0}
        emptyIcon={GitCompare}
        emptyTitle="Nothing to compare"
        emptyDescription="Lock a schedule baseline on the project Gantt, then return here."
      >
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Baseline</TableHead>
                <TableHead>Current</TableHead>
                <TableHead>Start var</TableHead>
                <TableHead>Finish var</TableHead>
                <TableHead>Progress Δ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.taskId}>
                  <TableCell className="max-w-56 truncate text-foreground">{r.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.baselineStart ?? "—"} → {r.baselineEnd ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.currentStart ?? "—"} → {r.currentEnd ?? "—"}
                  </TableCell>
                  <TableCell>
                    <VarianceChip days={r.startVarianceDays} />
                  </TableCell>
                  <TableCell>
                    <VarianceChip days={r.finishVarianceDays} />
                  </TableCell>
                  <TableCell
                    className={
                      (r.progressDelta ?? 0) < 0 ? "text-destructive" : "text-muted-foreground"
                    }
                  >
                    {r.progressDelta == null ? "—" : `${r.progressDelta.toFixed(1)}%`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </PanelState>
    </div>
  );
}
