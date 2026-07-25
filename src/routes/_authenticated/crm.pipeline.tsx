// P-042 — CRM pipeline route.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Plus } from "lucide-react";
import { z } from "zod";

import { CrmKpiStrip } from "@/components/crm/CrmKpiStrip";
import { CrmListView } from "@/components/crm/CrmListView";
import { CrmPipelineBoard } from "@/components/crm/CrmPipelineBoard";
import { LeadsTab } from "@/components/crm/LeadsTab";
import { NewOpportunityDialog } from "@/components/crm/NewOpportunityDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { crmKpisQueryOptions, opportunitiesQueryOptions } from "@/lib/crm-query";
import { getCrmKpis, listOpportunities } from "@/lib/crm.functions";
import { getCurrentUserRoles } from "@/lib/user-roles.functions";

const TABS = ["board", "list", "leads"] as const;
const searchSchema = z.object({
  tab: z.enum(TABS).catch("board").default("board"),
});

export const Route = createFileRoute("/_authenticated/crm/pipeline")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Pipeline — GridMind CRM" },
      {
        name: "description",
        content: "Kanban pipeline, list view, and lead conversion for your EPC sales team.",
      },
      { property: "og:title", content: "Pipeline — GridMind CRM" },
      {
        property: "og:description",
        content: "Drag opportunities across stages, track KPIs, and convert leads.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CrmPipelinePage,
});

function CrmPipelinePage() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const rolesFn = useServerFn(getCurrentUserRoles);
  const rolesQuery = useQuery({
    queryKey: ["me", "roles"],
    queryFn: () => rolesFn(),
    staleTime: 60_000,
  });
  const roles = new Set((rolesQuery.data ?? []).map((r) => r.role));
  const canWrite = roles.has("sales") || roles.has("company_admin") || roles.has("super_admin");
  const readOnly = !canWrite;

  const listFn = useServerFn(listOpportunities);
  const kpisFn = useServerFn(getCrmKpis);
  const oppsQuery = useQuery(opportunitiesQueryOptions(listFn));
  const kpisQuery = useQuery(crmKpisQueryOptions(kpisFn));

  const opportunities = oppsQuery.data ?? [];

  return (
    <div className="page-shell">
      <PageHeader
        title="CRM pipeline"
        description="Track opportunities, leads, and win-rate across your EPC portfolio."
        actions={
          !readOnly && (
            <NewOpportunityDialog
              trigger={
                <Button>
                  <Plus size={16} aria-hidden />
                  New opportunity
                </Button>
              }
            />
          )
        }
      />

      <CrmKpiStrip data={kpisQuery.data} isLoading={kpisQuery.isLoading} />

      <Tabs
        value={tab}
        onValueChange={(v) =>
          navigate({ search: { tab: v as (typeof TABS)[number] }, replace: true })
        }
      >
        <TabsList>
          <TabsTrigger value="board">Board</TabsTrigger>
          <TabsTrigger value="list">List</TabsTrigger>
          <TabsTrigger value="leads">Leads</TabsTrigger>
        </TabsList>
      </Tabs>

      {oppsQuery.isError && tab !== "leads" ? (
        <Card className="flex flex-col items-start gap-3 border-destructive/40 bg-destructive/10 p-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle size={18} aria-hidden />
            <span className="text-sm font-medium">Couldn't load opportunities</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {oppsQuery.error instanceof Error ? oppsQuery.error.message : "Unknown error"}
          </p>
          <Button size="sm" variant="outline" onClick={() => oppsQuery.refetch()}>
            Retry
          </Button>
        </Card>
      ) : tab === "leads" ? (
        <LeadsTab readOnly={readOnly} />
      ) : oppsQuery.isLoading ? (
        <BoardSkeleton />
      ) : opportunities.length === 0 && tab === "board" ? (
        <EmptyState
          icon={Plus}
          title="No opportunities yet"
          description="Create your first one to start tracking your pipeline."
          action={
            !readOnly && (
              <NewOpportunityDialog
                trigger={
                  <Button size="sm">
                    <Plus size={16} aria-hidden />
                    New opportunity
                  </Button>
                }
              />
            )
          }
        />
      ) : tab === "board" ? (
        <CrmPipelineBoard opportunities={opportunities} readOnly={readOnly} />
      ) : (
        <CrmListView opportunities={opportunities} />
      )}
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex min-w-[240px] flex-1 flex-col gap-2 rounded-lg border border-border bg-muted/30 p-2"
        >
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ))}
    </div>
  );
}
