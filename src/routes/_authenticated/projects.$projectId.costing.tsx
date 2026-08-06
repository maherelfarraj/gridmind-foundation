// GC-01 — Costing workspace layout: unified sub-navigation across the cost stack.
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

import { cn } from "@/lib/utils";

interface Tab {
  label: string;
  /** Path suffix relative to /projects/$projectId */
  to: string;
  exact?: boolean;
}

const TABS: Tab[] = [
  { label: "Overview", to: "/costing", exact: true },
  { label: "Budget", to: "/finance/budget" },
  { label: "Commitments", to: "/costing/commitments" },
  { label: "Contracts", to: "/costing/contracts" },
  { label: "Change orders", to: "/finance/change-orders" },
  { label: "Invoices & payments", to: "/costing/invoices" },
  { label: "Forecast", to: "/costing/forecast" },
];

export const Route = createFileRoute("/_authenticated/projects/$projectId/costing")({
  component: CostingLayout,
});

function CostingLayout() {
  const { projectId } = Route.useParams();
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Costing sections" className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.to}
            to={`/projects/$projectId${t.to}` as any}
            params={{ projectId } as any}
            activeOptions={{ exact: t.exact ?? false }}
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
