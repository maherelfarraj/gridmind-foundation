// P-080 — Invoices list with filters, CSV export, and detail drawer.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Download, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { InvoiceDetailDrawer } from "@/components/finance/invoice-detail-drawer";
import { downloadCsv } from "@/lib/csv";
import { toInvoicesCsv } from "@/lib/invoices.csv";
import { invoicesAccessQueryOptions, invoicesListQueryOptions } from "@/lib/invoices.query";
import {
  INVOICE_DIRECTIONS,
  INVOICE_STATUSES,
  invoiceStatusLabel,
  type InvoiceDirection,
  type InvoiceStatus,
} from "@/lib/invoices.rules";

export const Route = createFileRoute("/_authenticated/finance/invoices")({
  head: () => ({
    meta: [
      { title: "Invoices — GridMind EPC" },
      {
        name: "description",
        content:
          "Track payable and receivable invoices, guard payment release with 3-way match variance.",
      },
      { property: "og:title", content: "Invoices — GridMind EPC" },
      {
        property: "og:description",
        content: "Track payable and receivable invoices with milestone billing.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => {
    context.queryClient.ensureQueryData(invoicesListQueryOptions());
    context.queryClient.ensureQueryData(invoicesAccessQueryOptions());
  },
  component: InvoicesPage,
});

function fmt(n: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}

function InvoicesPage() {
  const [q, setQ] = useState("");
  const [direction, setDirection] = useState<InvoiceDirection | "all">("all");
  const [status, setStatus] = useState<InvoiceStatus | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const filters = useMemo(
    () => ({
      q: q.trim() || undefined,
      direction: direction === "all" ? undefined : direction,
      status: status === "all" ? undefined : status,
    }),
    [q, direction, status],
  );

  const rowsQ = useSuspenseQuery(invoicesListQueryOptions(filters));
  const accessQ = useSuspenseQuery(invoicesAccessQueryOptions());
  const rows = rowsQ.data.rows;

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Invoices</h1>
          <p className="text-sm text-muted-foreground">
            Payable and receivable invoices across the company.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={rows.length === 0}
          onClick={() =>
            downloadCsv(
              `invoices-${new Date().toISOString().slice(0, 10)}.csv`,
              toInvoicesCsv(rows),
            )
          }
        >
          <Download className="mr-2 size-4" /> Export CSV
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search invoice or milestone…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select value={direction} onValueChange={(v) => setDirection(v as any)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All directions</SelectItem>
            {INVOICE_DIRECTIONS.map((d) => (
              <SelectItem key={d} value={d}>
                {d === "payable" ? "Payable" : "Receivable"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as any)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {INVOICE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {invoiceStatusLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border">
        {rowsQ.isFetching && rows.length === 0 ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">No invoices yet</p>
            <p className="mt-1">
              Create receivable invoices from a contract&apos;s Bill milestone action, or ingest
              payable invoices from Procurement.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead>Milestone / Ref</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead>Due</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setOpenId(r.id)}
                >
                  <TableCell className="font-mono text-xs">{r.invoice_number}</TableCell>
                  <TableCell>
                    <Badge variant={r.direction === "payable" ? "destructive" : "secondary"}>
                      {r.direction === "payable" ? "Payable" : "Receivable"}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[24rem] truncate text-sm">
                    {r.milestone_label ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{invoiceStatusLabel(r.status)}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmt(r.amount, r.currency_code)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                    {fmt(r.tax_amount, r.currency_code)}
                  </TableCell>
                  <TableCell className="text-sm">{r.due_date ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <InvoiceDetailDrawer
        invoiceId={openId}
        open={openId !== null}
        onOpenChange={(v) => !v && setOpenId(null)}
        canWrite={accessQ.data.canWrite}
      />
    </div>
  );
}
