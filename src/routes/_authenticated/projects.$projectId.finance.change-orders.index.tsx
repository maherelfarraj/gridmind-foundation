// P-081 — Change orders list: KPI, filters, CSV, workflow entry.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Inbox, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

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
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { upsertChangeOrder } from "@/lib/change-orders.functions";
import {
  changeOrderErrorMessage,
  changeOrdersListQueryOptions,
  coPickersQueryOptions,
} from "@/lib/change-orders.query";
import {
  CHANGE_ORDER_STATUSES,
  exposureBucket,
  exposurePct,
  isBudgetImpactBalanced,
  sumBudgetImpact,
  type BudgetImpactLine,
  type ChangeOrderStatus,
} from "@/lib/change-orders.rules";

export const Route = createFileRoute("/_authenticated/projects/$projectId/finance/change-orders/")({
  head: () => ({
    meta: [
      { title: "Change orders — GridMind EPC" },
      {
        name: "description",
        content: "Contract change orders with scope, cost, schedule impact, and approval routing.",
      },
      { property: "og:title", content: "Change orders — GridMind EPC" },
      {
        property: "og:description",
        content: "Track scope changes and their contract and schedule impact.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: async ({ params, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(changeOrdersListQueryOptions(params.projectId)),
      context.queryClient.ensureQueryData(coPickersQueryOptions(params.projectId)),
    ]);
  },
  errorComponent: ({ error }) => (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
      {changeOrderErrorMessage(error)}
    </div>
  ),
  notFoundComponent: () => <div className="p-4 text-sm">Project not found.</div>,
  component: ChangeOrdersPage,
});

function money(n: number, code: string | null = "USD") {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: code || "USD",
    maximumFractionDigits: 2,
  });
}

const STATUS_TONE: Record<ChangeOrderStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-primary/10 text-primary border-primary/30",
  under_review: "bg-primary/10 text-primary border-primary/30",
  approved: "bg-success/10 text-success border-success/30",
  rejected: "bg-destructive/10 text-destructive border-destructive/30",
  incorporated: "bg-success/15 text-success border-success/40",
};

function StatusBadge({ status }: { status: ChangeOrderStatus }) {
  return (
    <Badge variant="outline" className={cn("capitalize", STATUS_TONE[status])}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

function ChangeOrdersPage() {
  const { projectId } = Route.useParams();
  const list = useSuspenseQuery(changeOrdersListQueryOptions(projectId));
  const pickers = useSuspenseQuery(coPickersQueryOptions(projectId));
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<ChangeOrderStatus | "all">("all");

  const rows = list.data.rows;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!term) return true;
      return r.co_number.toLowerCase().includes(term) || r.title.toLowerCase().includes(term);
    });
  }, [rows, q, statusFilter]);

  // Exposure KPI
  const contractTotal = pickers.data.contracts.reduce((s, c) => s + (c.value ?? 0), 0);
  const approvedExposure = rows
    .filter((r) => r.status === "approved" || r.status === "incorporated")
    .reduce((s, r) => s + r.amount, 0);
  const pct = exposurePct(approvedExposure, contractTotal);
  const bucket = exposureBucket(pct);
  const bucketTone =
    bucket === "danger"
      ? "border-destructive/40 bg-destructive/5 text-destructive"
      : bucket === "warn"
        ? "border-warning/40 bg-warning/10 text-warning"
        : "border-success/40 bg-success/10 text-success";

  const exportCsv = () => {
    const header = [
      "co_number",
      "title",
      "status",
      "amount",
      "currency",
      "schedule_impact_days",
      "created_at",
    ];
    const lines = [header.join(",")];
    for (const r of filtered) {
      lines.push(
        [
          r.co_number,
          JSON.stringify(r.title),
          r.status,
          r.amount,
          r.currency_code ?? "",
          r.schedule_impact_days,
          r.created_at,
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    a.href = url;
    a.download = `change-orders-${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Change orders"
        description="Log scope changes and their cost and schedule impact."
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-2 size-4" /> New change order
          </Button>
        }
      />

      <Card className={cn("p-4", bucketTone)}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-xs uppercase tracking-wide opacity-80">Approved CO exposure</div>
            <div className="text-2xl font-semibold tabular-nums">{pct.toFixed(1)}%</div>
          </div>
          <div className="text-sm tabular-nums opacity-90">
            {money(approvedExposure)} vs {money(contractTotal)} contract value
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search number or title"
            className="w-64 pl-8"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as ChangeOrderStatus | "all")}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {CHANGE_ORDER_STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="mr-2 size-4" /> CSV
        </Button>
      </div>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={rows.length === 0 ? "No change orders yet" : "No matching change orders"}
            description={
              rows.length === 0
                ? "Log a change order to track scope, cost, and schedule impact."
                : "Try adjusting your search or filters."
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Contract</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => {
                const c = pickers.data.contracts.find((x) => x.id === r.contract_id);
                return (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40">
                    <TableCell className="font-medium">
                      <Link
                        to="/projects/$projectId/finance/change-orders/$coId"
                        params={{ projectId, coId: r.id }}
                        className="hover:underline"
                      >
                        {r.co_number}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link
                        to="/projects/$projectId/finance/change-orders/$coId"
                        params={{ projectId, coId: r.id }}
                        className="hover:underline"
                      >
                        {r.title}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {c?.contract_number ?? "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(r.amount, r.currency_code ?? c?.currency_code ?? "USD")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.schedule_impact_days > 0 ? "+" : ""}
                      {r.schedule_impact_days}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(r.updated_at), { addSuffix: true })}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {open ? <NewCoDialog projectId={projectId} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// New CO dialog
// ---------------------------------------------------------------------------
function NewCoDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const pickers = useSuspenseQuery(coPickersQueryOptions(projectId));
  const upsert = useServerFn(upsertChangeOrder);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [contractId, setContractId] = useState<string>("");
  const [wbsItemId, setWbsItemId] = useState<string>("");
  const [amount, setAmount] = useState("0");
  const [days, setDays] = useState("0");
  const [sign, setSign] = useState<"add" | "credit">("add");
  const [impacts, setImpacts] = useState<Record<string, string>>({});

  const contract = pickers.data.contracts.find((c) => c.id === contractId) ?? null;
  const currency = contract?.currency_code ?? "USD";
  const signedAmount = (sign === "credit" ? -1 : 1) * Number(amount || 0);

  const impactLines: BudgetImpactLine[] = pickers.data.budgets
    .map((b) => ({
      cost_code_id: b.cost_code_id,
      amount: Number(impacts[b.cost_code_id] ?? 0),
    }))
    .filter((l) => l.amount !== 0);

  const balanced = isBudgetImpactBalanced(impactLines, signedAmount);
  const impactSum = sumBudgetImpact(impactLines);

  const mut = useMutation({
    mutationFn: () =>
      upsert({
        data: {
          project_id: projectId,
          title,
          description: description || null,
          contract_id: contractId || null,
          wbs_item_id: wbsItemId || null,
          amount: signedAmount,
          currency_code: currency,
          schedule_impact_days: parseInt(days || "0", 10),
          budget_impact: impactLines,
        },
      }),
    onSuccess: async () => {
      toast.success("Change order created (draft)");
      await qc.invalidateQueries({ queryKey: ["change-orders", "list", projectId] });
      onClose();
    },
    onError: (err) => toast.error(changeOrderErrorMessage(err)),
  });

  const canSave = title.trim().length > 0 && balanced;

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>New change order</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Description</Label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Contract</Label>
              <Select value={contractId} onValueChange={setContractId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select contract" />
                </SelectTrigger>
                <SelectContent>
                  {pickers.data.contracts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.contract_number} — {c.title}
                    </SelectItem>
                  ))}
                  {pickers.data.contracts.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      No signed/active contracts.
                    </div>
                  ) : null}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>WBS item</Label>
              <Select value={wbsItemId} onValueChange={setWbsItemId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select WBS item" />
                </SelectTrigger>
                <SelectContent>
                  {pickers.data.wbsItems.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.code} — {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <Select value={sign} onValueChange={(v) => setSign(v as "add" | "credit")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="add">Cost add (+)</SelectItem>
                  <SelectItem value="credit">Credit (−)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Amount ({currency})</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Schedule impact (days)</Label>
              <Input
                type="number"
                step={1}
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-baseline justify-between">
              <Label>Budget impact</Label>
              <div
                className={cn(
                  "text-xs tabular-nums",
                  balanced ? "text-success" : "text-destructive",
                )}
              >
                Σ {money(impactSum, currency)} / target {money(signedAmount, currency)}{" "}
                {balanced ? "✓" : "≠"}
              </div>
            </div>
            <div className="max-h-64 overflow-auto rounded-md border border-border">
              {pickers.data.budgets.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground">
                  No budgets defined for this project.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Cost code</TableHead>
                      <TableHead className="text-right">Current</TableHead>
                      <TableHead className="text-right w-32">Impact</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pickers.data.budgets.map((b) => {
                      const cc = pickers.data.costCodes.find((c) => c.id === b.cost_code_id);
                      return (
                        <TableRow key={b.id}>
                          <TableCell className="font-mono text-xs">{cc?.code ?? "—"}</TableCell>
                          <TableCell>{cc?.name ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {money(b.current_amount, b.currency_code)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              step="0.01"
                              className="h-8 text-right tabular-nums"
                              value={impacts[b.cost_code_id] ?? ""}
                              onChange={(e) =>
                                setImpacts((prev) => ({
                                  ...prev,
                                  [b.cost_code_id]: e.target.value,
                                }))
                              }
                              placeholder="0.00"
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !canSave}>
            {mut.isPending ? "Creating…" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
