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
      toast.error(invoiceErrorMessage(err));
    }
  }

  return (
    <div className="page-shell">
      <PageHeader
        title="Payments"
        description="All recorded payments, receivable and payable."
        actions={
          <Button variant="outline" size="sm" disabled={rows.length === 0} onClick={handleExport}>
            <Download className="mr-2 size-4" /> Export CSV
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-56">
          <Search className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Number or bank reference…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select value={direction} onValueChange={(v) => setDirection(v as typeof direction)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Direction" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All directions</SelectItem>
            <SelectItem value="receivable">Receivable</SelectItem>
            <SelectItem value="payable">Payable</SelectItem>
          </SelectContent>
        </Select>
        <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Method" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All methods</SelectItem>
            {PAYMENT_METHODS.map((m) => (
              <SelectItem key={m} value={m}>
                {paymentMethodLabel(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={recon} onValueChange={(v) => setRecon(v as typeof recon)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Reconciliation" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All reconciliation</SelectItem>
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
          aria-label="From date"
        />
        <Input
          type="date"
          className="w-40"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label="To date"
        />
      </div>

      {rowsQ.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : rowsQ.isError ? (
        <p className="text-sm text-destructive">Could not load payments. Try again.</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No payments"
          description="Record a payment from an invoice to see it here."
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Reconciliation</TableHead>
                <TableHead>Status</TableHead>
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
                        {p.direction === "payable" ? "Payable" : "Receivable"}
                      </Badge>
                    </TableCell>
                    <TableCell>{p.project_name ?? "—"}</TableCell>
                    <TableCell>{p.payment_date}</TableCell>
                    <TableCell>{paymentMethodLabel(p.method)}</TableCell>
                    <TableCell className="text-right">
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
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {reconciliationLabel(p.reconciliation_status)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {voided ? (
                        <Badge variant="destructive">Voided</Badge>
                      ) : (
                        <Badge variant="secondary">Recorded</Badge>
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
