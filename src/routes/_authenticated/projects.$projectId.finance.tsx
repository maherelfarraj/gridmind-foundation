// P-075 — Finance layout with sub-tabs.
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

import { cn } from "@/lib/utils";

const SUB_TABS = [
  { to: "budget" as const, label: "Budget" },
  { to: "evm" as const, label: "EVM" },
  { to: "cash-flow" as const, label: "Cash flow" },
];

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/finance",
)({
  component: FinanceLayout,
});

function FinanceLayout() {
  const { projectId } = Route.useParams();
  return (
    <div className="flex flex-col gap-4">
      <nav
        aria-label="Finance sections"
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {SUB_TABS.map((t) => (
          <Link
            key={t.to}
            to={`/projects/$projectId/finance/${t.to}` as any}
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
