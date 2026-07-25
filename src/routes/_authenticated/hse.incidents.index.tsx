// P-088 — HSE incidents list.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Plus, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, hseProjectsQueryOptions, incidentListQueryOptions } from "@/lib/hse-query";
import { IncidentTimingBadge } from "@/components/hse/incident-timing-badge";
import { objectsToCsv, downloadCsv } from "@/lib/csv";

export const Route = createFileRoute("/_authenticated/hse/incidents/")({
  head: () => ({
    meta: [
      { title: "HSE incidents — GridMind EPC" },
      {
        name: "description",
        content: "All logged HSE incidents with 24-hour rule enforcement.",
      },
      { property: "og:title", content: "HSE incidents — GridMind EPC" },
      {
        property: "og:description",
        content: "Injuries, near-misses, environmental and property events.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IncidentListPage,
});

function IncidentListPage() {
  const projectsQuery = useQuery(hseProjectsQueryOptions());
  const [projectId, setProjectId] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [search, setSearch] = useState("");

  const filters = useMemo(
    () => ({
      projectId: projectId || null,
      status: (status || null) as any,
      search: search || null,
    }),
    [projectId, status, search],
  );
  const listQuery = useQuery(incidentListQueryOptions(filters));
  const rows = listQuery.data ?? [];

  const exportCsv = () => {
    const csv = objectsToCsv(
      rows.map((r) => ({
        incident_number: r.incident_number,
        project: r.project_name ?? "",
        occurred_at: r.occurred_at,
        reported_at: r.reported_at,
        type: r.incident_type,
        severity: r.severity,
        status: r.status,
        osha_recordable: r.osha_recordable ? "yes" : "no",
        location: r.location ?? "",
        description: r.description,
      })),
    );
    downloadCsv("hse-incidents.csv", csv);
  };

  return (
    <div className="page-shell">
      <PageHeader
        title="Incidents"
        description="All logged HSE incidents with 24-hour rule enforcement."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
              Export CSV
            </Button>
            <Button asChild size="sm">
              <Link to="/hse/incidents/new">
                <Plus size={14} aria-hidden /> Log incident
              </Link>
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-4">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="All" />
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
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Any</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="investigating">Investigating</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2 flex flex-col gap-1">
            <Label className="text-xs">Search</Label>
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Incident #, description, location, project"
                className="pl-8"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {listQuery.isError ? (
        <Card>
          <CardContent className="p-4 text-sm text-destructive">
            {errorMessage(listQuery.error)}
          </CardContent>
        </Card>
      ) : null}

      {listQuery.isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="No incidents yet"
          description="Tap Log incident to report an HSE incident."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <Link
              key={r.id}
              to="/hse/incidents/$id"
              params={{ id: r.id }}
              className="flex flex-col gap-1 rounded-md border border-border bg-card p-3 transition-colors hover:bg-accent"
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-foreground">{r.incident_number}</span>
                <Badge variant="secondary" className="capitalize">
                  {r.incident_type.replace("_", " ")}
                </Badge>
                <Badge variant="outline" className="capitalize">
                  {r.severity}
                </Badge>
                <Badge variant="outline" className="capitalize">
                  {r.status}
                </Badge>
                {r.osha_recordable ? (
                  <Badge className="bg-destructive/10 text-destructive">OSHA</Badge>
                ) : null}
                <IncidentTimingBadge occurredAt={r.occurred_at} reportedAt={r.reported_at} />
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(r.occurred_at).toLocaleString()}
                </span>
              </div>
              <div className="line-clamp-1 text-sm text-muted-foreground">
                {r.project_name ?? "—"} · {r.description}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
