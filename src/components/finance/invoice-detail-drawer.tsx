// P-080 — Invoice detail drawer with payment guard + linked pay-app / debit notes.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { AlertTriangle, ExternalLink, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { PaymentHistory } from "@/components/finance/payment-history";
import { RecordPaymentDialog } from "@/components/finance/record-payment-dialog";
import { markInvoicePaid } from "@/lib/invoices.functions";
import { approveInvoice, markInvoiceSent } from "@/lib/payments.functions";
import { paymentsAccessQueryOptions } from "@/lib/payments.query";
import { FORMULAS, acceptsPayment, canApproveInvoice } from "@/lib/payments.rules";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useState } from "react";
import {
  invoiceDetailQueryOptions,
  invoiceErrorCode,
  invoiceErrorMessage,
} from "@/lib/invoices.query";
import { invoiceStatusLabel } from "@/lib/invoices.rules";
import { useI18n } from "@/lib/i18n/locale-provider";
import { translateError, errorCodeOf } from "@/lib/i18n/error-keys";

function fmt(n: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  submitted: "secondary",
  under_review: "secondary",
  approved: "secondary",
  sent: "secondary",
  partially_paid: "secondary",
  paid: "default",
  disputed: "destructive",
  cancelled: "outline",
};

export function InvoiceDetailDrawer({
  invoiceId,
  open,
  onOpenChange,
  canWrite,
}: {
  invoiceId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  canWrite: boolean;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const payFn = useServerFn(markInvoicePaid);
  const sendFn = useServerFn(markInvoiceSent);
  const approveFn = useServerFn(approveInvoice);
  const [payOpen, setPayOpen] = useState(false);
  const access = useQuery(paymentsAccessQueryOptions());
  const detail = useQuery({
    ...invoiceDetailQueryOptions(invoiceId ?? "00000000-0000-0000-0000-000000000000"),
    enabled: Boolean(invoiceId) && open,
  });

  const mutation = useMutation({
    mutationFn: () => payFn({ data: { id: invoiceId! } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success(t("financeMod.invoices.invoiceMarkedPaid"));
    },
    onError: (err) => {
      const code = invoiceErrorCode(err) ?? errorCodeOf(err);
      toast.error(translateError(t, code, invoiceErrorMessage(err)));
    },
  });

  const sendMutation = useMutation({
    mutationFn: () => sendFn({ data: { invoice_id: invoiceId! } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success(t("financeMod.invoices.invoiceMarkedSent"));
    },
    onError: (err) => toast.error(translateError(t, errorCodeOf(err), invoiceErrorMessage(err))),
  });

  const approveMutation = useMutation({
    mutationFn: () => approveFn({ data: { invoice_id: invoiceId! } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success(t("financeMod.invoices.invoiceApproved"));
    },
    onError: (err) => toast.error(translateError(t, errorCodeOf(err), invoiceErrorMessage(err))),
  });


  const d = detail.data;
  const canRecord =
    d?.invoice.direction === "payable"
      ? Boolean(access.data?.canPayable)
      : Boolean(access.data?.canFinance);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{d ? d.invoice.invoice_number : t("financeMod.invoices.invoiceFallback")}</SheetTitle>
          <SheetDescription>
            {d ? (d.invoice.direction === "payable" ? t("financeMod.invoices.payableInvoice") : t("financeMod.invoices.receivableInvoice")) : ""}
          </SheetDescription>
        </SheetHeader>

        {detail.isLoading || !d ? (
          <div className="mt-6 space-y-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            {d.payment_release_blocked && (
              <div
                className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
                role="alert"
              >
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                  <div className="space-y-1">
                    <p className="font-medium">{t("financeMod.invoices.paymentBlockedTitle")}</p>
                    <p className="text-xs">{t("financeMod.invoices.paymentBlockedHint")}</p>
                    {d.blocked_match_ids[0] && (
                      <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
                        <Link to="/procurement/matches" hash={d.blocked_match_ids[0]}>
                          {t("financeMod.invoices.openMatching")}
                          <ExternalLink className="ms-1 inline size-3" />
                        </Link>
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">{t("financeMod.common.status")}</dt>
                <dd>
                  <span className="flex flex-wrap items-center gap-1">
                    <Badge variant={STATUS_VARIANT[d.invoice.status] ?? "outline"}>
                      {invoiceStatusLabel(d.invoice.status)}
                    </Badge>
                    {d.invoice.overdue && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="destructive">{t("financeMod.invoices.overdueBadge")}</Badge>
                        </TooltipTrigger>
                        <TooltipContent>{FORMULAS.overdue}</TooltipContent>
                      </Tooltip>
                    )}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("financeMod.common.amount")}</dt>
                <dd className="font-mono tabular-nums">
                  {fmt(d.invoice.amount, d.invoice.currency_code)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("financeMod.common.tax")}</dt>
                <dd className="font-mono tabular-nums">
                  {fmt(d.invoice.tax_amount, d.invoice.currency_code)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("financeMod.common.paid")}</dt>
                <dd className="font-mono tabular-nums">
                  {fmt(d.invoice.paid_amount, d.invoice.currency_code)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("financeMod.common.balance")}</dt>
                <dd>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="font-mono tabular-nums">
                        {fmt(d.invoice.balance, d.invoice.currency_code)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{FORMULAS.balance}</TooltipContent>
                  </Tooltip>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("financeMod.common.retention")}</dt>
                <dd className="font-mono tabular-nums">{d.invoice.retention_pct}%</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("financeMod.common.issued")}</dt>
                <dd>{d.invoice.issue_date ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("financeMod.common.dueDate")}</dt>
                <dd>{d.invoice.due_date ?? "—"}</dd>
              </div>
              {d.invoice.milestone_label && (
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">{t("financeMod.invoices.milestoneLabel")}</dt>
                  <dd>{d.invoice.milestone_label}</dd>
                </div>
              )}
              {d.invoice.paid_at && (
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">{t("financeMod.invoices.paidAtLabel")}</dt>
                  <dd>{d.invoice.paid_at.slice(0, 10)}</dd>
                </div>
              )}
            </dl>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{t("financeMod.invoices.linkedTitle")}</h3>
              <ul className="space-y-1 text-sm">
                {d.contract && (
                  <li>
                    {t("financeMod.invoices.contractPrefix")}{" "}
                    <Link
                      to="/finance/contracts/$contractId"
                      params={{ contractId: d.contract.id }}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {d.contract.contract_number} — {d.contract.title}
                    </Link>
                  </li>
                )}
                {d.pay_app && <li>{t("financeMod.invoices.payAppPrefix", { number: d.pay_app.application_number })}</li>}
                {!d.contract && !d.pay_app && (
                  <li className="text-muted-foreground">{t("financeMod.invoices.noLinked")}</li>
                )}
              </ul>
            </div>

            {d.debit_notes_open_sum > 0 && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                <div className="flex items-start gap-2 text-warning">
                  <AlertTriangle className="mt-0.5 size-3.5" />
                  <span>
                    {t("financeMod.invoices.debitNoteReduced", {
                      amount: fmt(d.debit_notes_open_sum, d.invoice.currency_code),
                    })}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-muted-foreground">{t("financeMod.invoices.netOpen")}</span>
                  <span className="font-mono tabular-nums">
                    {fmt(
                      Math.max(0, d.invoice.amount - d.debit_notes_open_sum),
                      d.invoice.currency_code,
                    )}
                  </span>
                </div>
              </div>
            )}

            <PaymentHistory
              invoiceId={d.invoice.id}
              currency={d.invoice.currency_code}
              canVoid={Boolean(access.data?.canFinance)}
            />

            <div className="flex flex-wrap gap-2 border-t pt-4">
              {canApproveInvoice(d.invoice.status) && (
                <Button
                  variant="outline"
                  disabled={!canRecord || approveMutation.isPending}
                  onClick={() => approveMutation.mutate()}
                >
                  {approveMutation.isPending ? t("financeMod.invoices.approving") : t("financeMod.invoices.approve")}
                </Button>
              )}
              {d.invoice.status === "approved" && (
                <Button
                  variant="outline"
                  disabled={!canWrite || sendMutation.isPending}
                  onClick={() => sendMutation.mutate()}
                >
                  {t("financeMod.invoices.markSent")}
                </Button>
              )}
              {acceptsPayment(d.invoice.status) && (
                <Button
                  disabled={!canRecord || d.payment_release_blocked}
                  onClick={() => setPayOpen(true)}
                >
                  {t("financeMod.invoices.recordPayment")}
                </Button>
              )}
            </div>

            <RecordPaymentDialog
              open={payOpen}
              onOpenChange={setPayOpen}
              invoiceId={d.invoice.id}
              invoiceNumber={d.invoice.invoice_number}
              currency={d.invoice.currency_code}
              balance={d.invoice.balance}
              blocked={d.payment_release_blocked}
            />

            {d.invoice.direction === "payable" && d.invoice.status !== "paid" && (
              <div className="border-t pt-4">
                <Button
                  className="w-full"
                  disabled={!canWrite || d.payment_release_blocked || mutation.isPending}
                  onClick={() => mutation.mutate()}
                >
                  {mutation.isPending ? t("financeMod.invoices.releasing") : t("financeMod.invoices.markAsPaid")}
                </Button>
                {!canWrite && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("financeMod.invoices.financeAdminRequired")}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
