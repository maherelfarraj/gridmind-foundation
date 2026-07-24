// P-063 — RFQ list page.
import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, MailPlus, Plus, Search } from "lucide-react";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RfqStatusBadge } from "@/components/procurement/rfq-status-badge";
import {
  getRfqWriteAccess,
  listRfqs,
  type RfqRow,
} from "@/lib/rfq.functions";
import { RFQ_STATUSES, type RfqStatus } from "@/lib/rfq-rules";
import {
  rfqWriteAccessQueryOptions,
  rfqsListQueryOptions,
} from "@/lib/rfq-query";

export const Route = createFileRoute("/_authenticated/procurement/rfqs/")({
  head: () => ({
    meta: [
      { title: "RFQs — GridMind EPC" },
      {
        name: "description",
        content:
          "Author, issue, and level requests for quotation across GridMind EPC procurement pipelines.",
      },
      { property: "og:title", content: "RFQs — GridMind EPC" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RfqsIndex,
  errorComponent: RfqsError,
});

function RfqsError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 py-16 text-center">
      <h2 className="font-display text-lg font-semibold">Couldn’t load RFQs</h2>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}

function toCsv(rows: RfqRow[]): string {
  const header = ["rfq_number", "title", "project", "status", "issue_date", "due_date", "currency"];
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      r.rfq_number,
      r.title,
      r.project_name ?? "",
      r.status,
      r.issue_date ?? "",
      r.due_date ?? "",
      r.currency_code,
    ]
      .map(escape)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

function downloadCsv(rows: RfqRow[]) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rfqs-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function RfqsIndex() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<RfqStatus | "all">("all");
  const navigate = useNavigate();
  const listFn = useServerFn(listRfqs);
  const accessFn = useServerFn(getRfqWriteAccess);

  const filters = useMemo(
    () => ({
      search: search.trim() || null,
      status: status === "all" ? null : status,
    }),
    [search, status],
  );

  const rfqsQuery = useSuspenseQuery(rfqsListQueryOptions(listFn, filters));
  const accessQuery = useSuspenseQuery(rfqWriteAccessQueryOptions(accessFn));
  const rows = rfqsQuery.data;
  const canAuthor = accessQuery.data.canAuthor;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <MailPlus className="h-3.5 w-3.5" /> Procurement
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight">RFQs</h1>
          <p className="text-sm text-muted-foreground">
            Requests for quotation — invite vendors, collect bids, and level with TCO.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => downloadCsv(rows)} disabled={rows.length === 0}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
          {canAuthor && (
            <Button asChild>
              <Link to="/procurement/rfqs/new">
                <Plus className="mr-2 h-4 w-4" /> New RFQ
              </Link>
            </Button>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search title or RFQ number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as any)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {RFQ_STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rfqsQuery.isFetching ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center">
          <MailPlus className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <h2 className="font-display text-lg font-semibold">No RFQs yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Draft your first RFQ, invite vendors, and level bids in one workspace.
          </p>
          {canAuthor && (
            <Button className="mt-4" asChild>
              <Link to="/procurement/rfqs/new">
                <Plus className="mr-2 h-4 w-4" /> New RFQ
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Currency</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer"
                  onClick={() =>
                    navigate({
                      to: "/procurement/rfqs/$rfqId",
                      params: { rfqId: r.id },
                    })
                  }
                >
                  <TableCell className="font-mono text-sm">{r.rfq_number}</TableCell>
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.project_name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <RfqStatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.due_date ? format(new Date(r.due_date), "PP") : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.currency_code}
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
