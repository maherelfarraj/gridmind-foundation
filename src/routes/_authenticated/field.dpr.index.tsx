// P-086 — DPR list (mobile-first).
import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  ClipboardList,
  ImageOff,
  Plus,
  Search,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  dprListQueryOptions,
  dprProjectsQueryOptions,
  errorMessage,
} from "@/lib/dpr-query";

export const Route = createFileRoute("/_authenticated/field/dpr/")({
  head: () => ({
    meta: [
      { title: "Daily reports — GridMind EPC" },
      {
        name: "description",
        content:
          "Field daily progress reports: manpower, weather, installed quantities and site photos.",
      },
      { property: "og:title", content: "Daily reports — GridMind EPC" },
      {
        property: "og:description",
        content: "Field DPRs across every project.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DprListPage,
});

function DprListPage() {
  const navigate = useNavigate();
  const projectsQuery = useQuery(dprProjectsQueryOptions());
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
  const listQuery = useQuery(dprListQueryOptions(filters));
  const rows = listQuery.data ?? [];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 pb-24">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <ClipboardList size={14} aria-hidden /> Field
        </div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Daily reports
        </h1>
        <p className="text-sm text-muted-foreground">
          Capture manpower, weather, installed quantities and site photos —
          fast, one-handed, in the field.
        </p>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="f-project">Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="f-project" className="h-11">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All projects</SelectItem>
                {(projectsQuery.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="f-status">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="f-status" className="h-11">
                <SelectValue placeholder="Any status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Any status</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="f-search">Search</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="f-search"
                className="h-11 pl-9"
                placeholder="Project or date"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {listQuery.isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : listQuery.isError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            <span className="text-sm font-medium">Failed to load reports</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {errorMessage(listQuery.error)}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => listQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-muted/30 p-8 text-center">
          <ClipboardList
            className="mx-auto mb-3 h-8 w-8 text-muted-foreground"
            aria-hidden
          />
          <p className="text-sm text-muted-foreground">
            No daily reports yet — tap <b>New Report</b>.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                to="/field/dpr/$dprId"
                params={{ dprId: r.id }}
                search={{ step: 1 }}
                className="block rounded-md border border-border bg-card p-3 hover:bg-muted/30"
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                      {r.report_date} · {r.shift}
                    </div>
                    <div className="mt-0.5 truncate text-sm font-medium text-foreground">
                      {r.project_name ?? r.project_id}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {r.total_manpower} on site ·{" "}
                      {Number(r.total_hours).toFixed(1)} h
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge status={r.status} />
                    {r.status !== "draft" && r.photo_count === 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-warning-foreground">
                        <ImageOff className="h-3 w-3" aria-hidden /> No photos
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Button
        type="button"
        size="lg"
        className="fixed bottom-4 right-4 z-10 h-14 rounded-full shadow-lg"
        onClick={() => navigate({ to: "/field/dpr/new" })}
      >
        <Plus className="mr-2 h-5 w-5" aria-hidden />
        New Report
      </Button>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "approved"
      ? "default"
      : status === "submitted"
        ? "secondary"
        : "outline";
  return (
    <Badge variant={variant as any} className="capitalize">
      {status}
    </Badge>
  );
}
