// P-036 — Placeholder project detail. Real cockpit lands in P-037.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getProjectSummary } from "@/lib/projects.functions";

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  head: () => ({
    meta: [
      { title: "Project — GridMind EPC" },
      {
        name: "description",
        content: "Project cockpit for a GridMind EPC project.",
      },
      { property: "og:title", content: "Project — GridMind EPC" },
      {
        property: "og:description",
        content: "Project cockpit for a GridMind EPC project.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProjectDetailPage,
});

function ProjectDetailPage() {
  const { projectId } = Route.useParams();
  const getSummary = useServerFn(getProjectSummary);
  const query = useQuery({
    queryKey: ["project-summary", projectId],
    queryFn: () => getSummary({ data: { id: projectId } }),
    retry: false,
  });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Project
        </p>
        {query.isPending ? (
          <Skeleton className="h-8 w-72" />
        ) : query.isError || !query.data ? (
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Project not found
          </h1>
        ) : (
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            {query.data.name}
          </h1>
        )}
      </header>

      <Card className="flex flex-col gap-4 border-border bg-card p-6">
        {query.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : query.isError ? (
          <p className="text-sm text-destructive">
            {query.error instanceof Error ? query.error.message : "Error"}
          </p>
        ) : !query.data ? (
          <p className="text-sm text-muted-foreground">
            This project doesn&rsquo;t exist or you don&rsquo;t have access.
          </p>
        ) : (
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Code</dt>
              <dd className="font-mono text-foreground">{query.data.code}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Archetype</dt>
              <dd className="text-foreground">{query.data.archetype}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Phase</dt>
              <dd className="text-foreground">{query.data.phase}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd className="text-foreground">{query.data.status}</dd>
            </div>
          </dl>
        )}
        <p className="text-xs text-muted-foreground">
          The full project cockpit ships in P-037.
        </p>
        <div>
          <Button asChild variant="outline">
            <Link to="/">
              <ArrowLeft size={16} aria-hidden />
              Back to dashboard
            </Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
