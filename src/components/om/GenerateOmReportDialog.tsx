// P-110 — Monthly O&M report dialog. Aggregates on the server, then builds
// and uploads the branded PDF from the browser.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format, endOfMonth, startOfMonth, subMonths } from "date-fns";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  buildOmReportPdfBytes,
  omReportFilename,
} from "@/lib/exports/om-report-pdf";
import {
  attachOmReportPdf,
  generateOmReport,
} from "@/lib/om-reports.functions";

interface Props {
  projects: Array<{ id: string; name: string; code: string | null }>;
}

function monthOptions(): Array<{ value: string; label: string }> {
  const base = startOfMonth(subMonths(new Date(), 1));
  const items: Array<{ value: string; label: string }> = [];
  for (let i = 0; i < 12; i++) {
    const s = startOfMonth(subMonths(base, i));
    items.push({
      value: format(s, "yyyy-MM-dd"),
      label: format(s, "MMMM yyyy"),
    });
  }
  return items;
}

export function GenerateOmReportDialog({ projects }: Props) {
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState<string>("");
  const [monthStart, setMonthStart] = useState<string>(
    format(startOfMonth(subMonths(new Date(), 1)), "yyyy-MM-dd"),
  );
  const months = monthOptions();
  const generate = useServerFn(generateOmReport);
  const attach = useServerFn(attachOmReportPdf);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("Pick a project");
      const periodStart = monthStart;
      const periodEnd = format(endOfMonth(new Date(monthStart)), "yyyy-MM-dd");
      const dto = await generate({
        data: {
          projectId,
          periodStart,
          periodEnd,
          reportType: "monthly",
        },
      });
      const bytes = await buildOmReportPdfBytes(dto);
      const filename = omReportFilename(dto.project.name, periodStart);
      const path = `${dto.report.company_id}/om-reports/${dto.report.project_id}/${periodStart.slice(0, 7)}.pdf`;
      const { error: upErr } = await supabase.storage
        .from("documents")
        .upload(path, new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }), {
          contentType: "application/pdf",
          upsert: true,
        });
      if (upErr) throw upErr;
      await attach({ data: { reportId: dto.report.id, pdfPath: path } });
      return { filename, period: periodStart.slice(0, 7) };
    },
    onSuccess: (r) => {
      toast.success(`Generated O&M report — ${r.period}`);
      qc.invalidateQueries({ queryKey: ["om-reports"] });
      setOpen(false);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to generate";
      toast.error(/export blocked/i.test(msg) ? "Exports locked by governance" : msg);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Generate monthly report</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate monthly O&amp;M report</DialogTitle>
          <DialogDescription>
            Aggregates availability, PR, alarms, work orders and spend for the
            selected project + month, then uploads a branded PDF.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="om-project">Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="om-project" className="h-10">
                <SelectValue placeholder="Pick a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.code ? ` · ${p.code}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="om-month">Month</Label>
            <Select value={monthStart} onValueChange={setMonthStart}>
              <SelectTrigger id="om-month" className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !projectId}
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Generating…
              </>
            ) : (
              "Generate"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
