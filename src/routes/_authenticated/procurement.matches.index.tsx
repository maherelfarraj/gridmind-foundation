// P-067 — Three-way match list + KPI tile.
import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Plus, Scale, Search } from "lucide-react";
import { format } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { MatchStatusBadge } from "@/components/procurement/match-status-badge";
import { getMatchVarianceKpi, listMatchablePos, listMatches } from "@/lib/match.functions";
import { MATCH_STATUSES, type MatchStatus } from "@/lib/match-rules";
import {
  matchKpiQueryOptions,
  matchListQueryOptions,
  matchablePosQueryOptions,
} from "@/lib/match-query";

export const Route = createFileRoute("/_authenticated/procurement/matches/")({
  head: () => ({
    meta: [
      { title: "Invoice Matching — GridMind EPC" },
      {
        name: "description",
        content:
          "Three-way match vendor invoices against POs and goods receipts before releasing payment.",
      },
      { property: "og:title", content: "Invoice Matching — GridMind EPC" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MatchesIndex,
  errorComponent: MatchesError,
});

function MatchesError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 py-16 text-center">
      <h2 className="font-display text-lg font-semibold">Couldn’t load invoice matches</h2>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join(
    "\n",
  );
}

function formatCurrency(amount: number, code: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}

function varianceBadge(pct: number) {
  const abs = Math.abs(pct);
  const variant = abs >= 5 ? "destructive" : abs >= 1 ? "secondary" : "default";
  const sign = pct > 0 ? "+" : "";
  return <Badge variant={variant}>{`${sign}${pct.toFixed(2)}%`}</Badge>;
}

function MatchesIndex() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<MatchStatus | "all">("all");
  const navigate = useNavigate();

  const listFn = useServerFn(listMatches);
  const kpiFn = useServerFn(getMatchVarianceKpi);
  const posFn = useServerFn(listMatchablePos);

  const query = useSuspenseQuery(
    matchListQueryOptions(listFn, {
      search: search.trim() || null,
      status: status === "all" ? null : status,
    }),
  );
  const kpi = useSuspenseQuery(matchKpiQueryOptions(kpiFn));
  const posQuery = useSuspenseQuery(matchablePosQueryOptions(posFn));
  const rows = query.data;

  const handleNew = () => {
    const first = posQuery.data[0];
    navigate({
      to: "/procurement/matches/new",
      search: first ? { po: first.id } : {},
    });
  };

  const exportCsv = () => {
    const csv = toCsv(
      rows.map((r) => ({
        po: r.po_number ?? "",
        grn: r.grn_number ?? "",
        vendor: r.vendor_name ?? "",
        invoice: r.vendor_invoice_number,
        invoice_amount: r.invoice_amount,
        currency: r.invoice_currency_code,
        po_total: r.po_total,
        amount_variance: r.amount_variance ?? 0,
        status: r.status,
        blocked: r.payment_release_blocked ? "yes" : "no",
      })),
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoice-matches-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <Scale className="h-3.5 w-3.5" /> Procurement · Invoice matching
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Three-way match</h1>
          <p className="text-sm text-muted-foreground">
            Compare vendor invoices to PO totals and confirmed goods receipts — variance beyond
            tolerance blocks payment release.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
          <Button size="sm" onClick={handleNew} disabled={posQuery.data.length === 0}>
            <Plus className="mr-2 h-4 w-4" /> New match
          </Button>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-border p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Avg variance this quarter
          </div>
          <div className="mt-1 font-display text-2xl font-bold">{kpi.data.avgPct.toFixed(2)}%</div>
          <div className="text-xs text-muted-foreground">
            {kpi.data.count} match{kpi.data.count === 1 ? "" : "es"}
          </div>
        </div>
        <div className="rounded-md border border-border p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Blocked</div>
          <div className="mt-1 font-display text-2xl font-bold">
            {rows.filter((r) => r.payment_release_blocked).length}
          </div>
        </div>
        <div className="rounded-md border border-border p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Approved w/ variance
          </div>
          <div className="mt-1 font-display text-2xl font-bold">
            {rows.filter((r) => r.status === "approved_with_variance").length}
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Search invoice number"
            placeholder="Search vendor invoice #"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as MatchStatus | "all")}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {MATCH_STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No invoices matched yet — start one against an issued PO.
        </div>
      ) : (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO</TableHead>
                <TableHead>GRN</TableHead>
                <TableHead>Vendor invoice #</TableHead>
                <TableHead className="text-right">Invoice</TableHead>
                <TableHead className="text-right">PO total</TableHead>
                <TableHead>Variance</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const pct = r.po_total > 0 ? ((r.amount_variance ?? 0) / r.po_total) * 100 : 0;
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      {r.po_number ? (
                        <Link
                          to="/procurement/pos/$poId"
                          params={{ poId: r.po_id }}
                          className="text-sm underline-offset-4 hover:underline"
                        >
                          {r.po_number}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.grn_number ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Link
                        to="/procurement/matches/$matchId"
                        params={{ matchId: r.id }}
                        className="font-mono text-sm underline-offset-4 hover:underline"
                      >
                        {r.vendor_invoice_number}
                      </Link>
                      {r.payment_release_blocked && (
                        <div className="text-xs text-destructive">Payment blocked</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(r.invoice_amount, r.invoice_currency_code)}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {formatCurrency(r.po_total, r.invoice_currency_code)}
                    </TableCell>
                    <TableCell>{varianceBadge(pct)}</TableCell>
                    <TableCell>
                      <MatchStatusBadge status={r.status} />
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
