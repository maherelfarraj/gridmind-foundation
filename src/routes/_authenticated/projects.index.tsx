// P-037 — Project cockpit: card list, filters, phase badges.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { AlertTriangle, Download, FolderPlus, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { useActiveCompany } from "@/components/company-switcher";
import { PhaseBadge } from "@/components/projects/phase-badge";
import { ARCHETYPES } from "@/components/wizard/archetype-catalog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTablePagination } from "@/components/ui/data-table";
import { EmptyState as SharedEmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { exportProjectsCsv, listProjects, type ProjectCardRow } from "@/lib/projects.functions";
import {
  DEPARTMENT_LABELS,
  PHASE_LABELS,
  PROJECT_DEPARTMENTS,
  PROJECT_PHASES,
  type ProjectDepartment,
  type ProjectPhase,
} from "@/lib/schemas/project-wizard";
import type { ProjectArchetype } from "@/lib/wizard-draft";

const ARCHETYPE_KEYS = ARCHETYPES.map((a) => a.key) as ProjectArchetype[];
const ARCHETYPE_LABEL: Record<ProjectArchetype, string> = Object.fromEntries(
  ARCHETYPES.map((a) => [a.key, a.label]),
) as Record<ProjectArchetype, string>;

const searchSchema = z.object({
  q: z.string().catch("").default(""),
  phase: z.string().catch("").default(""),
  archetype: z.string().catch("").default(""),
  department: z.string().catch("").default(""),
  page: z.coerce.number().int().min(1).catch(1).default(1),
});

export const Route = createFileRoute("/_authenticated/projects/")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Projects — GridMind EPC" },
      {
        name: "description",
        content:
          "Browse and filter every EPC project in your tenant: utility PV, BESS, wind, hybrid, C&I rooftop, transmission, and Green H₂.",
      },
      { property: "og:title", content: "Projects — GridMind EPC" },
      {
        property: "og:description",
        content:
          "Browse and filter every EPC project in your tenant across phases, archetypes, and departments.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProjectsPage,
});

function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function ProjectsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { activeCompany } = useActiveCompany();
  const companyId = activeCompany?.id ?? null;

  // Clamp URL values to known sets.
  const phase = (PROJECT_PHASES as readonly string[]).includes(search.phase)
    ? (search.phase as ProjectPhase)
    : undefined;
  const archetype = ARCHETYPE_KEYS.includes(search.archetype as ProjectArchetype)
    ? (search.archetype as ProjectArchetype)
    : undefined;
  const department = (PROJECT_DEPARTMENTS as readonly string[]).includes(search.department)
    ? (search.department as ProjectDepartment)
    : undefined;

  const [rawQ, setRawQ] = useState(search.q);
  useEffect(() => setRawQ(search.q), [search.q]);
  const debouncedQ = useDebounced(rawQ, 300);
  useEffect(() => {
    if (debouncedQ === search.q) return;
    navigate({
      search: (prev) => ({ ...prev, q: debouncedQ, page: 1 }),
      replace: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  const filtersActive = !!(search.q || phase || archetype || department);

  const listFn = useServerFn(listProjects);
  const exportFn = useServerFn(exportProjectsCsv);

  const query = useQuery({
    queryKey: [
      "projects",
      companyId,
      { q: search.q, phase, archetype, department, page: search.page },
    ],
    queryFn: () =>
      listFn({
        data: {
          companyId: companyId!,
          search: search.q || undefined,
          phase,
          archetype,
          department,
          page: search.page,
        },
      }),
    enabled: !!companyId,
    placeholderData: keepPreviousData,
  });

  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    if (!companyId) return;
    setExporting(true);
    try {
      const res = await exportFn({
        data: {
          companyId,
          search: search.q || undefined,
          phase,
          archetype,
          department,
        },
      });
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("CSV downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const setFilter = (key: "phase" | "archetype" | "department", value: string) => {
    navigate({
      search: (prev) => ({
        ...prev,
        [key]: value === "__all__" ? "" : value,
        page: 1,
      }),
      replace: true,
    });
  };

  const total = query.data?.total ?? 0;
  const rows = query.data?.rows ?? [];
  const pageSize = query.data?.pageSize ?? 24;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="page-shell">
      <PageHeader
        title="Projects"
        description={
          query.isLoading
            ? "Loading…"
            : `${total} project${total === 1 ? "" : "s"}${filtersActive ? " matching filters" : ""}`
        }
        actions={
          <>
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={exporting || !companyId || rows.length === 0}
            >
              <Download size={16} aria-hidden />
              Export CSV
            </Button>
            <Button asChild>
              <Link to="/projects/new" search={{ step: 1 }}>
                <Plus size={16} aria-hidden />
                New project
              </Link>
            </Button>
          </>
        }
      />

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div className="relative min-w-[220px] flex-1">
          <Search
            size={16}
            aria-hidden
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={rawQ}
            onChange={(e) => setRawQ(e.target.value)}
            placeholder="Search by name or code"
            className="pl-8"
            aria-label="Search projects"
          />
        </div>
        <FilterSelect
          label="Phase"
          value={phase ?? ""}
          onChange={(v) => setFilter("phase", v)}
          options={PROJECT_PHASES.map((p) => ({
            value: p,
            label: PHASE_LABELS[p],
          }))}
        />
        <FilterSelect
          label="Archetype"
          value={archetype ?? ""}
          onChange={(v) => setFilter("archetype", v)}
          options={ARCHETYPE_KEYS.map((k) => ({
            value: k,
            label: ARCHETYPE_LABEL[k],
          }))}
        />
        <FilterSelect
          label="Department"
          value={department ?? ""}
          onChange={(v) => setFilter("department", v)}
          options={PROJECT_DEPARTMENTS.map((d) => ({
            value: d,
            label: DEPARTMENT_LABELS[d],
          }))}
        />
      </Card>

      {query.isError ? (
        <ErrorPanel
          message={query.error instanceof Error ? query.error.message : "Failed to load projects"}
          onRetry={() => query.refetch()}
        />
      ) : query.isLoading ? (
        <SkeletonGrid />
      ) : rows.length === 0 ? (
        <EmptyState filtersActive={filtersActive} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => (
              <ProjectCard key={r.id} row={r} />
            ))}
          </div>
          {totalPages > 1 ? (
            <DataTablePagination
              page={search.page}
              pageSize={pageSize}
              total={total}
              onPageChange={(page) => navigate({ search: (prev) => ({ ...prev, page }) })}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Select value={value || "__all__"} onValueChange={onChange}>
        <SelectTrigger className="w-[160px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ProjectCard({ row }: { row: ProjectCardRow }) {
  const archetypeLabel = ARCHETYPE_LABEL[row.archetype] ?? row.archetype;
  const capacity =
    row.capacity_mw != null
      ? `${row.capacity_mw} MW${row.capacity_mwh != null ? ` · ${row.capacity_mwh} MWh` : ""}`
      : "—";
  const codDisplay = row.target_cod ? format(parseISO(row.target_cod), "PP") : "No COD set";
  const admin = row.project_admin;
  const adminName = admin?.full_name?.trim() || admin?.email || "Unassigned";
  const initials = (admin?.full_name || admin?.email || "?")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: row.id }}
      className="block rounded-lg outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <Card className="flex h-full flex-col gap-4 p-5 transition-colors hover:border-primary/50">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-foreground">{row.name}</h3>
            <p className="text-xs text-muted-foreground">{row.code}</p>
          </div>
          <PhaseBadge phase={row.phase} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {archetypeLabel}
          </span>
          <span className="text-xs text-muted-foreground">{capacity}</span>
        </div>

        <div className="mt-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Avatar className="h-7 w-7">
              {admin?.avatar_url ? <AvatarImage src={admin.avatar_url} alt={adminName} /> : null}
              <AvatarFallback className="text-xs">{initials}</AvatarFallback>
            </Avatar>
            <span className="truncate text-xs text-foreground">{adminName}</span>
          </div>
          <span className="text-xs text-muted-foreground">{codDisplay}</span>
        </div>
      </Card>
    </Link>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-5 w-20" />
          </div>
          <Skeleton className="h-3 w-1/2" />
          <div className="mt-auto flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Skeleton className="h-7 w-7 rounded-full" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-3 w-16" />
          </div>
        </Card>
      ))}
    </div>
  );
}

function EmptyState({ filtersActive }: { filtersActive: boolean }) {
  return filtersActive ? (
    <SharedEmptyState
      icon={FolderPlus}
      title="No projects match your filters"
      description="Adjust or clear the filters above to see more results."
    />
  ) : (
    <SharedEmptyState
      icon={FolderPlus}
      title="No projects yet"
      description="Create your first project to start phase-gated delivery."
      action={
        <Button asChild size="sm">
          <Link to="/projects/new" search={{ step: 1 }}>
            <Plus size={16} aria-hidden />
            New project
          </Link>
        </Button>
      }
    />
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="flex flex-col items-start gap-3 border-destructive/40 bg-destructive/10 p-6">
      <div className="flex items-center gap-2 text-destructive">
        <AlertTriangle size={18} aria-hidden />
        <span className="text-sm font-medium">Couldn't load projects</span>
      </div>
      <p className="text-xs text-muted-foreground">{message}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </Card>
  );
}
