// P-218 — ESG home dashboard: KPI tiles, scope charts, lender indicators.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Factory, Flame, Gauge, Leaf, Plug, Truck, Info } from "lucide-react";

import { CategoryBar, MonthlyTrend, ScopeDonut } from "@/components/esg/dashboard-charts";
import { LenderIndicatorsCard } from "@/components/esg/lender-indicators-card";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { errorMessage } from "@/lib/dpr-query";
import type { EsgDashboardData } from "@/lib/esg/dashboard.functions";
import { getEsgDashboard } from "@/lib/esg/dashboard.functions";
import { ESG_DASHBOARD_EMPTY, ESG_TOOLTIP, fmtIntensity, fmtKg } from "@/lib/esg/dashboard.rules";

export const Route = createFileRoute("/_authenticated/esg/")({
  head: () => ({
    meta: [
      { title: "ESG dashboard — GridMind EPC" },
      {
        name: "description",
        content:
          "Portfolio ESG dashboard: scope 1/2/3 emissions, avoided emissions, carbon intensity and lender-ready indicators.",
      },
      { property: "og:title", content: "ESG dashboard — GridMind EPC" },
      {
        property: "og:description",
        content:
          "Scope 1/2/3 emissions, avoided emissions and lender indicators for your portfolio.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EsgDashboardPage,
});

const ALL = "__all__";

function yearStart(): string {
  return `${new Date().getUTCFullYear()}-01-01`;
}
function yearEnd(): string {
  return `${new Date().getUTCFullYear()}-12-31`;
}

function TileLabel({ label, formula }: { label: string; formula: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" aria-label={`${label} formula`}>
            <Info className="size-3" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{formula}</TooltipContent>
      </Tooltip>
    </span>
  );
}

function EsgDashboardPage() {
  const [projectId, setProjectId] = useState<string>(ALL);
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(yearEnd());

  const dashboardFn = useServerFn(getEsgDashboard);
  const q = useQuery({
    queryKey: ["esg", "dashboard", projectId, from, to],
    queryFn: () =>
      dashboardFn({
        data: {
          project_id: projectId === ALL ? null : projectId,
          period_from: from,
          period_to: to,
        },
      }) as Promise<EsgDashboardData>,
  });

  const d = q.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="ESG dashboard"
        description="Emissions, avoided carbon and lender-ready indicators for the selected period."
      />

      <Card className="flex flex-wrap items-end gap-4 p-4">
        <div className="min-w-56 space-y-1">
          <Label htmlFor="esg-project">Project</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger id="esg-project">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All company projects</SelectItem>
              {(d?.projects ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.code ? `${p.code} — ${p.name}` : p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="esg-from">From</Label>
          <Input id="esg-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="esg-to">To</Label>
          <Input id="esg-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </Card>

      {q.isError ? (
        <Card className="p-6">
          <EmptyState title="Could not load ESG data" description={errorMessage(q.error)} />
        </Card>
      ) : q.isPending || !d ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : d.activity_count === 0 ? (
        <Card className="p-6">
          <EmptyState title="Nothing recorded yet" description={ESG_DASHBOARD_EMPTY} />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <KpiTile
              icon={Flame}
              label={<TileLabel label="Scope 1" formula={ESG_TOOLTIP.scope_1} />}
              value={fmtKg(d.totals.scope_1_kg)}
              hint="Direct fuel combustion"
            />
            <KpiTile
              icon={Plug}
              label={<TileLabel label="Scope 2" formula={ESG_TOOLTIP.scope_2} />}
              value={fmtKg(d.totals.scope_2_kg)}
              hint="Purchased electricity"
            />
            <KpiTile
              icon={Truck}
              label={<TileLabel label="Scope 3" formula={ESG_TOOLTIP.scope_3} />}
              value={fmtKg(d.totals.scope_3_kg)}
              hint="Transport, materials, waste"
            />
            <KpiTile
              icon={Leaf}
              label={<TileLabel label="Avoided emissions" formula={ESG_TOOLTIP.avoided} />}
              value={fmtKg(d.avoided_kg)}
              status={d.avoided_kg ? "good" : "neutral"}
              hint={d.telemetry_available ? "Metered renewable output" : "No metered data"}
            />
            <KpiTile
              icon={Factory}
              label={<TileLabel label="Net emissions" formula={ESG_TOOLTIP.net} />}
              value={fmtKg(d.net_kg)}
              status={d.net_negative ? "good" : "bad"}
              delta={d.net_negative ? <Badge variant="secondary">net-negative</Badge> : undefined}
            />
            <KpiTile
              icon={Gauge}
              label={<TileLabel label="Carbon intensity" formula={ESG_TOOLTIP.intensity} />}
              value={fmtIntensity(d.intensity)}
              hint="Gross emissions per MWh generated"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ScopeDonut data={d.scope_share} />
            <MonthlyTrend data={d.monthly} />
          </div>
          <CategoryBar data={d.by_category} />

          <LenderIndicatorsCard
            grossKg={d.gross_kg}
            avoidedKg={d.avoided_kg}
            renewableMwh={d.renewable_mwh}
            renewableSharePct={d.renewable_share_pct}
            renewableShareReason={d.renewable_share_reason}
            diversionPct={d.waste.diversion_pct}
            diversionReason={d.waste.diversion_reason}
            trir={d.hse.trir}
            hseAvailable={d.hse.available}
          />

          {d.unfactored_count > 0 ? (
            <p className="text-muted-foreground text-xs">
              {d.unfactored_count} activity rows have no matching emission factor and are excluded
              (not zeroed).
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
