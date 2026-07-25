// P-104 — Live SCADA dashboard (read-only, auto-refresh 30s).
import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, formatDistanceToNow } from "date-fns";
import { AlertTriangle, RefreshCw, Radio, Zap } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { getScadaDashboard, listOperationsPlants } from "@/lib/scada-dashboard.functions";
import { plantAvailabilityBadge, type DashboardPayload } from "@/lib/scada-dashboard.rules";
import { cn } from "@/lib/utils";

const REFRESH_MS = 30_000;

type SearchParams = { projectId?: string };

export const Route = createFileRoute("/_authenticated/om/scada/")({
  head: () => ({
    meta: [
      { title: "SCADA dashboard · GridMind EPC" },
      {
        name: "description",
        content:
          "Live fleet SCADA dashboard: plant power, energy, performance ratio, and alarms across operating projects.",
      },
      { property: "og:title", content: "SCADA dashboard · GridMind EPC" },
      {
        property: "og:description",
        content:
          "Real-time SCADA telemetry, 24h power curve, and fleet status for solar and BESS assets.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (raw): SearchParams => ({
    projectId: typeof raw.projectId === "string" && raw.projectId ? raw.projectId : undefined,
  }),
  component: ScadaDashboardPage,
});

function ScadaDashboardPage() {
  const { projectId } = Route.useSearch();
  const navigate = Route.useNavigate();

  const listFn = useServerFn(listOperationsPlants);
  const plantsQuery = useQuery({
    queryKey: ["scada-dashboard", "plants"],
    queryFn: () => listFn(),
    staleTime: 60_000,
  });

  const dashFn = useServerFn(getScadaDashboard);
  const query = useQuery({
    queryKey: ["scada-dashboard", projectId ?? "all"],
    queryFn: () => dashFn({ data: projectId ? { projectId } : {} }),
    refetchInterval: REFRESH_MS,
    staleTime: 15_000,
  });

  const lastUpdatedLabel = useMemo(
    () => (query.dataUpdatedAt ? format(query.dataUpdatedAt, "HH:mm:ss") : "—"),
    [query.dataUpdatedAt],
  );

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">SCADA dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Fleet-wide live telemetry — auto-refreshes every 30&nbsp;seconds.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <div className="w-64">
            <label className="mb-1 block text-xs text-muted-foreground">Plant</label>
            <Select
              value={projectId ?? "all"}
              onValueChange={(v) =>
                navigate({
                  search: { projectId: v === "all" ? undefined : v },
                  replace: true,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="All operating plants" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All operating plants</SelectItem>
                {(plantsQuery.data?.projects ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="pb-1 text-right text-xs text-muted-foreground">
            <div>Last updated {lastUpdatedLabel}</div>
            <Button
              size="sm"
              variant="ghost"
              className="mt-1 h-7 px-2"
              onClick={() => query.refetch()}
            >
              <RefreshCw className="mr-1 h-3 w-3" /> Refresh
            </Button>
          </div>
        </div>
      </header>

      {query.isLoading && <DashboardSkeleton />}

      {query.isError && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            <p className="text-sm">Couldn&apos;t load SCADA dashboard.</p>
            <Button size="sm" variant="outline" onClick={() => query.refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {!query.isLoading && !query.isError && query.data && <DashboardBody data={query.data} />}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function DashboardBody({ data }: { data: DashboardPayload }) {
  const noAssets = data.plants.length === 0;
  if (noAssets) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          <Radio className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No telemetry yet — configure a connector in SCADA settings.
          </p>
          <Button asChild size="sm">
            <Link to="/om/scada/connectors">Go to SCADA connectors</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }
  return (
    <>
      <KpiTiles data={data} />
      <PowerCurveCard data={data} />
      <FleetTable data={data} />
    </>
  );
}

function KpiTiles({ data }: { data: DashboardPayload }) {
  const { tiles } = data;
  return (
    <div className="grid gap-4 md:grid-cols-4">
      <Tile
        label="Fleet power now"
        value={formatNumber(tiles.fleetPowerKw)}
        unit="kW"
        icon={<Zap className="h-4 w-4 text-primary" />}
      />
      <Tile label="Energy today" value={formatNumber(tiles.energyTodayKwh)} unit="kWh" />
      <Tile
        label="Availability (30d)"
        value={tiles.availabilityPct != null ? `${tiles.availabilityPct}%` : "—"}
        hint={
          tiles.availabilityPct == null
            ? "Populates after alarm rules (P-105) & work orders (P-106)"
            : undefined
        }
      />
      <Tile
        label="Performance ratio"
        value={
          tiles.performanceRatioPct != null ? `${tiles.performanceRatioPct}%` : "insufficient data"
        }
        hint={!data.weatherAvailable ? "Add a weather station stream to compute PR" : undefined}
        muted={tiles.performanceRatioPct == null}
      />
      {tiles.activeAlarms && (
        <div className="md:col-span-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Active alarms:</span>
            <Badge variant="destructive">{tiles.activeAlarms.critical} critical</Badge>
            <Badge variant="secondary">{tiles.activeAlarms.major} major</Badge>
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  unit,
  hint,
  muted,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  muted?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            "font-display text-3xl font-bold tabular-nums",
            muted && "text-muted-foreground text-xl font-medium",
          )}
        >
          {value}
          {unit && <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>}
        </div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function PowerCurveCard({ data }: { data: DashboardPayload }) {
  const chartData = useMemo(
    () =>
      data.powerCurve.map((p) => ({
        ts: p.bucket,
        label: format(new Date(p.bucket), "HH:mm"),
        ac_power_kw: p.ac_power_kw,
        irradiance_wm2: p.irradiance_wm2,
      })),
    [data.powerCurve],
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Power curve — last 24 hours</CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No telemetry in the last 24 hours yet.
          </div>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  stroke="hsl(var(--muted-foreground))"
                  tick={{ fontSize: 11 }}
                  minTickGap={40}
                />
                <YAxis
                  yAxisId="power"
                  stroke="hsl(var(--muted-foreground))"
                  tick={{ fontSize: 11 }}
                  label={{
                    value: "kW",
                    angle: -90,
                    position: "insideLeft",
                    fill: "hsl(var(--muted-foreground))",
                    fontSize: 11,
                  }}
                />
                {data.weatherAvailable && (
                  <YAxis
                    yAxisId="irr"
                    orientation="right"
                    stroke="hsl(var(--muted-foreground))"
                    tick={{ fontSize: 11 }}
                    label={{
                      value: "W/m²",
                      angle: 90,
                      position: "insideRight",
                      fill: "hsl(var(--muted-foreground))",
                      fontSize: 11,
                    }}
                  />
                )}
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    color: "hsl(var(--popover-foreground))",
                    fontSize: 12,
                  }}
                  formatter={(v: number, name: string) =>
                    name === "ac_power_kw"
                      ? [`${v.toFixed(1)} kW`, "AC power"]
                      : [`${v.toFixed(0)} W/m²`, "Irradiance"]
                  }
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area
                  yAxisId="power"
                  type="monotone"
                  dataKey="ac_power_kw"
                  name="AC power (kW)"
                  fill="hsl(var(--primary))"
                  stroke="hsl(var(--primary))"
                  fillOpacity={0.25}
                />
                {data.weatherAvailable && (
                  <Line
                    yAxisId="irr"
                    type="monotone"
                    dataKey="irradiance_wm2"
                    name="Irradiance (W/m²)"
                    stroke="hsl(var(--accent-foreground))"
                    dot={false}
                    strokeWidth={2}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FleetTable({ data }: { data: DashboardPayload }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Fleet status</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Plant</TableHead>
              <TableHead className="text-right">Capacity (MW)</TableHead>
              <TableHead className="text-right">Current (kW)</TableHead>
              <TableHead className="text-right">Today (kWh)</TableHead>
              <TableHead>Availability</TableHead>
              <TableHead className="text-right">Alarms</TableHead>
              <TableHead>Last telemetry</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.plants.map((p) => {
              const tier = plantAvailabilityBadge(p.availabilityPct);
              return (
                <TableRow key={p.projectId} className="cursor-pointer">
                  <TableCell className="font-medium">
                    <Link
                      to="/om/scada/plants/$projectId"
                      params={{ projectId: p.projectId }}
                      className="hover:underline"
                    >
                      {p.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.capacityMw.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(p.currentPowerKw)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(p.todayEnergyKwh)}
                  </TableCell>
                  <TableCell>
                    <AvailabilityBadge tier={tier} pct={p.availabilityPct} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{p.activeAlarms}</TableCell>
                  <TableCell
                    className={cn(
                      "text-muted-foreground",
                      p.stale && p.lastSeenAt && "text-destructive font-medium",
                    )}
                  >
                    {p.lastSeenAt
                      ? formatDistanceToNow(new Date(p.lastSeenAt), { addSuffix: true })
                      : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function AvailabilityBadge({
  tier,
  pct,
}: {
  tier: ReturnType<typeof plantAvailabilityBadge>;
  pct: number | null;
}) {
  if (tier === "unknown") {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        —
      </Badge>
    );
  }
  const variant =
    tier === "excellent" ? "default" : tier === "warning" ? "secondary" : "destructive";
  return <Badge variant={variant}>{pct?.toFixed(1)}%</Badge>;
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(n);
}
