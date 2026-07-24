// P-038 — Gates tab placeholder (read-only). Transitions land in P-040.
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";

import { Card } from "@/components/ui/card";
import { projectDetailQueryOptions } from "@/lib/projects-detail-query";

const GATE_STATUS_STYLES: Record<string, string> = {
  approved: "bg-primary text-primary-foreground",
  in_review: "bg-accent text-accent-foreground",
  open: "border border-primary text-primary bg-background",
  locked: "bg-muted text-muted-foreground",
};

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/gates",
)({
  component: GatesTab,
});

function GatesTab() {
  const { projectId } = Route.useParams();
  const { data: project } = useSuspenseQuery(
    projectDetailQueryOptions(projectId),
  );
  if (!project) return null;

  return (
    <Card className="border-border bg-card p-5">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Phase gates
        </h2>
        <p className="text-xs text-muted-foreground">
          Gate transitions ship in P-040.
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {project.gates.map((g) => (
          <li
            key={g.id}
            className="flex items-center justify-between gap-3 py-3"
          >
            <div className="flex min-w-0 flex-col">
              <span className="text-sm font-medium text-foreground">
                {g.name}
              </span>
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {g.phase}
              </span>
            </div>
            <span
              className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize ${
                GATE_STATUS_STYLES[g.status] ??
                "bg-muted text-muted-foreground"
              }`}
            >
              {g.status.replace("_", " ")}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
