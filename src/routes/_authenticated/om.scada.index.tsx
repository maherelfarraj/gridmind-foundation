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
import { EmptyState } from "@/components/ui/empty-state";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
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
import { useI18n } from "@/lib/i18n/locale-provider";
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
  const { t } = useI18n();
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
    <div className="page-shell">
      <PageHeader
        title={t("omMod.scadaDashboard.title")}
        description={t("omMod.scadaDashboard.description")}
        actions={
          <div className="flex items-end gap-3">
            <div className="w-64">
              <label className="mb-1 block text-xs text-muted-foreground">{t("omMod.scadaDashboard.plantLabel")}</label>
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
                  <SelectValue placeholder={t("omMod.scadaDashboard.allPlants")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("omMod.scadaDashboard.allPlants")}</SelectItem>
                  {(plantsQuery.data?.projects ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="pb-1 text-right text-xs text-muted-foreground">
              <div>{t("omMod.scadaDashboard.lastUpdated", { time: lastUpdatedLabel })}</div>
              <Button
                size="sm"
                variant="ghost"
                className="mt-1 h-7 px-2"
                onClick={() => query.refetch()}
              >
                <RefreshCw className="mr-1 h-3 w-3" /> {t("omMod.scadaDashboard.refresh")}
              </Button>
            </div>
          </div>
        }
      />

      {query.isLoading && <DashboardSkeleton />}

      {query.isError && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            <p className="text-sm">{t("omMod.scadaDashboard.loadFailed")}</p>
            <Button size="sm" variant="outline" onClick={() => query.refetch()}>
              {t("omMod.common.retry")}
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
  const { t } = useI18n();
  const noAssets = data.plants.length === 0;
  if (noAssets) {
    return (
      <EmptyState
        icon={Radio}
        title={t("omMod.scadaDashboard.noTelemetryTitle")}
        description={t("omMod.scadaDashboard.noTelemetryDescription")}
        action={
          <Button asChild size="sm">
            <Link to="/om/scada/connectors">{t("omMod.scadaDashboard.goToConnectors")}</Link>
          </Button>
        }
      />
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
  const { t } = useI18n();
  const { tiles } = data;
  return (
    <>
      <KpiGrid>
        <KpiTile
          label={t("omMod.scadaDashboard.fleetPowerNow")}
          value={`${formatNumber(tiles.fleetPowerKw)} kW`}
          icon={Zap}
        />
        <KpiTile label={t("omMod.scadaDashboard.energyToday")} value={`${formatNumber(tiles.energyTodayKwh)} kWh`} />
        <KpiTile
          label={t("omMod.scadaDashboard.availability30d")}
          value={tiles.availabilityPct != null ? `${tiles.availabilityPct}%` : "—"}
          hint={
            tiles.availabilityPct == null
              ? t("omMod.scadaDashboard.availabilityHint")
              : undefined
          }
        />
        <KpiTile
          label={t("omMod.scadaDashboard.performanceRatio")}
          value={
            tiles.performanceRatioPct != null
              ? `${tiles.performanceRatioPct}%`
              : t("omMod.scadaDashboard.insufficientData")
          }
          hint={!data.weatherAvailable ? t("omMod.scadaDashboard.addWeatherHint") : undefined}
          status={tiles.performanceRatioPct == null ? "neutral" : "good"}
        />
      </KpiGrid>
      {tiles.activeAlarms && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("omMod.scadaDashboard.activeAlarms")}</span>
          <Badge variant="destructive">{t("omMod.scadaDashboard.criticalCount", { count: tiles.activeAlarms.critical })}</Badge>
          <Badge variant="secondary">{t("omMod.scadaDashboard.majorCount", { count: tiles.activeAlarms.major })}</Badge>
        </div>
      )}
    </>
  );
}

export function PowerCurveCard({ data }: { data: DashboardPayload }) {
  const { t } = useI18n();
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
        <CardTitle>{t("omMod.scadaDashboard.powerCurveTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <EmptyState title={t("omMod.scadaDashboard.noTelemetry24h")} compact />
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  stroke="var(--muted-foreground)"
                  tick={{ fontSize: 11 }}
                  minTickGap={40}
                />
                <YAxis
                  yAxisId="power"
                  stroke="var(--muted-foreground)"
                  tick={{ fontSize: 11 }}
                  label={{
                    value: "kW",
                    angle: -90,
                    position: "insideLeft",
                    fill: "var(--muted-foreground)",
                    fontSize: 11,
                  }}
                />
                {data.weatherAvailable && (
                  <YAxis
                    yAxisId="irr"
                    orientation="right"
                    stroke="var(--muted-foreground)"
                    tick={{ fontSize: 11 }}
                    label={{
                      value: "W/m²",
                      angle: 90,
                      position: "insideRight",
                      fill: "var(--muted-foreground)",
                      fontSize: 11,
                    }}
                  />
                )}
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    color: "var(--popover-foreground)",
                    fontSize: 12,
                  }}
                  formatter={(v: number, name: string) =>
                    name === "ac_power_kw"
                      ? [`${v.toFixed(1)} kW`, t("omMod.scadaDashboard.acPower")]
                      : [`${v.toFixed(0)} W/m²`, t("omMod.scadaDashboard.irradiance")]
                  }
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area
                  yAxisId="power"
                  type="monotone"
                  dataKey="ac_power_kw"
                  name={t("omMod.scadaDashboard.acPowerKw")}
                  fill="var(--primary)"
                  stroke="var(--primary)"
                  fillOpacity={0.25}
                />
                {data.weatherAvailable && (
                  <Line
                    yAxisId="irr"
                    type="monotone"
                    dataKey="irradiance_wm2"
                    name={t("omMod.scadaDashboard.irradianceWm2")}
                    stroke="var(--accent-foreground)"
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
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("omMod.scadaDashboard.fleetStatusTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("omMod.scadaDashboard.colPlant")}</TableHead>
              <TableHead className="text-right">{t("omMod.scadaDashboard.colCapacity")}</TableHead>
              <TableHead className="text-right">{t("omMod.scadaDashboard.colCurrent")}</TableHead>
              <TableHead className="text-right">{t("omMod.scadaDashboard.colToday")}</TableHead>
              <TableHead>{t("omMod.scadaDashboard.colAvailability")}</TableHead>
              <TableHead className="text-right">{t("omMod.scadaDashboard.colAlarms")}</TableHead>
              <TableHead>{t("omMod.scadaDashboard.colLastTelemetry")}</TableHead>
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
