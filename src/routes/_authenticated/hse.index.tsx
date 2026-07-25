// P-088 — HSE dashboard.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  ClipboardCheck,
  GraduationCap,
  Plus,
  Shield,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  errorMessage,
  hseDashboardQueryOptions,
  hseProjectsQueryOptions,
} from "@/lib/hse-query";
import { IncidentTimingBadge } from "@/components/hse/incident-timing-badge";

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
  const data = dashQuery.data;

  const trirLabel = useMemo(() => {
    if (!data) return "—";
    if (data.trir12m == null) return "—";
    return data.trir12m.toFixed(2);
  }, [data]);

  return (
    <TooltipProvider>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 pb-24">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <Shield size={14} aria-hidden /> HSE
          </div>
          <div className="flex items-start justify-between gap-3">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
              HSE dashboard
            </h1>
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/hse/incidents">All incidents</Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/hse/incidents/new">
                  <Plus size={14} aria-hidden /> Log incident
                </Link>
              </Button>
            </div>
          </div>
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
        </header>

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
                {data.unloggedWindow} incident(s) inside the 24-hour logging
                window
              </div>
              <div className="text-xs opacity-90">
                Incidents must be logged within 24 hours of occurrence.
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          <KpiCard
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
            loading={dashQuery.isLoading}
          />
          <KpiCard
            icon={ShieldAlert}
            label="Open incidents"
            value={data ? data.openIncidents.toString() : "—"}
            loading={dashQuery.isLoading}
          />
          <KpiCard
            icon={CalendarClock}
            label="Logged late"
            value={data ? data.overdueLogs.toString() : "—"}
            hint="Reported more than 24h after occurrence"
            loading={dashQuery.isLoading}
          />
          <KpiCard
            icon={ClipboardCheck}
            label="Inspections MTD"
            value={data ? data.inspectionsThisMonth.toString() : "—"}
            loading={dashQuery.isLoading}
          />
          <KpiCard
            icon={GraduationCap}
            label="Certs ≤ 30d"
            value={data ? data.trainingExpiring.toString() : "—"}
            loading={dashQuery.isLoading}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              Recent incidents
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {dashQuery.isLoading ? (
              <>
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </>
            ) : (data?.recentIncidents ?? []).length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
                No incidents logged in the last 12 months.
              </div>
            ) : (
              (data?.recentIncidents ?? []).map((r) => (
                <Link
                  key={r.id}
                  to="/hse/incidents/$id"
                  params={{ id: r.id }}
                  className="flex flex-col gap-1 rounded-md border border-border p-3 transition-colors hover:bg-accent"
                >
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-foreground">
                      {r.incident_number}
                    </span>
                    <Badge variant="secondary" className="capitalize">
                      {r.incident_type.replace("_", " ")}
                    </Badge>
                    <Badge variant="outline" className="capitalize">
                      {r.severity}
                    </Badge>
                    <IncidentTimingBadge
                      occurredAt={r.occurred_at}
                      reportedAt={r.reported_at}
                    />
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

interface KpiProps {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  hint?: string;
  loading?: boolean;
}
function KpiCard({ icon: Icon, label, value, hint, loading }: KpiProps) {
  const body = (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <Icon size={12} /> {label}
        </div>
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <div className="font-display text-2xl font-semibold tabular-nums text-foreground">
            {value}
          </div>
        )}
      </CardContent>
    </Card>
  );
  if (!hint) return body;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{body}</TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}
