// P-052 — Site data uploads route.
import { Suspense } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/page-header";
import {
  SiteDataUploads,
  SiteDataUploadsSkeleton,
} from "@/components/engineering/site-data-uploads";
import { listSiteData } from "@/lib/site-data.functions";
import { siteDataListQueryOptions } from "@/lib/site-data-query";

export const Route = createFileRoute("/_authenticated/projects/$projectId/engineering/uploads")({
  head: () => ({
    meta: [
      { title: "Site data uploads — GridMind EPC" },
      {
        name: "description",
        content: "Upload survey, geotech and meteorological site data for engineering review.",
      },
      { property: "og:title", content: "Site data uploads — GridMind EPC" },
      {
        property: "og:description",
        content: "Upload survey, geotech and meteorological site data for engineering review.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  pendingComponent: SiteDataUploadsSkeleton,
  errorComponent: UploadsError,
  component: UploadsPage,
});

function UploadsPage() {
  const { projectId } = Route.useParams();
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Site data uploads"
        description="Upload survey, geotech and meteorological data. Files land in the drawings bucket with 15-minute signed downloads."
      />
      <UploadsBoundary projectId={projectId} />
    </div>
  );
}

function UploadsBoundary({ projectId }: { projectId: string }) {
  return (
    <Suspense fallback={<SiteDataUploadsSkeleton />}>
      <UploadsContent projectId={projectId} />
    </Suspense>
  );
}

function UploadsContent({ projectId }: { projectId: string }) {
  // Warm the query so downstream Suspense reads succeed on mount.
  const fn = useServerFn(listSiteData);
  // ensureQueryData isn't available here; useSuspenseQuery inside SiteDataUploads
  // will trigger the fetch via the same queryKey.
  void fn;
  void siteDataListQueryOptions;
  return <SiteDataUploads projectId={projectId} />;
}

function UploadsError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <Card className="flex flex-col items-start gap-3 border-destructive/40 p-6">
      <h2 className="font-display text-lg font-semibold text-foreground">
        Couldn&rsquo;t load site data
      </h2>
      <p className="text-sm text-muted-foreground">
        {error instanceof Error ? error.message : "Unexpected error."}
      </p>
      <div className="flex gap-2">
        <Button
          onClick={() => {
            router.invalidate();
            reset();
          }}
        >
          <RefreshCw size={14} aria-hidden />
          Retry
        </Button>
        <Button asChild variant="outline">
          <Link to="..">Back</Link>
        </Button>
      </div>
    </Card>
  );
}
