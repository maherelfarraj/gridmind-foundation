// P-175 — Performance analytics workspace.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { Activity, AlertTriangle, BarChart3, Gauge, ShieldCheck, Zap } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  computeDailyKpis,
  getProjectAnalytics,
  listAnalyticsProjectOptions,
} from "@/lib/scada-analytics.functions";
import { DOWNTIME_CLASS_LABELS, FORMULAS, type DowntimeClass } from "@/lib/scada/analytics";

export const Route = createFileRoute("/_authenticated/om/scada/analytics")({
  head: () => ({
    meta: [
      { title: "Performance analytics · GridMind EPC" },
      {
        name: "description",
        content:
          "Availability, performance ratio, lost energy, downtime classification and guarantee tracking for operating renewable plants.",
      },
      { property: "og:title", content: "Performance analytics · GridMind EPC" },
      {
        property: "og:description",
        content:
          "Downtime classification, lost energy, availability, PR and PPA guarantee margins in one workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AnalyticsPage,
});

const DOWNTIME_FILL: Record<DowntimeClass, string> = {
  maintenance: "var(--chart-1)",
  curtailment: "var(--chart-2)",
  equipment_fault: "var(--destructive)",
  grid_outage: "var(--chart-3)",
  comms_loss: "var(--chart-4)",
};

function Formula({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="ml-1 cursor-help text-xs text-muted-foreground underline decoration-dotted"
          aria-label="formula"
        >
          ƒ
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm text-xs">{text}</TooltipContent>
    </Tooltip>
  );
}

function pct(v: number | null | undefined, digits = 2): string {
  return v == null ? "—" : `${v.toFixed(digits)}%`;
}

function AnalyticsPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState<string>("");
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [excludeGrid, setExcludeGrid] = useState(false);

  const projectsFn = useServerFn(listAnalyticsProjectOptions);
  const projects = useQuery({
    queryKey: ["analytics-projects"],
    queryFn: () => projectsFn(),
  });

  const activeProject = projectId || (projects.data?.[0]?.id ?? "");

  const analyticsFn = useServerFn(getProjectAnalytics);
  const analytics = useQuery({
    queryKey: ["scada-analytics", activeProject, day, excludeGrid],
    enabled: !!activeProject,
    queryFn: () => analyticsFn({ data: { projectId: activeProject, day, excludeGrid } }),
  });

  const computeFn = useServerFn(computeDailyKpis);
  const compute = useMutation({
    mutationFn: () => computeFn({ data: { projectId: activeProject, day } }),
    onSuccess: () => {
      toast.success("Daily KPI snapshot saved");
      qc.invalidateQueries({ queryKey: ["scada-analytics"] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not compute KPIs"),
  });

  const d = analytics.data;
  const availabilityValue = excludeGrid ? d?.contractualAvailabilityPct : d?.availabilityPct;

  return (
    <div className="page-shell">
      <PageHeader
        title="Performance analytics"
        description="Downtime classification, lost energy, availability, performance ratio and guarantee margins."
        actions={
          <Button
            onClick={() => compute.mutate()}
            disabled={!activeProject || compute.isPending}
          >
            {compute.isPending ? "Computing…" : "Compute daily KPIs"}
          </Button>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div className="space-y-1">
            <Label>Project</Label>
            <Select value={activeProject} onValueChange={setProjectId}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {(projects.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="analytics-day">Day</Label>
            <Input
              id="analytics-day"
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="w-44"
            />
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Switch id="excl-grid" checked={excludeGrid} onCheckedChange={setExcludeGrid} />
            <Label htmlFor="excl-grid" className="text-sm">
              Contractual availability (exclude grid outage)
            </Label>
            <Formula text={FORMULAS.availabilityExclGrid} />
          </div>
        </CardContent>
      </Card>

      {!activeProject && !projects.isLoading ? (
        <EmptyState
          icon={BarChart3}
          title="No projects yet"
          description="Create a project and connect a SCADA stream to see performance analytics."
        />
      ) : analytics.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : analytics.isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't compute analytics"
          description={(analytics.error as Error)?.message}
          action={
            <Button variant="outline" onClick={() => analytics.refetch()}>
              Retry
            </Button>
          }
        />
      ) : d ? (
        <>
          <KpiGrid columns={4}>
            <KpiTile
              label="Availability"
              value={pct(availabilityValue)}
              icon={Gauge}
              hint={
                <>
                  {d.downtimeMinutes.toFixed(0)} downtime minutes
                  <Formula text={excludeGrid ? FORMULAS.availabilityExclGrid : FORMULAS.availability} />
                </>
              }
              status={
                availabilityValue == null ? "neutral" : availabilityValue >= 97 ? "good" : "warning"
              }
            />
            <KpiTile
              label="Performance ratio"
              value={pct(d.performanceRatioPct)}
              icon={Activity}
              hint={
                <>
                  {d.performanceRatioPct == null
                    ? "No irradiance or nameplate data"
                    : `${d.irradianceKwhM2?.toFixed(2) ?? "—"} kWh/m²`}
                  <Formula text={FORMULAS.performanceRatio} />
                </>
              }
            />
            <KpiTile
              label="Lost energy"
              value={`${d.lostEnergyKwh.toFixed(1)} kWh`}
              icon={Zap}
              hint={
                <>
                  {d.actualEnergyKwh != null
                    ? `${d.actualEnergyKwh.toFixed(1)} kWh produced`
                    : "No energy telemetry"}
                  <Formula text={FORMULAS.lostEnergy} />
                </>
              }
            />
            <KpiTile
              label="Data quality"
              value={pct(d.dataQuality.qualityPct)}
              icon={ShieldCheck}
              hint={
                <>
                  {pct(d.dataQuality.missingPct)} missing · {d.dataQuality.driftFlags.length} drift
                  flag(s)
                  <Formula text={FORMULAS.dataQuality} />
                </>
              }
              status={
                d.dataQuality.qualityPct == null
                  ? "neutral"
                  : d.dataQuality.qualityPct >= 95
                    ? "good"
                    : "warning"
              }
            />

          </KpiGrid>

          {d.dataQuality.driftFlags.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Sensor drift flags</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {d.dataQuality.driftFlags.map((f) => (
                  <Badge key={f.label} variant="destructive">
                    {f.label}: {f.maxDivergencePct}% for {f.hours} h
                  </Badge>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">
                  Downtime by class
                  <Formula text={FORMULAS.classifyDowntime} />
                </CardTitle>
              </CardHeader>
              <CardContent className="h-64">
                {d.downtimeMinutes === 0 ? (
                  <EmptyState icon={Gauge} title="No downtime recorded on this day" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={[
                        d.downtimeBreakdown.reduce<Record<string, number | string>>(
                          (acc, b) => {
                            acc[b.cls] = b.minutes;
                            return acc;
                          },
                          { day: d.day },
                        ),
                      ]}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="day" stroke="var(--muted-foreground)" fontSize={12} />
                      <YAxis
                        stroke="var(--muted-foreground)"
                        fontSize={12}
                        label={{ value: "minutes", angle: -90, position: "insideLeft" }}
                      />
                      <RTooltip />
                      <Legend />
                      {d.downtimeBreakdown.map((b) => (
                        <Bar
                          key={b.cls}
                          dataKey={b.cls}
                          name={DOWNTIME_CLASS_LABELS[b.cls]}
                          stackId="downtime"
                          fill={DOWNTIME_FILL[b.cls]}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">
                  Guarantees
                  <Formula text={FORMULAS.guarantee} />
                </CardTitle>
              </CardHeader>
              <CardContent>
                {d.guarantee.status === "no_guarantee" ? (
                  <EmptyState
                    icon={ShieldCheck}
                    title="No contractual guarantee on file"
                    description="Add PPA terms (availability, PR or annual energy) to track margins and breaches."
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Metric</TableHead>
                        <TableHead className="text-right">Guaranteed</TableHead>
                        <TableHead className="text-right">Actual</TableHead>
                        <TableHead className="text-right">Margin</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.guarantee.checks.map((c) => (
                        <TableRow key={c.metric}>
                          <TableCell>{c.label}</TableCell>
                          <TableCell className="text-right">
                            {c.guaranteed.toFixed(2)} {c.unit}
                          </TableCell>
                          <TableCell className="text-right">
                            {c.actual == null ? "—" : `${c.actual.toFixed(2)} ${c.unit}`}
                          </TableCell>
                          <TableCell className="text-right">
                            {c.margin_pct == null ? "—" : `${c.margin_pct.toFixed(2)}%`}
                          </TableCell>
                          <TableCell className="text-right">
                            {c.actual == null ? (
                              <Badge variant="outline">No data</Badge>
                            ) : c.breach ? (
                              <Badge variant="destructive">Breach</Badge>
                            ) : (
                              <Badge variant="secondary">Met</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Expected vs actual energy (30 days)</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              {!d.hasBaseline ? (
                <EmptyState
                  icon={BarChart3}
                  title="No simulation baseline"
                  description="Run a yield simulation for this project to compare actual output against expectation."
                />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={d.trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      dataKey="day"
                      stroke="var(--muted-foreground)"
                      fontSize={11}
                      tickFormatter={(v: string) => format(new Date(v), "dd MMM")}
                    />
                    <YAxis stroke="var(--muted-foreground)" fontSize={11} />
                    <RTooltip />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="expectedKwh"
                      name="Expected kWh"
                      stroke="var(--chart-2)"
                      strokeDasharray="4 4"
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="actualKwh"
                      name="Actual kWh"
                      stroke="var(--chart-1)"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Asset performance</CardTitle>
            </CardHeader>
            <CardContent>
              {d.assets.rows.length === 0 ? (
                <EmptyState
                  icon={Activity}
                  title="No asset telemetry for this day"
                  description="Energy per asset appears once a connector streams energy_kwh."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asset</TableHead>
                      <TableHead className="text-right">Actual kWh</TableHead>
                      <TableHead className="text-right">Expected kWh</TableHead>
                      <TableHead className="text-right">vs expected</TableHead>
                      <TableHead className="text-right">Rank</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.assets.rows.map((a) => {
                      const isTop = d.assets.top.some((t) => t.assetId === a.assetId);
                      const isBottom = d.assets.bottom.some((t) => t.assetId === a.assetId);
                      return (
                        <TableRow key={a.assetId}>
                          <TableCell>{a.name}</TableCell>
                          <TableCell className="text-right">{a.actualKwh.toFixed(1)}</TableCell>
                          <TableCell className="text-right">
                            {a.expectedKwh == null ? "—" : a.expectedKwh.toFixed(1)}
                          </TableCell>
                          <TableCell className="text-right">{pct(a.ratioPct)}</TableCell>
                          <TableCell className="text-right">
                            {isTop ? (
                              <Badge variant="secondary">Top 5</Badge>
                            ) : isBottom ? (
                              <Badge variant="destructive">Bottom 5</Badge>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
