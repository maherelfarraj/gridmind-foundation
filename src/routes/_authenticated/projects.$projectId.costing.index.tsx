// GC-01 — Costing overview: KPI roll-up + drill-down links into the cost stack.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Calculator } from "lucide-react";

import { CostingKpis } from "@/components/costing/costing-kpis";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
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
  const { projectId } = Route.useParams();
  const { data } = useSuspenseQuery(costingWorkspaceQueryOptions(projectId));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        as="h2"
        title="Cost position"
        description="Live roll-up of budget, commitments, actuals, accruals and forecast for this project."
      />

      {data.rollups.length === 0 ? (
        <EmptyState
          icon={Calculator}
          title="No cost data yet"
          description="Add cost codes and budgets to start tracking the project cost position."
          action={
            <Link
              to="/projects/$projectId/finance/budget"
              params={{ projectId }}
              className="text-sm font-medium text-primary hover:underline"
            >
              Go to budget
            </Link>
          }
        />
      ) : (
        data.rollups.map((r) => <CostingKpis key={r.currency_code} rollup={r} />)
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <DrillCard
          title="Commitments"
          value={data.commitments.length}
          hint="Purchase orders, subcontracts and change orders"
          to="/projects/$projectId/costing/commitments"
          projectId={projectId}
        />
        <DrillCard
          title="Contracts"
          value={data.contracts.length}
          hint={
            data.contracts.length > 0
              ? formatCostingMoney(
                  data.contracts.reduce((a, c) => a + c.value, 0),
                  data.contracts[0].currency_code,
                )
              : "No contracts"
          }
          to="/projects/$projectId/costing/contracts"
          projectId={projectId}
        />
        <DrillCard
          title="Invoices & payments"
          value={data.invoices.length}
          hint={`${data.payments.length} payments recorded`}
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
