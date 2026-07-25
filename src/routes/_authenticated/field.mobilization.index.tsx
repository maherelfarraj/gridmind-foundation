// P-084 — Mobilization checklist list page (project picker + list).
import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, HardHat, Plus } from "lucide-react";
import { toast } from "sonner";

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
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import {
  errorMessage,
  mobilizationListQueryOptions,
  mobilizationProjectOptionsQuery,
} from "@/lib/mobilization-query";
import { createMobilizationChecklist } from "@/lib/mobilization.functions";
import { computeProgress } from "@/lib/mobilization.rules";

export const Route = createFileRoute("/_authenticated/field/mobilization/")({
  head: () => ({
    meta: [
      { title: "Mobilization — GridMind EPC" },
      {
        name: "description",
        content:
          "Site mobilization checklists proving cabins, fencing, HSE induction and permits are ready before field work starts.",
      },
      { property: "og:title", content: "Mobilization — GridMind EPC" },
      {
        property: "og:description",
        content: "Per-project site-readiness checklists for GridMind EPC.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MobilizationIndexPage,
});

function MobilizationIndexPage() {
  const [projectId, setProjectId] = useState<string>("");
  const projectsQuery = useQuery(mobilizationProjectOptionsQuery());
  const listQuery = useQuery(mobilizationListQueryOptions(projectId));

  return (
    <div className="page-shell">
      <PageHeader
        title="Site mobilization"
        description="Prove cabins, fencing, HSE induction, utilities, access and permits are ready before crews mobilize."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Project</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {projectsQuery.isLoading ? (
            <Skeleton className="h-10 w-full sm:w-80" />
          ) : projectsQuery.isError ? (
            <span className="text-sm text-destructive">
              Failed to load projects. {errorMessage(projectsQuery.error)}
            </span>
          ) : (
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="w-full sm:w-80">
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {(projectsQuery.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} <span className="text-muted-foreground">({p.code})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {projectId ? <CreateChecklistButton projectId={projectId} /> : null}
        </CardContent>
      </Card>

      {projectId ? <ChecklistList projectId={projectId} query={listQuery} /> : null}
    </div>
  );
}

function CreateChecklistButton({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const createFn = useServerFn(createMobilizationChecklist);
  const mutation = useMutation({
    mutationFn: () => createFn({ data: { projectId } }),
    onSuccess: (row) => {
      toast.success("Checklist created");
      queryClient.invalidateQueries({ queryKey: ["mobilization"] });
      navigate({
        to: "/field/mobilization/$checklistId",
        params: { checklistId: row.id },
      });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Button size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
      <Plus className="mr-2 h-4 w-4" /> New checklist
    </Button>
  );
}

function ChecklistList({
  projectId,
  query,
}: {
  projectId: string;
  query: ReturnType<typeof useQuery<any, any>>;
}) {
  if (query.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="flex flex-col items-start gap-3 py-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-medium">Failed to load checklists</span>
          </div>
          <p className="text-sm text-muted-foreground">{errorMessage(query.error)}</p>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }
  const rows = (query.data ?? []) as any[];
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={HardHat}
        title="No mobilization checklist yet"
        description="Create one to begin site setup."
      />
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {rows.map((row) => {
        const p = computeProgress(row.items ?? []);
        const pct =
          p.requiredTotal === 0 ? 0 : Math.round((p.requiredComplete / p.requiredTotal) * 100);
        return (
          <Link
            key={row.id}
            to="/field/mobilization/$checklistId"
            params={{ checklistId: row.id }}
            className="rounded-lg border bg-card p-4 transition-colors hover:border-primary/40"
          >
            <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <h3 className="min-w-0 truncate font-display text-sm font-medium text-foreground">
                {row.name}
              </h3>
              <StatusBadge status={row.status} />
            </div>
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {p.requiredComplete} / {p.requiredTotal} required
              </span>
              <span>{pct}%</span>
            </div>
            <Progress value={pct} />
            <p className="mt-3 text-xs text-muted-foreground">
              Updated {new Date(row.updated_at).toLocaleString()}
            </p>
          </Link>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: any }> = {
    not_started: { label: "Not started", variant: "outline" },
    in_progress: { label: "In progress", variant: "secondary" },
    complete: { label: "Complete", variant: "default" },
  };
  const cfg = map[status] ?? map.not_started;
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}
