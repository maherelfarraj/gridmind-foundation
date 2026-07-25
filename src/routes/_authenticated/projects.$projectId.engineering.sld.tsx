// P-054 — SLD workspace route.
import { Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SldGallery } from "@/components/engineering/sld-gallery";
import { SldConfigForm } from "@/components/engineering/sld-config-form";
import { getMySldRoles, getSldConfig } from "@/lib/sld.functions";
import { sldConfigQueryOptions, sldRolesQueryOptions } from "@/lib/sld-query";

export const Route = createFileRoute("/_authenticated/projects/$projectId/engineering/sld")({
  head: () => ({
    meta: [
      { title: "SLD — GridMind EPC" },
      {
        name: "description",
        content: "Single-line diagram gallery and electrical configuration for the project.",
      },
      { property: "og:title", content: "SLD — GridMind EPC" },
      {
        property: "og:description",
        content: "Single-line diagram gallery and electrical configuration for the project.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SldPage,
  errorComponent: ({ error }) => (
    <Card>
      <CardContent className="py-8 text-sm text-destructive">
        {error instanceof Error ? error.message : "Failed to load SLD."}
      </CardContent>
    </Card>
  ),
});

function SldPage() {
  const { projectId } = Route.useParams();
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Single-line diagrams"
        description="Gallery of SLDs and electrical configuration for the project."
      />
      <Tabs defaultValue="gallery" className="space-y-4">
        <TabsList>
          <TabsTrigger value="gallery">Gallery</TabsTrigger>
          <TabsTrigger value="configuration">Configuration</TabsTrigger>
        </TabsList>
        <TabsContent value="gallery">
          <Suspense fallback={<GallerySkeleton />}>
            <GalleryTab projectId={projectId} />
          </Suspense>
        </TabsContent>
        <TabsContent value="configuration">
          <Suspense fallback={<ConfigSkeleton />}>
            <ConfigTab projectId={projectId} />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function GalleryTab({ projectId }: { projectId: string }) {
  const rolesFn = useServerFn(getMySldRoles);
  const { data: roles } = useSuspenseQuery(sldRolesQueryOptions(rolesFn, projectId));
  return <SldGallery projectId={projectId} canWrite={roles.canWrite} />;
}

function ConfigTab({ projectId }: { projectId: string }) {
  const cfgFn = useServerFn(getSldConfig);
  const rolesFn = useServerFn(getMySldRoles);
  const { data: cfg } = useSuspenseQuery(sldConfigQueryOptions(cfgFn, projectId));
  const { data: roles } = useSuspenseQuery(sldRolesQueryOptions(rolesFn, projectId));
  return <SldConfigForm projectId={projectId} initial={cfg} canWrite={roles.canWrite} />;
}

function GallerySkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-56 animate-pulse rounded-md border border-border bg-muted/40" />
      ))}
    </div>
  );
}

function ConfigSkeleton() {
  return <div className="h-80 animate-pulse rounded-md border border-border bg-muted/40" />;
}
