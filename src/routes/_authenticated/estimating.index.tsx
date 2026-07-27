// P-210 — Estimating register: server-filtered list of estimates.
import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Calculator, Library } from "lucide-react";

import { NewEstimateDialog } from "@/components/estimating/new-estimate-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  DataTableSearch,
  Num,
  RelativeTime,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { estimatingErrorMessage, estimatingRegisterQueryOptions } from "@/lib/estimating.query";
import { ESTIMATE_STATUSES } from "@/lib/estimating.rules";
import type { EstimateRow } from "@/lib/estimating.server";
import { formatMoney } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/estimating/")({
  // P-213 — deep links from the project accuracy tile: ?project=<id>&status=priced
  validateSearch: (search: Record<string, unknown>): { project?: string; status?: string } => {
    const out: { project?: string; status?: string } = {};
    if (typeof search.project === "string") out.project = search.project;
    if (typeof search.status === "string") out.status = search.status;
    return out;
  },
  head: () => ({
    meta: [
      { title: "Estimating register — GridMind EPC" },
      {
        name: "description",
        content:
          "Cost estimates built from released BOM snapshots: direct cost, total price, revision and status for every estimate.",
      },
      { property: "og:title", content: "Estimating register — GridMind EPC" },
      {
        property: "og:description",
        content: "Every EPC cost estimate with direct cost, total price, revision and status.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EstimatingRegisterPage,
});

const ALL = "__all__";

function EstimatingRegisterPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [status, setStatus] = useState(search.status ?? ALL);
  const [projectId, setProjectId] = useState(search.project ?? ALL);
  const [q, setQ] = useState("");

  const query = useQuery(
    estimatingRegisterQueryOptions({
      status: status === ALL ? null : (status as (typeof ESTIMATE_STATUSES)[number]),
      project_id: projectId === ALL ? null : projectId,
      q: q.trim() || null,
    }),
  );

  const projects = query.data?.projects ?? [];
  const projectName = (id: string) => {
    const p = projects.find((x) => x.id === id);
    return p ? (p.code ?? p.name) : "—";
  };

  const columns: DataTableColumn<EstimateRow>[] = [
    {
      id: "number",
      header: "Estimate",
      cell: (row) => (
        <span className="flex items-center gap-2">
          <span className="font-mono text-sm">{row.estimate_number ?? "—"}</span>
          <Badge variant="mutedOutline">R{row.revision}</Badge>
        </span>
      ),
    },
    { id: "title", header: "Title", cell: (row) => <span className="truncate">{row.title}</span> },
    {
      id: "project",
      header: "Project",
      hideBelow: "md",
      cell: (row) => (
        <Link
          to="/projects/$projectId"
          params={{ projectId: row.project_id }}
          className="text-primary underline-offset-4 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {projectName(row.project_id)}
        </Link>
      ),
    },
    { id: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
    {
      id: "direct",
      header: "Direct cost",
      numeric: true,
      cell: (row) => <Num>{formatMoney(row.direct_cost, row.currency_code)}</Num>,
    },
    {
      id: "price",
      header: "Total price",
      numeric: true,
      hideBelow: "lg",
      cell: (row) => <Num>{formatMoney(row.total_price, row.currency_code)}</Num>,
    },
    {
      id: "updated",
      header: "Updated",
      hideBelow: "lg",
      cell: (row) => <RelativeTime value={row.updated_at} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Estimating"
        description="Build cost estimates from released BOM snapshots or from scratch, priced off the shared rate library."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/estimating/rates">
                <Library className="mr-2 size-4" /> Rate library
              </Link>
            </Button>
            {query.data?.can_write ? <NewEstimateDialog register={query.data} /> : null}
          </>
        }
      />

      {query.isError ? (
        <EmptyState
          icon={Calculator}
          title="Could not load estimates"
          description={estimatingErrorMessage(query.error)}
          action={
            <Button variant="outline" onClick={() => void query.refetch()}>
              Retry
            </Button>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          rows={query.data?.estimates ?? []}
          getRowId={(r) => r.id}
          isLoading={query.isLoading}
          onRowClick={(r) => void navigate({ to: "/estimating/$id", params: { id: r.id } })}
          toolbar={{
            search: (
              <DataTableSearch
                value={q}
                onChange={setQ}
                placeholder="Search number or title"
                label="Search estimates"
              />
            ),
            filters: (
              <>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="w-[160px]" aria-label="Filter by status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All statuses</SelectItem>
                    {ESTIMATE_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s.replace("_", " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger className="w-[200px]" aria-label="Filter by project">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All projects</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.code ? `${p.code} — ${p.name}` : p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            ),
          }}
          emptyState={
            <EmptyState
              icon={Calculator}
              title="No estimates yet"
              description="No estimates yet — create one from a released BOM or start blank."
            />
          }
          mobileCard={(row) => ({
            primary: `${row.estimate_number ?? "—"} · ${row.title}`,
            badge: <StatusBadge status={row.status} />,
            fields: [
              { label: "Revision", value: `R${row.revision}` },
              { label: "Direct cost", value: formatMoney(row.direct_cost, row.currency_code) },
              { label: "Total price", value: formatMoney(row.total_price, row.currency_code) },
            ],
          })}
        />
      )}
    </div>
  );
}
