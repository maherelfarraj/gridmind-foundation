// P-082 — Project Finance layout with 4 sub-tabs.
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

import { SectionHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

const SUB_TABS = [
  { to: "ppa" as const, label: "PPA" },
  { to: "lcoe" as const, label: "LCOE" },
  { to: "dd" as const, label: "Lender DD" },
  { to: "facilities" as const, label: "Facilities" },
];

export const Route = createFileRoute("/_authenticated/projects/$projectId/finance/project-finance")(
  {
    head: () => ({
      meta: [
        { title: "Project finance — GridMind EPC" },
        {
          name: "description",
          content:
            "PPA terms, LCOE scenarios, lender due diligence, and bank facilities for the project.",
        },
        { property: "og:title", content: "Project finance — GridMind EPC" },
        {
          property: "og:description",
          content: "Project-finance workspace: PPA, LCOE, lender DD and bank facilities.",
        },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
    }),
    component: ProjectFinanceLayout,
  },
);

function ProjectFinanceLayout() {
  const { projectId } = Route.useParams();
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Project finance"
        description="PPA, LCOE, lender due diligence, and bank facilities."
      />
      <nav
        aria-label="Project finance sections"
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {SUB_TABS.map((t) => (
          <Link
            key={t.to}
            to={`/projects/$projectId/finance/project-finance/${t.to}` as any}
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
