// P-066 — Goods Receipts list.
import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, PackageOpen, Plus, Search } from "lucide-react";
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
import { GrnStatusBadge } from "@/components/procurement/grn-status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { listGrns, listReceivablePos } from "@/lib/grn.functions";
import { GRN_STATUSES, type GrnStatus } from "@/lib/grn-rules";
import { grnListQueryOptions, receivablePosQueryOptions } from "@/lib/grn-query";

export const Route = createFileRoute("/_authenticated/procurement/receipts/")({
  head: () => ({
    meta: [
      { title: "Goods Receipts — GridMind EPC" },
      {
        name: "description",
        content:
          "Record deliveries against purchase orders — lot IDs, defects, and photos captured on site.",
      },
      { property: "og:title", content: "Goods Receipts — GridMind EPC" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReceiptsIndex,
  errorComponent: ReceiptsError,
});

function ReceiptsError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 py-16 text-center">
      <h2 className="font-display text-lg font-semibold">Couldn’t load receipts</h2>
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

function ReceiptsIndex() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<GrnStatus | "all">("all");
  const navigate = useNavigate();

  const listFn = useServerFn(listGrns);
  const receivableFn = useServerFn(listReceivablePos);
  const query = useSuspenseQuery(
    grnListQueryOptions(listFn, {
      search: search.trim() || null,
      status: status === "all" ? null : status,
    }),
  );
  const receivable = useSuspenseQuery(receivablePosQueryOptions(receivableFn));
  const rows = query.data;

  const handleNew = () => {
    const first = receivable.data[0];
    if (first) {
      navigate({
        to: "/procurement/receipts/new",
        search: { po: first.id },
      });
    } else {
      navigate({ to: "/procurement/receipts/new", search: {} });
    }
  };

  const exportCsv = () => {
    const csv = toCsv(
      rows.map((r) => ({
        grn: r.grn_number,
        po: r.po_number ?? "",
        vendor: r.vendor_name ?? "",
        project: r.project_name ?? "",
        status: r.status,
        defects: r.defects_count,
        received_at: r.received_at ?? "",
      })),
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `goods-receipts-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page-shell">
      <PageHeader
        title="Goods Receipts"
        description="Log deliveries against issued POs — lot IDs, condition, and photos."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </Button>
            <Button size="sm" onClick={handleNew} disabled={receivable.data.length === 0}>
              <Plus className="mr-2 h-4 w-4" /> New receipt
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Search receipts"
            placeholder="Search GRN number"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as GrnStatus | "all")}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {GRN_STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s.replace("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={PackageOpen}
          title="No goods receipts yet"
          description="Start one against an issued PO."
        />
      ) : (
        <div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>GRN #</TableHead>
                <TableHead>PO</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Defects</TableHead>
                <TableHead>Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link
                      to="/procurement/receipts/$grnId"
                      params={{ grnId: r.id }}
                      className="font-mono text-sm underline-offset-4 hover:underline"
                    >
                      {r.grn_number}
                    </Link>
                  </TableCell>
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
                    {r.vendor_name ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.project_name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <GrnStatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-right font-medium">{r.defects_count}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.received_at ? format(new Date(r.received_at), "PP") : "—"}
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
