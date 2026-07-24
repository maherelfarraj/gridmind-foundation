// P-064 — Purchase Order detail with CFO approval controls.
import { useState } from "react";
import {
  createFileRoute,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, CheckCircle2, Receipt, Send, XCircle } from "lucide-react";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
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
import { PoStatusBadge } from "@/components/procurement/po-status-badge";
import { getPo, getPoApprovalThreshold, getPoWriteAccess } from "@/lib/po.functions";
import {
  poApprovalThresholdQueryOptions,
  poDetailQueryOptions,
  poWriteAccessQueryOptions,
  useApprovePo,
  useIssuePo,
  useRejectPo,
  useSubmitPoForApproval,
} from "@/lib/po-query";

export const Route = createFileRoute("/_authenticated/procurement/pos/$poId")({
  head: () => ({
    meta: [
      { title: "Purchase Order — GridMind EPC" },
      {
        name: "description",
        content: "Review, approve, and issue a purchase order with full audit trail.",
      },
    ],
  }),
  component: PoDetail,
});

function fmtMoney(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

function PoDetail() {
  const { poId } = useParams({ from: "/_authenticated/procurement/pos/$poId" });
  const navigate = useNavigate();

  const detailFn = useServerFn(getPo);
  const accessFn = useServerFn(getPoWriteAccess);
  const thresholdFn = useServerFn(getPoApprovalThreshold);

  const poQuery = useSuspenseQuery(poDetailQueryOptions(detailFn, poId));
  const accessQuery = useSuspenseQuery(poWriteAccessQueryOptions(accessFn));
  const thresholdQuery = useSuspenseQuery(
    poApprovalThresholdQueryOptions(thresholdFn),
  );

  const po = poQuery.data;
  const access = accessQuery.data;
  const threshold = thresholdQuery.data.threshold;

  const submit = useSubmitPoForApproval(poId);
  const approve = useApprovePo(poId);
  const reject = useRejectPo(poId);
  const issue = useIssuePo(poId);

  const [approveNote, setApproveNote] = useState("");
  const [rejectNote, setRejectNote] = useState("");

  const requiresApproval = po.total_amount > threshold;

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: "/procurement/pos" })}
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to POs
        </Button>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <Receipt className="h-3.5 w-3.5" /> Procurement · Purchase Order
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {po.po_number}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <PoStatusBadge status={po.status} />
            <span>{po.vendor_name}</span>
            <span>{po.project_name}</span>
            <span>{po.currency_code}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Total
          </div>
          <div className="font-display text-2xl font-semibold">
            {fmtMoney(po.total_amount, po.currency_code)}
          </div>
          <div className="text-xs text-muted-foreground">
            Threshold {fmtMoney(threshold, po.currency_code)}
            {requiresApproval ? " · above" : " · below"}
          </div>
        </div>
      </header>

      {/* action strip */}
      <section className="rounded-md border border-border p-4 space-y-4">
        {po.status === "draft" && access.canAuthor && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm">
              {requiresApproval
                ? "Above threshold — will require CFO approval."
                : "Below threshold — will auto-approve on submit."}
            </p>
            <Button
              onClick={() => submit.mutate(null)}
              disabled={submit.isPending}
            >
              <Send className="mr-2 h-4 w-4" />
              {submit.isPending ? "Submitting…" : "Submit"}
            </Button>
          </div>
        )}

        {po.status === "pending_approval" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Awaiting CFO / company admin approval.
            </p>
            {access.canApprove ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="approve-note">Approval note</Label>
                  <Textarea
                    id="approve-note"
                    value={approveNote}
                    onChange={(e) => setApproveNote(e.target.value)}
                    placeholder="Reason / conditions…"
                    rows={3}
                  />
                  <Button
                    className="w-full"
                    onClick={() => approve.mutate(approveNote)}
                    disabled={approve.isPending || approveNote.trim().length === 0}
                  >
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Approve
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reject-note">Rejection note</Label>
                  <Textarea
                    id="reject-note"
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    placeholder="Why rejected — required"
                    rows={3}
                  />
                  <Button
                    variant="destructive"
                    className="w-full"
                    onClick={() => reject.mutate(rejectNote)}
                    disabled={reject.isPending || rejectNote.trim().length === 0}
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Reject
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Only finance admin or company admin can act on this PO.
              </p>
            )}
          </div>
        )}

        {po.status === "approved" && access.canAuthor && (
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              {po.approved_at
                ? `Approved ${format(new Date(po.approved_at), "PPp")}`
                : "Approved."}
              {po.approval_note ? ` · ${po.approval_note}` : ""}
            </div>
            <Button onClick={() => issue.mutate()} disabled={issue.isPending}>
              <Send className="mr-2 h-4 w-4" />
              {issue.isPending ? "Issuing…" : "Issue PO"}
            </Button>
          </div>
        )}

        {po.status === "issued" && (
          <div className="text-sm text-muted-foreground">
            Issued {po.issued_at ? format(new Date(po.issued_at), "PPp") : "—"}.
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <MetaCard
          items={[
            ["Payment terms", po.payment_terms ?? "—"],
            ["Incoterms", po.incoterms ?? "—"],
            ["Required by", po.required_by_date ?? "—"],
          ]}
        />
        <MetaCard
          items={[
            ["Delivery", po.delivery_address ?? "—"],
            ["Created", format(new Date(po.created_at), "PPp")],
            ["Approval note", po.approval_note ?? "—"],
          ]}
        />
      </section>

      <section className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">#</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Spec</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead>UoM</TableHead>
              <TableHead className="text-right">Unit</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {po.lines.map((l) => (
              <TableRow key={l.line_no}>
                <TableCell className="font-mono">{l.line_no}</TableCell>
                <TableCell className="font-medium">{l.description}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {l.spec ?? "—"}
                </TableCell>
                <TableCell className="text-right">{l.qty}</TableCell>
                <TableCell>{l.uom}</TableCell>
                <TableCell className="text-right">
                  {fmtMoney(l.unit_price, po.currency_code)}
                </TableCell>
                <TableCell className="text-right font-medium">
                  {fmtMoney(l.amount, po.currency_code)}
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell colSpan={6} className="text-right text-sm text-muted-foreground">
                Subtotal
              </TableCell>
              <TableCell className="text-right">
                {fmtMoney(po.subtotal, po.currency_code)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell colSpan={6} className="text-right text-sm text-muted-foreground">
                Tax ({po.tax_pct}%)
              </TableCell>
              <TableCell className="text-right">
                {fmtMoney(po.tax_amount, po.currency_code)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell colSpan={6} className="text-right font-semibold">
                Total
              </TableCell>
              <TableCell className="text-right font-semibold">
                {fmtMoney(po.total_amount, po.currency_code)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function MetaCard({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="rounded-md border border-border p-4">
      <dl className="grid grid-cols-3 gap-y-2 text-sm">
        {items.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="col-span-2">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
