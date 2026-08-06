// GC-01 — Project contracts register feeding committed cost.
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { FileSignature } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { costingWorkspaceQueryOptions } from "@/lib/costing.query";
import { formatCostingMoney } from "@/lib/costing.rules";

export const Route = createFileRoute("/_authenticated/projects/$projectId/costing/contracts")({
  head: () => ({
    meta: [
      { title: "Contracts — GridMind EPC" },
      { name: "description", content: "Head contracts and subcontracts committing project cost." },
    ],
  }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(costingWorkspaceQueryOptions(params.projectId)),
  pendingComponent: () => <Skeleton className="h-64 w-full" />,
  component: ContractsView,
});

function ContractsView() {
  const { projectId } = Route.useParams();
  const { data } = useSuspenseQuery(costingWorkspaceQueryOptions(projectId));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        as="h2"
        title="Contracts"
        description="Head contracts and subcontracts recognised in the project cost position."
      />
      {data.contracts.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title="No contracts"
          description="Contracts and subcontracts linked to this project will appear here."
        />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Counterparty</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.contracts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.contract_number}</TableCell>
                  <TableCell>{c.title}</TableCell>
                  <TableCell className="text-muted-foreground">{c.counterparty}</TableCell>
                  <TableCell className="text-muted-foreground">{c.contract_type}</TableCell>
                  <TableCell>
                    <StatusBadge status={c.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCostingMoney(c.value, c.currency_code)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
