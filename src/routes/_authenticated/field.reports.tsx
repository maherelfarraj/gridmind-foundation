// P-092 — Weekly client report picker + preview + export.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarRange, ClipboardList, FileDown, Info } from "lucide-react";
import { addDays, addWeeks, format, parseISO, startOfISOWeek, subWeeks } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportWeeklyReportButton } from "@/components/field/ExportWeeklyReportButton";
import {
  weeklyReportDataQueryOptions,
  weeklyReportProjectsQueryOptions,
} from "@/components/field/ExportWeeklyReportButton";

const DEFAULT_WEEK = format(startOfISOWeek(subWeeks(new Date(), 1)), "yyyy-MM-dd");

export const Route = createFileRoute("/_authenticated/field/reports")({
  head: () => ({
    meta: [
      { title: "Weekly client report — GridMind EPC" },
      {
        name: "description",
        content:
          "Branded weekly construction report — KPIs, DPRs, HSE, QA/QC and site photos in a single PDF.",
      },
      {
        property: "og:title",
        content: "Weekly client report — GridMind EPC",
      },
      {
        property: "og:description",
        content:
          "Export a branded weekly construction report for any project, live from field data.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WeeklyReportPage,
});

function weekOptions(): Array<{ value: string; label: string }> {
  const base = startOfISOWeek(subWeeks(new Date(), 1));
  const items: Array<{ value: string; label: string }> = [];
  for (let i = 0; i < 12; i++) {
    const start = subWeeks(base, i - 0);
    const s = startOfISOWeek(start);
    const e = addDays(s, 6);
    items.push({
      value: format(s, "yyyy-MM-dd"),
      label: `${format(s, "MMM d")} – ${format(e, "MMM d, yyyy")}`,
    });
  }
  // include next 2 upcoming for testing/empty-state
  for (let i = 1; i <= 2; i++) {
    const s = startOfISOWeek(addWeeks(base, i));
    const e = addDays(s, 6);
    items.unshift({
      value: format(s, "yyyy-MM-dd"),
      label: `${format(s, "MMM d")} – ${format(e, "MMM d, yyyy")} (upcoming)`,
    });
  }
  return items;
}

function WeeklyReportPage() {
  const projectsQuery = useQuery(weeklyReportProjectsQueryOptions());
  const [projectId, setProjectId] = useState<string>("");
  const [weekStart, setWeekStart] = useState<string>(DEFAULT_WEEK);
  const weeks = useMemo(() => weekOptions(), []);

  const data = useQuery(weeklyReportDataQueryOptions(projectId || null, weekStart || null));
  const dto = data.data;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 pb-16">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <FileDown size={14} aria-hidden /> Field
        </div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Weekly client report
        </h1>
        <p className="text-sm text-muted-foreground">
          Pick a project and ISO week — preview the sections, then export a branded PDF pulled live
          from field data.
        </p>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Report</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wr-project">Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="wr-project" className="h-11">
                <SelectValue placeholder="Pick a project" />
              </SelectTrigger>
              <SelectContent>
                {(projectsQuery.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.code ? ` · ${p.code}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wr-week">ISO week</Label>
            <Select value={weekStart} onValueChange={setWeekStart}>
              <SelectTrigger id="wr-week" className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {weeks.map((w) => (
                  <SelectItem key={w.value} value={w.value}>
                    {w.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <ExportWeeklyReportButton
              projectId={projectId || null}
              weekStart={weekStart || null}
              className="w-full"
            />
          </div>
        </CardContent>
      </Card>

      {!projectId ? (
        <EmptyState
          icon={<Info className="h-8 w-8 text-muted-foreground" aria-hidden />}
          title="Pick a project"
          body="Choose a project above to preview weekly report contents."
        />
      ) : data.isLoading ? (
        <PreviewSkeleton />
      ) : data.isError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            <span className="text-sm font-medium">Failed to load report data</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.error instanceof Error ? data.error.message : "Unknown error"}
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => data.refetch()}>
            Retry
          </Button>
        </div>
      ) : !dto?.hasData ? (
        <EmptyState
          icon={<ClipboardList className="h-8 w-8 text-muted-foreground" aria-hidden />}
          title="No field data for this week"
          body="Submit DPRs first — then this report will populate automatically."
        />
      ) : (
        <PreviewSections dto={dto} />
      )}
    </div>
  );
}

function EmptyState({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/30 p-10 text-center">
      <div className="mx-auto mb-3 flex justify-center">{icon}</div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function PreviewSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function PreviewSections({
  dto,
}: { dto: NonNullable<ReturnType<typeof useQuery>["data"]> extends infer T ? T : never } & {
  dto: any;
}) {
  const d = dto;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarRange className="h-4 w-4" aria-hidden />
            {d.project.name} · {d.isoWeekLabel}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4">
          <Kpi label="SPI" value={fmtNum(d.kpis.spi)} />
          <Kpi label="CPI" value={fmtNum(d.kpis.cpi)} />
          <Kpi label="TRIR (12m)" value={fmtNum(d.kpis.trir12m)} />
          <Kpi label="Rework %" value={fmtPct(d.kpis.reworkPct)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Daily log</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-1 text-left">Date</th>
                <th className="py-1 text-left">Shift</th>
                <th className="py-1 text-right">Manpower</th>
                <th className="py-1 text-right">Hours</th>
                <th className="py-1 text-left">Weather</th>
              </tr>
            </thead>
            <tbody>
              {d.daily.map((r: any) => (
                <tr key={`${r.reportDate}-${r.shift}`} className="border-t border-border/60">
                  <td className="py-1.5">{format(parseISO(r.reportDate), "EEE, MMM d")}</td>
                  <td className="py-1.5">{r.shift}</td>
                  <td className="py-1.5 text-right">{r.totalManpower}</td>
                  <td className="py-1.5 text-right">{Number(r.totalHours).toFixed(1)}</td>
                  <td className="py-1.5 text-muted-foreground">{r.weatherSummary ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">HSE summary</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            <Row k="Recordables this week" v={String(d.hse.recordablesThisWeek)} />
            <Row k="TRIR (12m)" v={fmtNum(d.hse.trir12m)} />
            <Row k="Man-hours (12m)" v={Math.round(d.hse.hours12m).toLocaleString()} />
            {d.hse.incidentsByType.map((r: any) => (
              <Row key={r.type} k={r.type} v={String(r.count)} />
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">QA/QC summary</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            <Row k="Inspections run" v={String(d.qa.inspectionsRun)} />
            <Row k="Pass rate" v={fmtPct(d.qa.passRate)} />
            <Row k="Rework %" v={fmtPct(d.qa.reworkPct)} />
            <Row k="Open punch — A" v={String(d.qa.openPunchByCategory.A)} />
            <Row k="Open punch — B" v={String(d.qa.openPunchByCategory.B)} />
            <Row k="Open punch — C" v={String(d.qa.openPunchByCategory.C)} />
          </CardContent>
        </Card>
      </div>

      {d.photos.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Site photos <Badge variant="outline">{d.photos.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {d.photos.map((p: any) => (
                <div
                  key={p.filePath}
                  className="overflow-hidden rounded-md border border-border bg-muted/30"
                >
                  {p.signedUrl ? (
                    <img
                      src={p.signedUrl}
                      alt={p.caption ?? "Site photo"}
                      className="h-32 w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
                      Photo unavailable
                    </div>
                  )}
                  {p.caption && (
                    <div className="px-2 py-1 text-xs text-muted-foreground">{p.caption}</div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-display text-2xl font-semibold text-foreground">{value}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 py-1 last:border-b-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium tabular-nums">{v}</span>
    </div>
  );
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}
