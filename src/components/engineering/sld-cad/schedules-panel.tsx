// P-144 — Schedules tab for the SLD drawing detail: per-type cards, preview, export.
import { useQuery } from "@tanstack/react-query";
import { FileDown, Loader2, Lock, RefreshCw, Table2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsExportLocked } from "@/lib/export-locks.hooks";
import { formatDateTime } from "@/lib/format";
import {
  sldSchedulesQueryOptions,
  useExportSchedule,
  useGenerateSchedules,
  type ScheduleSummary,
} from "@/lib/sld-schedules-query";
import {
  SCHEDULE_COLUMNS,
  SCHEDULE_LABELS,
  SCHEDULE_TYPES,
  type ScheduleType,
} from "@/lib/sld/schedules";

interface SchedulesPanelProps {
  drawingId: string;
  projectId: string;
  canEdit: boolean;
}

export function SchedulesPanel({ drawingId, projectId, canEdit }: SchedulesPanelProps) {
  const query = useQuery(sldSchedulesQueryOptions(drawingId));
  const generate = useGenerateSchedules(drawingId);
  const exportSchedule = useExportSchedule();
  const { data: locked } = useIsExportLocked(projectId, "sld_schedule");

  if (query.isPending) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <Card>
        <CardContent className="space-y-3 py-6">
          <p className="text-sm text-destructive">
            {(query.error as Error)?.message ?? "Failed to load schedules."}
          </p>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const byType = new Map<ScheduleType, ScheduleSummary>(
    (query.data?.schedules ?? []).map((s) => [s.schedule_type, s]),
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Table2 size={14} aria-hidden className="text-muted-foreground" />
          <span className="text-sm font-medium">Schedules</span>
          {locked ? (
            <Badge variant="outline" className="gap-1">
              <Lock size={11} aria-hidden />
              Exports locked
            </Badge>
          ) : null}
        </div>
        {canEdit ? (
          <Button
            size="sm"
            variant="outline"
            disabled={generate.isPending}
            onClick={() => generate.mutate()}
          >
            {generate.isPending ? (
              <Loader2 size={14} className="animate-spin" aria-hidden />
            ) : (
              <RefreshCw size={14} aria-hidden />
            )}
            {byType.size > 0 ? "Regenerate" : "Generate schedules"}
          </Button>
        ) : null}
      </div>

      {byType.size === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No schedules yet.{" "}
            {canEdit
              ? "Generate them from the current object graph."
              : "An engineer can generate them from the object graph."}
          </CardContent>
        </Card>
      ) : (
        SCHEDULE_TYPES.map((type) => {
          const schedule = byType.get(type);
          if (!schedule) return null;
          return (
            <ScheduleCard
              key={type}
              schedule={schedule}
              locked={Boolean(locked)}
              exporting={exportSchedule.isPending}
              onExport={(format) => exportSchedule.mutate({ scheduleId: schedule.id, format })}
            />
          );
        })
      )}
    </div>
  );
}

function ScheduleCard({
  schedule,
  locked,
  exporting,
  onExport,
}: {
  schedule: ScheduleSummary;
  locked: boolean;
  exporting: boolean;
  onExport: (format: "csv" | "pdf") => void;
}) {
  const columns = SCHEDULE_COLUMNS[schedule.schedule_type];
  const preview = schedule.rows.slice(0, 5);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div>
          <CardTitle className="text-sm">{SCHEDULE_LABELS[schedule.schedule_type]}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {schedule.row_count} row{schedule.row_count === 1 ? "" : "s"} ·{" "}
            {formatDateTime(schedule.generated_at)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={exporting || locked}
            title={locked ? "Exports locked by a pending approval" : "Download CSV"}
            onClick={() => onExport("csv")}
          >
            {locked ? <Lock size={13} aria-hidden /> : <FileDown size={13} aria-hidden />}
            CSV
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={exporting || locked}
            title={locked ? "Exports locked by a pending approval" : "Download PDF"}
            onClick={() => onExport("pdf")}
          >
            {locked ? <Lock size={13} aria-hidden /> : <FileDown size={13} aria-hidden />}
            PDF
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        {preview.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing to list for this sheet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  {columns.map((c) => (
                    <th key={c.key} className="px-2 py-1 text-left font-medium">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i} className="border-b border-border/50 last:border-0">
                    {columns.map((c) => (
                      <td key={c.key} className="px-2 py-1">
                        {row[c.key] === null || row[c.key] === undefined ? "—" : String(row[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {schedule.row_count > preview.length ? (
              <p className="px-2 pt-2 text-xs text-muted-foreground">
                +{schedule.row_count - preview.length} more row(s) in the export
              </p>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
