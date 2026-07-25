// P-069 — Vendor scorecards workbench.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarIcon, Download, Loader2, RefreshCw, Users } from "lucide-react";
import { format, subDays } from "date-fns";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { EmptyState } from "@/components/ui/empty-state";
import { ScorecardStatusBadge } from "@/components/procurement/scorecard-status-badge";
import { TrendChip } from "@/components/procurement/trend-chip";
import { VendorScorecardDrawer } from "@/components/procurement/vendor-scorecard-drawer";
import {
  getScorecardAccess,
  listScorecards,
  recomputeScorecards,
  type ScorecardRow,
} from "@/lib/scorecard.functions";
import {
  scorecardAccessQueryOptions,
  scorecardErrorMessage,
  scorecardListQueryOptions,
} from "@/lib/scorecard-query";
import { cn } from "@/lib/utils";
import { downloadCsv, toCsv } from "@/lib/csv";

export const Route = createFileRoute("/_authenticated/procurement/scorecards")({
  component: ScorecardsPage,
  head: () => ({
    meta: [
      { title: "Vendor scorecards · GridMind EPC" },
      {
        name: "description",
        content:
          "Auto-computed OTD, quality, and responsiveness scores for every vendor across POs, receipts, and expediting activity.",
      },
      { property: "og:title", content: "Vendor scorecards · GridMind EPC" },
      {
        property: "og:description",
        content: "Vendor performance analytics powered by live procurement data.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const PRESETS: Array<{ label: string; days: number }> = [
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Last 180 days", days: 180 },
  { label: "Last 365 days", days: 365 },
];

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function ScorecardsPage() {
  const today = useMemo(() => new Date(), []);
  const [periodStart, setPeriodStart] = useState(isoDay(subDays(today, 90)));
  const [periodEnd, setPeriodEnd] = useState(isoDay(today));
  const [selected, setSelected] = useState<ScorecardRow | null>(null);

  const accessFn = useServerFn(getScorecardAccess);
  const listFn = useServerFn(listScorecards);
  const recomputeFn = useServerFn(recomputeScorecards);

  const access = useQuery(scorecardAccessQueryOptions(accessFn));
  const list = useQuery(scorecardListQueryOptions(listFn, { periodStart, periodEnd }));
  const qc = useQueryClient();

  const recompute = useMutation({
    mutationFn: () => recomputeFn({ data: { periodStart, periodEnd, projectId: null } }),
    onSuccess: (res) => {
      toast.success(`Recomputed ${res.upsertedCount} vendor${res.upsertedCount === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["scorecards"] });
    },
    onError: (err) => toast.error(scorecardErrorMessage(err)),
  });

  const priorMap = useMemo(() => {
    const m = new Map<string, ScorecardRow>();
    for (const r of list.data?.prior ?? []) {
      m.set(`${r.vendor_id}::${r.project_id ?? ""}`, r);
    }
    return m;
  }, [list.data]);

  const rows = useMemo(
    () =>
      [...(list.data?.current ?? [])].sort(
        (a, b) => (a.on_time_delivery_pct ?? -1) - (b.on_time_delivery_pct ?? -1),
      ),
    [list.data],
  );

  const kpis = useMemo(() => {
    const cur = list.data?.current ?? [];
    const otds = cur.map((r) => r.on_time_delivery_pct).filter((n): n is number => n != null);
    const quals = cur.map((r) => r.quality_score).filter((n): n is number => n != null);
    const avg = (xs: number[]) =>
      xs.length ? Math.round((xs.reduce((s, n) => s + n, 0) / xs.length) * 10) / 10 : null;
    return {
      avgOtd: avg(otds),
      avgQuality: avg(quals),
      belowThreshold: cur.filter(
        (r) => r.on_time_delivery_pct != null && r.on_time_delivery_pct < 80,
      ).length,
      totalVendors: cur.length,
    };
  }, [list.data]);

  const canRecompute = !!access.data?.canRecompute;

  function handlePreset(days: number) {
    setPeriodEnd(isoDay(today));
    setPeriodStart(isoDay(subDays(today, days)));
  }

  function handleExport() {
    if (!rows.length) return;
    const csv = toCsv(
      [
        "vendor",
        "otd_pct",
        "quality",
        "responsiveness",
        "pos",
        "receipts",
        "defects",
        "period_start",
        "period_end",
      ],
      rows.map((r) => [
        r.vendor_name ?? "",
        r.on_time_delivery_pct ?? "",
        r.quality_score ?? "",
        r.responsiveness_score ?? "",
        r.total_pos,
        r.total_receipts,
        r.defects_count,
        r.period_start,
        r.period_end,
      ]),
    );
    downloadCsv(`vendor-scorecards-${periodStart}-to-${periodEnd}.csv`, csv);
  }

  return (
    <div className="page-shell">
      <PageHeader
        title="Vendor scorecards"
        description="OTD, quality, and responsiveness computed from POs, receipts, and expediting."
        actions={
          <>
            <Select
              onValueChange={(v) => {
                const preset = PRESETS.find((p) => String(p.days) === v);
                if (preset) handlePreset(preset.days);
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Presets" />
              </SelectTrigger>
              <SelectContent>
                {PRESETS.map((p) => (
                  <SelectItem key={p.days} value={String(p.days)}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DateField label="Start" value={periodStart} onChange={setPeriodStart} />
            <DateField label="End" value={periodEnd} onChange={setPeriodEnd} />
            <Button variant="outline" onClick={handleExport} disabled={!rows.length}>
              <Download className="mr-2 h-4 w-4" /> CSV
            </Button>
            {canRecompute && (
              <Button onClick={() => recompute.mutate()} disabled={recompute.isPending}>
                {recompute.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Recompute
              </Button>
            )}
          </>
        }
      />

      <KpiGrid columns={3}>
        <KpiTile
          label="Avg on-time delivery"
          value={kpis.avgOtd == null ? "—" : `${kpis.avgOtd}%`}
        />
        <KpiTile
          label="Avg quality score"
          value={kpis.avgQuality == null ? "—" : `${kpis.avgQuality}`}
        />
        <KpiTile
          label="Vendors below 80% OTD"
          value={`${kpis.belowThreshold} / ${kpis.totalVendors}`}
          status={kpis.belowThreshold > 0 ? "bad" : "neutral"}
        />
      </KpiGrid>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Vendors</CardTitle>
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : list.isError ? (
            <div className="space-y-3">
              <p className="text-sm text-destructive">{scorecardErrorMessage(list.error)}</p>
              <Button variant="outline" size="sm" onClick={() => list.refetch()}>
                Retry
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No scorecard data"
              description={
                canRecompute
                  ? "Receipts will populate scores automatically, or click Recompute to build the current period."
                  : "Receipts will populate scores automatically."
              }
              compact
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">OTD %</TableHead>
                  <TableHead className="text-right">Quality</TableHead>
                  <TableHead className="text-right">Responsiveness</TableHead>
                  <TableHead className="text-right">POs</TableHead>
                  <TableHead className="text-right">Defects</TableHead>
                  <TableHead>Trend (OTD)</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const prior = priorMap.get(`${r.vendor_id}::${r.project_id ?? ""}`);
                  return (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                      <TableCell className="font-medium">{r.vendor_name ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        {r.on_time_delivery_pct == null ? "—" : `${r.on_time_delivery_pct}%`}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.quality_score == null ? "—" : r.quality_score}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.responsiveness_score == null ? (
                          <span className="text-xs text-muted-foreground">Insufficient data</span>
                        ) : (
                          r.responsiveness_score
                        )}
                      </TableCell>
                      <TableCell className="text-right">{r.total_pos}</TableCell>
                      <TableCell className="text-right">{r.defects_count}</TableCell>
                      <TableCell>
                        <TrendChip
                          current={r.on_time_delivery_pct}
                          prior={prior?.on_time_delivery_pct}
                        />
                      </TableCell>
                      <TableCell>
                        <ScorecardStatusBadge otd={r.on_time_delivery_pct} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <VendorScorecardDrawer
        row={selected}
        periodStart={periodStart}
        periodEnd={periodEnd}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const date = value ? new Date(value + "T00:00:00Z") : undefined;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="justify-start text-left font-normal">
          <CalendarIcon className="mr-2 h-4 w-4" />
          <span className="mr-2 text-xs text-muted-foreground">{label}</span>
          {date ? format(date, "PP") : "Pick date"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={(d) => d && onChange(isoDay(d))}
          initialFocus
          className={cn("pointer-events-auto p-3")}
        />
      </PopoverContent>
    </Popover>
  );
}
