// P-180 — Productivity dashboard: units per manhour by discipline / area / trade.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BarChart3 } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
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
  computeQuantityProgress,
  getControlsAccess,
  getProductivity,
  listControlsProjects,
} from "@/lib/controls.functions";
import { formatPerManhour } from "@/lib/controls.rules";
import { useI18n } from "@/lib/i18n/locale-provider";

export const Route = createFileRoute("/_authenticated/construction/productivity")({
  head: () => ({
    meta: [
      { title: "Construction productivity · GridMind EPC" },
      {
        name: "description",
        content:
          "Units per manhour by discipline, area and trade from approved daily reports and manpower logs.",
      },
      { property: "og:title", content: "Construction productivity · GridMind EPC" },
      {
        property: "og:description",
        content: "Track installed quantities against manhours and roll quantity progress into EVM.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProductivityPage,
});

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function ProductivityPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [dimension, setDimension] = useState<"discipline" | "area" | "trade">("discipline");
  const [from, setFrom] = useState(() => isoDaysAgo(90));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [minCrew, setMinCrew] = useState(0);

  const projectsFn = useServerFn(listControlsProjects);
  const projects = useQuery({ queryKey: ["controls-projects"], queryFn: () => projectsFn() });
  const activeProject = projectId || (projects.data?.[0]?.id ?? "");

  const accessFn = useServerFn(getControlsAccess);
  const access = useQuery({ queryKey: ["controls-access"], queryFn: () => accessFn() });

  const prodFn = useServerFn(getProductivity);
  const prod = useQuery({
    queryKey: ["productivity", activeProject, dimension, from, to, minCrew],
    queryFn: () => prodFn({ data: { projectId: activeProject, dimension, from, to, minCrew } }),
    enabled: Boolean(activeProject),
  });

  const quantityFn = useServerFn(computeQuantityProgress);
  const rollup = useMutation({
    mutationFn: () => quantityFn({ data: { projectId: activeProject } }),
    onSuccess: (r) => {
      toast.success(
        t("adminMod.construction.productivity.recomputeSuccess", {
          count: r.updatedCwps,
          pct: r.projectProgressPct.toFixed(1),
        }),
      );
      void qc.invalidateQueries({ queryKey: ["cwp-board", activeProject] });
    },
    onError: () => toast.error(t("adminMod.construction.productivity.recomputeFailed")),
  });

  const rows = prod.data?.rows ?? [];
  const totalHours = prod.data?.totalHours ?? 0;
  const overall = totalHours > 0 ? (prod.data?.totalQty ?? 0) / totalHours : null;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader
        title={t("adminMod.construction.productivity.title")}
        description={t("adminMod.construction.productivity.description")}
        actions={
          <Button
            size="sm"
            disabled={!activeProject || !access.data?.canAdmin || rollup.isPending}
            onClick={() => rollup.mutate()}
          >
            {t("adminMod.construction.productivity.recompute")}
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <ProjectSelect
          projects={projects.data ?? []}
          value={activeProject}
          onChange={setProjectId}
          loading={projects.isLoading}
        />
        <div className="w-full space-y-1 sm:w-40">
          <Label htmlFor="dimension" className="text-xs text-muted-foreground">
            {t("adminMod.construction.productivity.groupBy")}
          </Label>
          <Select value={dimension} onValueChange={(v) => setDimension(v as typeof dimension)}>
            <SelectTrigger id="dimension">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="discipline">
                {t("adminMod.construction.productivity.dimension.discipline")}
              </SelectItem>
              <SelectItem value="area">
                {t("adminMod.construction.productivity.dimension.area")}
              </SelectItem>
              <SelectItem value="trade">
                {t("adminMod.construction.productivity.dimension.trade")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-full space-y-1 sm:w-40">
          <Label htmlFor="from" className="text-xs text-muted-foreground">
            {t("adminMod.construction.productivity.from")}
          </Label>
          <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="w-full space-y-1 sm:w-40">
          <Label htmlFor="to" className="text-xs text-muted-foreground">
            {t("adminMod.construction.productivity.to")}
          </Label>
          <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="w-full space-y-1 sm:w-40">
          <Label htmlFor="min-crew" className="text-xs text-muted-foreground">
            {t("adminMod.construction.productivity.minCrewSize")}
          </Label>
          <Input
            id="min-crew"
            type="number"
            min={0}
            value={minCrew}
            onChange={(e) => setMinCrew(Number(e.target.value) || 0)}
          />
        </div>
      </div>

      <KpiGrid>
        <KpiTile
          label={t("adminMod.construction.productivity.unitsPerManhour")}
          value={formatPerManhour(overall)}
        />
        <KpiTile
          label={t("adminMod.construction.productivity.totalQuantity")}
          value={String(prod.data?.totalQty ?? 0)}
        />
        <KpiTile
          label={t("adminMod.construction.productivity.totalManhours")}
          value={String(totalHours)}
        />
      </KpiGrid>

      <PanelState
        isLoading={prod.isLoading || projects.isLoading}
        isError={prod.isError}
        onRetry={() => void prod.refetch()}
        isEmpty={!prod.isLoading && rows.length === 0}
        emptyIcon={BarChart3}
        emptyTitle={t("adminMod.construction.productivity.noApprovedReports")}
        emptyDescription={t("adminMod.construction.productivity.noApprovedReportsDesc")}
      >
        <div className="space-y-4">
          <div className="h-64 rounded-md border border-border bg-card p-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={prod.data?.weekly ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="week" stroke="var(--muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--muted-foreground)" fontSize={11} />
                <RTooltip />
                <Line
                  type="monotone"
                  dataKey="unitsPerManhour"
                  stroke="var(--primary)"
                  dot={false}
                  name={t("adminMod.construction.productivity.unitsPerManhour")}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{dimension}</TableHead>
                  <TableHead>{t("adminMod.construction.productivity.quantityCol")}</TableHead>
                  <TableHead>{t("adminMod.construction.productivity.manhoursCol")}</TableHead>
                  <TableHead>{t("adminMod.construction.productivity.unitsPerManhour")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.bucket}>
                    <TableCell className="text-foreground">{r.bucket}</TableCell>
                    <TableCell className="text-muted-foreground">{r.qty}</TableCell>
                    <TableCell className="text-muted-foreground">{r.hours}</TableCell>
                    <TableCell className="text-foreground">
                      {formatPerManhour(r.unitsPerManhour)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("adminMod.construction.productivity.weekCol")}</TableHead>
                  <TableHead>{t("adminMod.construction.productivity.quantityCol")}</TableHead>
                  <TableHead>{t("adminMod.construction.productivity.manhoursCol")}</TableHead>
                  <TableHead>{t("adminMod.construction.productivity.unitsPerManhour")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(prod.data?.weekly ?? []).map((w) => (
                  <TableRow key={w.week}>
                    <TableCell className="text-foreground">{w.week}</TableCell>
                    <TableCell className="text-muted-foreground">{w.qty}</TableCell>
                    <TableCell className="text-muted-foreground">{w.hours}</TableCell>
                    <TableCell className="text-foreground">
                      {formatPerManhour(w.unitsPerManhour)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </PanelState>
    </div>
  );
}
