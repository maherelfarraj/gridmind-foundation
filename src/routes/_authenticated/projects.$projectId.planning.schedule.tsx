// P-073 — Schedule Gantt workspace.
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import {
  createBaseline,
  createScheduleTask,
  deleteScheduleTask,
  getScheduleAccess,
  listBaselines,
  listScheduleTasks,
  lockBaseline,
  updateScheduleTask,
  type ScheduleTaskRow,
} from "@/lib/schedule.functions";
import {
  baselinesQueryOptions,
  scheduleAccessQueryOptions,
  scheduleErrorMessage,
  scheduleTasksQueryOptions,
} from "@/lib/schedule.query";
import { avgFinishVariance, isOverdue, weightedProgress } from "@/lib/schedule.rules";
import { buildVarianceCsv, downloadCsv } from "@/lib/schedule.csv";
import { SectionHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { CalendarClock } from "lucide-react";

import { GanttView } from "@/components/planning/gantt-view";
import { ScheduleKpiStrip } from "@/components/planning/schedule-kpi-strip";
import { ScheduleToolbar } from "@/components/planning/schedule-toolbar";
import { BaselineManager } from "@/components/planning/baseline-manager";
import type { TaskEditPatch } from "@/components/planning/task-inline-editor";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useQuery } from "@tanstack/react-query";
import { getControlsAccess, recomputeCriticalPath } from "@/lib/controls.functions";

export const Route = createFileRoute("/_authenticated/projects/$projectId/planning/schedule")({
  head: () => ({
    meta: [
      { title: "Schedule Gantt — GridMind EPC" },
      {
        name: "description",
        content: "Project Gantt with baseline lock and variance tracking for GridMind EPC.",
      },
      { property: "og:title", content: "Schedule Gantt — GridMind EPC" },
      {
        property: "og:description",
        content: "Project Gantt with baseline lock and variance tracking for GridMind EPC.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  pendingComponent: SchedulePending,
  errorComponent: ScheduleError,
  component: SchedulePage,
});

function SchedulePage() {
  const { projectId } = Route.useParams();
  const queryClient = useQueryClient();

  const tasksFn = useServerFn(listScheduleTasks);
  const baselinesFn = useServerFn(listBaselines);
  const accessFn = useServerFn(getScheduleAccess);

  const tasksQuery = useSuspenseQuery(scheduleTasksQueryOptions(tasksFn, projectId));
  const baselinesQuery = useSuspenseQuery(baselinesQueryOptions(baselinesFn, projectId));
  const accessQuery = useSuspenseQuery(scheduleAccessQueryOptions(accessFn));

  const tasks = tasksQuery.data;
  const baselines = baselinesQuery.data;
  const canWrite = accessQuery.data.canWrite;
  const canLock = accessQuery.data.canLockBaseline;

  const [selectedBaselineId, setSelectedBaselineId] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);

  // Auto-select the latest locked baseline once loaded.
  const effectiveBaselineId = useMemo(() => {
    if (selectedBaselineId) return selectedBaselineId;
    const locked = [...baselines].reverse().find((b) => b.locked);
    return locked?.id ?? null;
  }, [baselines, selectedBaselineId]);

  const selectedBaseline = useMemo(
    () => baselines.find((b) => b.id === effectiveBaselineId) ?? null,
    [baselines, effectiveBaselineId],
  );

  const snapshot = selectedBaseline?.snapshot ?? null;

  const overdueCount = useMemo(() => {
    const today = new Date();
    return tasks.filter((t) => isOverdue(t, today)).length;
  }, [tasks]);

  const weightedPct = useMemo(() => weightedProgress(tasks), [tasks]);
  const finishVar = useMemo(
    () => (snapshot ? avgFinishVariance(tasks, snapshot) : null),
    [tasks, snapshot],
  );

  const createFn = useServerFn(createScheduleTask);
  const updateFn = useServerFn(updateScheduleTask);
  const deleteFn = useServerFn(deleteScheduleTask);
  const createBaselineFn = useServerFn(createBaseline);
  const lockBaselineFn = useServerFn(lockBaseline);

  const invalidateTasks = () =>
    queryClient.invalidateQueries({
      queryKey: ["schedule", "tasks", projectId],
    });
  const invalidateBaselines = () =>
    queryClient.invalidateQueries({
      queryKey: ["schedule", "baselines", projectId],
    });

  const createTaskMut = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          projectId,
          name: "New task",
          discipline: null,
          start_date: format(new Date(), "yyyy-MM-dd"),
          end_date: format(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), "yyyy-MM-dd"),
          progress_pct: 0,
          status: "not_started",
          is_milestone: false,
          sort_order: tasks.length,
          predecessor_ids: [],
        },
      }),
    onSuccess: () => {
      toast.success("Task created");
      invalidateTasks();
    },
    onError: (e) => toast.error(scheduleErrorMessage(e)),
  });

  const updateTaskMut = useMutation({
    mutationFn: (v: { id: string; patch: TaskEditPatch }) => updateFn({ data: v }),
    onSuccess: () => {
      toast.success("Task saved");
      invalidateTasks();
    },
    onError: (e) => toast.error(scheduleErrorMessage(e)),
  });

  const deleteTaskMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Task deleted");
      invalidateTasks();
    },
    onError: (e) => toast.error(scheduleErrorMessage(e)),
  });

  const createBaselineMut = useMutation({
    mutationFn: () => createBaselineFn({ data: { projectId } }),
    onSuccess: (row) => {
      toast.success(`${row.name} created (draft)`);
      setSelectedBaselineId(row.id);
      invalidateBaselines();
    },
    onError: (e) => toast.error(scheduleErrorMessage(e)),
  });

  const lockBaselineMut = useMutation({
    mutationFn: (id: string) => lockBaselineFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Baseline locked 🔒");
      invalidateBaselines();
    },
    onError: (e) => toast.error(scheduleErrorMessage(e)),
  });

  const handleExport = () => {
    const csv = buildVarianceCsv(tasks, selectedBaseline?.name ?? null, snapshot);
    downloadCsv(`schedule-variance-${format(new Date(), "yyyyMMdd-HHmm")}.csv`, csv);
  };

  const showCompare = compare && !!snapshot;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Schedule"
        description="Gantt view with baseline lock and variance tracking."
      />

      {!canWrite && (
        <Card className="p-4 text-sm text-muted-foreground">
          You have read-only access to the schedule. Ask a project or company admin for write
          access.
        </Card>
      )}

      <ScheduleKpiStrip
        total={tasks.length}
        weightedPct={weightedPct}
        overdue={overdueCount}
        finishVariance={showCompare ? finishVar : null}
        baselineName={showCompare ? (selectedBaseline?.name ?? null) : null}
      />

      <Card className="p-4">
        <ScheduleToolbar
          baselines={baselines}
          selectedBaselineId={effectiveBaselineId}
          onSelectBaseline={(id) => {
            setSelectedBaselineId(id);
            if (!id) setCompare(false);
          }}
          compare={compare}
          onCompareChange={setCompare}
          canWrite={canWrite}
          canLock={canLock}
          onNewTask={() => createTaskMut.mutate()}
          onCreateBaseline={() => createBaselineMut.mutate()}
          onLockSelected={() => effectiveBaselineId && lockBaselineMut.mutate(effectiveBaselineId)}
          onExportCsv={handleExport}
          onManageBaselines={() => setManagerOpen(true)}
          creatingBaseline={createBaselineMut.isPending}
          lockingBaseline={lockBaselineMut.isPending}
        />
        />
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
          <div className="flex items-center gap-2">
            <Switch
              id="cp-toggle"
              checked={showCp}
              onCheckedChange={setShowCp}
              aria-label="Highlight critical path"
            />
            <Label htmlFor="cp-toggle" className="text-sm text-muted-foreground">
              Highlight critical path
            </Label>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!controlsAccess.data?.canAdmin || recomputeCpMut.isPending}
            onClick={() => recomputeCpMut.mutate()}
          >
            Recompute critical path
          </Button>
        </div>
      </Card>

      {tasks.length === 0 ? (
        <Card className="p-8">
          <EmptyState
            icon={CalendarClock}
            title="No tasks yet"
            description="Build the WBS first, then add tasks here."
          />
        </Card>
      ) : (
        <GanttView
          tasks={tasks}
          canWrite={canWrite}
          compare={showCompare}
          baselineSnapshot={snapshot}
          saving={updateTaskMut.isPending || deleteTaskMut.isPending}
          onSaveTask={(id: string, patch: TaskEditPatch) => updateTaskMut.mutate({ id, patch })}
          onDeleteTask={(id: string) => deleteTaskMut.mutate(id)}
        />
      )}

      <BaselineManager
        projectId={projectId}
        open={managerOpen}
        onOpenChange={setManagerOpen}
        baselines={baselines}
        canLock={canLock}
        canWrite={canWrite}
      />
    </div>
  );
}

function SchedulePending() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

function ScheduleError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <Card className="border-destructive/40 bg-card p-4">
      <p className="text-sm text-foreground">
        Couldn&rsquo;t load the schedule: {scheduleErrorMessage(error)}
      </p>
      <Button variant="outline" size="sm" className="mt-3" onClick={() => reset()}>
        Retry
      </Button>
    </Card>
  );
}
