// P-056 — Yield workspace route.
import { Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getMyYieldRoles, listYieldScenarios } from "@/lib/yield.functions";
import { yieldRolesQueryOptions, yieldScenariosQueryOptions } from "@/lib/yield-query";
import { YieldScenariosTable } from "@/components/engineering/yield-scenarios-table";
import { YieldComparison } from "@/components/engineering/yield-comparison";
import { YieldPvsystImport } from "@/components/engineering/yield-pvsyst-import";

export const Route = createFileRoute("/_authenticated/projects/$projectId/engineering/yield")({
  head: () => ({
    meta: [
      { title: "Yield scenarios — GridMind EPC" },
      {
        name: "description",
        content: "PVsyst and preliminary yield scenarios with side-by-side comparison.",
      },
      { property: "og:title", content: "Yield scenarios — GridMind EPC" },
      {
        property: "og:description",
        content: "PVsyst and preliminary yield scenarios with side-by-side comparison.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: YieldPage,
  errorComponent: ({ error }) => (
    <Card>
      <CardContent className="py-8 text-sm text-destructive">
        {error instanceof Error ? error.message : "Failed to load yield workspace."}
      </CardContent>
    </Card>
  ),
});

function YieldPage() {
  const { projectId } = Route.useParams();
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Yield scenarios"
        description="PVsyst and preliminary yield scenarios with side-by-side comparison."
      />
      <Tabs defaultValue="scenarios" className="space-y-4">
        <TabsList>
          <TabsTrigger value="scenarios">Scenarios</TabsTrigger>
          <TabsTrigger value="comparison">Comparison</TabsTrigger>
          <TabsTrigger value="pvsyst">PVsyst import</TabsTrigger>
        </TabsList>
        <TabsContent value="scenarios">
          <Suspense fallback={<TableSkeleton />}>
            <ScenariosTab projectId={projectId} />
          </Suspense>
        </TabsContent>
        <TabsContent value="comparison">
          <Suspense fallback={<TableSkeleton />}>
            <ComparisonTab projectId={projectId} />
          </Suspense>
        </TabsContent>
        <TabsContent value="pvsyst">
          <Suspense fallback={<TableSkeleton />}>
            <ImportTab projectId={projectId} />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ScenariosTab({ projectId }: { projectId: string }) {
  const listFn = useServerFn(listYieldScenarios);
  const rolesFn = useServerFn(getMyYieldRoles);
  const { data: scenarios } = useSuspenseQuery(yieldScenariosQueryOptions(listFn, projectId));
  const { data: roles } = useSuspenseQuery(yieldRolesQueryOptions(rolesFn, projectId));
  return (
    <YieldScenariosTable projectId={projectId} scenarios={scenarios} canWrite={roles.canWrite} />
  );
}

function ComparisonTab({ projectId }: { projectId: string }) {
  const listFn = useServerFn(listYieldScenarios);
  const { data: scenarios } = useSuspenseQuery(yieldScenariosQueryOptions(listFn, projectId));
  return <YieldComparison scenarios={scenarios} />;
}

function ImportTab({ projectId }: { projectId: string }) {
  const rolesFn = useServerFn(getMyYieldRoles);
  const { data: roles } = useSuspenseQuery(yieldRolesQueryOptions(rolesFn, projectId));
  return <YieldPvsystImport projectId={projectId} canWrite={roles.canWrite} />;
}

function TableSkeleton() {
  return <div className="h-64 animate-pulse rounded-md border border-border bg-muted/40" />;
}
