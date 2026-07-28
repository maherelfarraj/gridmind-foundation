// P-064 — Purchase Orders list with cycle-time KPI. POL-3: shared DataTable standard.
import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Receipt } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DataTable,
  DataTablePagination,
  DataTableSearch,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { PoStatusBadge } from "@/components/procurement/po-status-badge";
import {
  AcknowledgmentChip,
  AwaitingAcknowledgmentChip,
} from "@/components/vendor-portal/acknowledgment-chip";
import { isAcknowledgeable, type AcknowledgmentStatus } from "@/lib/vendor-portal.rules";
import { PageHeader } from "@/components/ui/page-header";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { MoneyCell } from "@/components/ui/num";
import { formatDate, formatMoney } from "@/lib/format";
import { listPos } from "@/lib/po.functions";
import { PO_STATUSES, type PoStatus } from "@/lib/po-rules";
import { posListQueryOptions } from "@/lib/po-query";
import { statusLabel } from "@/components/ui/status-badge";
import { useI18n } from "@/lib/i18n/locale-provider";

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
      {
        property: "og:description",
        content: "Track purchase orders, CFO approvals, and procurement cycle time.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PosIndex,
  errorComponent: PosError,
});

function PosError({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 py-16 text-center">
      <h2 className="font-display text-lg font-semibold">{t("procurementMod.pos.loadError")}</h2>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <Button onClick={() => reset()}>{t("procurementMod.common.tryAgain")}</Button>
    </div>
  );
}

type PoRow = ReturnType<typeof usePoRows>["rows"][number];

function usePoRows(search: string, status: PoStatus | "all") {
  const fn = useServerFn(listPos);
  const query = useSuspenseQuery(
    posListQueryOptions(fn, {
      search: search.trim() || null,
      status: status === "all" ? null : status,
    }),
  );
  return { rows: query.data };
}

function PosIndex() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<PoStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const { rows } = usePoRows(search, status);

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

  const pageRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize],
  );

  const columns: DataTableColumn<PoRow>[] = [
    {
      id: "po",
      header: t("procurementMod.pos.colNumber"),
      cell: (r) => <span className="font-mono text-sm">{r.po_number}</span>,
    },
    { id: "vendor", header: t("procurementMod.common.vendor"), cell: (r) => r.vendor_name ?? "—" },
    {
      id: "project",
      header: t("procurementMod.common.project"),
      hideBelow: "lg",
      cell: (r) => <span className="text-muted-foreground">{r.project_name ?? "—"}</span>,
    },
    {
      id: "status",
      header: t("procurementMod.common.status"),
      cell: (r) => <PoStatusBadge status={r.status} />,
    },
    {
      id: "ack",
      header: t("procurementMod.pos.colVendorAck"),
      hideBelow: "lg",
      cell: (r) =>
        r.acknowledgment_status ? (
          <AcknowledgmentChip
            status={r.acknowledgment_status as AcknowledgmentStatus}
            at={r.acknowledged_at}
            note={r.acknowledgment_note}
            by={r.acknowledged_by_email}
          />
        ) : isAcknowledgeable(r.status) ? (
          <AwaitingAcknowledgmentChip />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "total",
      header: t("procurementMod.pos.colTotal"),
      numeric: true,
      cell: (r) => (
        <MoneyCell className="font-medium">
          {formatMoney(r.total_amount, r.currency_code)}
        </MoneyCell>
      ),
    },
    {
      id: "created",
      header: t("procurementMod.pos.colCreated"),
      hideBelow: "md",
      cell: (r) => <span className="text-muted-foreground">{formatDate(r.created_at)}</span>,
    },
  ];

  return (
    <div className="page-shell">
      <PageHeader
        title={t("procurementMod.pos.title")}
        description={t("procurementMod.pos.subtitle")}
      />

      <KpiGrid columns={3}>
        <KpiTile
          label={t("procurementMod.pos.cycleTime")}
          value={kpi.cycle != null ? `${kpi.cycle.toFixed(1)} d` : "—"}
          hint={t("procurementMod.pos.cycleTimeHint")}
        />
        <KpiTile
          label={t("procurementMod.pos.pendingApproval")}
          value={String(kpi.pending)}
          hint={t("procurementMod.pos.pendingApprovalHint")}
          status={kpi.pending > 0 ? "warning" : "neutral"}
        />
        <KpiTile
          label={t("procurementMod.pos.totalPos")}
          value={String(kpi.total)}
          hint={t("procurementMod.pos.totalPosHint")}
        />
      </KpiGrid>

      <DataTable
        columns={columns}
        rows={pageRows}
        getRowId={(r) => r.id}
        onRowClick={(r) => navigate({ to: "/procurement/pos/$poId", params: { poId: r.id } })}
        emptyIcon={Receipt}
        emptyTitle={t("procurementMod.pos.emptyTitle")}
        emptyDescription={t("procurementMod.pos.emptyDescription")}
        toolbar={{
          search: (
            <DataTableSearch
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder={t("procurementMod.pos.searchPlaceholder")}
              label={t("procurementMod.pos.searchLabel")}
            />
          ),
          filters: (
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v as PoStatus | "all");
                setPage(1);
              }}
            >
              <SelectTrigger className="h-10 w-52" aria-label={t("procurementMod.pos.filterLabel")}>
                <SelectValue placeholder={t("procurementMod.common.status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("procurementMod.common.allStatuses")}</SelectItem>
                {PO_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {statusLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ),
        }}
        mobileCard={(r) => ({
          primary: (
            <span className="flex flex-col">
              <span className="font-mono">{r.po_number}</span>
              <span className="truncate text-xs text-muted-foreground">{r.vendor_name ?? "—"}</span>
            </span>
          ),
          badge: <PoStatusBadge status={r.status} />,
          fields: [
            {
              label: t("procurementMod.pos.colTotal"),
              value: formatMoney(r.total_amount, r.currency_code),
            },
            { label: t("procurementMod.pos.colCreated"), value: formatDate(r.created_at) },
          ],
        })}
      />

      {rows.length > pageSize ? (
        <DataTablePagination
          page={page}
          pageSize={pageSize}
          total={rows.length}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
        />
      ) : null}
    </div>
  );
}
