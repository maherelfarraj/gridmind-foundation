// P-059 — RFI workspace route (list + KPI + filters + detail drawer).
import { Suspense, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { differenceInCalendarDays, format } from "date-fns";
import { z } from "zod";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
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
  getRfiKpis,
  listRfis,
  listRoutableMembers,
  type RfiRow,
} from "@/lib/rfi.functions";
import {
  rfiKpiQueryOptions,
  rfiListQueryOptions,
  routableMembersQueryOptions,
} from "@/lib/rfi-query";
import { isOverdue, RFI_STATUSES } from "@/lib/rfi-rules";
import { RfiKpiCard } from "@/components/engineering/rfis/RfiKpiCard";
import {
  RfiPriorityBadge,
  RfiStatusBadge,
} from "@/components/engineering/rfis/rfi-badges";
import { RaiseRfiDialog } from "@/components/engineering/rfis/RaiseRfiDialog";
import { RfiDetailDrawer } from "@/components/engineering/rfis/RfiDetailDrawer";

const DISCIPLINES = [
  "civil",
  "structural",
  "electrical",
  "mechanical",
  "scada_controls",
  "survey",
  "general",
] as const;

const searchSchema = z.object({
  status: fallback(z.string(), "").default(""),
  discipline: fallback(z.string(), "").default(""),
  assignee: fallback(z.string(), "").default(""),
  q: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/engineering/rfis",
)({
  validateSearch: zodValidator(searchSchema),
  component: RfisPage,
});

function RfisPage() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [detailId, setDetailId] = useState<string | null>(null);

  const filters = useMemo(
    () => ({
      status: search.status || null,
      discipline: search.discipline || null,
      assignee: search.assignee || null,
      search: search.q || null,
    }),
    [search],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">RFIs</h1>
          <p className="text-sm text-muted-foreground">
            Requests for Information — track questions, answers, and turnaround.
          </p>
        </div>
        <RaiseRfiDialog projectId={projectId} />
      </div>

      <Suspense fallback={<Skeleton className="h-56 w-full" />}>
        <KpiSection projectId={projectId} />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-10 w-full" />}>
        <FiltersToolbar
          projectId={projectId}
          value={{
            status: search.status,
            discipline: search.discipline,
            assignee: search.assignee,
            q: search.q,
          }}
          onChange={(next) =>
            navigate({ search: (prev) => ({ ...prev, ...next }) })
          }
        />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <RfiTableSection
          projectId={projectId}
          filters={filters}
          onOpen={setDetailId}
        />
      </Suspense>

      <RfiDetailDrawer
        projectId={projectId}
        rfiId={detailId}
        open={!!detailId}
        onClose={() => setDetailId(null)}
      />
    </div>
  );
}

function KpiSection({ projectId }: { projectId: string }) {
  const fn = useServerFn(getRfiKpis);
  const { data } = useSuspenseQuery(rfiKpiQueryOptions(fn, projectId));
  return <RfiKpiCard kpis={data} />;
}

function FiltersToolbar({
  projectId,
  value,
  onChange,
}: {
  projectId: string;
  value: { status: string; discipline: string; assignee: string; q: string };
  onChange: (next: Partial<typeof value>) => void;
}) {
  const membersFn = useServerFn(listRoutableMembers);
  const { data: members } = useSuspenseQuery(
    routableMembersQueryOptions(membersFn, projectId),
  );
  return (
    <Card className="flex flex-wrap items-center gap-2 p-2">
      <Select
        value={value.status || "__all"}
        onValueChange={(v) => onChange({ status: v === "__all" ? "" : v })}
      >
        <SelectTrigger className="w-36">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">All statuses</SelectItem>
          {RFI_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {s.replace("_", " ")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={value.discipline || "__all"}
        onValueChange={(v) => onChange({ discipline: v === "__all" ? "" : v })}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Discipline" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">All disciplines</SelectItem>
          {DISCIPLINES.map((d) => (
            <SelectItem key={d} value={d}>
              {d.replace("_", " ")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={value.assignee || "__all"}
        onValueChange={(v) => onChange({ assignee: v === "__all" ? "" : v })}
      >
        <SelectTrigger className="w-48">
          <SelectValue placeholder="Assignee" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">All assignees</SelectItem>
          {members.map((m) => (
            <SelectItem key={m.user_id} value={m.user_id}>
              {m.full_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={value.q}
        onChange={(e) => onChange({ q: e.target.value })}
        placeholder="Search subject, question, number…"
        className="w-64"
      />
      <div className="ml-auto" />
    </Card>
  );
}

function RfiTableSection({
  projectId,
  filters,
  onOpen,
}: {
  projectId: string;
  filters: {
    status: string | null;
    discipline: string | null;
    assignee: string | null;
    search: string | null;
  };
  onOpen: (id: string) => void;
}) {
  const listFn = useServerFn(listRfis);
  const { data: rows } = useSuspenseQuery(
    rfiListQueryOptions(listFn, projectId, filters),
  );

  const exportCsv = () => {
    const header = [
      "rfi_number",
      "subject",
      "discipline",
      "priority",
      "status",
      "routed_to",
      "due_date",
      "created_at",
      "answered_at",
    ];
    const escape = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [header.join(",")]
      .concat(
        rows.map((r) =>
          [
            r.rfi_number,
            r.subject,
            r.discipline,
            r.priority,
            r.status,
            r.routed_to_name ?? "",
            r.due_date ?? "",
            r.created_at,
            r.answered_at ?? "",
          ]
            .map(escape)
            .join(","),
        ),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rfis-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (rows.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No RFIs raised yet. Use “Raise RFI” to create one.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs text-muted-foreground">
        <span>{rows.length} RFIs</span>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          Export CSV
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead>Discipline</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Routed to</TableHead>
            <TableHead>Due</TableHead>
            <TableHead>Age</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <RfiTableRow key={r.id} row={r} onOpen={onOpen} />
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function RfiTableRow({
  row,
  onOpen,
}: {
  row: RfiRow;
  onOpen: (id: string) => void;
}) {
  const overdue = isOverdue({ status: row.status, due_date: row.due_date });
  const ageDays = differenceInCalendarDays(new Date(), new Date(row.created_at));
  return (
    <TableRow
      className="cursor-pointer hover:bg-muted/40"
      onClick={() => onOpen(row.id)}
    >
      <TableCell className="font-mono text-xs">{row.rfi_number}</TableCell>
      <TableCell className="max-w-[24ch] truncate">{row.subject}</TableCell>
      <TableCell className="capitalize">
        {row.discipline.replace("_", " ")}
      </TableCell>
      <TableCell>
        <RfiPriorityBadge priority={row.priority} />
      </TableCell>
      <TableCell>
        <RfiStatusBadge status={row.status} />
      </TableCell>
      <TableCell>{row.routed_to_name ?? "—"}</TableCell>
      <TableCell className={overdue ? "text-destructive" : undefined}>
        {row.due_date ? format(new Date(row.due_date), "PP") : "—"}
      </TableCell>
      <TableCell>{ageDays}d</TableCell>
    </TableRow>
  );
}
