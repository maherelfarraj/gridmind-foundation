// GC-01/GC-02 — Costing overview: KPI roll-up, CBS drill-down, source drawer.
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Calculator } from "lucide-react";

import { CostingKpis } from "@/components/costing/costing-kpis";
import { CbsTable, type CbsMetricKey } from "@/components/costing/cbs-table";
import { CostCodeDrawer } from "@/components/costing/cost-code-drawer";
import type { CbsRow } from "@/lib/costing.cbs";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n/locale-provider";
import { costingWorkspaceQueryOptions } from "@/lib/costing.query";
import { formatCostingMoney } from "@/lib/costing.rules";

export const Route = createFileRoute("/_authenticated/projects/$projectId/costing/")({
  head: () => ({
    meta: [
      { title: "Project costing — GridMind EPC" },
      {
        name: "description",
        content: "Live budget, commitment, actual and forecast cost position for the project.",
      },
      { property: "og:title", content: "Project costing — GridMind EPC" },
      {
        property: "og:description",
        content: "Live budget, commitment, actual and forecast cost position for the project.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(costingWorkspaceQueryOptions(params.projectId)),
  pendingComponent: () => <Skeleton className="h-72 w-full" />,
  component: CostingOverview,
});

function CostingOverview() {
  const { t } = useI18n();
  const { projectId } = Route.useParams();
  const { data } = useSuspenseQuery(costingWorkspaceQueryOptions(projectId));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        as="h2"
        title={t("financeMod.costing.overview.title")}
        description={t("financeMod.costing.overview.description")}
      />

      {data.rollups.length === 0 ? (
        <EmptyState
          icon={Calculator}
          title={t("financeMod.costing.overview.emptyTitle")}
          description={t("financeMod.costing.overview.emptyBody")}
          action={
            <Link
              to="/projects/$projectId/finance/budget"
              params={{ projectId }}
              className="text-sm font-medium text-primary hover:underline"
            >
              {t("financeMod.costing.overview.goToBudget")}
            </Link>
          }
        />
      ) : (
        data.rollups.map((r) => <CostingKpis key={r.currency_code} rollup={r} />)
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <DrillCard
          title={t("financeMod.costing.tabs.commitments")}
          value={data.commitments.length}
          hint={t("financeMod.costing.commitments.description")}
          to="/projects/$projectId/costing/commitments"
          projectId={projectId}
        />
        <DrillCard
          title={t("financeMod.costing.tabs.contracts")}
          value={data.contracts.length}
          hint={
            data.contracts.length > 0
              ? formatCostingMoney(
                  data.contracts.reduce((a, c) => a + c.value, 0),
                  data.contracts[0].currency_code,
                )
              : t("financeMod.costing.overview.noContracts")
          }
          to="/projects/$projectId/costing/contracts"
          projectId={projectId}
        />
        <DrillCard
          title={t("financeMod.costing.tabs.invoicesPayments")}
          value={data.invoices.length}
          hint={t("financeMod.costing.overview.paymentsRecorded", { count: data.payments.length })}
          to="/projects/$projectId/costing/invoices"
          projectId={projectId}
        />
      </div>
    </div>
  );
}

function DrillCard({
  title,
  value,
  hint,
  to,
  projectId,
}: {
  title: string;
  value: number;
  hint: string;
  to: string;
  projectId: string;
}) {
  return (
    <Link to={to as any} params={{ projectId } as any} className="block">
      <Card className="flex flex-col gap-1 p-4 transition-colors hover:border-primary/50">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
        <p className="font-display text-2xl font-semibold text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </Card>
    </Link>
  );
}
