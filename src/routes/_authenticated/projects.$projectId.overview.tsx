// P-038 — Overview tab: key facts + team avatars.
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";

import { Card } from "@/components/ui/card";
import { projectDetailQueryOptions } from "@/lib/projects-detail-query";

export const Route = createFileRoute("/_authenticated/projects/$projectId/overview")({
  component: OverviewTab,
});

function OverviewTab() {
  const { projectId } = Route.useParams();
  const { data: project } = useSuspenseQuery(projectDetailQueryOptions(projectId));

  if (!project) return null;

  const capacity =
    project.capacity_mw != null
      ? `${project.capacity_mw} MW${
          project.capacity_mwh != null ? ` · ${project.capacity_mwh} MWh` : ""
        }`
      : "—";
  const site = [project.site_name, project.site_region, project.site_country]
    .filter(Boolean)
    .join(", ");
  const cod = project.target_cod ? format(parseISO(project.target_cod), "PP") : "—";

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card className="border-border bg-card p-5">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Key facts
        </h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <Fact label="Capacity" value={capacity} />
          <Fact label="Target COD" value={cod} />
          <Fact label="Site" value={site || "—"} className="col-span-2" />
          <Fact label="Offtaker" value={project.offtaker || "—"} />
          <Fact label="Status" value={<span className="capitalize">{project.status}</span>} />
        </dl>
        {project.description && (
          <p className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">
            {project.description}
          </p>
        )}
      </Card>

      <Card className="border-border bg-card p-5">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Team
        </h2>
        {project.members.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No members assigned yet.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {project.members.map((m) => {
              const label = m.full_name ?? m.email ?? m.user_id.slice(0, 8);
              const initials = getInitials(m.full_name, m.email);
              const isAdmin = m.user_id === project.project_admin_id;
              return (
                <li key={m.id} className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground">
                    {initials}
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">{label}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {m.project_role.replace(/_/g, " ")}
                      {isAdmin ? " · Project admin" : ""}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Fact({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm text-foreground">{value}</dd>
    </div>
  );
}

function getInitials(name: string | null, email: string | null): string {
  const src = name?.trim() || email?.split("@")[0] || "?";
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}
