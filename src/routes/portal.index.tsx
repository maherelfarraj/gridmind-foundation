// P-114 — Portal index: project picker.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";
import { Building2, ChevronRight, Loader2, ShieldAlert } from "lucide-react";

import { listMyPortalMemberships } from "@/lib/portal.functions";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const Route = createFileRoute("/portal/")({
  head: () => ({
    meta: [
      { title: "Your projects — GridMind Portal" },
      {
        name: "description",
        content: "Pick a project to view its curated portal.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PortalIndex,
});

function PortalIndex() {
  const listFn = useServerFn(listMyPortalMemberships);
  const q = useQuery({
    queryKey: ["portal", "memberships"],
    queryFn: () => listFn(),
  });

  return (
    <div className="page-shell max-w-4xl">
      <PageHeader title="Your projects" description="Choose a project to open its portal." />

      {q.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : q.error ? (
        <ExpiredCard />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Nothing shared yet"
          description="Your project team hasn't shared any projects with you."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(q.data ?? []).map((m) => (
            <li key={m.id}>
              <Link
                to="/portal/projects/$projectId"
                params={{ projectId: m.project_id }}
                className="flex items-center justify-between rounded-lg border border-border bg-card p-4 transition hover:border-primary/50"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-foreground">
                    {m.project_code
                      ? `${m.project_code} · ${m.project_name ?? "—"}`
                      : (m.project_name ?? "Project")}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {m.company_name ?? "—"} · {m.role.replace("_", " ")}
                  </div>
                  {m.last_seen_at ? (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Last opened{" "}
                      {formatDistanceToNow(new Date(m.last_seen_at), {
                        addSuffix: true,
                      })}
                    </div>
                  ) : null}
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExpiredCard() {
  return (
    <EmptyState
      icon={ShieldAlert}
      title="Access expired or revoked"
      description="Contact your project sponsor to request access again."
    />
  );
}
