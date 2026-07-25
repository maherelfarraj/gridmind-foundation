// P-104 — Plant drill-down (per-inverter breakdown + shared tiles/chart).
import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { format } from "date-fns";
import { ArrowLeft, RefreshCw } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getPlantDetail } from "@/lib/scada-dashboard.functions";
import type { PlantDetailPayload } from "@/lib/scada-dashboard.rules";
import { AvailabilityBadge, PowerCurveCard } from "@/routes/_authenticated/om.scada.index";
import { plantAvailabilityBadge } from "@/lib/scada-dashboard.rules";

const REFRESH_MS = 30_000;

export const Route = createFileRoute("/_authenticated/om/scada/plants/$projectId")({
  head: ({ params }) => ({
    meta: [
      { title: `Plant SCADA · ${params.projectId.slice(0, 8)} · GridMind EPC` },
      {
        name: "description",
        content:
          "Per-plant SCADA drill-down: live power, energy, performance ratio, and per-inverter output.",
      },
      { property: "og:title", content: "Plant SCADA · GridMind EPC" },
      {
        property: "og:description",
        content: "Per-plant SCADA telemetry, 24h curve, and per-inverter breakdown.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PlantDetailPage,
});

function PlantDetailPage() {
  const { projectId } = Route.useParams();
  const detailFn = useServerFn(getPlantDetail);
  const query = useQuery({
    queryKey: ["scada-dashboard", "plant", projectId],
    queryFn: () => detailFn({ data: { projectId } }),
    refetchInterval: REFRESH_MS,
    staleTime: 15_000,
  });

  const lastUpdatedLabel = useMemo(
    () => (query.dataUpdatedAt ? format(query.dataUpdatedAt, "HH:mm:ss") : "—"),
    [query.dataUpdatedAt],
  );

  return (
    <div className="page-shell">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 h-7 px-2">
          <Link to="/om/scada">
            <ArrowLeft className="mr-1 h-3 w-3" /> Fleet
          </Link>
        </Button>
        <PageHeader
          title={query.data?.plant?.name ?? "Plant SCADA"}
          description="Per-plant live telemetry — auto-refreshes every 30 seconds."
          actions={
            <div className="text-right text-xs text-muted-foreground">
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
          }
        />
      </div>

      {query.isLoading && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {query.data && <PlantBody data={query.data} />}
    </div>
  );
}

function PlantBody({ data }: { data: PlantDetailPayload }) {
  const p = data.plant;
  return (
    <>
      <KpiGrid>
        <KpiTile label="Capacity" value={`${p?.capacityMw.toFixed(2) ?? "—"} MW`} />
        <KpiTile label="Current power" value={`${p?.currentPowerKw.toFixed(1) ?? "—"} kW`} />
        <KpiTile label="Energy today" value={`${p?.todayEnergyKwh.toFixed(1) ?? "—"} kWh`} />
        <KpiTile
          label="Availability"
          value={
            <AvailabilityBadge
              tier={plantAvailabilityBadge(p?.availabilityPct ?? null)}
              pct={p?.availabilityPct ?? null}
            />
          }
        />
      </KpiGrid>

      <PowerCurveCard data={data} />

      <Card>
        <CardHeader>
          <CardTitle>Per-inverter output</CardTitle>
        </CardHeader>
        <CardContent>
          {data.perInverter.length === 0 ? (
            <EmptyState title="No inverters mapped for this plant yet." compact />
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.perInverter}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    stroke="hsl(var(--muted-foreground))"
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis
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
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      color: "hsl(var(--popover-foreground))",
                      fontSize: 12,
                    }}
                    formatter={(v: number) => [`${v.toFixed(1)} kW`, "AC power"]}
                  />
                  <Bar dataKey="currentKw" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}


