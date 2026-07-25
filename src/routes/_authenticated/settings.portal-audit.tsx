// P-116 — Portal audit viewer at /settings/portal-audit.
// company_admin only. Read-only view over portal_audit_events with filters,
// stat tiles, and CSV export.
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format, formatDistanceToNow } from "date-fns";
import {
  Activity,
  AlertTriangle,
  Download,
  Eye,
  MessageSquare,
  ShieldCheck,
  Share2,
  Users,
} from "lucide-react";
import { z } from "zod";

import {
  PORTAL_AUDIT_EVENTS,
  getPortalAuditSummary,
  listPortalAuditEvents,
  listPortalAuditMemberships,
  listPortalAuditProjects,
  type PortalAuditRow,
} from "@/lib/portal-audit.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
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

const DAYS_PRESETS = [
  { value: 1, label: "24h" },
  { value: 7, label: "7d" },
  { value: 30, label: "30d" },
  { value: 90, label: "90d" },
] as const;

const EVENT_LABELS: Record<string, { label: string; icon: typeof Eye }> = {
  "portal.feed_viewed": { label: "Feed viewed", icon: Eye },
  "portal.ticket_raised": { label: "Ticket raised", icon: MessageSquare },
  "portal.approval_decided": { label: "Approval decided", icon: ShieldCheck },
  "share_link.viewed": { label: "Share link viewed", icon: Share2 },
};

const searchSchema = z.object({
  projectId: z.string().uuid().optional(),
  membershipId: z.string().uuid().optional(),
  event: z.string().max(64).optional(),
  days: z.coerce.number().int().min(1).max(365).optional(),
});

export const Route = createFileRoute("/_authenticated/settings/portal-audit")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Portal audit — GridMind EPC" },
      {
        name: "description",
        content: "Read-only audit of every portal view, ticket, approval, and share-link access.",
      },
    ],
  }),
  component: PortalAuditPage,
});

function PortalAuditPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const days = search.days ?? 30;
  const eventFilter = search.event;
  const projectId = search.projectId;
  const membershipId = search.membershipId;

  const projectsFn = useServerFn(listPortalAuditProjects);
  const membersFn = useServerFn(listPortalAuditMemberships);
  const summaryFn = useServerFn(getPortalAuditSummary);
  const listFn = useServerFn(listPortalAuditEvents);

  const projectsQuery = useQuery({
    queryKey: ["portal-audit", "projects"],
    queryFn: () => projectsFn(),
  });
  const membersQuery = useQuery({
    queryKey: ["portal-audit", "members", projectId ?? "all"],
    queryFn: () => membersFn({ data: { projectId } }),
  });

  const summaryQuery = useQuery({
    queryKey: ["portal-audit", "summary", projectId ?? "all", days],
    queryFn: () => summaryFn({ data: { projectId, days } }),
  });

  const listQuery = useQuery({
    queryKey: [
      "portal-audit",
      "list",
      projectId ?? "all",
      membershipId ?? "all",
      eventFilter ?? "all",
      days,
    ],
    queryFn: () =>
      listFn({
        data: {
          projectId,
          membershipId,
          events: eventFilter ? [eventFilter] : undefined,
          days,
          limit: 100,
        },
      }),
  });

  const summary = summaryQuery.data;
  const rows = listQuery.data?.rows ?? [];

  function updateSearch(patch: Record<string, string | number | undefined>) {
    navigate({
      search: (prev) => {
        const next = { ...prev, ...patch } as Record<string, unknown>;
        for (const k of Object.keys(next)) {
          if (next[k] === undefined || next[k] === "" || next[k] === "all") {
            delete next[k];
          }
        }
        return next as typeof search;
      },
    });
  }

  const isForbidden = Boolean(
    (listQuery.error as Error | undefined)?.message?.includes("forbidden") ||
    (summaryQuery.error as Error | undefined)?.message?.includes("forbidden"),
  );

  if (isForbidden) {
    return (
      <div className="page-shell max-w-3xl">
        <EmptyState
          icon={AlertTriangle}
          title="Company admins only"
          description="Portal audit is restricted to company_admin. Ask an administrator for access."
        />
      </div>
    );
  }

  return (
    <div className="page-shell">
      <PageHeader
        title="Portal audit"
        description="Every portal view, ticket, approval decision, and investor share-link access."
      />

      <KpiGrid>
        <KpiTile
          icon={Eye}
          label="Total events"
          value={(summary?.total ?? 0).toLocaleString()}
          isLoading={summaryQuery.isLoading}
        />
        <KpiTile
          icon={Users}
          label="Unique viewers"
          value={(summary?.unique_actors ?? 0).toLocaleString()}
          isLoading={summaryQuery.isLoading}
        />
        <KpiTile
          icon={MessageSquare}
          label="Tickets raised"
          value={(summary?.by_event["portal.ticket_raised"] ?? 0).toLocaleString()}
          isLoading={summaryQuery.isLoading}
        />
        <KpiTile
          icon={ShieldCheck}
          label="Approvals decided"
          value={(summary?.by_event["portal.approval_decided"] ?? 0).toLocaleString()}
          isLoading={summaryQuery.isLoading}
        />
      </KpiGrid>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
        <FilterField label="Project">
          <Select
            value={projectId ?? "all"}
            onValueChange={(v) =>
              updateSearch({ projectId: v === "all" ? undefined : v, membershipId: undefined })
            }
          >
            <SelectTrigger className="w-56">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {(projectsQuery.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.code ? `${p.code} · ${p.name}` : p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>

        <FilterField label="Membership">
          <Select
            value={membershipId ?? "all"}
            onValueChange={(v) => updateSearch({ membershipId: v === "all" ? undefined : v })}
          >
            <SelectTrigger className="w-56">
              <SelectValue placeholder="All members" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All members</SelectItem>
              {(membersQuery.data ?? []).map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>

        <FilterField label="Event">
          <Select
            value={eventFilter ?? "all"}
            onValueChange={(v) => updateSearch({ event: v === "all" ? undefined : v })}
          >
            <SelectTrigger className="w-56">
              <SelectValue placeholder="All events" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All events</SelectItem>
              {PORTAL_AUDIT_EVENTS.map((e) => (
                <SelectItem key={e} value={e}>
                  {EVENT_LABELS[e]?.label ?? e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>

        <FilterField label="Range">
          <div className="flex gap-1">
            {DAYS_PRESETS.map((d) => (
              <Button
                key={d.value}
                variant={days === d.value ? "default" : "outline"}
                size="sm"
                onClick={() => updateSearch({ days: d.value })}
              >
                {d.label}
              </Button>
            ))}
          </div>
        </FilterField>

        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            disabled={rows.length === 0}
            onClick={() => downloadCsv(rows)}
          >
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Table */}
      {listQuery.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : listQuery.error ? (
        <div className="flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
          <span>Could not load portal audit events.</span>
          <Button size="sm" variant="outline" onClick={() => listQuery.refetch()}>
            Retry
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No portal activity yet"
          description="Once portal members log in or share links are viewed, events appear here."
        />
      ) : (
        <EventsTable rows={rows} />
      )}
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

// POL-3 — shared DataTable standard: relative timestamps with absolute on hover.
function EventsTable({ rows }: { rows: PortalAuditRow[] }) {
  const columns: DataTableColumn<PortalAuditRow>[] = [
    {
      id: "when",
      header: "When",
      width: "10rem",
      cell: (r) => <RelativeTime value={r.created_at} className="text-muted-foreground" />,
    },
    {
      id: "event",
      header: "Event",
      cell: (r) => {
        const meta = EVENT_LABELS[r.event];
        const EventIcon = meta?.icon ?? Activity;
        return <StatusBadge status="active" label={meta?.label ?? r.event} icon={EventIcon} />;
      },
    },
    {
      id: "actor",
      header: "Actor",
      cell: (r) =>
        r.actor_email ? (
          <span className="font-mono text-xs">{r.actor_email}</span>
        ) : r.event === "share_link.viewed" ? (
          <span className="text-xs italic text-muted-foreground">share link visitor</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      id: "project",
      header: "Project",
      hideBelow: "md",
      cell: (r) =>
        r.project_name ?? <span className="font-mono text-xs">{r.project_id.slice(0, 8)}</span>,
    },
    {
      id: "membership",
      header: "Membership",
      hideBelow: "lg",
      cell: (r) =>
        r.membership_email ? (
          <span className="font-mono text-xs">{r.membership_email}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      id: "detail",
      header: "Detail",
      hideBelow: "lg",
      className: "max-w-md",
      cell: (r) => <MetaDetail metadata={r.metadata} />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowId={(r) => r.id}
      emptyTitle="No portal events yet"
      emptyDescription="Client portal activity will appear here."
      stickyFirstColumn
    />
  );
}


function MetaDetail({ metadata }: { metadata: unknown }) {
  if (!metadata || typeof metadata !== "object") {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const entries = Object.entries(metadata as Record<string, unknown>).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );
  if (entries.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {entries.slice(0, 4).map(([k, v]) => (
        <span
          key={k}
          className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-foreground"
        >
          {k}={String(v).slice(0, 40)}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CSV export (client-side blob)
// ---------------------------------------------------------------------------

function downloadCsv(rows: PortalAuditRow[]) {
  const header = [
    "timestamp",
    "event",
    "actor_email",
    "project_id",
    "project_name",
    "membership_email",
    "metadata_json",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.created_at,
        r.event,
        csvCell(r.actor_email ?? ""),
        r.project_id,
        csvCell(r.project_name ?? ""),
        csvCell(r.membership_email ?? ""),
        csvCell(JSON.stringify(r.metadata ?? {})),
      ].join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `portal-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvCell(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
