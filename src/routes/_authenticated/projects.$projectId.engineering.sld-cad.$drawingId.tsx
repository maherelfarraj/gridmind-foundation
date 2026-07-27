// P-138 — SLD CAD canvas workspace route.
import { Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";

import { SldCadWorkspaceView } from "@/components/engineering/sld-cad/workspace";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useSldCadWorkspace } from "@/lib/sld-cad-query";
import { UnderChangeControlBanner } from "@/components/moc/under-change-control-banner";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/engineering/sld-cad/$drawingId",
)({
  head: () => ({
    meta: [
      { title: "SLD CAD workspace — GridMind EPC" },
      {
        name: "description",
        content:
          "Design single-line diagrams on a snap-to-grid CAD canvas with layers and revisions.",
      },
      { property: "og:title", content: "SLD CAD workspace — GridMind EPC" },
      {
        property: "og:description",
        content:
          "Design single-line diagrams on a snap-to-grid CAD canvas with layers and revisions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SldCadPage,
  errorComponent: ({ error, reset }) => (
    <Card>
      <CardContent className="space-y-3 py-8">
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to load the SLD canvas."}
        </p>
        <Button variant="outline" onClick={reset}>
          Retry
        </Button>
      </CardContent>
    </Card>
  ),
});

function SldCadPage() {
  return (
    <Suspense fallback={<CanvasSkeleton />}>
      <Workspace />
    </Suspense>
  );
}

function Workspace() {
  const { drawingId } = Route.useParams();
  const { data } = useSuspenseQuery(useSldCadWorkspace(drawingId));
  return (
    <div className="space-y-3">
      <UnderChangeControlBanner entityType="sld_drawing" entityId={drawingId} />
      <SldCadWorkspaceView data={data} />
    </div>
  );
}

function CanvasSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-9 w-full" />
      <div className="grid gap-3 lg:grid-cols-[190px_minmax(0,1fr)_240px]">
        <Skeleton className="hidden h-[70vh] lg:block" />
        <Skeleton className="h-[70vh]" />
        <Skeleton className="hidden h-[70vh] lg:block" />
      </div>
    </div>
  );
}
