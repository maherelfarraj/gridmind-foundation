// SLO/SLI dashboard — cron freshness, SCADA ingestion freshness, public hook
// 401 rate and finance alert triage time. Super-admin only (server-verified
// inside getSloDashboard).
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, AlertTriangle, CheckCircle2, RefreshCcw, XCircle } from "lucide-react";

import { getSloDashboard, type SloSnapshot, type SloStatus } from "@/lib/slo.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { useI18n } from "@/lib/i18n/locale-provider";

export const Route = createFileRoute("/_authenticated/admin/slo")({
  head: () => ({
    meta: [
      { title: "SLO / SLI dashboard | GridMind EPC Admin" },
      {
        name: "description",
        content:
          "Live SLO snapshots — cron freshness, SCADA ingestion, public hook 401 rate and finance alert triage time.",
      },
      { property: "og:title", content: "SLO / SLI dashboard | GridMind EPC Admin" },
      {
        property: "og:description",
        content: "Live SLO snapshots across cron, SCADA ingestion, public API and finance alerting.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SloPage,
});

function statusIcon(status: SloStatus) {
  if (status === "breach") return <XCircle className="h-4 w-4 text-destructive" />;
  if (status === "warn") return <AlertTriangle className="h-4 w-4 text-warning" />;
  return <CheckCircle2 className="h-4 w-4 text-primary" />;
}

function statusTone(status: SloStatus): "positive" | "attention" | "critical" {
  if (status === "breach") return "critical";
  if (status === "warn") return "attention";
  return "positive";
}

function formatValue(s: SloSnapshot): string {
  if (s.observed_value === null) return "No data";
  if (s.slo_name.includes("rate")) return `${s.observed_value}%`;
  if (s.slo_name.includes("triage")) return `${s.observed_value} min`;
  return `${s.observed_value} min ago`;
}

function SloPage() {
  const { t } = useI18n();
  const fetchSlo = useServerFn(getSloDashboard);
  const query = useQuery({
    queryKey: ["ops-slo"],
    queryFn: () => fetchSlo({ data: {} }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const overall: SloStatus = query.data?.some((s) => s.status === "breach")
    ? "breach"
    : query.data?.some((s) => s.status === "warn")
      ? "warn"
      : "ok";

  return (
    <div className="page-shell max-w-6xl">
      <PageHeader
        title={t("adminMod.admin.slo")}
        description="Live service-level indicators computed from cron probes, SCADA ingestion, the public API guard and finance alert triage."
        actions={
          <div className="flex items-center gap-3">
            {query.data ? <StatusBadge status={overall} tone={statusTone(overall)} /> : null}
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

      {query.isPending ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : null}

      {query.isError ? (
        <Card className="border-destructive/40 bg-card">
          <CardHeader>
            <CardTitle className="text-destructive">Couldn't load SLO dashboard</CardTitle>
            <CardDescription className="text-muted-foreground">
              {(query.error as Error | undefined)?.message ??
                "The server returned an error while reading SLO signals."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => query.refetch()} variant="default">
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {query.data && query.data.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No SLO data"
          description="No SLO snapshots could be computed yet."
        />
      ) : null}

      {query.data && query.data.length > 0 ? (
        <section
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
          aria-label="SLO snapshots"
        >
          {query.data.map((s) => (
            <Card key={s.slo_name} className="bg-card border-border">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {statusIcon(s.status)}
                    {s.slo_name}
                  </CardTitle>
                  <StatusBadge status={s.status} tone={statusTone(s.status)} />
                </div>
                <CardDescription className="text-xs text-muted-foreground">
                  Target: {s.target}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                <span className="text-2xl font-semibold tabular-nums text-foreground">
                  {formatValue(s)}
                </span>
                <p className="text-xs text-muted-foreground">{s.measurement_window}</p>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : null}
    </div>
  );
}
