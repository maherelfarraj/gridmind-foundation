// GC-01 — Commitments register (POs, subcontracts, approved change orders).
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Receipt } from "lucide-react";

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
import { formatCostingMoney, isCommittedCommitment } from "@/lib/costing.rules";

const KIND_LABEL = {
  purchase_order: "Purchase order",
  subcontract: "Subcontract",
  change_order: "Change order",
} as const;

export const Route = createFileRoute("/_authenticated/projects/$projectId/costing/commitments")({
  head: () => ({
    meta: [
      { title: "Commitments — GridMind EPC" },
      {
        name: "description",
        content: "Approved purchase orders, subcontracts and change orders committing project cost.",
      },
    ],
  }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(costingWorkspaceQueryOptions(params.projectId)),
  pendingComponent: () => <Skeleton className="h-64 w-full" />,
  component: CommitmentsView,
});

function CommitmentsView() {
  const { projectId } = Route.useParams();
  const { data } = useSuspenseQuery(costingWorkspaceQueryOptions(projectId));
  const rows = data.commitments;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        as="h2"
        title="Commitments"
        description="Committed cost = approved POs + active subcontracts + approved change orders, less cancellations."
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No commitments"
          description="Issued purchase orders, subcontracts and approved change orders appear here."
        />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Counterparty</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Counts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const counts = isCommittedCommitment(r);
                return (
                  <TableRow key={`${r.kind}-${r.id}`}>
                    <TableCell className="font-medium">{r.reference}</TableCell>
                    <TableCell className="text-muted-foreground">{KIND_LABEL[r.kind]}</TableCell>
                    <TableCell className="text-muted-foreground">{r.counterparty ?? "—"}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCostingMoney(r.amount, r.currency_code)}
                    </TableCell>
                    <TableCell className="text-right">
                      <StatusBadge
                        status={counts ? "committed" : "excluded"}
                        tone={counts ? "positive" : "inactive"}
                        label={counts ? "Committed" : "Excluded"}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
