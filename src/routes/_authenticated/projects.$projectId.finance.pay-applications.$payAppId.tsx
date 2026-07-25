// P-079 — Pay application detail: SOV line grid + certify/approve/invoice.
import { useMemo, useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowLeft, CheckCircle2, FileText, Save } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  approvePayApplication,
  certifyPayApplication,
  generatePayAppInvoice,
  rejectPayApplication,
  updatePayApplicationLines,
} from "@/lib/pay-app.functions";
import {
  payAppAccessQueryOptions,
  payAppDetailQueryOptions,
  payAppErrorExtra,
  payAppErrorMessage,
} from "@/lib/pay-app.query";
import {
  computePayAppTotals,
  payAppStatusLabel,
  type PayAppStatus,
  type ReconciliationResult,
} from "@/lib/pay-app.rules";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/finance/pay-applications/$payAppId",
)({
  head: () => ({
    meta: [
      { title: "Pay application — GridMind EPC" },
      {
        name: "description",
        content: "Line-by-line certification of progress on a signed contract.",
      },
      { property: "og:title", content: "Pay application — GridMind EPC" },
      {
        property: "og:description",
        content: "Certify progress by SOV line; reconciliation runs at approval.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: async ({ params, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(payAppDetailQueryOptions(params.payAppId)),
      context.queryClient.ensureQueryData(payAppAccessQueryOptions()),
    ]);
  },
  errorComponent: ({ error }) => (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
      {payAppErrorMessage(error)}
    </div>
  ),
  notFoundComponent: () => <div className="p-4 text-sm">Pay application not found.</div>,
  component: PayAppDetail,
});

const STATUS_VARIANTS: Record<PayAppStatus, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  submitted: "secondary",
  certified: "secondary",
  approved: "default",
  rejected: "destructive",
  invoiced: "default",
};

function fmt(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function PayAppDetail() {
  const { projectId, payAppId } = Route.useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const detail = useSuspenseQuery(payAppDetailQueryOptions(payAppId));
  const access = useSuspenseQuery(payAppAccessQueryOptions());

  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      detail.data.payApp.lines.map((l) => [String(l.sov_line_no), String(l.this_period)]),
    ),
  );
  const [retention, setRetention] = useState(String(detail.data.payApp.retention_pct));
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");

  const isDraft = detail.data.payApp.status === "draft";
  const isCertified = detail.data.payApp.status === "certified";
  const isApproved = detail.data.payApp.status === "approved";

  const previewTotals = useMemo(() => {
    const lines = detail.data.payApp.lines.map((l) => ({
      ...l,
      this_period: Number(drafts[String(l.sov_line_no)] ?? l.this_period ?? 0),
    }));
    return computePayAppTotals(lines, Number(retention || 0));
  }, [detail.data.payApp.lines, drafts, retention]);

  const invalidateAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["pay-applications", "detail", payAppId] }),
      qc.invalidateQueries({ queryKey: ["pay-applications", "list", projectId] }),
    ]);
  };

  const saveFn = useServerFn(updatePayApplicationLines);
  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          id: payAppId,
          this_period_by_line_no: Object.fromEntries(
            Object.entries(drafts).map(([k, v]) => [k, Number(v || 0)]),
          ),
          retention_pct: Number(retention || 0),
        },
      }),
    onSuccess: async () => {
      toast.success("Draft saved");
      await invalidateAll();
    },
    onError: (err) => toast.error(payAppErrorMessage(err)),
  });

  const certifyFn = useServerFn(certifyPayApplication);
  const certify = useMutation({
    mutationFn: async () => {
      await saveFn({
        data: {
          id: payAppId,
          this_period_by_line_no: Object.fromEntries(
            Object.entries(drafts).map(([k, v]) => [k, Number(v || 0)]),
          ),
          retention_pct: Number(retention || 0),
        },
      });
      return certifyFn({ data: { id: payAppId } });
    },
    onSuccess: async () => {
      toast.success("Pay application certified");
      await invalidateAll();
    },
    onError: (err) => toast.error(payAppErrorMessage(err)),
  });

  const approveFn = useServerFn(approvePayApplication);
  const approve = useMutation({
    mutationFn: () => approveFn({ data: { id: payAppId } }),
    onSuccess: async () => {
      toast.success("Pay application approved");
      await invalidateAll();
    },
    onError: async (err) => {
      toast.error(payAppErrorMessage(err));
      // Reload — server may have stamped a failed reconciliation object.
      await invalidateAll();
    },
  });

  const rejectFn = useServerFn(rejectPayApplication);
  const reject = useMutation({
    mutationFn: () => rejectFn({ data: { id: payAppId, note: rejectNote.trim() } }),
    onSuccess: async () => {
      toast.success("Rejected");
      setRejectOpen(false);
      setRejectNote("");
      await invalidateAll();
    },
    onError: (err) => toast.error(payAppErrorMessage(err)),
  });

  const invoiceFn = useServerFn(generatePayAppInvoice);
  const invoice = useMutation({
    mutationFn: () => invoiceFn({ data: { id: payAppId } }),
    onSuccess: async (r) => {
      toast.success(`Invoice ${r.invoice_number} created`);
      await invalidateAll();
    },
    onError: (err) => toast.error(payAppErrorMessage(err)),
  });

  const approvalExtra = approve.error
    ? (payAppErrorExtra(approve.error) as { reconciliation?: ReconciliationResult } | null)
    : null;

  const p = detail.data.payApp;
  const c = detail.data.contract;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild size="sm" variant="ghost">
          <Link to="/projects/$projectId/finance/pay-applications" params={{ projectId }}>
            <ArrowLeft className="mr-2 size-4" /> Back
          </Link>
        </Button>
        <h1 className="truncate text-lg font-semibold text-foreground">
          Pay app #{p.application_number}
        </h1>
        <Badge variant={STATUS_VARIANTS[p.status]}>{payAppStatusLabel(p.status)}</Badge>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground">Contract</div>
            <div className="text-sm font-medium">
              {c.contract_number} — {c.title}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Period</div>
            <div className="text-sm">
              {p.period_start} → {p.period_end}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Retention</div>
            {isDraft ? (
              <Input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={retention}
                onChange={(e) => setRetention(e.target.value)}
                className="h-8"
              />
            ) : (
              <div className="text-sm">{p.retention_pct}%</div>
            )}
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Net due</div>
            <div className="text-sm font-semibold tabular-nums">
              {fmt(isDraft ? previewTotals.net_amount : p.net_amount)}
            </div>
          </div>
        </div>
      </Card>

      {approvalExtra?.reconciliation && !approvalExtra.reconciliation.ok ? (
        <ReconciliationCard rec={approvalExtra.reconciliation} />
      ) : null}
      {"failures" in (p.reconciliation as ReconciliationResult) &&
      !(p.reconciliation as ReconciliationResult).ok ? (
        <ReconciliationCard rec={p.reconciliation as ReconciliationResult} />
      ) : null}

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Scheduled</TableHead>
              <TableHead className="text-right">Prev certified</TableHead>
              <TableHead className="text-right">This period</TableHead>
              <TableHead className="text-right">% Complete</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {p.lines.map((l) => {
              const key = String(l.sov_line_no);
              const currentThis = isDraft ? Number(drafts[key] ?? 0) : l.this_period;
              const totalCents = Math.round((l.prev_certified + currentThis) * 100);
              const schedCents = Math.round(l.scheduled_amount * 100);
              const overrun = totalCents > schedCents;
              return (
                <TableRow key={key} className={overrun ? "bg-destructive/5" : ""}>
                  <TableCell className="font-medium">{l.sov_line_no}</TableCell>
                  <TableCell className="text-muted-foreground">{l.description}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt(l.scheduled_amount)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(l.prev_certified)}</TableCell>
                  <TableCell className="text-right">
                    {isDraft ? (
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={drafts[key] ?? ""}
                        onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                        className="h-8 w-32 text-right tabular-nums"
                      />
                    ) : (
                      <span className="tabular-nums">{fmt(l.this_period)}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {(l.scheduled_amount > 0
                      ? Math.round(
                          ((l.prev_certified + currentThis) / l.scheduled_amount) * 10000,
                        ) / 100
                      : 0
                    ).toFixed(1)}
                    %
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
        <div className="flex gap-6 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Total certified</div>
            <div className="font-semibold tabular-nums">
              {fmt(isDraft ? previewTotals.total_certified : p.total_certified)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Retention</div>
            <div className="font-semibold tabular-nums">
              {fmt(isDraft ? previewTotals.retention_amount : p.retention_amount)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Net</div>
            <div className="font-semibold tabular-nums">
              {fmt(isDraft ? previewTotals.net_amount : p.net_amount)}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isDraft && access.data.canCertify ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => save.mutate()}
                disabled={save.isPending}
              >
                <Save className="mr-2 size-4" /> Save draft
              </Button>
              <Button size="sm" onClick={() => certify.mutate()} disabled={certify.isPending}>
                <CheckCircle2 className="mr-2 size-4" /> Certify
              </Button>
            </>
          ) : null}
          {isCertified && access.data.canApprove ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRejectOpen(true)}
                disabled={reject.isPending}
              >
                Reject
              </Button>
              <Button size="sm" onClick={() => approve.mutate()} disabled={approve.isPending}>
                {approve.isPending ? "Approving…" : "Approve"}
              </Button>
            </>
          ) : null}
          {isApproved && access.data.canApprove && !p.invoice_id ? (
            <Button size="sm" onClick={() => invoice.mutate()} disabled={invoice.isPending}>
              <FileText className="mr-2 size-4" />
              {invoice.isPending ? "Generating…" : "Generate invoice"}
            </Button>
          ) : null}
          {p.invoice_id ? <Badge variant="secondary">Invoice generated</Badge> : null}
        </div>
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject pay application</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label>Rejection note</Label>
            <Textarea
              rows={4}
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="Explain why this pay application is being rejected."
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => reject.mutate()}
              disabled={reject.isPending || rejectNote.trim().length === 0}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReconciliationCard({ rec }: { rec: ReconciliationResult }) {
  return (
    <Card className="border-destructive/40 bg-destructive/5 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-destructive">
        <AlertTriangle className="size-4" /> Reconciliation blocked approval
      </div>
      <ul className="list-inside list-disc space-y-1 text-sm text-destructive">
        {rec.failures.map((f, i) => (
          <li key={i}>
            {f.rule === "contract_status" && f.detail}
            {f.rule === "line_overrun" &&
              `Lines exceed scheduled amount: ${f.sov_line_nos.join(", ")}`}
            {f.rule === "contract_value_overrun" && f.detail}
            {f.rule === "totals_integrity" && f.detail}
          </li>
        ))}
      </ul>
    </Card>
  );
}
