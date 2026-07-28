// P-194 — Record payment dialog: react-hook-form + zod, live balance-after preview.
import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoneyCell } from "@/components/ui/num";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { errorCodeOf, translateError } from "@/lib/i18n/error-keys";
import { useI18n } from "@/lib/i18n/locale-provider";
import { recordPayment } from "@/lib/payments.functions";
import {
  FORMULAS,
  PAYMENT_METHODS,
  paymentMethodLabel,
  todayIso,
  type PaymentMethod,
} from "@/lib/payments.rules";
import { invoiceErrorMessage } from "@/lib/invoices.query";

const FormSchema = z.object({
  // Explicit coercion: an empty/blank input must read as "Required", never as NaN
  // silently failing a z.coerce.number() with no message the operator can see.
  amount: z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === "string" ? v.trim() : v))
    .refine((v) => v !== "" && Number.isFinite(Number(v)), "financeMod.recordPaymentDialog.requiredAmount")
    .transform((v) => Number(v))
    .refine((n) => n > 0, "financeMod.recordPaymentDialog.amountPositive"),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "financeMod.recordPaymentDialog.validDate"),
  method: z.enum(PAYMENT_METHODS),
  bank_reference: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
});

type FormValues = z.input<typeof FormSchema>;

function fmt(n: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
}

export function RecordPaymentDialog({
  open,
  onOpenChange,
  invoiceId,
  invoiceNumber,
  currency,
  balance,
  blocked,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invoiceId: string;
  invoiceNumber: string;
  currency: string;
  balance: number;
  blocked: boolean;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const recordFn = useServerFn(recordPayment);
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      amount: balance > 0 ? String(balance) : "",
      payment_date: todayIso(),
      method: "bank_transfer" as PaymentMethod,
      bank_reference: "",
      notes: "",
    } as unknown as FormValues,
  });

  const watched = form.watch("amount");
  const formError = form.formState.errors.root?.message;

  const balanceAfter = useMemo(() => {
    const amt = Number(watched);
    if (!Number.isFinite(amt)) return balance;
    return Math.round((balance - amt) * 100) / 100;
  }, [watched, balance]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const parsed = FormSchema.parse(values);
      return recordFn({
        data: {
          invoice_id: invoiceId,
          amount: parsed.amount,
          payment_date: parsed.payment_date,
          method: parsed.method,
          bank_reference: parsed.bank_reference || undefined,
          notes: parsed.notes || undefined,
        },
      });
    },
    onSuccess: async (res) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["payments"] }),
        qc.invalidateQueries({ queryKey: ["invoices"] }),
      ]);
      toast.success(
        t("financeMod.recordPaymentDialog.successMessage", {
          status: res.invoice_status.replace("_", " "),
        }),
      );
      onOpenChange(false);
      form.reset();
    },
    onError: (err) =>
      toast.error(translateError(t, errorCodeOf(err), invoiceErrorMessage(err))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("financeMod.recordPaymentDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("financeMod.recordPaymentDialog.descriptionPrefix", {
              invoiceNumber,
              balance: fmt(balance, currency),
            })}
          </DialogDescription>
        </DialogHeader>

        {blocked && (
          <div
            className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
            role="alert"
          >
            {t("financeMod.recordPaymentDialog.blockedMessage")}
          </div>
        )}

        {formError && (
          <div
            className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
            role="alert"
          >
            {formError}
          </div>
        )}

        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit(
              (values) => {
                form.clearErrors("root");
                mutation.mutate(values);
              },
              // A resolver rejection must never be silent: if no field message is
              // rendered, surface the raw issue list at form level.
              (errors) => {
                const messages = Object.entries(errors)
                  .filter(([name]) => name !== "root")
                  .map(([name, e]) => {
                    const raw = (e as { message?: string })?.message;
                    const msg = raw && raw.startsWith("financeMod.") ? t(raw) : (raw ?? "invalid");
                    return `${name}: ${msg}`;
                  });
                form.setError("root", {
                  message: messages.length
                    ? t("financeMod.recordPaymentDialog.checkFields", { messages: messages.join("; ") })
                    : t("financeMod.recordPaymentDialog.validationFallback"),
                });
              },
            )}
          >

            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("financeMod.recordPaymentDialog.amountLabel", { currency })}</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" min="0.01" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="payment_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("financeMod.recordPaymentDialog.paymentDateLabel")}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="method"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("financeMod.recordPaymentDialog.methodLabel")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PAYMENT_METHODS.map((m) => (
                          <SelectItem key={m} value={m}>
                            {paymentMethodLabel(m)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="bank_reference"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("financeMod.recordPaymentDialog.bankReferenceLabel")}</FormLabel>
                  <FormControl>
                    <Input placeholder={t("financeMod.common.optional")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("financeMod.recordPaymentDialog.notesLabel")}</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder={t("financeMod.common.optional")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center justify-between rounded-md border bg-muted/40 p-3 text-sm">
                  <span className="text-muted-foreground">
                    {t("financeMod.recordPaymentDialog.balanceAfterLabel")}
                  </span>
                  <MoneyCell className={balanceAfter < 0 ? "text-destructive" : undefined}>
                    {fmt(balanceAfter, currency)}
                  </MoneyCell>
                </div>
              </TooltipTrigger>
              <TooltipContent>{FORMULAS.balanceAfter}</TooltipContent>
            </Tooltip>

            {balanceAfter < -0.005 && (
              <p className="text-xs text-destructive">
                {t("financeMod.recordPaymentDialog.overpaymentWarning")}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("financeMod.common.cancel")}
              </Button>
              <Button type="submit" disabled={blocked || mutation.isPending}>
                {mutation.isPending
                  ? t("financeMod.recordPaymentDialog.recording")
                  : t("financeMod.recordPaymentDialog.recordButton")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
