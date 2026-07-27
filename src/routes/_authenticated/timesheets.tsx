// P-228 — Weekly timesheet capture, mobile-first at 390px.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, CloudOff, RefreshCw, Send, Timer } from "lucide-react";
import { toast } from "sonner";

import { AddRowDialog } from "@/components/timesheets/add-row-dialog";
import { ClockMode } from "@/components/timesheets/clock-mode";
import { HourlyRateCard } from "@/components/timesheets/hourly-rate-card";
import { TimesheetGrid } from "@/components/timesheets/timesheet-grid";
import { WeekPicker } from "@/components/timesheets/week-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiTile } from "@/components/ui/kpi-tile";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { enqueueMutation } from "@/lib/offline/queue";
import {
  checkTimesheetApproval,
  getMyHourlyRate,
  getOrCreateTimesheet,
  listTimesheetProjects,
  saveClockMetadata,
  resubmitTimesheet,
  submitTimesheet,
  upsertTimesheetEntries,
} from "@/lib/timesheets.functions";
import type { ClockDay } from "@/lib/timesheets.server";
import { rowKey, toCells, toGridRows, type GridRow } from "@/lib/timesheets/grid";
import { computeWeeklyTotals } from "@/lib/timesheets/split";
import { weekDays, weekStartOf } from "@/lib/timesheets/week";

export const Route = createFileRoute("/_authenticated/timesheets")({
  head: () => ({
    meta: [
      { title: "Weekly timesheets — GridMind EPC" },
      {
        name: "description",
        content:
          "Capture crew hours week by week: project and work-package rows, automatic overtime split, clock in/out mode and offline-safe submission.",
      },
      { property: "og:title", content: "Weekly timesheets — GridMind EPC" },
      {
        property: "og:description",
        content: "Mobile-first weekly time capture with automatic regular/overtime split.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TimesheetsPage,
});

const hoursFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function TimesheetsPage() {
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState<string>(() => weekStartOf());
  const [rows, setRows] = useState<GridRow[]>([]);
  const [clockMode, setClockMode] = useState(false);
  const [queued, setQueued] = useState(false);
  const [decisionComment, setDecisionComment] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const days = useMemo(() => weekDays(weekStart), [weekStart]);

  const weekFn = useServerFn(getOrCreateTimesheet);
  const week = useQuery({
    queryKey: ["timesheets", "week", weekStart],
    queryFn: () => weekFn({ data: { week_start: weekStart } }),
  });

  const projectsFn = useServerFn(listTimesheetProjects);
  const projects = useQuery({
    queryKey: ["timesheets", "projects"],
    queryFn: () => projectsFn(),
    staleTime: 300_000,
  });

  const rateFn = useServerFn(getMyHourlyRate);
  const rate = useQuery({ queryKey: ["timesheets", "rate"], queryFn: () => rateFn() });

  const sheet = week.data?.timesheet ?? null;
  const readOnly = !week.data?.canEdit;

  useEffect(() => {
    if (week.data) setRows(toGridRows(week.data.entries));
  }, [week.data]);

  const upsertFn = useServerFn(upsertTimesheetEntries);
  const saveCells = useMutation({
    mutationFn: async (next: GridRow[]) => {
      if (!sheet) return null;
      return upsertFn({ data: { timesheetId: sheet.id, cells: toCells(next, days) } });
    },
    onError: (e: unknown) => toast.error((e as Error).message || "Autosave failed"),
  });

  const scheduleSave = useCallback(
    (next: GridRow[]) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => saveCells.mutate(next), 800);
    },
    [saveCells],
  );

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const mutateRows = (updater: (prev: GridRow[]) => GridRow[]) => {
    setRows((prev) => {
      const next = updater(prev);
      scheduleSave(next);
      return next;
    });
  };

  const projectLabel = useCallback(
    (id: string | null) => {
      if (!id) return "Unassigned";
      const p = (projects.data ?? []).find((x) => x.id === id);
      return p ? (p.code ? `${p.code} — ${p.name}` : p.name) : "Project";
    },
    [projects.data],
  );

  // ── Clock in/out ─────────────────────────────────────────────────────────
  const clock = (sheet?.metadata?.clock ?? {}) as Record<string, ClockDay>;
  const [clockDraft, setClockDraft] = useState<Record<string, ClockDay>>({});
  useEffect(() => setClockDraft(clock), [sheet?.id, week.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const clockRow = rows.find((r) => r.activity === "regular") ?? rows[0] ?? null;
  const hoursByDay = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const d of days) acc[d] = rows.reduce((s, r) => s + (Number(r.hours[d]) || 0), 0);
    return acc;
  }, [rows, days]);

  const clockFn = useServerFn(saveClockMetadata);
  const onClockChange = (day: string, next: { clock?: ClockDay; hours?: number }) => {
    if (next.clock) {
      const merged = { ...clockDraft, [day]: next.clock };
      setClockDraft(merged);
      if (sheet) void clockFn({ data: { timesheetId: sheet.id, clock: merged } });
    }
    if (next.hours != null && clockRow) {
      mutateRows((prev) =>
        prev.map((r) =>
          r.key === clockRow.key ? { ...r, hours: { ...r.hours, [day]: next.hours! } } : r,
        ),
      );
    }
  };

  // ── Submit (offline-aware) ───────────────────────────────────────────────
  const submitFn = useServerFn(submitTimesheet);
  const submit = useMutation({
    mutationFn: async () => {
      if (!sheet) return null;
      const key = `timesheet-submit-${sheet.id}`;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        await enqueueMutation({
          entity: "timesheet",
          action: "submit",
          payload: { timesheetId: sheet.id },
          clientIdempotencyKey: key,
        });
        setQueued(true);
        return { queued: true } as const;
      }
      return submitFn({ data: { timesheetId: sheet.id, clientIdempotencyKey: key } });
    },
    onSuccess: (res) => {
      if (res && "queued" in res) {
        toast.info("Queued — will submit when online");
        return;
      }
      toast.success("Timesheet submitted for approval");
      void qc.invalidateQueries({ queryKey: ["timesheets", "week", weekStart] });
    },
    onError: (e: unknown) => toast.error((e as Error).message || "Could not submit"),
  });

  // ── Decision watcher / rejection recovery ────────────────────────────────
  const checkFn = useServerFn(checkTimesheetApproval);
  const check = useMutation({
    mutationFn: async () => (sheet ? checkFn({ data: { timesheetId: sheet.id } }) : null),
    onSuccess: (res) => {
      if (!res) return;
      setDecisionComment(res.comment ?? null);
      if (res.changed) {
        toast.success(`Timesheet ${res.status}`);
        void qc.invalidateQueries({ queryKey: ["timesheets", "week", weekStart] });
      } else {
        toast.info(`Still ${res.status.replace("_", " ")}`);
      }
    },
    onError: (e: unknown) => toast.error((e as Error).message || "Could not check approval"),
  });

  const reopenFn = useServerFn(resubmitTimesheet);
  const reopen = useMutation({
    mutationFn: async () => (sheet ? reopenFn({ data: { timesheetId: sheet.id } }) : null),
    onSuccess: () => {
      setDecisionComment(null);
      toast.success("Reopened as draft — your hours are intact");
      void qc.invalidateQueries({ queryKey: ["timesheets", "week", weekStart] });
    },
    onError: (e: unknown) => toast.error((e as Error).message || "Could not reopen"),
  });

  // Pull the verdict automatically whenever an in-review week is opened.
  useEffect(() => {
    if (sheet && sheet.approval_instance_id && sheet.status === "in_review") check.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet?.id, sheet?.status]);

  const totals = computeWeeklyTotals(
    rows.flatMap((r) =>
      days.map((d) => ({ work_date: d, activity: r.activity, hours: r.hours[d] ?? 0 })),
    ),
  );

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6">
      <PageHeader
        title="Weekly timesheets"
        description="Book crew hours per project and work package. Overtime splits automatically."
        actions={
          sheet ? (
            <div className="flex items-center gap-2">
              <StatusBadge status={sheet.status} />
              <Button
                size="sm"
                disabled={readOnly || submit.isPending || rows.length === 0}
                onClick={() => submit.mutate()}
              >
                <Send className="mr-1 h-4 w-4" />
                Submit week
              </Button>
              {sheet.approval_instance_id ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={check.isPending}
                  onClick={() => check.mutate()}
                >
                  <RefreshCw className="mr-1 h-4 w-4" />
                  Check approval
                </Button>
              ) : null}
            </div>
          ) : null
        }
      />

      <WeekPicker weekStart={weekStart} onChange={setWeekStart} />

      {queued ? (
        <Card className="border-border">
          <CardContent className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
            <CloudOff className="h-4 w-4" />
            Queued — will submit when online.
          </CardContent>
        </Card>
      ) : null}

      {sheet?.status === "rejected" ? (
        <Card className="border-destructive/50 bg-destructive/10">
          <CardContent className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium text-destructive">This week was rejected</p>
              <p className="text-sm text-destructive/90">
                {decisionComment ? `“${decisionComment}”` : "Check with your approver for details."}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={reopen.isPending}
              onClick={() => reopen.mutate()}
            >
              Resubmit
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-4">
          {week.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : week.isError ? (
            <EmptyState
              icon={CalendarClock}
              title="Could not load this week"
              description="Check your connection and try again."
              action={
                <Button variant="outline" onClick={() => void week.refetch()}>
                  Retry
                </Button>
              }
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <KpiTile label="Regular hours" value={hoursFmt.format(totals.regular)} />
                <KpiTile label="Overtime hours" value={hoursFmt.format(totals.overtime)} />
                <KpiTile
                  label="Timesheet"
                  value={sheet?.timesheet_number ?? "—"}
                  className="col-span-2 sm:col-span-1"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Switch id="clock-mode" checked={clockMode} onCheckedChange={setClockMode} />
                  <Label htmlFor="clock-mode" className="flex items-center gap-1 text-sm">
                    <Timer className="h-4 w-4 text-muted-foreground" />
                    Clock in/out mode
                  </Label>
                </div>
                <AddRowDialog
                  projects={projects.data ?? []}
                  disabled={readOnly}
                  onAdd={({ project_id, cwp_id, activity }) =>
                    mutateRows((prev) => {
                      const key = rowKey(project_id, cwp_id, activity);
                      if (prev.some((r) => r.key === key)) return prev;
                      return [
                        ...prev,
                        { key, project_id, cwp_id, activity, notes: null, hours: {} },
                      ];
                    })
                  }
                />
              </div>

              {rows.length === 0 ? (
                <EmptyState
                  icon={CalendarClock}
                  title="No hours booked yet"
                  description="Add a project row to start capturing this week's hours."
                />
              ) : clockMode ? (
                <ClockMode
                  weekStart={weekStart}
                  clock={clockDraft}
                  hoursByDay={hoursByDay}
                  readOnly={readOnly}
                  onChange={onClockChange}
                />
              ) : (
                <TimesheetGrid
                  rows={rows}
                  days={days}
                  readOnly={readOnly}
                  projectLabel={projectLabel}
                  onCellChange={(key, day, hours) =>
                    mutateRows((prev) =>
                      prev.map((r) =>
                        r.key === key ? { ...r, hours: { ...r.hours, [day]: hours } } : r,
                      ),
                    )
                  }
                  onNotesChange={(key, notes) =>
                    mutateRows((prev) => prev.map((r) => (r.key === key ? { ...r, notes } : r)))
                  }
                  onRemoveRow={(key) =>
                    mutateRows((prev) =>
                      prev
                        .map((r) => (r.key === key ? { ...r, hours: {} } : r))
                        .filter((r) => r.key !== key),
                    )
                  }
                />
              )}

              {readOnly ? (
                <p className="text-xs text-muted-foreground">
                  This week is {sheet?.status} and read-only.
                </p>
              ) : null}
            </>
          )}
        </div>

        <div className="space-y-4">
          <HourlyRateCard
            loading={rate.isLoading}
            error={rate.isError}
            userId={rate.data?.userId ?? null}
            rate={rate.data?.rate ?? null}
            canEdit={Boolean(rate.data?.canEdit)}
            onRetry={() => void rate.refetch()}
          />
        </div>
      </div>
    </div>
  );
}
