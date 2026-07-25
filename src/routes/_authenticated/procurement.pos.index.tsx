// P-064 — Purchase Orders list with cycle-time KPI.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Receipt, Search } from "lucide-react";
import { format } from "date-fns";

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
import { PoStatusBadge } from "@/components/procurement/po-status-badge";
import { listPos } from "@/lib/po.functions";
import { PO_STATUSES, type PoStatus } from "@/lib/po-rules";
import { posListQueryOptions } from "@/lib/po-query";

export const Route = createFileRoute("/_authenticated/procurement/pos/")({
  head: () => ({
    meta: [
      { title: "Purchase Orders — GridMind EPC" },
      {
        name: "description",
        content:
          "Track purchase orders, CFO approvals, and cycle time across GridMind EPC procurement.",
      },
      { property: "og:title", content: "Purchase Orders — GridMind EPC" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PosIndex,
  errorComponent: PosError,
});

function PosError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 py-16 text-center">
      <h2 className="font-display text-lg font-semibold">Couldn’t load POs</h2>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}

function fmtMoney(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(0)}`;
  }
}

function PosIndex() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<PoStatus | "all">("all");

  const fn = useServerFn(listPos);
  const query = useSuspenseQuery(
    posListQueryOptions(fn, {
      search: search.trim() || null,
      status: status === "all" ? null : status,
    }),
  );
  const rows = query.data;

  const kpi = useMemo(() => {
    const issued = rows.filter((r) => r.issued_at != null);
    const totalDays = issued.reduce((s, r) => {
      const created = new Date(r.created_at).getTime();
      const issuedAt = new Date(r.issued_at as string).getTime();
      return s + Math.max(0, (issuedAt - created) / (1000 * 60 * 60 * 24));
    }, 0);
    const cycle = issued.length === 0 ? null : totalDays / issued.length;
    const pending = rows.filter((r) => r.status === "pending_approval").length;
    return { cycle, pending, total: rows.length };
  }, [rows]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <Receipt className="h-3.5 w-3.5" /> Procurement · Purchase Orders
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Purchase Orders</h1>
          <p className="text-sm text-muted-foreground">
            Awarded RFQs create POs here. CFO approval is required above the company threshold.
          </p>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Kpi
          label="PO cycle time"
          value={kpi.cycle != null ? `${kpi.cycle.toFixed(1)} d` : "—"}
          hint="Created → Issued (avg)"
        />
        <Kpi label="Pending approval" value={String(kpi.pending)} hint="Awaiting CFO sign-off" />
        <Kpi label="Total POs" value={String(kpi.total)} hint="Across all statuses" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Search POs"
            placeholder="Search PO number"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as PoStatus | "all")}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {PO_STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s.replace("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No POs yet — award an RFQ to generate one.
        </div>
      ) : (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO #</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link
                      to="/procurement/pos/$poId"
                      params={{ poId: r.id }}
                      className="font-mono text-sm underline-offset-4 hover:underline"
                    >
                      {r.po_number}
                    </Link>
                  </TableCell>
                  <TableCell>{r.vendor_name ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.project_name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <PoStatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {fmtMoney(r.total_amount, r.currency_code)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(r.created_at), "PP")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-md border border-border p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}
