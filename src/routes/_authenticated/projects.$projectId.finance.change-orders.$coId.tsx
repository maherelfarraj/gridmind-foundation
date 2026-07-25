// P-081 — Change order detail page: workflow actions + propagation preview.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

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
import { Label } from "@/components/ui/label";
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

import {
  approveChangeOrder,
  incorporateChangeOrder,
  rejectChangeOrder,
  submitChangeOrder,
} from "@/lib/change-orders.functions";
import {
  changeOrderAccessQueryOptions,
  changeOrderDetailQueryOptions,
  changeOrderErrorMessage,
} from "@/lib/change-orders.query";
import {
  exposureBucket,
  exposurePct,
  isChangeOrderLocked,
  shiftUnstartedTasks,
  type ChangeOrderStatus,
} from "@/lib/change-orders.rules";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/finance/change-orders/$coId",
)({
  head: () => ({
    meta: [
      { title: "Change order — GridMind EPC" },
      {
        name: "description",
        content: "Change order detail: budget impact, schedule shift, approval trail.",
      },
      { property: "og:title", content: "Change order — GridMind EPC" },
      {
        property: "og:description",
        content: "Approve, reject, or incorporate a change order and see propagation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: async ({ params, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(changeOrderDetailQueryOptions(params.coId)),
      context.queryClient.ensureQueryData(changeOrderAccessQueryOptions()),
    ]);
  },
  errorComponent: ({ error }) => (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
      {changeOrderErrorMessage(error)}
    </div>
  ),
  notFoundComponent: () => <div className="p-4 text-sm">Change order not found.</div>,
  component: CoDetailPage,
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
  approved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  rejected: "bg-destructive/10 text-destructive border-destructive/30",
  incorporated: "bg-emerald-500/15 text-emerald-700 border-emerald-500/40",
};

function CoDetailPage() {
  const { projectId, coId } = Route.useParams();
  const qc = useQueryClient();
  const detail = useSuspenseQuery(changeOrderDetailQueryOptions(coId));
  const access = useSuspenseQuery(changeOrderAccessQueryOptions());

  const { co, contract, wbs, costCodes, budgets, tasks, audit } = detail.data;

  const submit = useServerFn(submitChangeOrder);
  const approve = useServerFn(approveChangeOrder);
  const reject = useServerFn(rejectChangeOrder);
  const incorporate = useServerFn(incorporateChangeOrder);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [incorpOpen, setIncorpOpen] = useState(false);

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ["change-orders", "detail", coId] });
    await qc.invalidateQueries({ queryKey: ["change-orders", "list", projectId] });
  };

  const submitMut = useMutation({
    mutationFn: () => submit({ data: { id: coId } }),
    onSuccess: async () => {
      toast.success("Submitted for approval");
      await invalidate();
    },
    onError: (e) => toast.error(changeOrderErrorMessage(e)),
  });

  const approveMut = useMutation({
    mutationFn: () => approve({ data: { id: coId } }),
    onSuccess: async () => {
      toast.success("Change order approved — budgets updated");
      await invalidate();
    },
    onError: (e) => toast.error(changeOrderErrorMessage(e)),
  });

  const incorpMut = useMutation({
    mutationFn: () => incorporate({ data: { id: coId } }),
    onSuccess: async () => {
      toast.success("Incorporated — schedule shifted, CO locked");
      await invalidate();
      setIncorpOpen(false);
    },
    onError: (e) => toast.error(changeOrderErrorMessage(e)),
  });

  const currency = co.currency_code ?? contract?.currency_code ?? "USD";
  const amountPct = contract?.value ? exposurePct(Math.abs(co.amount), contract.value) : 0;
  const amountBucket = exposureBucket(amountPct);
  const amountTone =
    amountBucket === "danger" || amountBucket === "warn"
      ? "border-destructive/40 bg-destructive/5 text-destructive"
      : "border-border bg-muted/40 text-foreground";

  const shift = useMemo(
    () => shiftUnstartedTasks(tasks, co.schedule_impact_days),
    [tasks, co.schedule_impact_days],
  );

  const canWrite = access.data.canWrite;
  const canApprove = access.data.canApprove;
  const locked = isChangeOrderLocked(co.status);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          to="/projects/$projectId/finance/change-orders"
          params={{ projectId }}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> Back to change orders
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{co.co_number}</h1>
            <Badge variant="outline" className={cn("capitalize", STATUS_TONE[co.status])}>
              {co.status.replace(/_/g, " ")}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{co.title}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {co.status === "draft" && canWrite ? (
            <Button size="sm" onClick={() => submitMut.mutate()} disabled={submitMut.isPending}>
              {submitMut.isPending ? "Submitting…" : "Submit for approval"}
            </Button>
          ) : null}
          {(co.status === "submitted" || co.status === "under_review") && canApprove ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRejectOpen(true)}
                disabled={approveMut.isPending}
              >
                <XCircle className="mr-2 size-4" /> Reject
              </Button>
              <Button size="sm" onClick={() => approveMut.mutate()} disabled={approveMut.isPending}>
                <CheckCircle2 className="mr-2 size-4" />
                {approveMut.isPending ? "Approving…" : "Approve"}
              </Button>
            </>
          ) : null}
          {co.status === "approved" && canApprove ? (
            <Button size="sm" onClick={() => setIncorpOpen(true)} disabled={incorpMut.isPending}>
              Incorporate
            </Button>
          ) : null}
        </div>
      </div>

      {locked ? (
        <Card className="flex items-center gap-2 border-border bg-muted/40 p-3 text-sm">
          <AlertTriangle className="size-4 text-muted-foreground" />
          This change order is <span className="font-medium">{co.status}</span> and locked from
          further edits.
        </Card>
      ) : null}

      {/* Impact chips */}
      <div className="flex flex-wrap gap-2">
        <Card className={cn("px-4 py-2", amountTone)}>
          <div className="text-xs uppercase tracking-wide opacity-80">Amount</div>
          <div className="text-lg font-semibold tabular-nums">
            {co.amount >= 0 ? "+" : ""}
            {money(co.amount, currency)}
          </div>
          {contract?.value ? (
            <div className="text-xs opacity-75">
              {amountPct.toFixed(1)}% of {money(contract.value, currency)} contract
            </div>
          ) : null}
        </Card>
        <Card className="px-4 py-2">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Schedule impact
          </div>
          <div className="text-lg font-semibold tabular-nums">
            {co.schedule_impact_days > 0 ? "+" : ""}
            {co.schedule_impact_days} days
          </div>
        </Card>
        {contract ? (
          <Card className="px-4 py-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Contract</div>
            <div className="text-sm font-medium">{contract.contract_number}</div>
            <div className="text-xs text-muted-foreground">{contract.title}</div>
          </Card>
        ) : null}
        {wbs ? (
          <Card className="px-4 py-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">WBS item</div>
            <div className="text-sm font-medium">{wbs.code}</div>
            <div className="text-xs text-muted-foreground">{wbs.name}</div>
          </Card>
        ) : null}
      </div>

      {/* Overview */}
      {co.description ? (
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Description</div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{co.description}</p>
        </Card>
      ) : null}

      {/* Budget impact */}
      <Card className="overflow-hidden">
        <div className="border-b border-border p-4">
          <h2 className="font-semibold">Budget impact</h2>
          <p className="text-xs text-muted-foreground">
            {co.status === "approved" || co.status === "incorporated"
              ? "Applied — current budgets already reflect these changes."
              : "Preview — approval will apply these to the latest budget version."}
          </p>
        </div>
        {co.budget_impact.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No budget impact lines.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Cost code</TableHead>
                <TableHead className="text-right">Current</TableHead>
                <TableHead className="text-right">Impact</TableHead>
                <TableHead className="text-right">New current</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {co.budget_impact.map((line) => {
                const cc = costCodes.find((c) => c.id === line.cost_code_id);
                const b = budgets.find((x) => x.cost_code_id === line.cost_code_id);
                const applied = co.status === "approved" || co.status === "incorporated";
                const currentBefore = applied
                  ? (b?.current_amount ?? 0) - line.amount
                  : (b?.current_amount ?? 0);
                const newAmount = currentBefore + line.amount;
                return (
                  <TableRow key={line.cost_code_id}>
                    <TableCell className="font-mono text-xs">{cc?.code ?? "—"}</TableCell>
                    <TableCell>{cc?.name ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {money(currentBefore, b?.currency_code ?? currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {line.amount >= 0 ? "+" : ""}
                      {money(line.amount, b?.currency_code ?? currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(newAmount, b?.currency_code ?? currency)}
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="bg-muted/40 font-medium">
                <TableCell colSpan={3}>Total</TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(
                    co.budget_impact.reduce((s, l) => s + l.amount, 0),
                    currency,
                  )}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Schedule preview */}
      {co.wbs_item_id && co.schedule_impact_days > 0 ? (
        <Card className="overflow-hidden">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold">Schedule shift preview</h2>
            <p className="text-xs text-muted-foreground">
              Incorporating this CO will shift {shift.shifted.length} unstarted task(s) by +
              {co.schedule_impact_days} days. Started or complete tasks are untouched.
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead>Preview</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shift.shifted.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{t.name}</TableCell>
                  <TableCell className="capitalize text-muted-foreground">
                    {t.status.replace(/_/g, " ")}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {t.start_date}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{t.end_date}</TableCell>
                  <TableCell className="tabular-nums font-medium">
                    {t.new_start_date} → {t.new_end_date}
                  </TableCell>
                </TableRow>
              ))}
              {shift.skipped.map((t) => (
                <TableRow key={t.id} className="text-muted-foreground">
                  <TableCell>{t.name}</TableCell>
                  <TableCell className="capitalize">{t.status.replace(/_/g, " ")}</TableCell>
                  <TableCell className="tabular-nums">{t.start_date}</TableCell>
                  <TableCell className="tabular-nums">{t.end_date}</TableCell>
                  <TableCell className="text-xs italic">
                    untouched ({t.status === "not_started" ? "no shift" : "already started"})
                  </TableCell>
                </TableRow>
              ))}
              {tasks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    No tasks under the linked WBS item.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Card>
      ) : null}

      {/* Approval trail */}
      <Card className="p-4">
        <h2 className="font-semibold">Approval trail</h2>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted-foreground">Submitted</dt>
          <dd>{co.submitted_at ? format(new Date(co.submitted_at), "PPpp") : "—"}</dd>
          <dt className="text-muted-foreground">Approved</dt>
          <dd>{co.approved_at ? format(new Date(co.approved_at), "PPpp") : "—"}</dd>
          <dt className="text-muted-foreground">Approval instance</dt>
          <dd className="font-mono text-xs">{co.approval_instance_id ?? "inline"}</dd>
        </dl>
        <div className="mt-3 border-t border-border pt-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Audit events</div>
          <ul className="mt-1 space-y-1 text-sm">
            {audit.length === 0 ? (
              <li className="text-muted-foreground">No events recorded.</li>
            ) : (
              audit.map((a) => (
                <li key={a.id} className="flex flex-wrap items-baseline gap-2">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {a.action}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(a.created_at), "PP p")}
                  </span>
                  {a.metadata?.note ? (
                    <span className="text-xs italic">"{String(a.metadata.note)}"</span>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </div>
      </Card>

      {rejectOpen ? (
        <RejectDialog
          onClose={() => setRejectOpen(false)}
          onSubmit={async (note) => {
            try {
              await reject({ data: { id: coId, note } });
              toast.success("Change order rejected");
              await invalidate();
              setRejectOpen(false);
            } catch (e) {
              toast.error(changeOrderErrorMessage(e));
            }
          }}
        />
      ) : null}

      {incorpOpen ? (
        <Dialog open onOpenChange={(o) => (!o ? setIncorpOpen(false) : undefined)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Incorporate change order?</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 text-sm">
              <p>
                This will shift {shift.shifted.length} unstarted task(s) by{" "}
                <strong>+{co.schedule_impact_days} days</strong> and lock the change order from
                further edits.
              </p>
              {shift.shifted.length === 0 && co.schedule_impact_days > 0 ? (
                <p className="text-muted-foreground">
                  No unstarted tasks under the linked WBS — nothing to shift, but the CO will still
                  be marked incorporated.
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setIncorpOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => incorpMut.mutate()} disabled={incorpMut.isPending}>
                {incorpMut.isPending ? "Incorporating…" : "Confirm incorporate"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function RejectDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject change order</DialogTitle>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label>Reason (required)</Label>
          <Textarea
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Explain why this change order is being rejected."
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy || note.trim().length === 0}
            onClick={async () => {
              setBusy(true);
              try {
                await onSubmit(note.trim());
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Rejecting…" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
