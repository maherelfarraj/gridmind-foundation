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
import { formatDate, formatMoney } from "@/lib/format";
import { listPos } from "@/lib/po.functions";
import { PO_STATUSES, type PoStatus } from "@/lib/po-rules";
import { posListQueryOptions } from "@/lib/po-query";
import { statusLabel } from "@/components/ui/status-badge";

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
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 py-16 text-center">
      <h2 className="font-display text-lg font-semibold">Couldn’t load POs</h2>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <Button onClick={() => reset()}>Try again</Button>
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
      header: "PO #",
      cell: (r) => <span className="font-mono text-sm">{r.po_number}</span>,
    },
    { id: "vendor", header: "Vendor", cell: (r) => r.vendor_name ?? "—" },
    {
      id: "project",
      header: "Project",
      hideBelow: "lg",
      cell: (r) => <span className="text-muted-foreground">{r.project_name ?? "—"}</span>,
    },
    { id: "status", header: "Status", cell: (r) => <PoStatusBadge status={r.status} /> },
    {
      id: "ack",
      header: "Vendor ack",
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
      header: "Total",
      numeric: true,
      cell: (r) => (
        <span className="font-medium">{formatMoney(r.total_amount, r.currency_code)}</span>
      ),
    },
    {
      id: "created",
      header: "Created",
      hideBelow: "md",
      cell: (r) => <span className="text-muted-foreground">{formatDate(r.created_at)}</span>,
    },
  ];

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
        <KpiTile
          label="Pending approval"
          value={String(kpi.pending)}
          hint="Awaiting CFO sign-off"
          status={kpi.pending > 0 ? "warning" : "neutral"}
        />
        <KpiTile label="Total POs" value={String(kpi.total)} hint="Across all statuses" />
      </KpiGrid>

      <DataTable
        columns={columns}
        rows={pageRows}
        getRowId={(r) => r.id}
        onRowClick={(r) => navigate({ to: "/procurement/pos/$poId", params: { poId: r.id } })}
        emptyIcon={Receipt}
        emptyTitle="No POs yet"
        emptyDescription="Award an RFQ to generate one."
        toolbar={{
          search: (
            <DataTableSearch
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="Search PO number"
              label="Search POs"
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
              <SelectTrigger className="h-10 w-52" aria-label="Filter by status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
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
            { label: "Total", value: formatMoney(r.total_amount, r.currency_code) },
            { label: "Created", value: formatDate(r.created_at) },
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
