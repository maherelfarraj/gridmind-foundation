// P-100 — Commissioning KPI dashboard (read-only).
import { useMemo } from "react";
import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowLeft, Download, RefreshCw, Radio } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getCommissioningKpis } from "@/lib/commissioning-kpis.functions";
import { serializeKpisCsv, type CommissioningKpisPayload } from "@/lib/commissioning-kpis.rules";

const KPI_STALE_MS = 5 * 60_000;

const kpisQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: ["commissioning-kpis", projectId] as const,
    queryFn: () => getCommissioningKpis({ data: { projectId } }),
    staleTime: KPI_STALE_MS,
  });

export const Route = createFileRoute("/_authenticated/projects/$projectId/commissioning/kpis")({
  head: () => ({
    meta: [
      { title: "Commissioning KPIs — GridMind EPC" },
      {
        name: "description",
        content:
          "MC to COD days, PR at COD, punch closure and first-30-days availability at a glance.",
      },
      { property: "og:title", content: "Commissioning KPIs — GridMind EPC" },
      {
        property: "og:description",
        content: "Read-only commissioning KPI dashboard for project handover readiness.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: async ({ context, params }) => {
    try {
      await context.queryClient.ensureQueryData(kpisQueryOptions(params.projectId));
    } catch (e) {
      const status = (e as { statusCode?: number } | null)?.statusCode;
      if (status === 404) throw notFound();
      throw e;
    }
  },
  errorComponent: ({ error, reset }) => <KpiError message={error.message} reset={reset} />,
  notFoundComponent: () => (
    <Card className="border-border bg-card p-8 text-center">
      <p className="text-sm text-muted-foreground">Project not found in your workspace.</p>
    </Card>
  ),
  component: KpisPage,
});

function KpisPage() {
  const { projectId } = Route.useParams();
  const { data } = useSuspenseQuery(kpisQueryOptions(projectId));

  const onExportCsv = () => {
    const csv = serializeKpisCsv(data);
    const filename = `commissioning-kpis-${data.project.code ?? data.project.id}.csv`;
    // Forward-compat: when P-12x lands project_export_locks, call a
    // server-fn guard here before allowing download.
    downloadBlob(csv, filename, "text/csv");
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Link
              to="/projects/$projectId/commissioning"
              params={{ projectId }}
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <ArrowLeft size={12} aria-hidden />
              Commissioning
            </Link>
            <span aria-hidden>/</span>
            <span>KPIs</span>
          </div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Commissioning KPIs
          </h1>
          <p className="text-sm text-muted-foreground">
            {data.project.name}
            {data.project.code ? ` · ${data.project.code}` : ""} — read-only snapshot.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onExportCsv}>
          <Download size={14} aria-hidden />
          CSV snapshot
        </Button>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <McCodTile data={data} />
        <PrAtCodTile data={data} />
        <PunchClosureTile data={data} />
        <AvailabilityTile data={data} />
      </div>

      <SecondaryStrip data={data} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

function TileShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-3 border-border bg-card p-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
        {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      {children}
    </Card>
  );
}

function McCodTile({ data }: { data: CommissioningKpisPayload }) {
  const k = data.mcCod;
  if (k.state === "empty") {
    return (
      <TileShell title="MC → COD" subtitle="days between certificates">
        <EmptyValue label="Awaiting Mechanical Completion" />
      </TileShell>
    );
  }
  if (k.state === "mc_only") {
    return (
      <TileShell title="MC → COD" subtitle={`MC signed ${k.mc_date}`}>
        <div className="flex items-baseline gap-2">
          <span className="font-display text-3xl font-semibold text-foreground">
            {k.elapsed_since_mc}
          </span>
          <span className="text-xs text-muted-foreground">days elapsed</span>
        </div>
        {k.projected_cod ? (
          <Badge variant="outline" className="w-fit border-primary/30 bg-primary/10 text-primary">
            Projected COD {k.projected_cod}
          </Badge>
        ) : null}
      </TileShell>
    );
  }
  return (
    <TileShell title="MC → COD" subtitle={`MC ${k.mc_date} → COD ${k.cod_date}`}>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-3xl font-semibold text-foreground">{k.days}</span>
        <span className="text-xs text-muted-foreground">days</span>
      </div>
      {k.projected_cod && k.cod_date ? (
        <p className="text-xs text-muted-foreground">Target was {k.projected_cod}.</p>
      ) : null}
    </TileShell>
  );
}

function PrAtCodTile({ data }: { data: CommissioningKpisPayload }) {
  const k = data.prAtCod;
  if (k.source === null || k.measured == null) {
    return (
      <TileShell title="PR at COD" subtitle="measured vs contract">
        <EmptyValue label="No PR data yet" />
        {k.contract != null ? (
          <p className="text-xs text-muted-foreground">Contract PR: {k.contract}%</p>
        ) : null}
      </TileShell>
    );
  }
  return (
    <TileShell
      title="PR at COD"
      subtitle={k.source === "certificate" ? "from COD certificate" : "from performance test"}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-display text-3xl font-semibold text-foreground">
          {k.measured.toFixed(2)}%
        </span>
        <Badge
          variant="outline"
          className={cn(
            "border",
            k.passing
              ? "border-success/30 bg-success/10 text-success"
              : "border-destructive/30 bg-destructive/15 text-destructive",
          )}
        >
          {k.passing ? "Pass" : "Fail"}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Contract {k.contract != null ? `${k.contract}%` : "—"}
        {k.delta != null ? ` · Δ ${k.delta > 0 ? "+" : ""}${k.delta}` : ""}
      </p>
    </TileShell>
  );
}

function PunchClosureTile({ data }: { data: CommissioningKpisPayload }) {
  const totalAll = data.punchClosure.reduce((s, p) => s + p.total, 0);
  const chartData = data.punchClosure.map((p) => ({
    category: `Cat ${p.category}`,
    closed: p.closed,
    open: p.total - p.closed,
    open_refs: p.open_refs,
    total: p.total,
  }));
  if (totalAll === 0) {
    return (
      <TileShell title="Punch closure" subtitle="closed / total by category">
        <EmptyValue label="No punch items raised" />
      </TileShell>
    );
  }
  const catA = data.punchClosure.find((p) => p.category === "A");
  const catAOpen = catA ? catA.total - catA.closed : 0;
  return (
    <TileShell
      title="Punch closure"
      subtitle={catAOpen > 0 ? `${catAOpen} Cat A open — blocks COD` : "Cat A clear"}
    >
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="category" tick={{ fontSize: 11 }} stroke="currentColor" />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="currentColor" />
            <Tooltip content={<PunchTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar
              dataKey="closed"
              stackId="s"
              name="Closed"
              fill="hsl(var(--muted-foreground) / 0.6)"
              radius={[0, 0, 0, 0]}
            />
            <Bar dataKey="open" stackId="s" name="Open" fill="hsl(var(--destructive))" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </TileShell>
  );
}

function PunchTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as {
    category: string;
    closed: number;
    open: number;
    total: number;
    open_refs: string[];
  };
  const pct = row.total > 0 ? Math.round((row.closed / row.total) * 100) : 0;
  return (
    <div className="rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-sm">
      <p className="font-medium">{label}</p>
      <p>
        {row.closed}/{row.total} closed ({pct}%)
      </p>
      {row.open_refs.length > 0 ? (
        <p className="mt-1 max-w-[220px] text-muted-foreground">
          Open: {row.open_refs.slice(0, 6).join(", ")}
          {row.open_refs.length > 6 ? ` +${row.open_refs.length - 6}` : ""}
        </p>
      ) : null}
    </div>
  );
}

function AvailabilityTile({ data }: { data: CommissioningKpisPayload }) {
  return (
    <TileShell title="First 30-day availability" subtitle="from COD effective date">
      <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-border bg-muted/30 p-3">
        <div className="flex items-center gap-2 text-sm text-foreground">
          <Radio size={16} aria-hidden className="text-muted-foreground" />
          Populates after SCADA connection
        </div>
        <p className="text-xs text-muted-foreground">
          {data.availability.cod_date
            ? `Window starts ${data.availability.cod_date} — the Operations stage will fill this once telemetry is bound.`
            : "Sign the COD certificate and connect SCADA to compute uptime."}
        </p>
      </div>
    </TileShell>
  );
}

// ---------------------------------------------------------------------------
// Secondary strip
// ---------------------------------------------------------------------------
function SecondaryStrip({ data }: { data: CommissioningKpisPayload }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2 border-border bg-card p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Commissioning tests</p>
        {data.testSummary.length === 0 ? (
          <div className="mt-3 text-sm text-muted-foreground">No tests assigned yet.</div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {data.testSummary.map((t) => (
              <div
                key={t.test_type}
                className="min-w-[160px] rounded-md border border-border bg-background/60 p-3"
              >
                <p className="text-xs font-medium text-foreground">{formatTestType(t.test_type)}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <span className="text-success">✓ {t.passed}</span>
                  <span className="text-destructive">✕ {t.failed}</span>
                  <span className="text-warning">↻ {t.in_progress}</span>
                  <span className="text-muted-foreground">· {t.not_started}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card className="border-border bg-card p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Turnover pack</p>
        {data.turnoverStatus ? (
          <div className="mt-3 space-y-1">
            <Badge variant="outline" className="border-border">
              {data.turnoverStatus.status}
            </Badge>
            <p className="text-xs text-muted-foreground">
              Compiled {data.turnoverStatus.compiled_at ?? "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              Delivered {data.turnoverStatus.delivered_at ?? "—"}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No turnover package yet.</p>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------
function EmptyValue({ label }: { label: string }) {
  return <p className="text-sm text-muted-foreground">{label}</p>;
}

function KpiError({ message, reset }: { message: string; reset: () => void }) {
  const router = useRouter();
  return (
    <Card className="border-destructive/40 bg-destructive/5 p-6">
      <p className="text-sm font-medium text-destructive">Failed to load KPIs</p>
      <p className="mt-1 text-xs text-muted-foreground">{message}</p>
      <Button
        size="sm"
        variant="outline"
        className="mt-3"
        onClick={() => {
          reset();
          router.invalidate();
        }}
      >
        <RefreshCw size={14} aria-hidden />
        Retry
      </Button>
    </Card>
  );
}

// Loading skeleton shown via router's default pending path is fine; but keep
// a static-safe representation available if a consumer imports it.
export function KpisSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="flex flex-col gap-3 border-border bg-card p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-3 w-40" />
        </Card>
      ))}
    </div>
  );
}

function formatTestType(t: string): string {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
