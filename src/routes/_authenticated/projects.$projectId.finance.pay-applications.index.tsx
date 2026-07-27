// P-079 — Pay applications list.
import { useMemo, useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Inbox, Plus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { createPayApplication } from "@/lib/pay-app.functions";
import {
  payAppAccessQueryOptions,
  payAppContractsPickerQueryOptions,
  payAppErrorMessage,
  payAppListQueryOptions,
} from "@/lib/pay-app.query";
import { toPayAppCsv } from "@/lib/pay-app.csv";
import { payAppStatusLabel, type PayAppStatus } from "@/lib/pay-app.rules";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/finance/pay-applications/",
)({
  head: () => ({
    meta: [
      { title: "Pay applications — GridMind EPC" },
      {
        name: "description",
        content:
          "Draft, certify, and approve interim payment applications against signed contracts.",
      },
      { property: "og:title", content: "Pay applications — GridMind EPC" },
      {
        property: "og:description",
        content: "Certified progress money flow with SOV reconciliation and audit trail.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: async ({ params, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(payAppListQueryOptions(params.projectId)),
      context.queryClient.ensureQueryData(payAppAccessQueryOptions()),
    ]);
  },
  errorComponent: ({ error }) => (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
      {payAppErrorMessage(error)}
    </div>
  ),
  notFoundComponent: () => <div className="p-4 text-sm">Project not found.</div>,
  component: PayAppsPage,
});

const STATUS_VARIANTS: Record<PayAppStatus, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  submitted: "secondary",
  certified: "secondary",
  approved: "default",
  rejected: "destructive",
  invoiced: "default",
};

function formatCurrency(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function PayAppsPage() {
  const { projectId } = Route.useParams();
  const list = useSuspenseQuery(payAppListQueryOptions(projectId));
  const access = useSuspenseQuery(payAppAccessQueryOptions());
  const [dialogOpen, setDialogOpen] = useState(false);

  const rows = list.data.rows;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Pay applications"
        description="Certified progress against signed contracts."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const csv = toPayAppCsv(rows);
                const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `pay-applications-${projectId}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              disabled={rows.length === 0}
            >
              <Download className="mr-2 size-4" /> Export CSV
            </Button>
            {access.data.canCertify ? (
              <Button size="sm" onClick={() => setDialogOpen(true)}>
                <Plus className="mr-2 size-4" /> New pay app
              </Button>
            ) : null}
          </div>
        }
      />

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No pay applications yet"
            description="Create one against a signed contract to get started."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Certified</TableHead>
                <TableHead className="text-right">Retention</TableHead>
                <TableHead className="text-right">Net due</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">#{r.application_number}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.period_start} → {r.period_end}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[r.status]}>{payAppStatusLabel(r.status)}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(r.total_certified)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatCurrency(r.retention_amount)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatCurrency(r.net_amount)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="ghost">
                      <Link
                        to="/projects/$projectId/finance/pay-applications/$payAppId"
                        params={{ projectId, payAppId: r.id }}
                      >
                        Open
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {dialogOpen ? (
        <NewPayAppDialog projectId={projectId} onClose={() => setDialogOpen(false)} />
      ) : null}
    </div>
  );
}

function NewPayAppDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const create = useServerFn(createPayApplication);
  const contracts = useSuspenseQuery(payAppContractsPickerQueryOptions(projectId));

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const firstOfMonth = useMemo(() => {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }, []);

  const [contractId, setContractId] = useState<string>(contracts.data.rows[0]?.id ?? "");
  const [start, setStart] = useState(firstOfMonth);
  const [end, setEnd] = useState(today);
  const [retention, setRetention] = useState("5");

  const mut = useMutation({
    mutationFn: () =>
      create({
        data: {
          project_id: projectId,
          contract_id: contractId,
          period_start: start,
          period_end: end,
          retention_pct: Number(retention || 0),
        },
      }),
    onSuccess: async (row) => {
      toast.success(`Pay app #${row.application_number} created`);
      await qc.invalidateQueries({ queryKey: ["pay-applications", "list", projectId] });
      onClose();
      router.navigate({
        to: "/projects/$projectId/finance/pay-applications/$payAppId",
        params: { projectId, payAppId: row.id },
      });
    },
    onError: (err) => toast.error(payAppErrorMessage(err)),
  });

  const noContracts = contracts.data.rows.length === 0;

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New pay application</DialogTitle>
        </DialogHeader>
        {noContracts ? (
          <p className="text-sm text-muted-foreground">
            No signed or active contracts on this project. Sign a contract first.
          </p>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Contract</Label>
              <Select value={contractId} onValueChange={setContractId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {contracts.data.rows.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.contract_number} — {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Period start</Label>
                <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>Period end</Label>
                <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Retention %</Label>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={retention}
                onChange={(e) => setRetention(e.target.value)}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={noContracts || !contractId || mut.isPending}
          >
            {mut.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PayAppsFallback() {
  return <Skeleton className="h-64 w-full" />;
}
