// P-038 — Shared department tab placeholder. Real modules ship in later batches.
import { Construction } from "lucide-react";
import { useSuspenseQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { projectDetailQueryOptions } from "@/lib/projects-detail-query";
import { DEPARTMENT_LABELS, type ProjectDepartment } from "@/lib/schemas/project-wizard";

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
      <div className="space-y-6">
        <PageHeader title={label} description="This department isn't assigned to this project." />
        <EmptyState
          icon={Construction}
          title="Not assigned"
          description="This department isn't assigned to this project."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={label}
        description={`Lead: ${row.lead_name ?? "Unassigned"}`}
        actions={
          <Badge variant="secondary" className="capitalize">
            {row.status.replace(/_/g, " ")}
          </Badge>
        }
      />
      <EmptyState
        icon={Construction}
        title="This module ships in a later batch"
        description="Check back soon for detailed tracking here."
      />
    </div>
  );
}
