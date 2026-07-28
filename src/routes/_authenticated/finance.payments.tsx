// P-194 — Payments register: server-filtered table with CSV export gated by export locks.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Inbox, Search } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { MoneyCell } from "@/components/ui/num";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { downloadCsv } from "@/lib/csv";
import { errorCodeOf, translateError } from "@/lib/i18n/error-keys";
import { useI18n } from "@/lib/i18n/locale-provider";
import { invoiceErrorMessage } from "@/lib/invoices.query";
import { exportPaymentsCsv } from "@/lib/payments.functions";
import { paymentsListQueryOptions } from "@/lib/payments.query";
import {
  FORMULAS,
  PAYMENT_METHODS,
  RECONCILIATION_STATUSES,
  paymentMethodLabel,
  reconciliationLabel,
  type ListPaymentsInput,
  type PaymentMethod,
  type ReconciliationStatus,
} from "@/lib/payments.rules";

export const Route = createFileRoute("/_authenticated/finance/payments")({
  head: () => ({
    meta: [
      { title: "Payments register — GridMind EPC" },
      {
        name: "description",
        content:
          "Every recorded receivable and payable payment with reconciliation status, FX base amounts and CSV export.",
      },
      { property: "og:title", content: "Payments register — GridMind EPC" },
      {
        property: "og:description",
        content: "Recorded payments across projects with reconciliation and FX base amounts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PaymentsPage,
});

function fmt(n: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
}

function PaymentsPage() {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [direction, setDirection] = useState<"all" | "receivable" | "payable">("all");
  const [method, setMethod] = useState<"all" | PaymentMethod>("all");
  const [recon, setRecon] = useState<"all" | ReconciliationStatus>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filters: ListPaymentsInput = useMemo(
    () => ({
      q: q.trim() || undefined,
      direction: direction === "all" ? undefined : direction,
      method: method === "all" ? undefined : method,
      reconciliation_status: recon === "all" ? undefined : recon,
      date_from: from || undefined,
      date_to: to || undefined,
    }),
    [q, direction, method, recon, from, to],
  );

  const rowsQ = useQuery(paymentsListQueryOptions(filters));
  const exportFn = useServerFn(exportPaymentsCsv);
  const rows = rowsQ.data?.rows ?? [];

  async function handleExport() {
    try {
      const res = await exportFn({ data: filters });
      downloadCsv(res.filename, res.csv);
    } catch (err) {
      toast.error(translateError(t, errorCodeOf(err), invoiceErrorMessage(err)));
    }
  }

  return (
    <div className="page-shell">
      <PageHeader
        title={t("financeMod.payments.title")}
        description={t("financeMod.paymentsPage.subtitle")}
        actions={
          <Button variant="outline" size="sm" disabled={rows.length === 0} onClick={handleExport}>
            <Download className="me-2 size-4" /> {t("financeMod.common.export")}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-56">
          <Search className="pointer-events-none absolute start-2 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="ps-8"
            placeholder={t("financeMod.paymentsPage.searchPlaceholder")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select value={direction} onValueChange={(v) => setDirection(v as typeof direction)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder={t("financeMod.payments.direction")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("financeMod.paymentsPage.allDirections")}</SelectItem>
            <SelectItem value="receivable">{t("financeMod.invoices.receivable")}</SelectItem>
            <SelectItem value="payable">{t("financeMod.invoices.payable")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder={t("financeMod.payments.method")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("financeMod.paymentsPage.allMethods")}</SelectItem>
            {PAYMENT_METHODS.map((m) => (
              <SelectItem key={m} value={m}>
                {paymentMethodLabel(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={recon} onValueChange={(v) => setRecon(v as typeof recon)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder={t("financeMod.paymentsPage.columnReconciliation")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("financeMod.paymentsPage.allReconciliation")}</SelectItem>
            {RECONCILIATION_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {reconciliationLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          className="w-40"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label={t("financeMod.paymentsPage.fromDate")}
        />
        <Input
          type="date"
          className="w-40"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label={t("financeMod.paymentsPage.toDate")}
        />
      </div>

      {rowsQ.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : rowsQ.isError ? (
        <p className="text-sm text-destructive">{t("financeMod.paymentsPage.couldNotLoad")}</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={t("financeMod.paymentsPage.noPayments")}
          description={t("financeMod.paymentsPage.emptyHint")}
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("financeMod.paymentsPage.columnNumber")}</TableHead>
                <TableHead>{t("financeMod.paymentsPage.columnInvoice")}</TableHead>
                <TableHead>{t("financeMod.paymentsPage.columnDirection")}</TableHead>
                <TableHead>{t("financeMod.paymentsPage.columnProject")}</TableHead>
                <TableHead>{t("financeMod.paymentsPage.columnDate")}</TableHead>
                <TableHead>{t("financeMod.paymentsPage.columnMethod")}</TableHead>
                <TableHead className="text-end">{t("financeMod.paymentsPage.columnAmount")}</TableHead>
                <TableHead>{t("financeMod.paymentsPage.columnReconciliation")}</TableHead>
                <TableHead>{t("financeMod.paymentsPage.columnStatus")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const voided = p.record_status === "voided";
                return (
                  <TableRow key={p.id} className={voided ? "opacity-60" : undefined}>
                    <TableCell className={voided ? "line-through" : undefined}>
                      {p.payment_number}
                    </TableCell>
                    <TableCell>{p.invoice_number ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={p.direction === "payable" ? "outline" : "secondary"}>
                        {p.direction === "payable" ? t("financeMod.invoices.payable") : t("financeMod.invoices.receivable")}
                      </Badge>
                    </TableCell>
                    <TableCell>{p.project_name ?? "—"}</TableCell>
                    <TableCell>{p.payment_date}</TableCell>
                    <TableCell>{paymentMethodLabel(p.method)}</TableCell>
                    <TableCell>
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
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {reconciliationLabel(p.reconciliation_status)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {voided ? (
                        <Badge variant="destructive">{t("financeMod.paymentsPage.voided")}</Badge>
                      ) : (
                        <Badge variant="secondary">{t("financeMod.paymentsPage.recorded")}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
