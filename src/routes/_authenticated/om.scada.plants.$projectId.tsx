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
import { useI18n } from "@/lib/i18n/locale-provider";

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
  const { t } = useI18n();
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
            <ArrowLeft className="mr-1 h-3 w-3" /> {t("omMod.plantDetail.fleetLink")}
          </Link>
        </Button>
        <PageHeader
          title={query.data?.plant?.name ?? t("omMod.plantDetail.titleFallback")}
          description={t("omMod.plantDetail.description")}
          actions={
            <div className="text-right text-xs text-muted-foreground">
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
  const { t } = useI18n();
  const p = data.plant;
  return (
    <>
      <KpiGrid>
        <KpiTile
          label={t("omMod.plantDetail.capacity")}
          value={`${p?.capacityMw.toFixed(2) ?? "—"} MW`}
        />
        <KpiTile
          label={t("omMod.plantDetail.currentPower")}
          value={`${p?.currentPowerKw.toFixed(1) ?? "—"} kW`}
        />
        <KpiTile
          label={t("omMod.plantDetail.energyToday")}
          value={`${p?.todayEnergyKwh.toFixed(1) ?? "—"} kWh`}
        />
        <KpiTile
          label={t("omMod.plantDetail.availability")}
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
          <CardTitle>{t("omMod.plantDetail.perInverterTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.perInverter.length === 0 ? (
            <EmptyState title={t("omMod.plantDetail.noInverters")} compact />
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.perInverter}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="name" stroke="var(--muted-foreground)" tick={{ fontSize: 11 }} />
                  <YAxis
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
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      color: "var(--popover-foreground)",
                      fontSize: 12,
                    }}
                    formatter={(v: number) => [`${v.toFixed(1)} kW`, "AC power"]}
                  />
                  <Bar dataKey="currentKw" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
