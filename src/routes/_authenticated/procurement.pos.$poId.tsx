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
import { MoneyCell, Num } from "@/components/ui/num";
import { useI18n } from "@/lib/i18n/locale-provider";
import { errorCodeOf, translateError } from "@/lib/i18n/error-keys";
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
  const { t } = useI18n();
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
          <ArrowLeft className="me-2 h-4 w-4" /> {t("procurementMod.pos.backToList")}
        </Button>
      </div>

      <PageHeader
        title={po.po_number}
        description={`${po.vendor_name} · ${po.project_name} · ${po.currency_code}`}
        actions={
          <div className="text-end">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("procurementMod.pos.totalLabel")}
            </div>
            <div className="text-2xl font-semibold">
              <MoneyCell className="text-2xl font-semibold">
                {fmtMoney(po.total_amount, po.currency_code)}
              </MoneyCell>
            </div>
            <div className="text-xs text-muted-foreground">
              {t("procurementMod.pos.thresholdLabel", {
                amount: fmtMoney(threshold, po.currency_code),
                state: requiresApproval ? t("procurementMod.pos.above") : t("procurementMod.pos.below"),
              })}
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
          <p className="font-medium text-destructive">{t("procurementMod.pos.rejectedByVendor")}</p>
          <p className="mt-1 text-muted-foreground">
            {po.acknowledgment_note ?? t("procurementMod.pos.noReasonProvided")}
          </p>
        </div>
      )}

      <section className="rounded-md border border-border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-sm font-semibold">{t("procurementMod.pos.acknowledgment")}</h2>
          {po.acknowledgment_status ? (
            <AcknowledgmentChip
              status={po.acknowledgment_status as AcknowledgmentStatus}
              at={po.acknowledged_at}
            />
          ) : isAcknowledgeable(po.status) ? (
            <AwaitingAcknowledgmentChip />
          ) : (
            <span className="text-sm text-muted-foreground">{t("procurementMod.pos.notApplicable")}</span>
          )}
        </div>
        {po.acknowledged_at && (
          <dl className="mt-3 grid grid-cols-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t("procurementMod.pos.acknowledgedLabel")}</dt>
            <dd className="col-span-2">{format(new Date(po.acknowledged_at), "PPp")}</dd>
            <dt className="text-muted-foreground">{t("procurementMod.pos.byLabel")}</dt>
            <dd className="col-span-2">{po.acknowledged_by_email ?? t("procurementMod.pos.vendorContactFallback")}</dd>
            <dt className="text-muted-foreground">{t("procurementMod.pos.commentLabel")}</dt>
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
                ? t("procurementMod.pos.aboveThresholdNotice")
                : t("procurementMod.pos.belowThresholdNotice")}
            </p>
            <Button
              onClick={() =>
                submit.mutate(null, {
                  onError: (err: unknown) => {
                    toast.error(translateError(t, errorCodeOf(err), (err as Error)?.message));
                  },
                })
              }
              disabled={submit.isPending}
            >
              <Send className="me-2 h-4 w-4" />
              {submit.isPending ? t("procurementMod.pos.submitting") : t("procurementMod.pos.submit")}
            </Button>
          </div>
        )}

        {po.status === "pending_approval" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("procurementMod.pos.awaitingApproval")}</p>
            {access.canApprove ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="approve-note">{t("procurementMod.pos.approvalNoteLabel")}</Label>
                  <Textarea
                    id="approve-note"
                    value={approveNote}
                    onChange={(e) => setApproveNote(e.target.value)}
                    placeholder={t("procurementMod.pos.approvalNotePlaceholder")}
                    rows={3}
                  />
                  <Button
                    className="w-full"
                    onClick={() =>
                      approve.mutate(approveNote, {
                        onError: (err: unknown) => {
                          toast.error(translateError(t, errorCodeOf(err), (err as Error)?.message));
                        },
                      })
                    }
                    disabled={approve.isPending || approveNote.trim().length === 0}
                  >
                    <CheckCircle2 className="me-2 h-4 w-4" />
                    {t("procurementMod.pos.approve")}
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reject-note">{t("procurementMod.pos.rejectionNoteLabel")}</Label>
                  <Textarea
                    id="reject-note"
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    placeholder={t("procurementMod.pos.rejectionNotePlaceholder")}
                    rows={3}
                  />
                  <Button
                    variant="destructive"
                    className="w-full"
                    onClick={() =>
                      reject.mutate(rejectNote, {
                        onError: (err: unknown) => {
                          toast.error(translateError(t, errorCodeOf(err), (err as Error)?.message));
                        },
                      })
                    }
                    disabled={reject.isPending || rejectNote.trim().length === 0}
                  >
                    <XCircle className="me-2 h-4 w-4" />
                    {t("procurementMod.pos.reject")}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("procurementMod.pos.approverOnlyNotice")}
              </p>
            )}
          </div>
        )}

        {po.status === "approved" && access.canAuthor && (
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              {po.approved_at
                ? t("procurementMod.pos.approvedAt", { date: format(new Date(po.approved_at), "PPp") })
                : t("procurementMod.pos.approvedGeneric")}
              {po.approval_note ? ` · ${po.approval_note}` : ""}
            </div>
            <Button
              onClick={() =>
                issue.mutate(undefined, {
                  onError: (err: unknown) => {
                    toast.error(translateError(t, errorCodeOf(err), (err as Error)?.message));
                  },
                })
              }
              disabled={issue.isPending || changeControl.blocked}
              title={
                changeControl.blocked
                  ? t("procurementMod.common.changeControlBlocked")
                  : undefined
              }
            >
              <Send className="me-2 h-4 w-4" />
              {issue.isPending ? t("procurementMod.pos.issuing") : t("procurementMod.pos.issuePo")}
            </Button>
          </div>
        )}

        {po.status === "issued" && (
          <div className="text-sm text-muted-foreground">
            {t("procurementMod.pos.issuedAt", {
              date: po.issued_at ? format(new Date(po.issued_at), "PPp") : "—",
            })}
          </div>
        )}
      </section>

      {/* Approval trail */}
      {(po.approved_at || po.approval_note) && (
        <section className="rounded-md border border-border p-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {t("procurementMod.pos.approvalTrail")}
          </h2>
          <dl className="mt-2 grid grid-cols-2 gap-y-2 text-sm md:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">{t("procurementMod.pos.approvedAtLabel")}</dt>
              <dd>{po.approved_at ? format(new Date(po.approved_at), "PPp") : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("procurementMod.pos.approvedByLabel")}</dt>
              <dd className="font-mono text-xs">{po.approved_by ?? "—"}</dd>
            </div>
            <div className="md:col-span-1">
              <dt className="text-muted-foreground">{t("procurementMod.pos.noteLabel")}</dt>
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
                {t("procurementMod.pos.brandedPdf")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {po.pdf_path
                  ? t("procurementMod.pos.pdfReady")
                  : t("procurementMod.pos.pdfNotGenerated")}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() =>
                download.mutate(undefined, {
                  onError: (err: unknown) => {
                    toast.error(translateError(t, errorCodeOf(err), (err as Error)?.message));
                  },
                })
              }
              disabled={download.isPending || !canDownload}
            >
              {po.pdf_path ? (
                <Download className="me-2 h-4 w-4" />
              ) : (
                <RefreshCw className="me-2 h-4 w-4" />
              )}
              {download.isPending ? t("procurementMod.pos.preparingPdf") : t("procurementMod.pos.downloadPdf")}
            </Button>
          </div>

          {canShare && (
            <div className="border-t border-border pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("procurementMod.pos.vendorShareLink")}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {shareLive
                      ? t("procurementMod.pos.shareLive", {
                          date: format(new Date(po.share_token_expires_at as string), "PPp"),
                        })
                      : t("procurementMod.pos.noActiveLink")}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() =>
                      createLink.mutate(undefined, {
                        onError: (err: unknown) => {
                          toast.error(translateError(t, errorCodeOf(err), (err as Error)?.message));
                        },
                      })
                    }
                    disabled={createLink.isPending}
                  >
                    <Link2 className="me-2 h-4 w-4" />
                    {shareLive
                      ? createLink.isPending
                        ? t("procurementMod.pos.regenerating")
                        : t("procurementMod.pos.regenerateLink")
                      : createLink.isPending
                        ? t("procurementMod.pos.creatingLink")
                        : t("procurementMod.pos.createVendorLink")}
                  </Button>
                  {shareLive && (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        revokeLink.mutate(undefined, {
                          onError: (err: unknown) => {
                            toast.error(translateError(t, errorCodeOf(err), (err as Error)?.message));
                          },
                        })
                      }
                      disabled={revokeLink.isPending}
                    >
                      <Link2Off className="me-2 h-4 w-4" />
                      {t("procurementMod.pos.revoke")}
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
                        toast.success(t("procurementMod.common.copied"));
                      } catch {
                        toast.error(t("procurementMod.common.copyFailed"));
                      }
                    }}
                  >
                    <Copy className="me-2 h-4 w-4" /> {t("procurementMod.common.copy")}
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
            [t("procurementMod.pos.paymentTerms"), po.payment_terms ?? "—"],
            [t("procurementMod.pos.incoterms"), po.incoterms ?? "—"],
            [t("procurementMod.pos.requiredBy"), po.required_by_date ?? "—"],
          ]}
        />
        <MetaCard
          items={[
            [t("procurementMod.pos.delivery"), po.delivery_address ?? "—"],
            [t("procurementMod.common.created"), format(new Date(po.created_at), "PPp")],
            [t("procurementMod.pos.approvalNoteLabel"), po.approval_note ?? "—"],
          ]}
        />
      </section>

      <section className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">{t("procurementMod.common.hash")}</TableHead>
              <TableHead>{t("procurementMod.common.description")}</TableHead>
              <TableHead>{t("procurementMod.common.spec")}</TableHead>
              <TableHead className="text-end">{t("procurementMod.common.qtyShort")}</TableHead>
              <TableHead>{t("procurementMod.common.uom")}</TableHead>
              <TableHead className="text-end">{t("procurementMod.pos.colUnit")}</TableHead>
              <TableHead className="text-end">{t("procurementMod.pos.colAmount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {po.lines.map((l) => (
              <TableRow key={l.line_no}>
                <TableCell className="font-mono">{l.line_no}</TableCell>
                <TableCell className="font-medium">{l.description}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{l.spec ?? "—"}</TableCell>
                <TableCell className="text-end">
                  <Num>{l.qty}</Num>
                </TableCell>
                <TableCell>{l.uom}</TableCell>
                <TableCell className="text-end">
                  <MoneyCell>{fmtMoney(l.unit_price, po.currency_code)}</MoneyCell>
                </TableCell>
                <TableCell className="text-end font-medium">
                  <MoneyCell className="font-medium">{fmtMoney(l.amount, po.currency_code)}</MoneyCell>
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell colSpan={6} className="text-end text-sm text-muted-foreground">
                {t("procurementMod.pos.subtotal")}
              </TableCell>
              <TableCell className="text-end">
                <MoneyCell>{fmtMoney(po.subtotal, po.currency_code)}</MoneyCell>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell colSpan={6} className="text-end text-sm text-muted-foreground">
                {t("procurementMod.pos.tax", { pct: po.tax_pct })}
              </TableCell>
              <TableCell className="text-end">
                <MoneyCell>{fmtMoney(po.tax_amount, po.currency_code)}</MoneyCell>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell colSpan={6} className="text-end font-semibold">
                {t("procurementMod.pos.total")}
              </TableCell>
              <TableCell className="text-end font-semibold">
                <MoneyCell className="font-semibold">{fmtMoney(po.total_amount, po.currency_code)}</MoneyCell>
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
