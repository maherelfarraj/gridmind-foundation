// P-092 — Weekly report query options + button component.
import { useState } from "react";
import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { buildWeeklyReportPdfBytes, weeklyReportFilename } from "@/lib/exports/weekly-report-pdf";
import {
  getWeeklyReportData,
  listWeeklyReportProjects,
  logWeeklyReportExport,
  type WeeklyReportDTO,
} from "@/lib/field-reports.functions";

export function weeklyReportProjectsQueryOptions() {
  return queryOptions({
    queryKey: ["weekly-report", "projects"],
    queryFn: () => listWeeklyReportProjects(),
    staleTime: 60_000,
  });
}

export function weeklyReportDataQueryOptions(projectId: string | null, weekStart: string | null) {
  const enabled = Boolean(projectId && weekStart);
  return queryOptions({
    queryKey: ["weekly-report", "data", projectId, weekStart],
    queryFn: () =>
      getWeeklyReportData({
        data: { projectId: projectId as string, weekStart: weekStart as string },
      }),
    enabled,
    staleTime: 15_000,
  });
}

interface Props {
  projectId: string | null;
  weekStart: string | null;
  size?: "sm" | "default" | "lg";
  variant?: "default" | "outline" | "secondary";
  className?: string;
  label?: string;
}

function triggerDownload(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as unknown as BlobPart], {
    type: "application/pdf",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4_000);
}

export function ExportWeeklyReportButton({
  projectId,
  weekStart,
  size = "default",
  variant = "default",
  className,
  label = "Export weekly report PDF",
}: Props) {
  const getData = useServerFn(getWeeklyReportData);
  const logExport = useServerFn(logWeeklyReportExport);
  const [busy, setBusy] = useState(false);

  const preview = useQuery(weeklyReportDataQueryOptions(projectId, weekStart));
  const canExport = preview.data?.permissions.canExport ?? true;
  const hasData = preview.data?.hasData ?? true;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!projectId || !weekStart) throw new Error("Pick a project and week");
      const dto: WeeklyReportDTO =
        preview.data ??
        (await getData({
          data: { projectId, weekStart },
        }));
      if (!dto.hasData) {
        throw new Error("No field data for this week — submit DPRs first");
      }
      // Gate + audit (throws if locked or forbidden).
      await logExport({
        data: {
          projectId,
          weekStart: dto.weekStart,
          weekEnd: dto.weekEnd,
        },
      });
      const bytes = await buildWeeklyReportPdfBytes(dto);
      triggerDownload(bytes, weeklyReportFilename(dto.project.name, dto.isoWeekLabel));
      return dto;
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Export failed";
      if (/export blocked/i.test(msg)) {
        toast.error("Exports locked by governance");
      } else {
        toast.error(msg);
      }
    },
    onSuccess: (dto) => {
      toast.success(`Weekly report exported — ${dto.isoWeekLabel}`);
    },
  });

  if (!canExport) return null;

  const disabled =
    !projectId || !weekStart || busy || mutation.isPending || preview.isLoading || !hasData;

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      disabled={disabled}
      onClick={async () => {
        setBusy(true);
        try {
          await mutation.mutateAsync();
        } finally {
          setBusy(false);
        }
      }}
    >
      {mutation.isPending || busy ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <FileDown className="mr-2 h-4 w-4" aria-hidden />
      )}
      {label}
    </Button>
  );
}
