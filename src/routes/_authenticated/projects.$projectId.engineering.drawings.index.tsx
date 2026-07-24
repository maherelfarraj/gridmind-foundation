// P-053 — Drawing register index page.
import { Suspense } from "react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { z } from "zod";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DrawingRegisterTable,
  DrawingRegisterTableSkeleton,
} from "@/components/engineering/drawing-register-table";
import {
  DRAWING_DISCIPLINES,
  DRAWING_STATUSES,
  getMyDrawingRoles,
  listDrawings,
} from "@/lib/drawings.functions";
import {
  drawingRolesQueryOptions,
  drawingsListQueryOptions,
} from "@/lib/drawings-query";

const searchSchema = z.object({
  q: z.string().optional(),
  discipline: z.enum(DRAWING_DISCIPLINES).optional(),
  status: z.enum(DRAWING_STATUSES).optional(),
  page: z.number().int().min(1).optional(),
});

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/engineering/drawings/",
)({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Drawing register — GridMind EPC" },
      {
        name: "description",
        content:
          "Engineering drawing register with revision timeline, IFC governance, and markup viewer.",
      },
      { property: "og:title", content: "Drawing register — GridMind EPC" },
      {
        property: "og:description",
        content:
          "Engineering drawing register with revision timeline, IFC governance, and markup viewer.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  pendingComponent: DrawingRegisterTableSkeleton,
  errorComponent: RegisterError,
  component: RegisterPage,
});

function RegisterPage() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="font-display text-lg font-semibold text-foreground">
          Drawing register
        </h2>
        <p className="text-sm text-muted-foreground">
          Track drawings, revisions, and IFC governance. IFC promotion requires an
          approved engineering sign-off.
        </p>
      </header>
      <Suspense fallback={<DrawingRegisterTableSkeleton />}>
        <DrawingRegisterTable
          projectId={projectId}
          filters={search}
          onFilterChange={(next) =>
            navigate({ search: (prev) => ({ ...prev, ...next }) as any })
          }
        />
      </Suspense>
    </div>
  );
}

function RegisterError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <Card className="flex flex-col items-start gap-3 border-destructive/40 p-6">
      <h2 className="font-display text-lg font-semibold text-foreground">
        Couldn&rsquo;t load drawings
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
