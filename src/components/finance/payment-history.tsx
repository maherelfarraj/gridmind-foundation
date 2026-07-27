// P-194 — Payment history section for the invoice drawer.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { invoiceErrorMessage } from "@/lib/invoices.query";
import { voidPayment } from "@/lib/payments.functions";
import { invoicePaymentsQueryOptions } from "@/lib/payments.query";
import { FORMULAS, paymentMethodLabel, reconciliationLabel } from "@/lib/payments.rules";

function fmt(n: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
}

export function PaymentHistory({
  invoiceId,
  currency,
  canVoid,
}: {
  invoiceId: string;
  currency: string;
  canVoid: boolean;
}) {
  const qc = useQueryClient();
  const voidFn = useServerFn(voidPayment);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const q = useQuery(invoicePaymentsQueryOptions(invoiceId));

  const mutation = useMutation({
    mutationFn: (payment_id: string) => voidFn({ data: { payment_id, reason: reason.trim() } }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["payments"] }),
        qc.invalidateQueries({ queryKey: ["invoices"] }),
      ]);
      toast.success("Payment voided");
      setVoidingId(null);
      setReason("");
    },
    onError: (err) => toast.error(invoiceErrorMessage(err)),
  });

  if (q.isLoading) return <Skeleton className="h-24 w-full" />;
  if (q.isError)
    return <p className="text-sm text-destructive">Could not load payment history.</p>;

  const rows = q.data?.rows ?? [];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Payment history</h3>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              Balance {fmt(q.data?.balance ?? 0, currency)}
            </span>
          </TooltipTrigger>
          <TooltipContent>{FORMULAS.balance}</TooltipContent>
        </Tooltip>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {rows.map((p) => {
            const voided = p.record_status === "voided";
            return (
              <li key={p.id} className="space-y-1 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className={voided ? "font-medium line-through" : "font-medium"}>
                    {p.payment_number}
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className={
                          voided
                            ? "font-mono tabular-nums line-through"
                            : "font-mono tabular-nums"
                        }
                      >
                        {fmt(p.amount, p.currency_code)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {p.amount_base !== null
                        ? `${fmt(p.amount_base, p.base_currency_code ?? p.currency_code)} — ${FORMULAS.amountBase}`
                        : FORMULAS.amountBase}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{p.payment_date}</span>
                  <span>{paymentMethodLabel(p.method)}</span>
                  {p.bank_reference && <span>Ref {p.bank_reference}</span>}
                  <Badge variant="outline">{reconciliationLabel(p.reconciliation_status)}</Badge>
                  {voided && <Badge variant="destructive">Voided</Badge>}
                </div>
                {voided && p.voided_reason && (
                  <p className="text-xs text-muted-foreground">Reason: {p.voided_reason}</p>
                )}
                {!voided && canVoid && (
                  <div className="pt-1">
                    {voidingId === p.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="Void reason (required)"
                          className="h-8 text-xs"
                        />
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={reason.trim().length < 3 || mutation.isPending}
                          onClick={() => mutation.mutate(p.id)}
                        >
                          Void
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setVoidingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => {
                          setVoidingId(p.id);
                          setReason("");
                        }}
                      >
                        Void payment
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
