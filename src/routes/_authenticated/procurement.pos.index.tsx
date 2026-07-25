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
import { PageHeader } from "@/components/ui/page-header";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { EmptyState } from "@/components/ui/empty-state";
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
    <div className="page-shell">
      <PageHeader
        title="Purchase Orders"
        description="Awarded RFQs create POs here; CFO approval is required above threshold."
      />

      <KpiGrid columns={3}>
        <KpiTile
          label="PO cycle time"
          value={kpi.cycle != null ? `${kpi.cycle.toFixed(1)} d` : "—"}
          hint="Created → Issued (avg)"
        />
        <KpiTile label="Pending approval" value={String(kpi.pending)} hint="Awaiting CFO sign-off" />
        <KpiTile label="Total POs" value={String(kpi.total)} hint="Across all statuses" />
      </KpiGrid>

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
        <EmptyState
          icon={Receipt}
          title="No POs yet"
          description="Award an RFQ to generate one."
        />
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


