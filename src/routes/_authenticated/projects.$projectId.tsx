// P-038 — Project detail layout: header + tab bar + <Outlet />.
import { createFileRoute, Link, Outlet, useRouter } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { ArrowLeft, HardHat, RefreshCw } from "lucide-react";

import { mobilizationHeaderChipQueryOptions } from "@/lib/mobilization-query";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { PhaseBadge } from "@/components/projects/phase-badge";
import { PhaseGateStepper } from "@/components/projects/phase-gate-stepper";
import { projectDetailQueryOptions } from "@/lib/projects-detail-query";
import { DEPARTMENT_LABELS, type ProjectDepartment } from "@/lib/schemas/project-wizard";
import { ARCHETYPES } from "@/components/wizard/archetype-catalog";
import type { ProjectArchetype } from "@/lib/wizard-draft";

const ARCHETYPE_LABEL: Record<ProjectArchetype, string> = Object.fromEntries(
  ARCHETYPES.map((a) => [a.key, a.label]),
) as Record<ProjectArchetype, string>;

// Tabs — key must match the child route path segment.
const STATIC_TABS = [
  { key: "overview" as const, label: "Overview" },
  { key: "gates" as const, label: "Gates" },
  { key: "config" as const, label: "Config" },
  { key: "planning/wbs" as const, label: "Planning" },
  { key: "commissioning" as const, label: "Commissioning" },
];

// Department tabs — only render when the project has that department row.
const DEPT_TABS: { key: TabKey; dept: ProjectDepartment; label: string }[] = [
  { key: "engineering", dept: "engineering", label: DEPARTMENT_LABELS.engineering },
  { key: "procurement", dept: "procurement", label: DEPARTMENT_LABELS.procurement },
  { key: "construction", dept: "construction", label: DEPARTMENT_LABELS.construction },
  { key: "hse", dept: "hse", label: DEPARTMENT_LABELS.hse },
  { key: "finance", dept: "finance", label: DEPARTMENT_LABELS.finance },
];

type TabKey =
  | "overview"
  | "gates"
  | "config"
  | "planning/wbs"
  | "commissioning"
  | "engineering"
  | "procurement"
  | "construction"
  | "hse"
  | "finance";

const PROJECTS_LINK_SEARCH = {
  q: "",
  phase: "",
  archetype: "",
  department: "",
  page: 1,
} as const;

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  head: () => ({
    meta: [
      { title: "Project — GridMind EPC" },
      {
        name: "description",
        content: "Project cockpit for a GridMind EPC project.",
      },
      { property: "og:title", content: "Project — GridMind EPC" },
      {
        property: "og:description",
        content: "Project cockpit for a GridMind EPC project.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(projectDetailQueryOptions(params.projectId)),
  pendingComponent: DetailSkeleton,
  errorComponent: DetailError,
  notFoundComponent: DetailNotFound,
  component: ProjectDetailLayout,
});

function ProjectDetailLayout() {
  const { projectId } = Route.useParams();
  const { data: project } = useSuspenseQuery(projectDetailQueryOptions(projectId));

  if (!project) {
    return <DetailNotFound />;
  }

  const archetypeLabel = ARCHETYPE_LABEL[project.archetype] ?? project.archetype;
  const deptSet = new Set(project.departments.map((d) => d.department));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      {/* Header */}
      <header className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link
            to="/projects"
            search={PROJECTS_LINK_SEARCH}
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <ArrowLeft size={14} aria-hidden />
            Projects
          </Link>
          <span aria-hidden>/</span>
          <span className="font-mono">{project.code}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            {project.name}
          </h1>
          <span className="inline-flex items-center rounded-md border border-border bg-secondary/40 px-2 py-0.5 text-xs font-medium text-foreground">
            {archetypeLabel}
          </span>
          <PhaseBadge phase={project.phase} />
          <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium capitalize text-muted-foreground">
            {project.status}
          </span>
          <MobilizationHeaderChip projectId={projectId} />
        </div>

        <Card className="p-5">
          <PhaseGateStepper gates={project.gates} />
        </Card>
      </header>

      {/* Tab bar */}
      <nav aria-label="Project sections" className="flex flex-wrap gap-1 border-b border-border">
        {STATIC_TABS.map((t) => (
          <TabLink key={t.key} to={t.key} label={t.label} projectId={projectId} />
        ))}
        {DEPT_TABS.filter((t) => deptSet.has(t.dept)).map((t) => (
          <TabLink key={t.key} to={t.key} label={t.label} projectId={projectId} />
        ))}
      </nav>

      {/* Outlet */}
      <Outlet />
    </div>
  );
}

function TabLink({ to, label, projectId }: { to: string; label: string; projectId: string }) {
  return (
    <Link
      to={`/projects/$projectId/${to}` as any}
      params={{ projectId } as any}
      className={cn(
        "-mb-px inline-flex items-center border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
      )}
      activeProps={{
        className: "border-primary text-foreground",
      }}
    >
      {label}
    </Link>
  );
}

function DetailSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-96" />
        <Card className="p-5">
          <Skeleton className="h-16 w-full" />
        </Card>
      </header>
      <div className="flex gap-2 border-b border-border pb-2">
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-24" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function DetailError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="mx-auto flex w-full max-w-3xl">
      <Card className="flex w-full flex-col items-start gap-3 border-destructive/40 bg-card p-6">
        <h2 className="font-display text-lg font-semibold text-foreground">
          Couldn&rsquo;t load this project
        </h2>
        <p className="text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "Unexpected error."}
        </p>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              router.invalidate();
              reset();
            }}
          >
            <RefreshCw size={14} aria-hidden />
            Retry
          </Button>
          <Button asChild variant="outline">
            <Link to="/projects" search={PROJECTS_LINK_SEARCH}>
              <ArrowLeft size={14} aria-hidden />
              Back to projects
            </Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}

function DetailNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-3xl">
      <Card className="flex w-full flex-col items-start gap-3 p-6">
        <h2 className="font-display text-lg font-semibold text-foreground">
          Project not available
        </h2>
        <p className="text-sm text-muted-foreground">
          This project doesn&rsquo;t exist or you don&rsquo;t have access.
        </p>
        <Button asChild variant="outline">
          <Link to="/projects" search={PROJECTS_LINK_SEARCH}>
            <ArrowLeft size={14} aria-hidden />
            Back to projects
          </Link>
        </Button>
      </Card>
    </div>
  );
}

function MobilizationHeaderChip({ projectId }: { projectId: string }) {
  const { data } = useQuery(mobilizationHeaderChipQueryOptions(projectId));
  if (!data) return null;
  if (data.status === "complete" || data.status === "none") return null;
  const label =
    data.status === "in_progress" ? "Mobilization: in progress" : "Mobilization: not started";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300"
      aria-label={label}
    >
      <HardHat size={12} aria-hidden />
      {label}
    </span>
  );
}
