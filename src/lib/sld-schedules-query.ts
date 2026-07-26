// P-144 — Client wiring for SLD schedules: list, regenerate, export (CSV/PDF).
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { downloadCsv } from "@/lib/csv";
import { downloadSchedulePdf } from "@/lib/exports/sld-schedule-pdf";
import {
  exportSldSchedule,
  generateSldSchedules,
  listSldSchedules,
} from "@/lib/sld-schedules.functions";
import type { ScheduleType } from "@/lib/sld/schedules";

export type ScheduleSummary = {
  id: string;
  revision_id: string;
  schedule_type: ScheduleType;
  rows: Record<string, string | number | boolean | null>[];
  row_count: number;
  generated_at: string;
};

export function sldSchedulesQueryOptions(drawingId: string) {
  return queryOptions({
    queryKey: ["sld-schedules", drawingId],
    queryFn: () =>
      (listSldSchedules as any)({ data: { drawingId } }) as Promise<{
        revision_id: string | null;
        schedules: ScheduleSummary[];
      }>,
  });
}

export function useGenerateSchedules(drawingId: string) {
  const fn = useServerFn(generateSldSchedules);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => (fn as any)({ data: { drawingId } }),
    onSuccess: async (res: any) => {
      const total = (res.schedules ?? []).reduce((n: number, s: any) => n + s.row_count, 0);
      toast.success(`Schedules generated — ${total} row(s)`);
      await qc.invalidateQueries({ queryKey: ["sld-schedules", drawingId] });
    },
    onError: (err) => toast.error(String((err as any)?.message ?? "Generation failed")),
  });
}

function lockMessage(err: unknown): string {
  const msg = String((err as any)?.message ?? "");
  if (msg.includes("export_locked") || (err as any)?.statusCode === 423) {
    return "Export locked — an approval is pending on this project.";
  }
  return msg || "Export failed";
}

export function useExportSchedule() {
  const fn = useServerFn(exportSldSchedule);
  return useMutation({
    mutationFn: ({ scheduleId, format }: { scheduleId: string; format: "csv" | "pdf" }) =>
      (fn as any)({ data: { scheduleId, format } }),
    onSuccess: (res: any) => {
      if (res.format === "csv") {
        downloadCsv(res.filename, res.csv ?? "");
      } else {
        downloadSchedulePdf(res.filename, {
          scheduleType: res.schedule_type,
          rows: res.rows ?? [],
          drawing: res.drawing,
          branding: res.branding,
        });
      }
      toast.success(`Exported ${res.filename}`);
    },
    onError: (err) => toast.error(lockMessage(err)),
  });
}
