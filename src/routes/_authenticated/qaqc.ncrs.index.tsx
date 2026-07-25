// P-091 — NCR list page.
import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ClipboardCheck, Download, Plus, Search } from "lucide-react";
import { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { downloadCsv, objectsToCsv } from "@/lib/csv";
import { errorMessage, ncrListQueryOptions, ncrProjectsQueryOptions } from "@/lib/ncr-query";
import {
  daysOpen,
  NCR_DISPOSITION_LABELS,
  NCR_DISPOSITIONS,
  NCR_SOURCE_LABELS,
  NCR_SOURCES,
  NCR_STATUS_LABELS,
  NCR_STATUSES,
  ncrDispositionTint,
  ncrStatusTint,
  type NcrDisposition,
  type NcrSource,
  type NcrStatus,
} from "@/lib/ncr.rules";

const searchSchema = z.object({
  projectId: z.string().uuid().optional(),
  status: z.enum(NCR_STATUSES).optional(),
  disposition: z.enum(NCR_DISPOSITIONS).optional(),
  source: z.enum(NCR_SOURCES).optional(),
  search: z.string().max(200).optional(),
});

export const Route = createFileRoute("/_authenticated/qaqc/ncrs/")({
  validateSearch: (raw): z.infer<typeof searchSchema> => searchSchema.parse(raw ?? {}),
  head: () => ({
    meta: [
      { title: "Non-conformance reports — GridMind EPC" },
      {
        name: "description",
        content: "Track NCRs across projects with disposition, corrective action, and cost impact.",
      },
      { property: "og:title", content: "NCRs — GridMind EPC" },
      {
        property: "og:description",
        content:
          "Raise, disposition, and close NCRs from inspections, punch items, and observations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NcrIndexPage,
});

function NcrIndexPage() {
  const navigate = useNavigate();
  const sp = Route.useSearch();
  const projectsQuery = useQuery(ncrProjectsQueryOptions());
  const [search, setSearch] = useState(sp.search ?? "");

  const filters = useMemo(
    () => ({
      projectId: sp.projectId ?? null,
      status: sp.status ?? null,
      disposition: sp.disposition ?? null,
      source: sp.source ?? null,
      search: sp.search ?? null,
    }),
    [sp],
  );
  const listQuery = useQuery(ncrListQueryOptions(filters));

  const setSearchParam = (patch: Partial<z.infer<typeof searchSchema>>) => {
    void navigate({
      to: "/qaqc/ncrs",
      search: (prev: Record<string, unknown>) =>
        ({ ...prev, ...patch }) as z.infer<typeof searchSchema>,
      replace: true,
    });
  };

  const rows = listQuery.data ?? [];
  const openCount = rows.filter((r) => r.status === "open").length;
  const avgOpen =
    rows.length === 0 ? 0 : Math.round(rows.reduce((acc, r) => acc + daysOpen(r), 0) / rows.length);

  // total cost impact per currency
  const costByCurrency = rows.reduce<Record<string, number>>((acc, r) => {
    if (r.cost_impact === null || r.cost_impact === undefined) return acc;
    const cur = r.currency_code ?? "USD";
    acc[cur] = (acc[cur] ?? 0) + Number(r.cost_impact);
    return acc;
  }, {});
  const costLabel =
    Object.keys(costByCurrency).length === 0
      ? "—"
      : Object.entries(costByCurrency)
          .map(([cur, amt]) =>
            new Intl.NumberFormat(undefined, {
              style: "currency",
              currency: cur,
              maximumFractionDigits: 0,
            }).format(amt),
          )
          .join(" · ");

  const onExport = () => {
    const csv = objectsToCsv(
      rows.map((r) => ({
        ncr_number: r.ncr_number,
        project: r.project_name ?? "",
        status: r.status,
        disposition: r.disposition,
        source: r.source,
        area: r.area ?? "",
        discipline: r.discipline ?? "",
        description: r.description,
        cost_impact: r.cost_impact ?? "",
        currency: r.currency_code ?? "",
        days_open: daysOpen(r),
        created_at: r.created_at,
        closed_at: r.closed_at ?? "",
      })),
    );
    downloadCsv(`ncrs-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <AlertTriangle size={14} aria-hidden /> QA/QC
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Non-conformance reports
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onExport} disabled={rows.length === 0}>
            <Download className="mr-2 h-4 w-4" /> CSV
          </Button>
          <Button size="sm" asChild>
            <Link to="/qaqc/ncrs/new" search={{ projectId: sp.projectId }}>
              <Plus className="mr-2 h-4 w-4" /> New NCR
            </Link>
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <KpiTile label="Open NCRs" value={String(openCount)} />
        <KpiTile label="Avg days open" value={rows.length === 0 ? "—" : String(avgOpen)} />
        <KpiTile label="Total cost impact" value={costLabel} />
      </div>

      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-5">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Project</Label>
            <Select
              value={sp.projectId ?? "all"}
              onValueChange={(v) => setSearchParam({ projectId: v === "all" ? undefined : v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                {(projectsQuery.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Status</Label>
            <Select
              value={sp.status ?? "all"}
              onValueChange={(v) =>
                setSearchParam({ status: v === "all" ? undefined : (v as NcrStatus) })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {NCR_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {NCR_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Disposition</Label>
            <Select
              value={sp.disposition ?? "all"}
              onValueChange={(v) =>
                setSearchParam({
                  disposition: v === "all" ? undefined : (v as NcrDisposition),
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {NCR_DISPOSITIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {NCR_DISPOSITION_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Source</Label>
            <Select
              value={sp.source ?? "all"}
              onValueChange={(v) =>
                setSearchParam({ source: v === "all" ? undefined : (v as NcrSource) })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {NCR_SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {NCR_SOURCE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Search</Label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSearchParam({ search: search || undefined });
              }}
              className="flex gap-1"
            >
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="NCR / area…"
              />
              <Button type="submit" variant="outline" size="icon">
                <Search className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>

      {listQuery.isLoading ? (
        <Skeleton className="h-64" />
      ) : listQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load NCRs</AlertTitle>
          <AlertDescription>
            {errorMessage(listQuery.error)}{" "}
            <Button variant="link" onClick={() => listQuery.refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <ClipboardCheck className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No NCRs yet. Raise one from a failed inspection or a punch item.
            </p>
            <Button asChild>
              <Link to="/qaqc/ncrs/new" search={{ projectId: sp.projectId }}>
                <Plus className="mr-2 h-4 w-4" /> New NCR
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Disposition</TableHead>
                  <TableHead className="text-right">Days open</TableHead>
                  <TableHead className="text-right">Cost impact</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer">
                    <TableCell>
                      <Link
                        to="/qaqc/ncrs/$id"
                        params={{ id: r.id }}
                        className="font-medium text-foreground hover:underline"
                      >
                        {r.ncr_number}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.project_name ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">{NCR_SOURCE_LABELS[r.source]}</TableCell>
                    <TableCell>
                      <Badge className={ncrStatusTint(r.status)} variant="outline">
                        {NCR_STATUS_LABELS[r.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={ncrDispositionTint(r.disposition)} variant="outline">
                        {NCR_DISPOSITION_LABELS[r.disposition]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm">{daysOpen(r)}</TableCell>
                    <TableCell className="text-right text-sm">
                      {r.cost_impact === null || r.cost_impact === undefined
                        ? "—"
                        : new Intl.NumberFormat(undefined, {
                            style: "currency",
                            currency: r.currency_code ?? "USD",
                            maximumFractionDigits: 0,
                          }).format(Number(r.cost_impact))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="font-display text-xl font-semibold text-foreground">{value}</span>
      </CardContent>
    </Card>
  );
}
