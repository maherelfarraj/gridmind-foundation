// P-219 — ESG report drawer: compute → approval chain → branded PDF → publish.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, FileText, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/dpr-query";
import { computeEsgReport } from "@/lib/esg/carbon.functions";
import {
  attachEsgReportPdf,
  checkEsgReportApproval,
  generateEsgReportPdf,
  getEsgReportDownloadUrl,
  getEsgReportState,
  publishEsgReport,
} from "@/lib/esg/report.functions";
import { approvalStageLabel } from "@/lib/esg/report.rules";
import { buildEsgReportPdfBytes } from "@/lib/exports/esg-report-pdf";
import { downloadBlob } from "@/lib/exports/theme";

interface Props {
  projectId: string | null;
  periodFrom: string;
  periodTo: string;
}

export function EsgReportDrawer({ projectId, periodFrom, periodTo }: Props) {
  const [open, setOpen] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);
  const qc = useQueryClient();

  const compute = useServerFn(computeEsgReport);
  const generate = useServerFn(generateEsgReportPdf);
  const check = useServerFn(checkEsgReportApproval);
  const attach = useServerFn(attachEsgReportPdf);
  const publish = useServerFn(publishEsgReport);
  const signedUrl = useServerFn(getEsgReportDownloadUrl);
  const stateFn = useServerFn(getEsgReportState);

  const state = useQuery({
    queryKey: ["esg", "report-state", reportId],
    enabled: Boolean(reportId),
    queryFn: () => stateFn({ data: { report_id: reportId as string } }),
  });

  const computeMutation = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("Select a single project first");
      const res = await compute({
        data: { project_id: projectId, period_from: periodFrom, period_to: periodTo },
      });
      return res.report.id as string;
    },
    onSuccess: (id) => {
      setReportId(id);
      toast.success("Draft report computed");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submitMutation = useMutation({
    mutationFn: () => generate({ data: { report_id: reportId as string } }),
    onSuccess: () => {
      toast.success("Sent for approval — HSE then Company Admin");
      state.refetch();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const checkMutation = useMutation({
    mutationFn: async () => {
      const res = await check({ data: { report_id: reportId as string } });
      if (res.status === "approved" && res.package) {
        const bytes = await buildEsgReportPdfBytes(res.package);
        const path = res.package.report.pdf_path;
        const { error } = await supabase.storage
          .from("documents")
          .upload(path, new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }), {
            contentType: "application/pdf",
            upsert: true,
          });
        if (error) throw error;
        await attach({ data: { report_id: res.package.report.id, pdf_path: path } });
      }
      return res;
    },
    onSuccess: (res) => {
      if (res.status === "approved") toast.success("Approved — branded PDF stored");
      else if (res.comment) toast.error(`Rejected: ${res.comment}`);
      else toast.message("Still pending approval");
      state.refetch();
      qc.invalidateQueries({ queryKey: ["esg"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const publishMutation = useMutation({
    mutationFn: () => publish({ data: { report_id: reportId as string } }),
    onSuccess: () => {
      toast.success("Report published");
      state.refetch();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const downloadMutation = useMutation({
    mutationFn: async () => {
      const { url } = await signedUrl({ data: { report_id: reportId as string } });
      if (!url) throw new Error("No stored PDF");
      const res = await fetch(url);
      downloadBlob(`${state.data?.report_number ?? "esg-report"}.pdf`, await res.blob());
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const s = state.data;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline">
          <FileText className="mr-2 size-4" aria-hidden />
          Report
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full space-y-4 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>ESG report</SheetTitle>
          <SheetDescription>
            {periodFrom} – {periodTo}
          </SheetDescription>
        </SheetHeader>

        {!projectId ? (
          <EmptyState
            title="Select a project"
            description="ESG reports are issued per project. Pick a single project in the filter bar."
          />
        ) : (
          <div className="space-y-4 px-4 pb-6">
            <Card className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {s?.report_number ?? "No report computed yet"}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {s ? `Status: ${s.status}` : "Compute a draft from recorded activity data."}
                  </p>
                </div>
                {s ? <Badge variant="outline">{s.status}</Badge> : null}
              </div>
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => computeMutation.mutate()}
                disabled={computeMutation.isPending}
              >
                <RefreshCw className="mr-2 size-4" aria-hidden />
                Compute draft
              </Button>
            </Card>

            {reportId ? (
              <Card className="space-y-3 p-4">
                {s?.approval_status === "pending" ? (
                  <p className="text-sm">{approvalStageLabel(s.current_step)}</p>
                ) : null}
                {s?.rejection_comment ? (
                  <p className="text-destructive text-sm">Rejected: {s.rejection_comment}</p>
                ) : null}

                <Button
                  className="w-full"
                  onClick={() => submitMutation.mutate()}
                  disabled={submitMutation.isPending || s?.status !== "draft"}
                >
                  Generate report
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => checkMutation.mutate()}
                  disabled={checkMutation.isPending}
                >
                  Check approval
                </Button>

                <Separator />

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => downloadMutation.mutate()}
                  disabled={!s?.pdf_path || downloadMutation.isPending}
                >
                  <Download className="mr-2 size-4" aria-hidden />
                  Download PDF
                </Button>
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => publishMutation.mutate()}
                  disabled={publishMutation.isPending || s?.status !== "approved"}
                >
                  Publish
                </Button>
              </Card>
            ) : null}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
