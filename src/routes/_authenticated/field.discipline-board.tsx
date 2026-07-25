// P-085 — Discipline board: read-only civil / mechanical / electrical rollup.
import { useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CloudRain,
  Download,
  HardHat,
  RefreshCw,
  Users,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  disciplineBoardProjectsQueryOptions,
  disciplineBoardQueryOptions,
} from "@/lib/discipline-board-query";
import {
  BOARD_DISCIPLINES,
  DISCIPLINE_LABELS,
  spiCpiTone,
  trendFor,
  type AreaRollup,
  type BoardDiscipline,
} from "@/lib/discipline-board.rules";

const searchSchema = z.object({
  projectId: z.string().uuid().optional().catch(undefined),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
});

function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export const Route = createFileRoute("/_authenticated/field/discipline-board")({
  head: () => ({
    meta: [
      { title: "Discipline board — GridMind EPC" },
      {
        name: "description",
        content:
          "Civil, mechanical and electrical construction progress by area — installed vs planned, install rates, SPI / CPI, manpower and weather at a glance.",
      },
      { property: "og:title", content: "Discipline board — GridMind EPC" },
      {
        property: "og:description",
        content:
          "Site manager's morning screen: DPR-driven progress by discipline and area, with SPI / CPI, manpower and weather KPIs.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s) => searchSchema.parse(s),
  component: DisciplineBoardPage,
  errorComponent: BoardErrorState,
  notFoundComponent: BoardNotFoundState,
});

const DISCIPLINE_ICON: Record<BoardDiscipline, LucideIcon> = {
  civil: HardHat,
  mechanical: Wrench,
  electrical: Zap,
};

function DisciplineBoardPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const range = useMemo(() => {
    const d = defaultRange();
    return { from: search.from ?? d.from, to: search.to ?? d.to };
  }, [search.from, search.to]);

  const projectsQuery = useQuery(disciplineBoardProjectsQueryOptions());
  const projectId = search.projectId ?? projectsQuery.data?.[0]?.id ?? "";

  function setSearch(next: Partial<{ projectId: string; from: string; to: string }>) {
    navigate({
      search: (prev) => ({ ...prev, ...next }),
      replace: true,
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <HardHat size={14} aria-hidden /> Field
        </div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Discipline board
        </h1>
        <p className="text-sm text-muted-foreground">
          Civil, mechanical and electrical progress per area — rolled up from your daily reports.
        </p>
      </header>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Project</label>
            {projectsQuery.isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : projectsQuery.isError ? (
              <div className="flex items-center gap-2 text-sm text-destructive">
                Failed to load projects.
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => projectsQuery.refetch()}
                >
                  <RefreshCw size={14} aria-hidden /> Retry
                </Button>
              </div>
            ) : (projectsQuery.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No projects available for your company.
              </p>
            ) : (
              <Select
                value={projectId}
                onValueChange={(v) => setSearch({ projectId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {(projectsQuery.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.code} — {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="from">
              From
            </label>
            <Input
              id="from"
              type="date"
              value={range.from}
              max={range.to}
              onChange={(e) => setSearch({ from: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="to">
              To
            </label>
            <Input
              id="to"
              type="date"
              value={range.to}
              min={range.from}
              onChange={(e) => setSearch({ to: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      {projectId ? (
        <BoardBody projectId={projectId} from={range.from} to={range.to} />
      ) : (
        <Card className="border-border bg-card">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Select a project to load the discipline board.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function BoardBody({
  projectId,
  from,
  to,
}: {
  projectId: string;
  from: string;
  to: string;
}) {
  const query = useQuery(disciplineBoardQueryOptions(projectId, from, to));

  if (query.isLoading) return <BoardSkeleton />;
  if (query.isError) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="flex flex-col items-start gap-3 py-6">
          <p className="text-sm text-destructive">
            Failed to load discipline board.
          </p>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            <RefreshCw size={14} aria-hidden /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }
  const data = query.data!;
  if (!data.hasDprs) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="py-10 text-center">
          <p className="text-sm font-medium text-foreground">No field data yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Capture your first daily report to see progress here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <KpiRow kpis={data.kpis} />
      <div className="flex items-center justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportCsv(data.columns)}
        >
          <Download size={14} aria-hidden /> Export CSV
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {data.columns.map((col) => (
          <DisciplineColumn key={col.discipline} column={col} />
        ))}
      </div>
    </>
  );
}

function KpiChip({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  tone: "success" | "warning" | "destructive" | "muted";
  icon: LucideIcon;
}) {
  const toneClass =
    tone === "success"
      ? "bg-success/10 text-success"
      : tone === "warning"
      ? "bg-warning/10 text-warning"
      : tone === "destructive"
      ? "bg-destructive/10 text-destructive"
      : "bg-muted text-muted-foreground";
  return (
    <Card className="border-border bg-card">
      <CardContent className="flex items-center gap-3 py-4">
        <span
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-md",
            toneClass,
          )}
        >
          <Icon size={16} aria-hidden />
        </span>
        <div className="flex flex-col">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <span className="font-display text-lg font-semibold text-foreground">
            {value}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function KpiRow({
  kpis,
}: {
  kpis: {
    spi: number | null;
    cpi: number | null;
    manpowerToday: number;
    weatherHoursThisWeek: number;
  };
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <KpiChip
        label="SPI (latest)"
        value={kpis.spi != null ? kpis.spi.toFixed(2) : "—"}
        tone={spiCpiTone(kpis.spi)}
        icon={HardHat}
      />
      <KpiChip
        label="CPI (latest)"
        value={kpis.cpi != null ? kpis.cpi.toFixed(2) : "—"}
        tone={spiCpiTone(kpis.cpi)}
        icon={Wrench}
      />
      <KpiChip
        label="Manpower today"
        value={String(kpis.manpowerToday)}
        tone="muted"
        icon={Users}
      />
      <KpiChip
        label="Weather hours (week)"
        value={kpis.weatherHoursThisWeek.toFixed(1)}
        tone={kpis.weatherHoursThisWeek > 0 ? "warning" : "muted"}
        icon={CloudRain}
      />
    </div>
  );
}

function DisciplineColumn({
  column,
}: {
  column: { discipline: BoardDiscipline; areas: AreaRollup[] };
}) {
  const Icon = DISCIPLINE_ICON[column.discipline];
  return (
    <Card className="border-border bg-card">
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary/40 text-foreground">
          <Icon size={16} aria-hidden />
        </span>
        <CardTitle className="text-base">
          {DISCIPLINE_LABELS[column.discipline]}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {column.areas.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
            No {DISCIPLINE_LABELS[column.discipline].toLowerCase()} quantities
            reported yet — submit a DPR.
          </p>
        ) : (
          column.areas.map((a) => <AreaCard key={a.area} area={a} />)
        )}
      </CardContent>
    </Card>
  );
}

function AreaCard({ area }: { area: AreaRollup }) {
  const trend = trendFor(area.rate7d, area.ratePrev7d);
  const TrendIcon =
    trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : ArrowRight;
  const trendClass =
    trend === "up"
      ? "text-success"
      : trend === "down"
      ? "text-destructive"
      : "text-muted-foreground";
  const uomLabel = area.uom ?? "units";
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-background/40 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-foreground">{area.area}</span>
          {area.wbsName ? (
            <span className="text-xs text-muted-foreground">{area.wbsName}</span>
          ) : null}
        </div>
        {area.plannedQty == null ? (
          <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            No baseline
          </span>
        ) : (
          <span className="text-xs font-medium text-foreground">
            {formatQty(area.installedToDate)} / {formatQty(area.plannedQty)} {uomLabel}
          </span>
        )}
      </div>
      {area.plannedQty != null && area.progressPct != null ? (
        <div className="flex flex-col gap-1">
          <Progress value={Math.min(100, area.progressPct)} />
          <span className="text-xs text-muted-foreground">
            {area.progressPct.toFixed(1)}% complete
          </span>
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">
          {formatQty(area.installedToDate)} {uomLabel} installed
        </span>
      )}
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">7-day rate</span>
        <span className={cn("flex items-center gap-1 font-medium", trendClass)}>
          <TrendIcon size={12} aria-hidden />
          {formatRate(area.rate7d)} {uomLabel}/day
        </span>
      </div>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-64 w-full" />
        ))}
      </div>
    </>
  );
}

function BoardErrorState({ error }: { error: Error }) {
  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardContent className="flex flex-col items-start gap-3 py-6">
        <p className="text-sm text-destructive">{error.message}</p>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          <RefreshCw size={14} aria-hidden /> Reload
        </Button>
      </CardContent>
    </Card>
  );
}

function BoardNotFoundState() {
  return (
    <Card className="border-border bg-card">
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        Board not found.
      </CardContent>
    </Card>
  );
}

function formatQty(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

function formatRate(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

function exportCsv(
  columns: { discipline: BoardDiscipline; areas: AreaRollup[] }[],
) {
  const header = [
    "discipline",
    "area",
    "wbs_name",
    "uom",
    "installed",
    "planned",
    "progress_pct",
    "rate_7d",
    "rate_prev_7d",
  ];
  const rows: string[][] = [header];
  for (const col of columns) {
    for (const a of col.areas) {
      rows.push([
        col.discipline,
        a.area,
        a.wbsName ?? "",
        a.uom ?? "",
        String(a.installedToDate),
        a.plannedQty != null ? String(a.plannedQty) : "",
        a.progressPct != null ? a.progressPct.toFixed(2) : "",
        a.rate7d.toFixed(3),
        a.ratePrev7d.toFixed(3),
      ]);
    }
  }
  const csv = rows
    .map((r) => r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `discipline-board-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
