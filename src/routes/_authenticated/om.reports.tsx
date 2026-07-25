// P-110 — Monthly O&M reports list + generator.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format, parseISO } from "date-fns";
import { AlertTriangle, Download, FileText, Info } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 pb-16">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <FileText size={14} aria-hidden /> O&amp;M
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
              Monthly O&amp;M reports
            </h1>
            <p className="text-sm text-muted-foreground">
              Availability, PR, alarms, work orders and spend — one branded PDF per project + month.
            </p>
          </div>
          <GenerateOmReportDialog projects={projects.data ?? []} />
        </div>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Reports</CardTitle>
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
            <div className="rounded-md border border-dashed border-border bg-muted/30 p-10 text-center">
              <div className="mx-auto mb-3 flex justify-center">
                <Info className="h-8 w-8 text-muted-foreground" aria-hidden />
              </div>
              <p className="text-sm font-medium text-foreground">No reports yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Click <strong>Generate monthly report</strong> to build the first one.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2 text-left">Project</th>
                    <th className="py-2 text-left">Period</th>
                    <th className="py-2 text-left">Type</th>
                    <th className="py-2 text-left">Status</th>
                    <th className="py-2 text-left">Generated</th>
                    <th className="py-2 text-right">Download</th>
                  </tr>
                </thead>
                <tbody>
                  {(list.data ?? []).map((r) => (
                    <ReportRow key={r.id} row={r} />
                  ))}
                </tbody>
              </table>
            </div>
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
    <tr className="border-t border-border/60">
      <td className="py-2 font-medium">{row.project_name ?? "—"}</td>
      <td className="py-2">{period}</td>
      <td className="py-2 capitalize">{row.report_type}</td>
      <td className="py-2">
        <Badge variant={row.status === "generated" ? "default" : "outline"}>{row.status}</Badge>
      </td>
      <td className="py-2 text-muted-foreground">{generated}</td>
      <td className="py-2 text-right">
        <Button size="sm" variant="outline" disabled={!row.pdf_path || busy} onClick={download}>
          <Download className="mr-2 h-3.5 w-3.5" aria-hidden />
          PDF
        </Button>
      </td>
    </tr>
  );
}
