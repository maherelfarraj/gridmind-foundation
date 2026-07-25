// P-072 — Align schedule tasks to WBS nodes and disciplines.
import { useMemo } from "react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { Link2 } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  assignScheduleTask,
  getScheduleTaskAssignAccess,
  listScheduleTasksForAlign,
  type ScheduleTaskAlignRow,
} from "@/lib/schedule-tasks.functions";
import {
  scheduleTaskAssignAccessQueryOptions,
  scheduleTasksAlignQueryOptions,
  wbsErrorMessage,
} from "@/lib/wbs-query";
import { WBS_DISCIPLINES, WBS_DISCIPLINE_LABEL, type WbsDiscipline } from "@/lib/wbs-rules";
import type { WbsItemRow } from "@/lib/wbs.functions";

const NONE = "__none";

interface TaskAlignmentPanelProps {
  projectId: string;
  items: WbsItemRow[];
}

export function TaskAlignmentPanel({ projectId, items }: TaskAlignmentPanelProps) {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listScheduleTasksForAlign);
  const accessFn = useServerFn(getScheduleTaskAssignAccess);
  const assignFn = useServerFn(assignScheduleTask);

  const tasksQuery = useSuspenseQuery(scheduleTasksAlignQueryOptions(listFn, projectId));
  const accessQuery = useSuspenseQuery(scheduleTaskAssignAccessQueryOptions(accessFn));
  const canAssign = accessQuery.data.canAssign;

  const wbsOptions = useMemo(
    () =>
      items
        .filter((i) => i.item_type !== "phase")
        .map((i) => ({
          id: i.id,
          label: `${i.code} · ${i.name}`,
        })),
    [items],
  );

  const wbsLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of items) m.set(i.id, `${i.code} · ${i.name}`);
    return m;
  }, [items]);

  const assignMut = useMutation({
    mutationFn: (input: {
      id: string;
      discipline: WbsDiscipline | null;
      wbs_item_id: string | null;
    }) => assignFn({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["schedule-tasks", "align", projectId],
      });
      toast.success("Task aligned");
    },
    onError: (e) => toast.error(wbsErrorMessage(e)),
  });

  const tasks = tasksQuery.data;
  const unaligned = tasks.filter((t) => !t.wbs_item_id || !t.discipline).length;

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link2 size={16} className="text-muted-foreground" aria-hidden />
          <h3 className="font-display text-base font-semibold text-foreground">
            Align schedule tasks
          </h3>
        </div>
        <Badge variant={unaligned > 0 ? "destructive" : "secondary"}>{unaligned} unaligned</Badge>
      </div>

      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No schedule tasks yet. Once tasks are created you can pin them to WBS nodes and
          disciplines here.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Window</TableHead>
                <TableHead>Discipline</TableHead>
                <TableHead>WBS node</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  wbsOptions={wbsOptions}
                  wbsLabelById={wbsLabelById}
                  canAssign={canAssign && !assignMut.isPending}
                  onAssign={(discipline, wbs_item_id) =>
                    assignMut.mutate({ id: t.id, discipline, wbs_item_id })
                  }
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

function TaskRow({
  task,
  wbsOptions,
  wbsLabelById,
  canAssign,
  onAssign,
}: {
  task: ScheduleTaskAlignRow;
  wbsOptions: { id: string; label: string }[];
  wbsLabelById: Map<string, string>;
  canAssign: boolean;
  onAssign: (discipline: WbsDiscipline | null, wbs_item_id: string | null) => void;
}) {
  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{task.name}</span>
          <span className="text-xs text-muted-foreground">
            {task.is_milestone ? "Milestone · " : ""}
            {task.status}
          </span>
        </div>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {format(new Date(task.start_date), "dd MMM")} →{" "}
        {format(new Date(task.end_date), "dd MMM yyyy")}
      </TableCell>
      <TableCell>
        <Select
          value={task.discipline ?? NONE}
          onValueChange={(v) =>
            onAssign(v === NONE ? null : (v as WbsDiscipline), task.wbs_item_id)
          }
          disabled={!canAssign}
        >
          <SelectTrigger className="h-8 w-40">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>—</SelectItem>
            {WBS_DISCIPLINES.map((d) => (
              <SelectItem key={d} value={d}>
                {WBS_DISCIPLINE_LABEL[d]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Select
          value={task.wbs_item_id ?? NONE}
          onValueChange={(v) => onAssign(task.discipline, v === NONE ? null : v)}
          disabled={!canAssign}
        >
          <SelectTrigger className="h-8 w-64">
            <SelectValue placeholder="—">
              {task.wbs_item_id ? (wbsLabelById.get(task.wbs_item_id) ?? "—") : "—"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>—</SelectItem>
            {wbsOptions.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
    </TableRow>
  );
}
