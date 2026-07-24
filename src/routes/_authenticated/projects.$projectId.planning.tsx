// P-072 — Planning layout: sub-nav + <Outlet />.
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

import { cn } from "@/lib/utils";

const SUB_TABS = [{ to: "wbs" as const, label: "WBS" }];

export const Route = createFileRoute("/_authenticated/projects/$projectId/planning")({
  component: PlanningLayout,
});

function PlanningLayout() {
  const { projectId } = Route.useParams();
  return (
    <div className="flex flex-col gap-4">
      <nav
        aria-label="Planning sections"
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {SUB_TABS.map((t) => (
          <Link
            key={t.to}
            to={`/projects/$projectId/planning/${t.to}` as any}
            params={{ projectId } as any}
            className={cn(
              "-mb-px inline-flex items-center border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
            )}
            activeProps={{ className: "border-primary text-foreground" }}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
