// P-106 — Work Orders kanban + table + KPIs.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { Download, LayoutGrid, Rows, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatMoney } from "@/lib/format";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { objectsToCsv, downloadCsv } from "@/lib/csv";
import {
  getWorkOrderKpis,
  listWorkOrders,
  updateWorkOrderStatus,
  type WorkOrderRow,
} from "@/lib/work-orders.functions";
import type { WorkOrderStatus } from "@/lib/work-orders.rules";
import { canTransition, WORK_ORDER_STATUSES } from "@/lib/work-orders.rules";
import { CreateWorkOrderDialog } from "@/components/work-orders/create-work-order-dialog";
import { WorkOrderDrawer } from "@/components/work-orders/work-order-drawer";
import { useI18n } from "@/lib/i18n/locale-provider";

export const Route = createFileRoute("/_authenticated/om/work-orders")({
  head: () => ({
    meta: [
      { title: "Work orders — GridMind EPC" },
      {
        name: "description",
        content:
          "Maintenance work orders: kanban board, parts and labor capture, PM vs corrective KPIs.",
      },
      { property: "og:title", content: "Work orders — GridMind EPC" },
      {
        property: "og:description",
        content: "Maintenance work orders: kanban, parts and labor capture, PM vs CM KPIs.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WorkOrdersPage,
});

const KANBAN_COLUMNS: readonly WorkOrderStatus[] = [
  "open",
  "assigned",
  "in_progress",
  "on_hold",
  "completed",
  "closed",
];

function priorityCls(p: string) {
  return p === "emergency"
    ? "bg-destructive text-destructive-foreground"
    : p === "high"
      ? "bg-warning text-warning-foreground"
      : p === "medium"
        ? "bg-secondary text-secondary-foreground"
        : "bg-muted text-muted-foreground";
}

function initials(name: string | null | undefined, email: string | null | undefined) {
  const s = (name ?? email ?? "?").trim();
  if (!s) return "?";
  const parts = s.split(/\s+|@/);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}

function isOverdue(due: string | null | undefined, status: WorkOrderStatus) {
  if (!due) return false;
  if (status === "closed" || status === "cancelled") return false;
  return new Date(due).getTime() < Date.now();
}

function money(n: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n);
}

// ---------------------------------------------------------------------------
function WorkOrdersPage() {
  const { t } = useI18n();
  const listFn = useServerFn(listWorkOrders);
  const kpiFn = useServerFn(getWorkOrderKpis);
  const statusFn = useServerFn(updateWorkOrderStatus);
  const qc = useQueryClient();

  const [q, setQ] = useState("");
  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [openId, setOpenId] = useState<string | null>(null);

  const rowsQ = useQuery({
    queryKey: ["work-orders", { q }],
    queryFn: () => listFn({ data: q ? { q } : {} }),
  });
  const kpisQ = useQuery({ queryKey: ["wo-kpis"], queryFn: () => kpiFn({ data: {} }) });

  const rows = rowsQ.data ?? [];

  const statusMut = useMutation({
    mutationFn: (v: { id: string; status: WorkOrderStatus }) => statusFn({ data: v }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["work-orders", { q }] });
      const prev = qc.getQueryData<WorkOrderRow[]>(["work-orders", { q }]);
      if (prev) {
        qc.setQueryData<WorkOrderRow[]>(
          ["work-orders", { q }],
          prev.map((r) => (r.id === v.id ? { ...r, status: v.status } : r)),
        );
      }
      return { prev };
    },
    onError: (err: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["work-orders", { q }], ctx.prev);
      toast.error(err.message || t("omMod.workOrders.statusRejected"));
    },
    onSuccess: () => {
      toast.success(t("omMod.workOrders.statusUpdated"));
      qc.invalidateQueries({ queryKey: ["wo-kpis"] });
    },
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const columns = useMemo(() => {
    const acc: Record<WorkOrderStatus, WorkOrderRow[]> = {
      open: [],
      assigned: [],
      in_progress: [],
      on_hold: [],
      completed: [],
      closed: [],
      cancelled: [],
    };
    for (const r of rows) acc[r.status].push(r);
    return acc;
  }, [rows]);

  function onDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    const to = e.over?.id as WorkOrderStatus | undefined;
    if (!to) return;
    const row = rows.find((r) => r.id === id);
    if (!row || row.status === to) return;
    if (to === "closed") {
      toast.info(t("omMod.workOrders.moveClosedInfo"));
      setOpenId(id);
      return;
    }
    if (!canTransition(row.status, to)) {
      toast.error(t("omMod.workOrders.cannotMove", { from: row.status, to }));
      return;
    }
    statusMut.mutate({ id, status: to });
  }

  function exportCsv() {
    const csv = objectsToCsv(
      rows.map((r) => ({
        wo_number: r.wo_number,
        title: r.title,
        project: r.project_name ?? "",
        equipment: r.equipment_tag ?? "",
        type: r.type,
        priority: r.priority,
        status: r.status,
        assignee: r.assignee_name ?? r.assignee_email ?? "",
        due_date: r.due_date ?? "",
        total_cost: r.total_cost,
        created_at: r.created_at,
      })),
    );
    downloadCsv(`work-orders-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  return (
    <div className="page-shell">
      <PageHeader
        title={t("omMod.workOrders.title")}
        description={t("omMod.workOrders.description")}
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute start-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="w-64 ps-8"
                placeholder={t("omMod.workOrders.searchPlaceholder")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <Button variant="outline" onClick={exportCsv} disabled={!rows.length}>
              <Download className="me-2 h-4 w-4" /> {t("omMod.common.csv")}
            </Button>
            <CreateWorkOrderDialog />
          </>
        }
      />

      <KpiStrip
        t={t}
        loading={kpisQ.isLoading}
        pmRatio={kpisQ.data?.pmRatio ?? null}
        pmCount={kpisQ.data?.pmCount ?? 0}
        cmCount={kpisQ.data?.cmCount ?? 0}
        mttrHours={kpisQ.data?.mttrHours ?? null}
        correctiveClosed={kpisQ.data?.correctiveClosed ?? 0}
        windowDays={kpisQ.data?.windowDays ?? 90}
      />

      <div className="flex items-center justify-between">
        <Tabs value={view} onValueChange={(v) => setView(v as "kanban" | "table")}>
          <TabsList>
            <TabsTrigger value="kanban">
              <LayoutGrid className="me-1 h-4 w-4" /> {t("omMod.workOrders.kanban")}
            </TabsTrigger>
            <TabsTrigger value="table">
              <Rows className="me-1 h-4 w-4" /> {t("omMod.workOrders.table")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="text-xs text-muted-foreground">
          {rowsQ.isLoading
            ? t("omMod.workOrders.loadingCount")
            : t("omMod.workOrders.countLabel", { count: rows.length })}
        </span>
      </div>

      {view === "kanban" ? (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {KANBAN_COLUMNS.map((col) => (
              <KanbanColumn key={col} status={col} rows={columns[col]} onOpen={setOpenId} t={t} />
            ))}
          </div>
        </DndContext>
      ) : (
        <TableView rows={rows} onOpen={setOpenId} t={t} />
      )}

      <WorkOrderDrawer
        workOrderId={openId}
        onOpenChange={(o) => {
          if (!o) setOpenId(null);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
function KpiStrip(props: {
  t: ReturnType<typeof useI18n>["t"];
  loading: boolean;
  pmRatio: number | null;
  pmCount: number;
  cmCount: number;
  mttrHours: number | null;
  correctiveClosed: number;
  windowDays: number;
}) {
  const { t } = props;
  const pct = props.pmRatio == null ? null : Math.round(props.pmRatio * 100);
  const targetMet = pct != null && pct >= 80;
  return (
    <KpiGrid columns={3}>
      <KpiTile
        label={t("omMod.workOrders.pmCmRatio", { days: props.windowDays })}
        value={pct == null ? "—" : `${pct}%`}
        status={targetMet ? "good" : "neutral"}
        hint={
          <span className="flex items-center gap-2">
            <Badge variant={targetMet ? "default" : "outline"}>
              {t("omMod.workOrders.targetLabel")}
            </Badge>
            <span>{t("omMod.workOrders.pmCmHint", { pm: props.pmCount, cm: props.cmCount })}</span>
          </span>
        }
        isLoading={props.loading}
      />
      <KpiTile
        label={t("omMod.workOrders.mttr")}
        value={props.mttrHours == null ? "—" : `${props.mttrHours} h`}
        hint={t("omMod.workOrders.mttrHint", { count: props.correctiveClosed })}
        isLoading={props.loading}
      />
      <KpiTile
        label={t("omMod.workOrders.window")}
        value={`${props.windowDays}d`}
        hint={t("omMod.workOrders.windowHint")}
        isLoading={props.loading}
      />
    </KpiGrid>
  );
}

// ---------------------------------------------------------------------------
function KanbanColumn({
  status,
  rows,
  onOpen,
  t,
}: {
  status: WorkOrderStatus;
  rows: WorkOrderRow[];
  onOpen: (id: string) => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-40 flex-col rounded-lg border border-border bg-card ${
        isOver ? "ring-2 ring-primary" : ""
      }`}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-medium">{t(`omMod.workOrderStatus.${status}`)}</span>
        <Badge variant="outline">{rows.length}</Badge>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-2">
        {rows.length === 0 ? (
          <p className="px-1 py-3 text-xs text-muted-foreground uppercase tracking-wide">
            {t("omMod.workOrders.noCards")}
          </p>
        ) : (
          rows.map((r) => <KanbanCard key={r.id} row={r} onOpen={onOpen} t={t} />)
        )}
      </div>
    </div>
  );
}

function KanbanCard({
  row,
  onOpen,
  t,
}: {
  row: WorkOrderRow;
  onOpen: (id: string) => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: row.id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  const overdue = isOverdue(row.due_date, row.status);
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        // Only open drawer if it's a plain click (dnd-kit blocks with distance:4 already)
        if (isDragging) return;
        e.stopPropagation();
        onOpen(row.id);
      }}
      className={`cursor-grab rounded-md border border-border bg-background p-2 shadow-sm active:cursor-grabbing ${
        isDragging ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">{row.wo_number}</span>
        <Badge className={priorityCls(row.priority)}>
          {t(`omMod.workOrderPriority.${row.priority}`)}
        </Badge>
      </div>
      <p className="mt-1 line-clamp-2 text-sm font-medium">{row.title}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {row.project_name ?? "—"}
        {row.equipment_tag ? ` · ${row.equipment_tag}` : ""}
      </p>
      <div className="mt-2 flex items-center justify-between">
        <span
          className={`text-xs ${overdue ? "font-semibold text-destructive" : "text-muted-foreground"}`}
        >
          {row.due_date
            ? overdue
              ? t("omMod.workOrders.overdue", { date: row.due_date })
              : t("omMod.workOrders.due", { date: row.due_date })
            : "—"}
        </span>
        <span
          className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium"
          title={row.assignee_name ?? row.assignee_email ?? t("omMod.common.unassigned")}
        >
          {row.assigned_to ? initials(row.assignee_name, row.assignee_email) : "·"}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// POL-3 — shared DataTable standard (numeric right-aligned, card list on mobile).
function TableView({
  rows,
  onOpen,
  t,
}: {
  rows: WorkOrderRow[];
  onOpen: (id: string) => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const columns: DataTableColumn<WorkOrderRow>[] = [
    {
      id: "wo",
      header: t("omMod.workOrders.colWo"),
      cell: (r) => <span className="font-mono text-xs">{r.wo_number}</span>,
    },
    {
      id: "title",
      header: t("omMod.workOrders.colTitle"),
      cell: (r) => <span className="font-medium">{r.title}</span>,
    },
    {
      id: "type",
      header: t("omMod.workOrders.colType"),
      hideBelow: "lg",
      cell: (r) => <StatusBadge status={r.type} />,
    },
    {
      id: "priority",
      header: t("omMod.workOrders.colPriority"),
      cell: (r) => <StatusBadge status={r.priority} />,
    },
    {
      id: "status",
      header: t("omMod.workOrders.colStatus"),
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      id: "assignee",
      header: t("omMod.workOrders.colAssignee"),
      hideBelow: "lg",
      cell: (r) =>
        r.assignee_name ??
        r.assignee_email ?? (
          <span className="text-muted-foreground">{t("omMod.common.unassigned")}</span>
        ),
    },
    {
      id: "due",
      header: t("omMod.workOrders.colDue"),
      hideBelow: "md",
      cell: (r) =>
        isOverdue(r.due_date, r.status) ? (
          <span className="font-medium text-destructive">{formatDate(r.due_date)}</span>
        ) : (
          <span className="text-muted-foreground">{formatDate(r.due_date)}</span>
        ),
    },
    {
      id: "cost",
      header: t("omMod.workOrders.colCost"),
      numeric: true,
      cell: (r) => formatMoney(r.total_cost, "USD"),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowId={(r) => r.id}
      onRowClick={(r) => onOpen(r.id)}
      emptyTitle={t("omMod.workOrders.emptyTitle")}
      emptyDescription={t("omMod.workOrders.emptyDescription")}
      mobileCard={(r) => ({
        primary: (
          <span className="flex flex-col">
            <span>{r.title}</span>
            <span className="font-mono text-xs text-muted-foreground">{r.wo_number}</span>
          </span>
        ),
        badge: <StatusBadge status={r.status} />,
        fields: [
          { label: t("omMod.workOrders.colPriority"), value: <StatusBadge status={r.priority} /> },
          {
            label: t("omMod.workOrders.colDue"),
            value: isOverdue(r.due_date, r.status) ? (
              <span className="font-medium text-destructive">{formatDate(r.due_date)}</span>
            ) : (
              formatDate(r.due_date)
            ),
          },
        ],
      })}
    />
  );
}
