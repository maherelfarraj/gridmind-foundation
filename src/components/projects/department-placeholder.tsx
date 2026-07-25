// P-038 — Shared department tab placeholder. Real modules ship in later batches.
import { useSuspenseQuery } from "@tanstack/react-query";

import { Card } from "@/components/ui/card";
import { projectDetailQueryOptions } from "@/lib/projects-detail-query";
import { DEPARTMENT_LABELS, type ProjectDepartment } from "@/lib/schemas/project-wizard";

const STATUS_STYLES: Record<string, string> = {
  active: "bg-primary text-primary-foreground",
  in_progress: "bg-accent text-accent-foreground",
  pending: "bg-muted text-muted-foreground",
  blocked: "bg-destructive text-destructive-foreground",
  done: "bg-secondary text-secondary-foreground",
};

export function DepartmentPlaceholder({
  projectId,
  department,
}: {
  projectId: string;
  department: ProjectDepartment;
}) {
  const { data: project } = useSuspenseQuery(projectDetailQueryOptions(projectId));
  if (!project) return null;

  const row = project.departments.find((d) => d.department === department);
  const label = DEPARTMENT_LABELS[department];

  if (!row) {
    return (
      <Card className="border-border bg-card p-6">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">
          This department isn&rsquo;t assigned to this project.
        </p>
      </Card>
    );
  }

  const statusClass = STATUS_STYLES[row.status] ?? "bg-muted text-muted-foreground";

  return (
    <Card className="flex flex-col gap-4 border-border bg-card p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">{label}</h2>
        <span
          className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize ${statusClass}`}
        >
          {row.status.replace(/_/g, " ")}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Department lead</dt>
          <dd className="mt-1 text-foreground">{row.lead_name ?? "Unassigned"}</dd>
        </div>
      </dl>
      <p className="border-t border-border pt-3 text-xs text-muted-foreground">
        This module ships in a later batch.
      </p>
    </Card>
  );
}
