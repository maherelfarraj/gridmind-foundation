// P-110 — Monthly O&M reports list + generator.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format, parseISO } from "date-fns";
import { AlertTriangle, Download, Inbox } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { GenerateOmReportDialog } from "@/components/om/GenerateOmReportDialog";
import {
  getOmReportDownloadUrl,
  listOmReportProjects,
  listOmReports,
  type OmReportRow,
} from "@/lib/om-reports.functions";

const omReportsQueryOptions = () =>
  queryOptions({
    queryKey: ["om-reports", "list"],
    queryFn: () => listOmReports({ data: {} }),
    staleTime: 15_000,
  });

const omReportProjectsQueryOptions = () =>
  queryOptions({
    queryKey: ["om-reports", "projects"],
    queryFn: () => listOmReportProjects(),
    staleTime: 60_000,
  });

export const Route = createFileRoute("/_authenticated/om/reports")({
  head: () => ({
    meta: [
      { title: "O&M reports — GridMind EPC" },
      {
        name: "description",
        content:
          "Branded monthly O&M reports: availability, performance ratio, alarms, work orders and spend — generated from live plant data.",
      },
      {
        property: "og:title",
        content: "O&M reports — GridMind EPC",
      },
      {
        property: "og:description",
        content:
          "Monthly asset-owner deliverables from availability to spend — one branded PDF per project.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OmReportsPage,
});

function OmReportsPage() {
  const list = useQuery(omReportsQueryOptions());
  const projects = useQuery(omReportProjectsQueryOptions());

  return (
    <div className="page-shell">
      <PageHeader
        title="Monthly O&M reports"
        description="Availability, PR, alarms, work orders and spend — one branded PDF per project."
        actions={<GenerateOmReportDialog projects={projects.data ?? []} />}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Reports</CardTitle>
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : list.isError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                <span className="text-sm font-medium">Failed to load reports</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {list.error instanceof Error ? list.error.message : "Unknown error"}
              </p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => list.refetch()}>
                Retry
              </Button>
            </div>
          ) : (list.data ?? []).length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No reports yet"
              description="Click Generate monthly report to build the first one."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Generated</TableHead>
                  <TableHead className="text-right">Download</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(list.data ?? []).map((r) => (
                  <ReportRow key={r.id} row={r} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ReportRow({ row }: { row: OmReportRow }) {
  const getUrl = useServerFn(getOmReportDownloadUrl);
  const [busy, setBusy] = useState(false);
  const period = format(parseISO(`${row.period_start}T00:00:00`), "MMM yyyy");
  const generated = row.generated_at ? format(parseISO(row.generated_at), "PP p") : "—";

  async function download() {
    setBusy(true);
    try {
      const { url } = await getUrl({ data: { reportId: row.id } });
      if (!url) throw new Error("No PDF");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <TableRow>
      <TableCell className="font-medium">{row.project_name ?? "—"}</TableCell>
      <TableCell>{period}</TableCell>
      <TableCell className="capitalize">{row.report_type}</TableCell>
      <TableCell>
        <Badge variant={row.status === "generated" ? "default" : "outline"}>{row.status}</Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">{generated}</TableCell>
      <TableCell className="text-right">
        <Button size="sm" variant="outline" disabled={!row.pdf_path || busy} onClick={download}>
          <Download className="mr-2 h-3.5 w-3.5" aria-hidden />
          PDF
        </Button>
      </TableCell>
    </TableRow>
  );
}
