// P-088 — HSE dashboard.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  ClipboardCheck,
  Eye,
  GraduationCap,
  Inbox,
  Leaf,
  Recycle,
  Siren,
  Plus,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { errorMessage, hseDashboardQueryOptions, hseProjectsQueryOptions } from "@/lib/hse-query";
import { IncidentTimingBadge } from "@/components/hse/incident-timing-badge";
import { useServerFn } from "@tanstack/react-start";
import { getHseExtDashboard } from "@/lib/hse-ext.functions";

export const Route = createFileRoute("/_authenticated/hse/")({
  head: () => ({
    meta: [
      { title: "HSE dashboard — GridMind EPC" },
      {
        name: "description",
        content:
          "Health, safety & environment overview: TRIR, open incidents, inspections, and training expiries.",
      },
      { property: "og:title", content: "HSE — GridMind EPC" },
      {
        property: "og:description",
        content: "Safety culture, codified — TRIR, 24-hour rule, inspections.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HseDashboardPage,
});

function HseDashboardPage() {
  const projectsQuery = useQuery(hseProjectsQueryOptions());
  const [projectId, setProjectId] = useState<string>("");
  const dashQuery = useQuery(hseDashboardQueryOptions(projectId || null));
  const extFn = useServerFn(getHseExtDashboard);
  const extQuery = useQuery({
    queryKey: ["hse-ext-dashboard", projectId || null],
    queryFn: () => extFn({ data: { projectId: projectId || undefined } }),
  });
  const ext = extQuery.data;
  const data = dashQuery.data;

  const trirLabel = useMemo(() => {
    if (!data) return "—";
    if (data.trir12m == null) return "—";
    return data.trir12m.toFixed(2);
  }, [data]);

  return (
    <TooltipProvider>
      <div className="page-shell">
        <PageHeader
          title="HSE dashboard"
          description="Safety culture, codified — TRIR, 24-hour rule, inspections."
          actions={
            <>
              <Button asChild variant="outline" size="sm">
                <Link to="/hse/incidents">All incidents</Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/hse/incidents/new">
                  <Plus size={14} aria-hidden /> Log incident
                </Link>
              </Button>
            </>
          }
        />
        <div className="max-w-xs">
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger>
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All projects</SelectItem>
              {(projectsQuery.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {dashQuery.isError ? (
          <Card>
            <CardContent className="p-4 text-sm text-destructive">
              Failed to load dashboard: {errorMessage(dashQuery.error)}
            </CardContent>
          </Card>
        ) : null}

        {data && data.unloggedWindow > 0 ? (
          <div className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
            <AlertTriangle size={16} className="mt-0.5" aria-hidden />
            <div>
              <div className="font-medium">
                {data.unloggedWindow} incident(s) inside the 24-hour logging window
              </div>
              <div className="text-xs opacity-90">
                Incidents must be logged within 24 hours of occurrence.
              </div>
            </div>
          </div>
        ) : null}

        <KpiGrid columns={4}>
          <KpiTile
            icon={TrendingUp}
            label="TRIR (12m)"
            value={trirLabel}
            hint={
              data && data.trir12m == null
                ? "Add manpower hours from daily reports to compute TRIR."
                : data
                  ? `${data.recordables12m} recordable · ${data.hours12m.toFixed(0)}h`
                  : undefined
            }
            isLoading={dashQuery.isLoading}
          />
          <KpiTile
            icon={ShieldAlert}
            label="Open incidents"
            value={data ? data.openIncidents.toString() : "—"}
            isLoading={dashQuery.isLoading}
          />
          <KpiTile
            icon={CalendarClock}
            label="Logged late"
            value={data ? data.overdueLogs.toString() : "—"}
            hint="Reported more than 24h after occurrence"
            isLoading={dashQuery.isLoading}
          />
          <KpiTile
            icon={ClipboardCheck}
            label="Inspections MTD"
            value={data ? data.inspectionsThisMonth.toString() : "—"}
            isLoading={dashQuery.isLoading}
          />
          <KpiTile
            icon={GraduationCap}
            label="Certs ≤ 30d"
            value={data ? data.trainingExpiring.toString() : "—"}
            isLoading={dashQuery.isLoading}
          />
          <KpiTile
            icon={Eye}
            label="Open unsafe observations"
            value={ext ? ext.openUnsafeObservations.toString() : "—"}
            hint="Unsafe acts and conditions not yet closed"
            isLoading={extQuery.isLoading}
          />
          <KpiTile
            icon={GraduationCap}
            label="Competencies ≤ 30d"
            value={ext ? ext.competenciesExpiring.toString() : "—"}
            isLoading={extQuery.isLoading}
          />
          <KpiTile
            icon={Leaf}
            label="Env exceedances MTD"
            value={ext ? ext.envExceedancesThisMonth.toString() : "—"}
            isLoading={extQuery.isLoading}
          />
          <KpiTile
            icon={Recycle}
            label="Waste (kg)"
            value={ext ? Math.round(ext.wasteTotalKg).toString() : "—"}
            hint={
              ext && Object.keys(ext.wasteByType).length > 0
                ? Object.entries(ext.wasteByType)
                    .map(([t, kg]) => `${t}: ${Math.round(kg)}`)
                    .join(" · ")
                : undefined
            }
            isLoading={extQuery.isLoading}
          />
          <KpiTile
            icon={ClipboardCheck}
            label="Last audit score"
            value={ext && ext.lastAuditScore != null ? `${ext.lastAuditScore}%` : "—"}
            isLoading={extQuery.isLoading}
          />
          <KpiTile
            icon={Siren}
            label="Drill response avg"
            value={
              ext && ext.drillResponseAvgMinutes != null
                ? `${ext.drillResponseAvgMinutes} min`
                : "—"
            }
            isLoading={extQuery.isLoading}
          />
        </KpiGrid>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Recent incidents</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {dashQuery.isLoading ? (
              <>
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </>
            ) : (data?.recentIncidents ?? []).length === 0 ? (
              <EmptyState
                icon={Inbox}
                title="No incidents logged"
                description="No incidents were logged in the last 12 months."
                compact
              />
            ) : (
              (data?.recentIncidents ?? []).map((r) => (
                <Link
                  key={r.id}
                  to="/hse/incidents/$id"
                  params={{ id: r.id }}
                  className="flex flex-col gap-1 rounded-md border border-border p-3 transition-colors hover:bg-accent"
                >
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-foreground">{r.incident_number}</span>
                    <Badge variant="secondary" className="capitalize">
                      {r.incident_type.replace("_", " ")}
                    </Badge>
                    <Badge variant="outline" className="capitalize">
                      {r.severity}
                    </Badge>
                    <IncidentTimingBadge occurredAt={r.occurred_at} reportedAt={r.reported_at} />
                    <span className="ml-auto text-xs text-muted-foreground">
                      {new Date(r.occurred_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="line-clamp-1 text-sm text-muted-foreground">
                    {r.project_name ?? "—"} · {r.description}
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
