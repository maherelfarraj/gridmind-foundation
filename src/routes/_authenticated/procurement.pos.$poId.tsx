// P-064/P-065 — Purchase Order detail: approval, issue, PDF, vendor share link.
import { useMemo, useState } from "react";
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Download,
  Link2,
  Link2Off,
  Receipt,
  RefreshCw,
  Send,
  XCircle,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

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
import { PoStatusStepper } from "@/components/procurement/po-status-stepper";
import {
  AcknowledgmentChip,
  AwaitingAcknowledgmentChip,
} from "@/components/vendor-portal/acknowledgment-chip";
import { isAcknowledgeable, type AcknowledgmentStatus } from "@/lib/vendor-portal.rules";
import { PageHeader } from "@/components/ui/page-header";
import { UnderChangeControlBanner } from "@/components/moc/under-change-control-banner";
import { useUnderChangeControl } from "@/hooks/use-change-control";
import { getPo, getPoApprovalThreshold, getPoWriteAccess } from "@/lib/po.functions";
import {
  poApprovalThresholdQueryOptions,
  poDetailQueryOptions,
  poWriteAccessQueryOptions,
  useApprovePo,
  useCreatePoShareLink,
  useDownloadPoPdf,
  useIssuePo,
  useRejectPo,
  useRevokePoShareLink,
  useSubmitPoForApproval,
} from "@/lib/po-query";

export const Route = createFileRoute("/_authenticated/procurement/pos/$poId")({
  head: () => ({
    meta: [
      { title: "Purchase Order — GridMind EPC" },
      {
        name: "description",
        content: "Review, approve, issue, and share a purchase order with full audit trail.",
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

function shareUrl(token: string): string {
  if (typeof window === "undefined") return `/po/${token}`;
  return `${window.location.origin}/po/${token}`;
}

function PoDetail() {
  const { poId } = useParams({ from: "/_authenticated/procurement/pos/$poId" });
  const navigate = useNavigate();

  const detailFn = useServerFn(getPo);
  const accessFn = useServerFn(getPoWriteAccess);
  const thresholdFn = useServerFn(getPoApprovalThreshold);

  const poQuery = useSuspenseQuery(poDetailQueryOptions(detailFn, poId));
  const accessQuery = useSuspenseQuery(poWriteAccessQueryOptions(accessFn));
  const thresholdQuery = useSuspenseQuery(poApprovalThresholdQueryOptions(thresholdFn));

  const po = poQuery.data;
  const access = accessQuery.data;
  const threshold = thresholdQuery.data.threshold;

  const submit = useSubmitPoForApproval(poId);
  const approve = useApprovePo(poId);
  const reject = useRejectPo(poId);
  const issue = useIssuePo(poId);
  const changeControl = useUnderChangeControl("purchase_order", poId);
  const download = useDownloadPoPdf(poId);
  const createLink = useCreatePoShareLink(poId);
  const revokeLink = useRevokePoShareLink(poId);

  const [approveNote, setApproveNote] = useState("");
  const [rejectNote, setRejectNote] = useState("");

  const requiresApproval = po.total_amount > threshold;

  const shareLive = useMemo(() => {
    if (!po.share_token || !po.share_token_expires_at) return false;
    return new Date(po.share_token_expires_at).getTime() > Date.now();
  }, [po.share_token, po.share_token_expires_at]);
  const shareLink = po.share_token ? shareUrl(po.share_token) : null;
  const canShare =
    access.canAuthor &&
    ["approved", "issued", "partially_received", "received"].includes(po.status);
  const canDownload = ["approved", "issued", "partially_received", "received", "closed"].includes(
    po.status,
  );

  return (
    <div className="page-shell">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/procurement/pos" })}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to POs
        </Button>
      </div>

      <PageHeader
        title={po.po_number}
        description={`${po.vendor_name} · ${po.project_name} · ${po.currency_code}`}
        actions={
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Total</div>
            <div className="text-2xl font-semibold">
              {fmtMoney(po.total_amount, po.currency_code)}
            </div>
            <div className="text-xs text-muted-foreground">
              Threshold {fmtMoney(threshold, po.currency_code)}
              {requiresApproval ? " · above" : " · below"}
            </div>
          </div>
        }
      />
      <UnderChangeControlBanner entityType="purchase_order" entityId={poId} />
      <div className="-mt-2">
        <PoStatusBadge status={po.status} />
      </div>

      <PoStatusStepper status={po.status} />

      {po.acknowledgment_status === "rejected" && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm"
        >
          <p className="font-medium text-destructive">Rejected by the vendor</p>
          <p className="mt-1 text-muted-foreground">
            {po.acknowledgment_note ?? "No reason provided."}
          </p>
        </div>
      )}

      <section className="rounded-md border border-border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-sm font-semibold">Acknowledgment</h2>
          {po.acknowledgment_status ? (
            <AcknowledgmentChip
              status={po.acknowledgment_status as AcknowledgmentStatus}
              at={po.acknowledged_at}
            />
          ) : isAcknowledgeable(po.status) ? (
            <AwaitingAcknowledgmentChip />
          ) : (
            <span className="text-sm text-muted-foreground">Not applicable</span>
          )}
        </div>
        {po.acknowledged_at && (
          <dl className="mt-3 grid grid-cols-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Acknowledged</dt>
            <dd className="col-span-2">{format(new Date(po.acknowledged_at), "PPp")}</dd>
            <dt className="text-muted-foreground">By</dt>
            <dd className="col-span-2">{po.acknowledged_by_email ?? "Vendor contact"}</dd>
            <dt className="text-muted-foreground">Comment</dt>
            <dd className="col-span-2">{po.acknowledgment_note ?? "—"}</dd>
          </dl>
        )}
      </section>

      {/* action strip */}
      <section className="rounded-md border border-border p-4 space-y-4">
        {po.status === "draft" && access.canAuthor && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm">
              {requiresApproval
                ? "Above threshold — will require CFO approval."
                : "Below threshold — will auto-approve on submit."}
            </p>
            <Button onClick={() => submit.mutate(null)} disabled={submit.isPending}>
              <Send className="mr-2 h-4 w-4" />
              {submit.isPending ? "Submitting…" : "Submit"}
            </Button>
          </div>
        )}

        {po.status === "pending_approval" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Awaiting CFO / company admin approval.</p>
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
              {po.approved_at ? `Approved ${format(new Date(po.approved_at), "PPp")}` : "Approved."}
              {po.approval_note ? ` · ${po.approval_note}` : ""}
            </div>
            <Button
              onClick={() => issue.mutate()}
              disabled={issue.isPending || changeControl.blocked}
              title={
                changeControl.blocked
                  ? "Under change control — resolve the open change request first"
                  : undefined
              }
            >
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

      {/* Approval trail */}
      {(po.approved_at || po.approval_note) && (
        <section className="rounded-md border border-border p-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Approval trail
          </h2>
          <dl className="mt-2 grid grid-cols-2 gap-y-2 text-sm md:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Approved at</dt>
              <dd>{po.approved_at ? format(new Date(po.approved_at), "PPp") : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Approved by</dt>
              <dd className="font-mono text-xs">{po.approved_by ?? "—"}</dd>
            </div>
            <div className="md:col-span-1">
              <dt className="text-muted-foreground">Note</dt>
              <dd>{po.approval_note ?? "—"}</dd>
            </div>
          </dl>
        </section>
      )}

      {/* PDF + vendor share */}
      {(canDownload || canShare) && (
        <section className="rounded-md border border-border p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Branded PDF
              </h2>
              <p className="text-sm text-muted-foreground">
                {po.pdf_path
                  ? "Latest branded PDF is ready to download."
                  : "PDF has not been generated yet. Downloading will build it now."}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => download.mutate()}
              disabled={download.isPending || !canDownload}
            >
              {po.pdf_path ? (
                <Download className="mr-2 h-4 w-4" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {download.isPending ? "Preparing…" : "Download PDF"}
            </Button>
          </div>

          {canShare && (
            <div className="border-t border-border pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Vendor share link
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {shareLive
                      ? `Read-only vendor view · expires ${format(
                          new Date(po.share_token_expires_at as string),
                          "PPp",
                        )}`
                      : "No active vendor link. Generate one to share this PO for 14 days."}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => createLink.mutate()}
                    disabled={createLink.isPending}
                  >
                    <Link2 className="mr-2 h-4 w-4" />
                    {shareLive
                      ? createLink.isPending
                        ? "Regenerating…"
                        : "Regenerate link"
                      : createLink.isPending
                        ? "Creating…"
                        : "Create vendor link"}
                  </Button>
                  {shareLive && (
                    <Button
                      variant="ghost"
                      onClick={() => revokeLink.mutate()}
                      disabled={revokeLink.isPending}
                    >
                      <Link2Off className="mr-2 h-4 w-4" />
                      Revoke
                    </Button>
                  )}
                </div>
              </div>
              {shareLive && shareLink && (
                <div className="mt-3 flex gap-2">
                  <Input readOnly value={shareLink} className="font-mono text-xs" />
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(shareLink);
                        toast.success("Link copied");
                      } catch {
                        toast.error("Copy failed");
                      }
                    }}
                  >
                    <Copy className="mr-2 h-4 w-4" /> Copy
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>
      )}

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
                <TableCell className="text-sm text-muted-foreground">{l.spec ?? "—"}</TableCell>
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
