// P-134 — Audit-driven ops health dashboard. Super-admin only (server-verified
// inside getOpsHealth). Read-only; no mutations, no audit writes.
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, RefreshCcw, ShieldAlert } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDistanceToNowStrict } from "date-fns";

import { getOpsHealth, type OpsHealth, type SignalStatus } from "@/lib/ops-health.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";

export const Route = createFileRoute("/_authenticated/admin/health")({
  head: () => ({
    meta: [
      { title: "Ops Health | GridMind EPC Admin" },
      {
        name: "description",
        content:
          "Audit-driven signals — rate-limit fail-open, signature failures, guard 401/429, cron freshness.",
      },
      { property: "og:title", content: "Ops Health | GridMind EPC Admin" },
      {
        property: "og:description",
        content:
          "Audit-driven signals — rate-limit fail-open, signature failures, guard 401/429, cron freshness.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HealthPage,
});

function statusBadge(status: SignalStatus) {
  if (status === "crit") {
    return (
      <Badge variant="destructive" className="uppercase tracking-wide">
        Critical
      </Badge>
    );
  }
  if (status === "warn") {
    return (
      <Badge className="bg-warning/15 text-warning border border-warning/30 uppercase tracking-wide hover:bg-warning/15">
        Warn
      </Badge>
    );
  }
  return (
    <Badge className="bg-primary/10 text-primary border border-primary/20 uppercase tracking-wide hover:bg-primary/10">
      OK
    </Badge>
  );
}

function statusIcon(status: SignalStatus) {
  if (status === "crit") return <ShieldAlert className="h-4 w-4 text-destructive" />;
  if (status === "warn") return <AlertTriangle className="h-4 w-4 text-warning" />;
  return <CheckCircle2 className="h-4 w-4 text-primary" />;
}

function HealthPage() {
  const fetchHealth = useServerFn(getOpsHealth);
  const query = useQuery({
    queryKey: ["ops-health"],
    queryFn: () => fetchHealth({ data: {} }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return (
    <div className="page-shell max-w-6xl">
      <PageHeader
        title="Ops Health"
        description="Audit-driven signals from the public API guard, webhook framework, and cron schedulers."
        actions={
          <div className="flex items-center gap-3">
            {query.data ? statusBadge(query.data.overall) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCcw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        }
      />

      {query.isPending ? <HealthSkeleton /> : null}

      {query.isError ? (
        <Card className="border-destructive/40 bg-card">
          <CardHeader>
            <CardTitle className="text-destructive">Couldn't load ops health</CardTitle>
            <CardDescription className="text-muted-foreground">
              {(query.error as Error | undefined)?.message ??
                "The server returned an error while reading audit signals."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => query.refetch()} variant="default">
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {query.data ? <HealthContent data={query.data} /> : null}
    </div>
  );
}

function HealthContent({ data }: { data: OpsHealth }) {
  const emptyAll =
    data.signals.every((s) => s.value24h === 0) && data.crons.every((c) => !c.lastRunAt);

  if (emptyAll) {
    return (
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground">All quiet</CardTitle>
          <CardDescription className="text-muted-foreground">
            No guard events in 24h and no cron runs recorded. The public API surface is either idle
            or has never been exercised on this environment.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <>
      <section
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        aria-label="Guard signals"
      >
        {data.signals.map((s) => (
          <Card key={s.key} className="bg-card border-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {statusIcon(s.status)}
                  {s.label}
                </CardTitle>
                {statusBadge(s.status)}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-baseline gap-3">
                <span className="text-2xl font-semibold tabular-nums text-foreground">
                  {s.value24h}
                </span>
                <span className="text-xs text-muted-foreground">last 24h</span>
                {s.peakPerHour > 0 ? (
                  <span className="text-xs text-muted-foreground">· peak {s.peakPerHour}/h</span>
                ) : null}
              </div>
              {s.status !== "ok" ? (
                <p className="text-xs leading-relaxed text-muted-foreground">{s.runbookHint}</p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base font-medium text-foreground">
            7-day guard activity
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Signature failures (all reasons) and rate-limit 429s per day.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.series} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="sigFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="rateFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  stroke="hsl(var(--border))"
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  stroke="hsl(var(--border))"
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "hsl(var(--foreground))" }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area
                  type="monotone"
                  dataKey="signature_failed"
                  name="Signature failed"
                  stroke="hsl(var(--destructive))"
                  fill="url(#sigFill)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="guard_429"
                  name="Rate limited (429)"
                  stroke="hsl(var(--primary))"
                  fill="url(#rateFill)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base font-medium text-foreground">Cron runs</CardTitle>
          <CardDescription className="text-muted-foreground">
            Latest audit timestamp per scheduled job (last 7 days).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.crons.map((c) => (
            <div
              key={c.key}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/50 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {statusIcon(c.status)}
                  <span className="truncate">{c.label}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {c.lastRunAt
                    ? `Ran ${formatDistanceToNowStrict(new Date(c.lastRunAt), { addSuffix: true })}`
                    : "No run recorded in 7 days"}
                </div>
              </div>
              {statusBadge(c.status)}
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}

function HealthSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i} className="bg-card border-border">
            <CardHeader>
              <Skeleton className="h-4 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="bg-card border-border">
        <CardHeader>
          <Skeleton className="h-4 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
