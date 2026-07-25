// P-091 — Transmittals list.
import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, Plus, Search, Send } from "lucide-react";
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
import {
  errorMessage,
  transmittalListQueryOptions,
  transmittalProjectsQueryOptions,
} from "@/lib/transmittals-query";
import {
  TRANSMITTAL_DIRECTIONS,
  TRANSMITTAL_DIRECTION_LABELS,
  isTransmittalOverdue,
  type TransmittalDirection,
} from "@/lib/transmittals.rules";

const searchSchema = z.object({
  projectId: z.string().uuid().optional(),
  direction: z.enum(TRANSMITTAL_DIRECTIONS).optional(),
  search: z.string().max(200).optional(),
});

export const Route = createFileRoute("/_authenticated/field/transmittals/")({
  validateSearch: (raw): z.infer<typeof searchSchema> => searchSchema.parse(raw ?? {}),
  head: () => ({
    meta: [
      { title: "Transmittals — GridMind EPC" },
      {
        name: "description",
        content: "Track outgoing and incoming document transmittals with acknowledgement tracking.",
      },
      { property: "og:title", content: "Transmittals — GridMind EPC" },
      {
        property: "og:description",
        content: "Compile documents, send transmittals, and track responses.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TransmittalsIndexPage,
});

function TransmittalsIndexPage() {
  const navigate = useNavigate();
  const sp = Route.useSearch();
  const projectsQuery = useQuery(transmittalProjectsQueryOptions());
  const [search, setSearch] = useState(sp.search ?? "");

  const filters = useMemo(
    () => ({
      projectId: sp.projectId ?? null,
      direction: sp.direction ?? null,
      search: sp.search ?? null,
    }),
    [sp],
  );
  const listQuery = useQuery(transmittalListQueryOptions(filters));

  const setSearchParam = (patch: Partial<z.infer<typeof searchSchema>>) => {
    void navigate({
      to: "/field/transmittals",
      search: (prev: Record<string, unknown>) =>
        ({ ...prev, ...patch }) as z.infer<typeof searchSchema>,
      replace: true,
    });
  };

  const rows = listQuery.data ?? [];
  const overdue = rows.filter((r) => isTransmittalOverdue(r)).length;
  const openOut = rows.filter((r) => r.direction === "outgoing" && !r.acknowledged_at).length;

  const onExport = () => {
    const csv = objectsToCsv(
      rows.map((r) => ({
        number: r.transmittal_number,
        project: r.project_name ?? "",
        direction: r.direction,
        from: r.from_party,
        to: r.to_party,
        subject: r.subject,
        items: r.items?.length ?? 0,
        response_due: r.response_due ?? "",
        sent_at: r.sent_at ?? "",
        acknowledged_at: r.acknowledged_at ?? "",
      })),
    );
    downloadCsv(`transmittals-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <Send size={14} aria-hidden /> Field / Document control
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Transmittals
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onExport} disabled={rows.length === 0}>
            <Download className="mr-2 h-4 w-4" /> CSV
          </Button>
          <Button size="sm" asChild>
            <Link to="/field/transmittals/new" search={{ projectId: sp.projectId }}>
              <Plus className="mr-2 h-4 w-4" /> New transmittal
            </Link>
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Kpi label="Awaiting ack" value={String(openOut)} />
        <Kpi label="Overdue" value={String(overdue)} tone={overdue > 0 ? "warn" : "default"} />
        <Kpi label="Total" value={String(rows.length)} />
      </div>

      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-4">
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
            <Label className="text-xs">Direction</Label>
            <Select
              value={sp.direction ?? "all"}
              onValueChange={(v) =>
                setSearchParam({
                  direction: v === "all" ? undefined : (v as TransmittalDirection),
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {TRANSMITTAL_DIRECTIONS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {TRANSMITTAL_DIRECTION_LABELS[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-full flex flex-col gap-1 md:col-span-2">
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
                placeholder="TRN / subject / party…"
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
          <AlertTitle>Could not load transmittals</AlertTitle>
          <AlertDescription>
            {errorMessage(listQuery.error)}{" "}
            <Button variant="link" onClick={() => listQuery.refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No transmittals yet. Send the first one.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Dir</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Parties</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Sent / Ack</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const od = isTransmittalOverdue(r);
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link
                          to="/field/transmittals/$id"
                          params={{ id: r.id }}
                          className="font-medium text-foreground hover:underline"
                        >
                          {r.transmittal_number}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{TRANSMITTAL_DIRECTION_LABELS[r.direction]}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{r.subject}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.from_party} → {r.to_party}
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.response_due ?? "—"}
                        {od ? (
                          <span className="ml-1 inline-flex items-center gap-1 text-destructive">
                            <AlertTriangle size={12} /> overdue
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.sent_at ? new Date(r.sent_at).toLocaleDateString() : "—"} /{" "}
                        {r.acknowledged_at ? new Date(r.acknowledged_at).toLocaleDateString() : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warn";
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <span
          className={`font-display text-xl font-semibold ${tone === "warn" ? "text-destructive" : "text-foreground"}`}
        >
          {value}
        </span>
      </CardContent>
    </Card>
  );
}
