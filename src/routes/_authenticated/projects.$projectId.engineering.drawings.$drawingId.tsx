// P-053 — Drawing detail page.
import { Suspense } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DrawingDetail,
  DrawingDetailSkeleton,
} from "@/components/engineering/drawing-detail";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/engineering/drawings/$drawingId",
)({
  head: () => ({
    meta: [
      { title: "Drawing — GridMind EPC" },
      {
        name: "description",
        content: "Drawing detail with revisions, markups, and sign-off history.",
      },
      { property: "og:title", content: "Drawing — GridMind EPC" },
      {
        property: "og:description",
        content: "Drawing detail with revisions, markups, and sign-off history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  pendingComponent: DrawingDetailSkeleton,
  errorComponent: DetailError,
  component: DetailPage,
});

function DetailPage() {
  const { projectId, drawingId } = Route.useParams();
  return (
    <Suspense fallback={<DrawingDetailSkeleton />}>
      <DrawingDetail drawingId={drawingId} projectId={projectId} />
    </Suspense>
  );
}

function DetailError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <Card className="flex flex-col items-start gap-3 border-destructive/40 p-6">
      <h2 className="font-display text-lg font-semibold text-foreground">
        Couldn&rsquo;t load drawing
      </h2>
      <p className="text-sm text-muted-foreground">
        {error instanceof Error ? error.message : "Unexpected error."}
      </p>
      <Button
        onClick={() => {
          router.invalidate();
          reset();
        }}
      >
        <RefreshCw size={14} aria-hidden />
        Retry
      </Button>
    </Card>
  );
}
