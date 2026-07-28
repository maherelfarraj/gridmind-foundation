// Performance & Capacity cockpit. Super-admin only (server-verified inside
// getPerformanceSignals). Read-only Postgres introspection.
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, RefreshCcw, ShieldAlert } from "lucide-react";

import {
  getPerformanceSignals,
  type CapacityStatus,
  type PerformanceSignals,
} from "@/lib/performance.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n/locale-provider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/admin/performance")({
  head: () => ({
    meta: [
      { title: "Performance & Capacity | GridMind EPC Admin" },
      {
        name: "description",
        content: "Slow queries, connection/WAL capacity, and table growth across the platform.",
      },
      { property: "og:title", content: "Performance & Capacity | GridMind EPC Admin" },
      {
        property: "og:description",
        content: "Slow queries, connection/WAL capacity, and table growth across the platform.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PerformancePage,
});

function statusBadge(status: CapacityStatus, t: (key: string) => string) {
  if (status === "crit") {
    return (
      <Badge variant="destructive" className="uppercase tracking-wide">
        {t("adminMod.performancePage.critical")}
      </Badge>
    );
  }
  if (status === "warn") {
    return (
      <Badge className="bg-warning/15 text-warning border border-warning/30 uppercase tracking-wide hover:bg-warning/15">
        {t("adminMod.performancePage.warn")}
      </Badge>
    );
  }
  return (
    <Badge className="bg-primary/10 text-primary border border-primary/20 uppercase tracking-wide hover:bg-primary/10">
      {t("adminMod.performancePage.ok")}
    </Badge>
  );
}

function statusIcon(status: CapacityStatus) {
  if (status === "crit") return <ShieldAlert className="h-4 w-4 text-destructive" />;
  if (status === "warn") return <AlertTriangle className="h-4 w-4 text-warning" />;
  return <CheckCircle2 className="h-4 w-4 text-primary" />;
}

function toKpiStatus(status: CapacityStatus): "neutral" | "good" | "warning" | "bad" {
  if (status === "crit") return "bad";
  if (status === "warn") return "warning";
  return "good";
}

function PerformancePage() {
  const { t } = useI18n();
  const fetchPerf = useServerFn(getPerformanceSignals);
  const query = useQuery({
    queryKey: ["admin-performance"],
    queryFn: () => fetchPerf({ data: {} }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return (
    <div className="page-shell max-w-6xl">
      <PageHeader
        title={t("adminMod.admin.performance")}
        description="Slow queries, connection/WAL capacity, and table growth — read-only Postgres introspection."
        actions={
          <div className="flex items-center gap-3">
            {query.data ? statusBadge(query.data.overall, t) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCcw className="mr-2 h-4 w-4" />
              {t("adminMod.performancePage.refresh")}
            </Button>
          </div>
        }
      />

      {query.isPending ? <PerfSkeleton /> : null}

      {query.isError ? (
        <Card className="border-destructive/40 bg-card">
          <CardHeader>
            <CardTitle className="text-destructive">
              {t("adminMod.performancePage.errorTitle")}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {(query.error as Error | undefined)?.message ??
                t("adminMod.performancePage.errorFallback")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => query.refetch()} variant="default">
              {t("adminMod.performancePage.retry")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {query.data ? <PerfContent data={query.data} t={t} /> : null}
    </div>
  );
}

function PerfContent({
  data,
  t,
}: {
  data: PerformanceSignals;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  return (
    <>
      <KpiGrid columns={4}>
        {data.capacity.map((c) => (
          <KpiTile
            key={c.key}
            label={c.label}
            value={c.value == null ? t("adminMod.performancePage.naValue") : `${c.value}${c.unit}`}
            hint={
              c.value == null
                ? t("adminMod.performancePage.notExposed")
                : t("adminMod.performancePage.thresholdHint", {
                    warn: c.warnAt,
                    crit: c.critAt,
                    unit: c.unit,
                  })
            }
            status={toKpiStatus(c.status)}
          />
        ))}
      </KpiGrid>

      <section
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Database health"
      >
        <KpiTile
          label={t("adminMod.performancePage.dbSize")}
          value={`${data.dbHealth.dbSizeMb.toLocaleString()} MB`}
        />
        <KpiTile
          label={t("adminMod.performancePage.walSize")}
          value={`${data.dbHealth.walSizeMb.toLocaleString()} MB`}
        />
        <KpiTile
          label={t("adminMod.performancePage.connections")}
          value={`${data.dbHealth.connectionsUsed} / ${data.dbHealth.connectionsMax}`}
        />
        <KpiTile
          label={t("adminMod.performancePage.rollbackRate")}
          value={`${data.dbHealth.rollbackRate}%`}
        />
      </section>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base font-medium text-foreground">
            {t("adminMod.performancePage.capacityStatusTitle")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("adminMod.performancePage.capacityStatusDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.capacity.map((c) => (
            <div
              key={c.key}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/50 px-3 py-2"
            >
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                {statusIcon(c.status)}
                <span>{c.label}</span>
              </div>
              {statusBadge(c.status, t)}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base font-medium text-foreground">
            {t("adminMod.performancePage.slowQueriesTitle")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("adminMod.performancePage.slowQueriesDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.slowQueries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("adminMod.performancePage.noQueryStats")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("adminMod.performancePage.colQuery")}</TableHead>
                    <TableHead className="text-right">
                      {t("adminMod.performancePage.colCalls")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("adminMod.performancePage.colMean")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("adminMod.performancePage.colTotal")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("adminMod.performancePage.colMax")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.slowQueries.map((q, i) => (
                    <TableRow key={i}>
                      <TableCell className="max-w-md truncate font-mono text-xs" title={q.query}>
                        {q.query}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{q.calls}</TableCell>
                      <TableCell className="text-right tabular-nums">{q.meanMs}</TableCell>
                      <TableCell className="text-right tabular-nums">{q.totalMs}</TableCell>
                      <TableCell className="text-right tabular-nums">{q.maxMs}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base font-medium text-foreground">
            {t("adminMod.performancePage.tableSizesTitle")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("adminMod.performancePage.tableSizesDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("adminMod.performancePage.colTable")}</TableHead>
                  <TableHead className="text-right">
                    {t("adminMod.performancePage.colSizeMb")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.tableSizes.map((t) => (
                  <TableRow key={`${t.schema}.${t.table}`}>
                    <TableCell className="font-mono text-xs">
                      {t.schema}.{t.table}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{t.totalMb}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function PerfSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
