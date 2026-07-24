// P-073 — Inline task editor popover.
import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { CalendarIcon, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

import {
  SCHEDULE_STATUS_LABEL,
  SCHEDULE_TASK_STATUSES,
  type ScheduleTaskStatus,
} from "@/lib/schedule.rules";
import type { ScheduleTaskRow } from "@/lib/schedule.functions";
import {
  WBS_DISCIPLINES,
  WBS_DISCIPLINE_LABEL,
  type WbsDiscipline,
} from "@/lib/wbs-rules";

const NONE = "__none";

export interface TaskEditPatch {
  name?: string;
  discipline?: WbsDiscipline | null;
  start_date?: string;
  end_date?: string;
  progress_pct?: number;
  status?: ScheduleTaskStatus;
  is_milestone?: boolean;
  predecessor_ids?: string[];
}

interface Props {
  task: ScheduleTaskRow;
  siblings: ScheduleTaskRow[];
  canWrite: boolean;
  onSave: (patch: TaskEditPatch) => void;
  onDelete: () => void;
  saving?: boolean;
}

function toIso(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function TaskInlineEditor({
  task,
  siblings,
  canWrite,
  onSave,
  onDelete,
  saving,
}: Props) {
  const [name, setName] = useState(task.name);
  const [discipline, setDiscipline] = useState<WbsDiscipline | "">(
    (task.discipline ?? "") as WbsDiscipline | "",
  );
  const [start, setStart] = useState<Date>(parseISO(task.start_date));
  const [end, setEnd] = useState<Date>(parseISO(task.end_date));
  const [progress, setProgress] = useState<number>(task.progress_pct);
  const [status, setStatus] = useState<ScheduleTaskStatus>(task.status);
  const [milestone, setMilestone] = useState<boolean>(task.is_milestone);
  const [preds, setPreds] = useState<Set<string>>(
    () => new Set(task.predecessor_ids),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(task.name);
    setDiscipline((task.discipline ?? "") as WbsDiscipline | "");
    setStart(parseISO(task.start_date));
    setEnd(parseISO(task.end_date));
    setProgress(task.progress_pct);
    setStatus(task.status);
    setMilestone(task.is_milestone);
    setPreds(new Set(task.predecessor_ids));
    setError(null);
  }, [task]);

  const togglePred = (id: string) =>
    setPreds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleSave = () => {
    setError(null);
    if (name.trim().length === 0) {
      setError("Name is required");
      return;
    }
    if (end < start) {
      setError("End must be on or after start");
      return;
    }
    onSave({
      name: name.trim(),
      discipline: (discipline || null) as WbsDiscipline | null,
      start_date: toIso(start),
      end_date: toIso(end),
      progress_pct: progress,
      status,
      is_milestone: milestone,
      predecessor_ids: Array.from(preds),
    });
  };

  const others = siblings.filter((s) => s.id !== task.id);

  return (
    <div className="flex w-[380px] flex-col gap-3 p-1">
      <div className="flex flex-col gap-1">
        <Label htmlFor="task-name">Name</Label>
        <Input
          id="task-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!canWrite}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label>Discipline</Label>
          <Select
            value={discipline === "" ? NONE : discipline}
            onValueChange={(v) =>
              setDiscipline(v === NONE ? "" : (v as WbsDiscipline))
            }
            disabled={!canWrite}
          >
            <SelectTrigger>
              <SelectValue />
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
        </div>
        <div className="flex flex-col gap-1">
          <Label>Status</Label>
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as ScheduleTaskStatus)}
            disabled={!canWrite}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCHEDULE_TASK_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {SCHEDULE_STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <DatePopover
          label="Start"
          value={start}
          onChange={setStart}
          disabled={!canWrite}
        />
        <DatePopover
          label="End"
          value={end}
          onChange={setEnd}
          disabled={!canWrite}
        />
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <Label>Progress</Label>
          <span className="text-xs font-medium text-foreground">
            {progress}%
          </span>
        </div>
        <Slider
          value={[progress]}
          min={0}
          max={100}
          step={1}
          onValueChange={(v) => setProgress(v[0] ?? 0)}
          disabled={!canWrite}
        />
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="task-milestone"
          checked={milestone}
          onCheckedChange={(v) => setMilestone(v === true)}
          disabled={!canWrite}
        />
        <Label htmlFor="task-milestone" className="cursor-pointer">
          Milestone
        </Label>
      </div>

      <div className="flex flex-col gap-1">
        <Label>Predecessors</Label>
        {others.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No other tasks to depend on.
          </p>
        ) : (
          <ScrollArea className="max-h-32 rounded border border-border p-1">
            <ul className="flex flex-col gap-1">
              {others.map((o) => (
                <li key={o.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id={`pred-${o.id}`}
                    checked={preds.has(o.id)}
                    onCheckedChange={() => togglePred(o.id)}
                    disabled={!canWrite}
                  />
                  <label
                    htmlFor={`pred-${o.id}`}
                    className="min-w-0 flex-1 cursor-pointer truncate text-foreground"
                  >
                    {o.name}
                  </label>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDelete}
          disabled={!canWrite || saving}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 size={14} aria-hidden />
          Delete
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={!canWrite || saving}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

function DatePopover({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: Date;
  onChange: (d: Date) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn("justify-start text-left font-normal")}
            disabled={disabled}
          >
            <CalendarIcon size={14} aria-hidden />
            {format(value, "dd MMM yyyy")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value}
            onSelect={(d) => d && onChange(d)}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
