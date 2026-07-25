// P-089 — QA/QC inspections list with heatmap deep-linkable search params.
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, Plus, Search } from "lucide-react";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { QaqcResultBadge } from "@/components/qaqc/result-badge";
import {
  errorMessage,
  inspectionListQueryOptions,
  qaqcProjectsQueryOptions,
} from "@/lib/qaqc-query";
import {
  QAQC_DISCIPLINES,
  QAQC_DISCIPLINE_LABELS,
  QAQC_RESULTS,
  type QaqcDiscipline,
  type QaqcResult,
} from "@/lib/qaqc.rules";
import { objectsToCsv, downloadCsv } from "@/lib/csv";

const searchSchema = z.object({
  projectId: z.string().uuid().optional(),
  discipline: z.enum(QAQC_DISCIPLINES).optional(),
  result: z.enum(QAQC_RESULTS).optional(),
  area: z.string().max(200).optional(),
  reworkOnly: z.boolean().optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  search: z.string().max(200).optional(),
});

export const Route = createFileRoute("/_authenticated/qaqc/inspections/")({
  validateSearch: (raw): z.infer<typeof searchSchema> => searchSchema.parse(raw ?? {}),
  head: () => ({
    meta: [
      { title: "QA/QC inspections — GridMind EPC" },
      {
        name: "description",
        content:
          "All quality-control inspections with ITP references, results, and rework tracking.",
      },
      { property: "og:title", content: "QA/QC inspections — GridMind EPC" },
      {
        property: "og:description",
        content: "Search, filter, and export inspection records.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InspectionListPage,
});

function InspectionListPage() {
  const navigate = useNavigate();
  const sp = Route.useSearch();
  const projectsQuery = useQuery(qaqcProjectsQueryOptions());

  const [projectId, setProjectId] = useState<string>(sp.projectId ?? "");
  const [discipline, setDiscipline] = useState<string>(sp.discipline ?? "");
  const [result, setResult] = useState<string>(sp.result ?? "");
  const [area, setArea] = useState<string>(sp.area ?? "");
  const [reworkOnly, setReworkOnly] = useState<boolean>(!!sp.reworkOnly);
  const [from, setFrom] = useState<string>(sp.from ?? "");
  const [to, setTo] = useState<string>(sp.to ?? "");
  const [search, setSearch] = useState<string>(sp.search ?? "");

  // reflect search-param changes when navigating from heatmap
  useEffect(() => {
    setProjectId(sp.projectId ?? "");
    setDiscipline(sp.discipline ?? "");
    setResult(sp.result ?? "");
    setArea(sp.area ?? "");
    setReworkOnly(!!sp.reworkOnly);
    setFrom(sp.from ?? "");
    setTo(sp.to ?? "");
    setSearch(sp.search ?? "");
  }, [sp]);

  const filters = useMemo(
    () => ({
      projectId: projectId || null,
      discipline: (discipline || null) as QaqcDiscipline | null,
      result: (result || null) as QaqcResult | null,
      area: area || null,
      reworkOnly: reworkOnly || null,
      from: from || null,
      to: to || null,
      search: search || null,
    }),
    [projectId, discipline, result, area, reworkOnly, from, to, search],
  );
  const listQuery = useQuery(inspectionListQueryOptions(filters));
  const rows = listQuery.data ?? [];

  const clearFilters = () => {
    navigate({ to: "/qaqc/inspections", search: {} });
  };

  const exportCsv = () => {
    const csv = objectsToCsv(
      rows.map((r) => ({
        number: r.inspection_number,
        date: r.inspection_date,
        project: r.project_name ?? "",
        discipline: r.discipline,
        area: r.area,
        itp_reference: r.itp_reference ?? "",
        result: r.result,
        rework: r.rework_required ? "yes" : "no",
        rework_notes: r.rework_notes ?? "",
        inspector: r.inspector_email ?? "",
      })),
    );
    downloadCsv("qaqc-inspections.csv", csv);
  };

  const activeFilterCount =
    (projectId ? 1 : 0) +
    (discipline ? 1 : 0) +
    (result ? 1 : 0) +
    (area ? 1 : 0) +
    (reworkOnly ? 1 : 0) +
    (from ? 1 : 0) +
    (to ? 1 : 0);

  return (
    <div className="page-shell">
      <PageHeader
        title="Inspections"
        description="All quality-control inspections with ITP references and rework tracking."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to="/qaqc/heatmap">Heatmap</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
              Export CSV
            </Button>
            <Button asChild size="sm">
              <Link to="/qaqc/inspections/new">
                <Plus size={14} aria-hidden /> New inspection
              </Link>
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-4">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All projects</SelectItem>
                {(projectsQuery.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Discipline</Label>
            <Select value={discipline} onValueChange={setDiscipline}>
              <SelectTrigger>
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Any</SelectItem>
                {QAQC_DISCIPLINES.map((d) => (
                  <SelectItem key={d} value={d}>
                    {QAQC_DISCIPLINE_LABELS[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Result</Label>
            <Select value={result} onValueChange={setResult}>
              <SelectTrigger>
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Any</SelectItem>
                {QAQC_RESULTS.map((r) => (
                  <SelectItem key={r} value={r} className="capitalize">
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Area</Label>
            <Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Any area" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="md:col-span-2 flex flex-col gap-1">
            <Label className="text-xs">Search</Label>
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Number, area, ITP ref, notes"
                className="pl-8"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-border p-3 md:col-span-2">
            <Switch checked={reworkOnly} onCheckedChange={setReworkOnly} />
            <span className="text-sm">Rework only</span>
            {activeFilterCount > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="ml-auto"
              >
                Clear ({activeFilterCount})
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {listQuery.isError ? (
        <Card>
          <CardContent className="p-4 text-sm text-destructive">
            <div>{errorMessage(listQuery.error)}</div>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => listQuery.refetch()}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {listQuery.isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="No inspections recorded yet" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Discipline</TableHead>
              <TableHead>Area</TableHead>
              <TableHead>ITP ref</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Rework</TableHead>
              <TableHead>Project</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={r.id}
                className="cursor-pointer"
                onClick={() =>
                  navigate({
                    to: "/qaqc/inspections/$id",
                    params: { id: r.id },
                  })
                }
              >
                <TableCell className="font-medium text-foreground">{r.inspection_number}</TableCell>
                <TableCell className="tabular-nums">{r.inspection_date}</TableCell>
                <TableCell className="capitalize">{r.discipline}</TableCell>
                <TableCell>{r.area}</TableCell>
                <TableCell className="text-muted-foreground">{r.itp_reference ?? "—"}</TableCell>
                <TableCell>
                  <QaqcResultBadge result={r.result} />
                </TableCell>
                <TableCell>
                  {r.rework_required ? (
                    <Badge className="bg-destructive/10 text-destructive">Rework</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{r.project_name ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
