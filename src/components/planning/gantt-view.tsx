// P-073 — Gantt view: left grid + right timeline.
import { useMemo } from "react";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { TaskInlineEditor, type TaskEditPatch } from "@/components/planning/task-inline-editor";
import {
  SCHEDULE_STATUS_LABEL,
  barColorForStatus,
  baselineByTaskId,
  computeVariance,
  isOverdue,
  type BaselineSnapshotEntry,
} from "@/lib/schedule.rules";
import type { ScheduleTaskRow } from "@/lib/schedule.functions";
import { WBS_DISCIPLINE_LABEL, type WbsDiscipline } from "@/lib/wbs-rules";

interface Props {
  tasks: ScheduleTaskRow[];
  canWrite: boolean;
  compare: boolean;
  baselineSnapshot: BaselineSnapshotEntry[] | null;
  saving?: boolean;
  highlightCriticalPath?: boolean;
  onSaveTask: (id: string, patch: TaskEditPatch) => void;
  onDeleteTask: (id: string) => void;
}

interface Range {
  start: Date;
  end: Date;
  totalDays: number;
  unit: "week" | "month";
}

function computeRange(tasks: ScheduleTaskRow[], snapshot: BaselineSnapshotEntry[] | null): Range {
  const dates: Date[] = [];
  for (const t of tasks) {
    dates.push(parseISO(t.start_date), parseISO(t.end_date));
  }
  if (snapshot) {
    for (const s of snapshot) {
      dates.push(parseISO(s.start_date), parseISO(s.end_date));
    }
  }
  if (dates.length === 0) {
    const today = new Date();
    return {
      start: today,
      end: addDays(today, 30),
      totalDays: 30,
      unit: "week",
    };
  }
  let min = dates[0]!;
  let max = dates[0]!;
  for (const d of dates) {
    if (d < min) min = d;
    if (d > max) max = d;
  }
  // Pad by a few days each side.
  const start = addDays(min, -3);
  const end = addDays(max, 3);
  const totalDays = Math.max(7, differenceInCalendarDays(end, start));
  const unit: "week" | "month" = totalDays <= 90 ? "week" : "month";
  return { start, end, totalDays, unit };
}

function buildTicks(range: Range): { label: string; pct: number }[] {
  const ticks: { label: string; pct: number }[] = [];
  const stepDays = range.unit === "week" ? 7 : 30;
  const fmtStr = range.unit === "week" ? "dd MMM" : "MMM yyyy";
  for (let d = 0; d <= range.totalDays; d += stepDays) {
    ticks.push({
      label: format(addDays(range.start, d), fmtStr),
      pct: (d / range.totalDays) * 100,
    });
  }
  return ticks;
}

export function GanttView({
  tasks,
  canWrite,
  compare,
  baselineSnapshot,
  saving,
  highlightCriticalPath = false,
  onSaveTask,
  onDeleteTask,
}: Props) {
  const range = useMemo(
    () => computeRange(tasks, compare ? baselineSnapshot : null),
    [tasks, compare, baselineSnapshot],
  );
  const ticks = useMemo(() => buildTicks(range), [range]);
  const baselineMap = useMemo(
    () => baselineByTaskId(compare ? baselineSnapshot : null),
    [baselineSnapshot, compare],
  );
  const showVariance = compare && !!baselineSnapshot;
  const today = new Date();

  const posPct = (isoDate: string) => {
    const d = parseISO(isoDate);
    const offset = differenceInCalendarDays(d, range.start);
    return (offset / range.totalDays) * 100;
  };

  return (
    <div className="grid grid-cols-1 gap-0 overflow-hidden rounded border border-border bg-card lg:grid-cols-[minmax(0,540px)_minmax(0,1fr)]">
      {/* LEFT GRID */}
      <div className="overflow-x-auto border-b border-border lg:border-b-0 lg:border-r">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>Discipline</TableHead>
              <TableHead>Start</TableHead>
              <TableHead>End</TableHead>
              <TableHead>%</TableHead>
              <TableHead>Status</TableHead>
              {showVariance && (
                <>
                  <TableHead>Start var</TableHead>
                  <TableHead>Finish var</TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((t) => {
              const overdue = isOverdue(t, today);
              const v = computeVariance(t, baselineMap.get(t.id));
              return (
                <TableRow key={t.id} className="h-10">
                  <TableCell className="max-w-[220px]">
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="truncate text-left text-sm font-medium text-foreground hover:underline"
                        >
                          {t.is_milestone && "◆ "}
                          {t.name}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="p-3">
                        <TaskInlineEditor
                          task={t}
                          siblings={tasks}
                          canWrite={canWrite}
                          saving={saving}
                          onSave={(patch) => onSaveTask(t.id, patch)}
                          onDelete={() => onDeleteTask(t.id)}
                        />
                      </PopoverContent>
                    </Popover>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {t.discipline ? WBS_DISCIPLINE_LABEL[t.discipline as WbsDiscipline] : "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {format(parseISO(t.start_date), "dd MMM")}
                  </TableCell>
                  <TableCell className="text-xs">
                    {format(parseISO(t.end_date), "dd MMM")}
                  </TableCell>
                  <TableCell className="text-xs">{t.progress_pct}%</TableCell>
                  <TableCell>
                    <Badge variant={overdue ? "destructive" : "secondary"} className="text-xs">
                      {overdue ? "Overdue" : SCHEDULE_STATUS_LABEL[t.status]}
                    </Badge>
                  </TableCell>
                  {showVariance && (
                    <>
                      <TableCell className="text-xs">
                        <VarianceCell v={v.start_var_days} />
                      </TableCell>
                      <TableCell className="text-xs">
                        <VarianceCell v={v.finish_var_days} />
                      </TableCell>
                    </>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* RIGHT TIMELINE */}
      <div className="relative min-w-0 overflow-x-auto">
        {/* Header ticks */}
        <div className="relative h-10 border-b border-border">
          {ticks.map((tk, i) => (
            <div
              key={i}
              className="absolute top-0 flex h-full items-center border-l border-border/60 pl-1 text-[10px] text-muted-foreground"
              style={{ left: `${tk.pct}%` }}
            >
              {tk.label}
            </div>
          ))}
        </div>
        {/* Rows */}
        <div className="relative">
          {tasks.map((t) => {
            const overdue = isOverdue(t, today);
            const color = barColorForStatus(t.status, overdue);
            const leftPct = posPct(t.start_date);
            const rightPct = posPct(t.end_date);
            const widthPct = Math.max(0.5, rightPct - leftPct);
            const baseline = baselineMap.get(t.id);
            return (
              <div key={t.id} className="relative h-10 border-b border-border/60">
                {/* Ghost baseline bar */}
                {compare && baseline && (
                  <div
                    className="absolute top-6 h-1.5 rounded border border-dashed border-muted-foreground/60 bg-muted-foreground/20"
                    style={{
                      left: `${posPct(baseline.start_date)}%`,
                      width: `${Math.max(
                        0.5,
                        posPct(baseline.end_date) - posPct(baseline.start_date),
                      )}%`,
                    }}
                    aria-hidden
                  />
                )}
                {t.is_milestone ? (
                  <div
                    className={cn(
                      "absolute top-2 h-6 w-6 rotate-45 border border-primary-foreground/20",
                      color,
                    )}
                    style={{
                      left: `calc(${leftPct}% - 12px)`,
                    }}
                    title={`${t.name} · ${format(parseISO(t.start_date), "dd MMM yyyy")}`}
                    aria-label={`Milestone ${t.name}`}
                  />
                ) : (
                  <div
                    className={cn(
                      "absolute top-3 flex h-4 items-center rounded-sm text-[10px] font-medium text-primary-foreground shadow-sm",
                      color,
                    )}
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      minWidth: 4,
                    }}
                    title={`${t.name} · ${format(parseISO(t.start_date), "dd MMM")} → ${format(parseISO(t.end_date), "dd MMM")}`}
                  >
                    <span className="truncate px-1">{t.progress_pct}%</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function VarianceCell({ v }: { v: number | null }) {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  if (v === 0) return <span className="text-muted-foreground">0d</span>;
  const late = v > 0;
  return (
    <span className={cn("font-medium", late ? "text-destructive" : "text-muted-foreground")}>
      {late ? "+" : ""}
      {v}d
    </span>
  );
}
