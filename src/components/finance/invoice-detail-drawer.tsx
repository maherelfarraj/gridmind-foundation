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
import { markInvoicePaid } from "@/lib/invoices.functions";
import {
  invoiceDetailQueryOptions,
  invoiceErrorCode,
  invoiceErrorMessage,
} from "@/lib/invoices.query";
import { invoiceStatusLabel } from "@/lib/invoices.rules";

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
  const qc = useQueryClient();
  const payFn = useServerFn(markInvoicePaid);
  const detail = useQuery({
    ...invoiceDetailQueryOptions(invoiceId ?? "00000000-0000-0000-0000-000000000000"),
    enabled: Boolean(invoiceId) && open,
  });

  const mutation = useMutation({
    mutationFn: () => payFn({ data: { id: invoiceId! } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Invoice marked as paid");
    },
    onError: (err) => {
      const code = invoiceErrorCode(err);
      if (code === "payment_release_blocked") {
        toast.error("Payment release blocked by 3-way match variance");
      } else {
        toast.error(invoiceErrorMessage(err));
      }
    },
  });

  const d = detail.data;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{d ? d.invoice.invoice_number : "Invoice"}</SheetTitle>
          <SheetDescription>
            {d ? `${d.invoice.direction === "payable" ? "Payable" : "Receivable"} invoice` : ""}
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
                    <p className="font-medium">
                      Payment release blocked by 3-way match variance
                    </p>
                    <p className="text-xs">
                      Resolve the linked match to release payment.
                    </p>
                    {d.blocked_match_ids[0] && (
                      <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
                        <Link
                          to="/procurement/matches"
                          hash={d.blocked_match_ids[0]}
                        >
                          Open matching workbench
                          <ExternalLink className="ml-1 inline size-3" />
                        </Link>
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Status</dt>
                <dd>
                  <Badge variant={STATUS_VARIANT[d.invoice.status] ?? "outline"}>
                    {invoiceStatusLabel(d.invoice.status)}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Amount</dt>
                <dd className="font-mono tabular-nums">
                  {fmt(d.invoice.amount, d.invoice.currency_code)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Tax</dt>
                <dd className="font-mono tabular-nums">
                  {fmt(d.invoice.tax_amount, d.invoice.currency_code)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Retention</dt>
                <dd className="font-mono tabular-nums">{d.invoice.retention_pct}%</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Issued</dt>
                <dd>{d.invoice.issue_date ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Due</dt>
                <dd>{d.invoice.due_date ?? "—"}</dd>
              </div>
              {d.invoice.milestone_label && (
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">Milestone</dt>
                  <dd>{d.invoice.milestone_label}</dd>
                </div>
              )}
              {d.invoice.paid_at && (
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">Paid at</dt>
                  <dd>{d.invoice.paid_at.slice(0, 10)}</dd>
                </div>
              )}
            </dl>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Linked</h3>
              <ul className="space-y-1 text-sm">
                {d.contract && (
                  <li>
                    Contract{" "}
                    <Link
                      to="/finance/contracts/$contractId"
                      params={{ contractId: d.contract.id }}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {d.contract.contract_number} — {d.contract.title}
                    </Link>
                  </li>
                )}
                {d.pay_app && (
                  <li>Pay application #{d.pay_app.application_number}</li>
                )}
                {!d.contract && !d.pay_app && (
                  <li className="text-muted-foreground">No linked records.</li>
                )}
              </ul>
            </div>

            {d.debit_notes_open_sum > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                <div className="flex items-start gap-2 text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 size-3.5" />
                  <span>
                    Open balance reduced by{" "}
                    <span className="font-mono">
                      {fmt(d.debit_notes_open_sum, d.invoice.currency_code)}
                    </span>{" "}
                    in debit notes.
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-muted-foreground">Net open</span>
                  <span className="font-mono tabular-nums">
                    {fmt(
                      Math.max(0, d.invoice.amount - d.debit_notes_open_sum),
                      d.invoice.currency_code,
                    )}
                  </span>
                </div>
              </div>
            )}

            {d.invoice.direction === "payable" && d.invoice.status !== "paid" && (
              <div className="border-t pt-4">
                <Button
                  className="w-full"
                  disabled={!canWrite || d.payment_release_blocked || mutation.isPending}
                  onClick={() => mutation.mutate()}
                >
                  {mutation.isPending ? "Releasing…" : "Mark as paid"}
                </Button>
                {!canWrite && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Finance admin role required to release payments.
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
