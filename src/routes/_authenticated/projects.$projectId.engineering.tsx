// P-052 — Engineering module layout with subnav.
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

import { cn } from "@/lib/utils";

const SUB_TABS = [
  { to: "" as const, label: "Overview" },
  { to: "drawings" as const, label: "Drawings" },
  { to: "reviews" as const, label: "Reviews" },
  { to: "rfis" as const, label: "RFIs" },
  { to: "ifc-release" as const, label: "IFC release" },
  { to: "sld" as const, label: "SLD" },
  { to: "studies" as const, label: "Studies" },
  { to: "grid-code" as const, label: "Grid code" },
  { to: "pv-site" as const, label: "Site config" },
  { to: "pv-layout" as const, label: "PV layout" },
  { to: "yield" as const, label: "Yield" },
  { to: "terrain" as const, label: "Terrain" },
  { to: "civil-features" as const, label: "Civil features" },
  { to: "layout-optimization" as const, label: "Optimization" },

  { to: "bom" as const, label: "BOM" },
  { to: "uploads" as const, label: "Site data uploads" },
];

export const Route = createFileRoute("/_authenticated/projects/$projectId/engineering")({
  component: EngineeringLayout,
});

function EngineeringLayout() {
  const { projectId } = Route.useParams();
  return (
    <div className="flex flex-col gap-4">
      <nav
        aria-label="Engineering sections"
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {SUB_TABS.map((t) => (
          <SubTabLink key={t.to || "index"} to={t.to} label={t.label} projectId={projectId} />
        ))}
      </nav>
      <Outlet />
    </div>
  );
}

function SubTabLink({
  to,
  label,
  projectId,
}: {
  to:
    | ""
    | "uploads"
    | "drawings"
    | "reviews"
    | "rfis"
    | "ifc-release"
    | "sld"
    | "studies"
    | "grid-code"
    | "pv-site"
    | "pv-layout"
    | "yield"
    | "terrain"
    | "civil-features"
    | "layout-optimization"
    | "bom";

  label: string;
  projectId: string;
}) {
  const target = to ? `/projects/$projectId/engineering/${to}` : `/projects/$projectId/engineering`;
  return (
    <Link
      to={target as any}
      params={{ projectId } as any}
      activeOptions={{ exact: to === "" }}
      className={cn(
        "-mb-px inline-flex items-center border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
      )}
      activeProps={{ className: "border-primary text-foreground" }}
    >
      {label}
    </Link>
  );
}
