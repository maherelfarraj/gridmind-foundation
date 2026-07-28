// P-194 — Payment history section for the invoice drawer.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyCell } from "@/components/ui/num";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { errorCodeOf, translateError } from "@/lib/i18n/error-keys";
import { useI18n } from "@/lib/i18n/locale-provider";
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
  const { t } = useI18n();
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
      toast.success(t("financeMod.paymentHistory.paymentVoided"));
      setVoidingId(null);
      setReason("");
    },
    onError: (err) => toast.error(translateError(t, errorCodeOf(err), invoiceErrorMessage(err))),
  });

  if (q.isLoading) return <Skeleton className="h-24 w-full" />;
  if (q.isError)
    return (
      <p className="text-sm text-destructive">{t("financeMod.paymentHistory.couldNotLoad")}</p>
    );

  const rows = q.data?.rows ?? [];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("financeMod.paymentHistory.title")}</h3>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {t("financeMod.paymentHistory.balancePrefix", {
                amount: fmt(q.data?.balance ?? 0, currency),
              })}
            </span>
          </TooltipTrigger>
          <TooltipContent>{FORMULAS.balance}</TooltipContent>
        </Tooltip>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("financeMod.paymentHistory.empty")}</p>
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
                      <MoneyCell className={voided ? "line-through" : undefined}>
                        {fmt(p.amount, p.currency_code)}
                      </MoneyCell>
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
                  {p.bank_reference && (
                    <span>
                      {t("financeMod.paymentHistory.refPrefix", { reference: p.bank_reference })}
                    </span>
                  )}
                  <Badge variant="outline">{reconciliationLabel(p.reconciliation_status)}</Badge>
                  {voided && (
                    <Badge variant="destructive">{t("financeMod.paymentHistory.voided")}</Badge>
                  )}
                </div>
                {voided && p.voided_reason && (
                  <p className="text-xs text-muted-foreground">
                    {t("financeMod.paymentHistory.reasonPrefix", { reason: p.voided_reason })}
                  </p>
                )}
                {!voided && canVoid && (
                  <div className="pt-1">
                    {voidingId === p.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder={t("financeMod.paymentHistory.voidReasonPlaceholder")}
                          className="h-8 text-xs"
                        />
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={reason.trim().length < 3 || mutation.isPending}
                          onClick={() => mutation.mutate(p.id)}
                        >
                          {t("financeMod.paymentHistory.void")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setVoidingId(null)}>
                          {t("financeMod.common.cancel")}
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
                        {t("financeMod.paymentHistory.voidPayment")}
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
