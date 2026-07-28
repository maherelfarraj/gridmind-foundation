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
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { RfqStatusBadge } from "@/components/procurement/rfq-status-badge";
import { useI18n } from "@/lib/i18n/locale-provider";
import { getRfqWriteAccess, listRfqs, type RfqRow } from "@/lib/rfq.functions";
import { RFQ_STATUSES, type RfqStatus } from "@/lib/rfq-rules";
import { rfqWriteAccessQueryOptions, rfqsListQueryOptions } from "@/lib/rfq-query";

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
  const { t } = useI18n();
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 py-16 text-center">
      <h2 className="font-display text-lg font-semibold">{t("procurementMod.rfqs.loadError")}</h2>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <Button onClick={() => reset()}>{t("procurementMod.common.tryAgain")}</Button>
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
  const { t } = useI18n();
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
    <div className="page-shell">
      <PageHeader
        title={t("procurementMod.rfqs.title")}
        description={t("procurementMod.rfqs.subtitle")}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => downloadCsv(rows)}
              disabled={rows.length === 0}
            >
              <Download className="me-2 h-4 w-4" /> {t("procurementMod.common.export")}
            </Button>
            {canAuthor && (
              <Button asChild>
                <Link to="/procurement/rfqs/new">
                  <Plus className="me-2 h-4 w-4" /> {t("procurementMod.rfqs.newRfq")}
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="ps-9"
            placeholder={t("procurementMod.rfqs.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as any)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("procurementMod.common.allStatuses")}</SelectItem>
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
        <EmptyState
          icon={MailPlus}
          title={t("procurementMod.rfqs.emptyTitle")}
          description={t("procurementMod.rfqs.emptyDescription")}
          action={
            canAuthor ? (
              <Button asChild>
                <Link to="/procurement/rfqs/new">
                  <Plus className="me-2 h-4 w-4" /> {t("procurementMod.rfqs.newRfq")}
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("procurementMod.rfqs.colNumber")}</TableHead>
              <TableHead>{t("procurementMod.rfqs.colTitle")}</TableHead>
              <TableHead>{t("procurementMod.rfqs.colProject")}</TableHead>
              <TableHead>{t("procurementMod.common.status")}</TableHead>
              <TableHead>{t("procurementMod.rfqs.colDue")}</TableHead>
              <TableHead>{t("procurementMod.rfqs.colCurrency")}</TableHead>
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
                <TableCell className="text-sm text-muted-foreground">{r.currency_code}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
