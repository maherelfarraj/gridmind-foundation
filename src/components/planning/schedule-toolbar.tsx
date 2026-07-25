// P-073 — Schedule toolbar.
import { Download, Lock, Plus, Save, SlidersHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import type { BaselineRow } from "@/lib/schedule.functions";

const NONE = "__none";

interface Props {
  baselines: BaselineRow[];
  selectedBaselineId: string | null;
  onSelectBaseline: (id: string | null) => void;
  compare: boolean;
  onCompareChange: (v: boolean) => void;
  canWrite: boolean;
  canLock: boolean;
  onNewTask: () => void;
  onCreateBaseline: () => void;
  onLockSelected: () => void;
  onExportCsv: () => void;
  onManageBaselines: () => void;
  creatingBaseline?: boolean;
  lockingBaseline?: boolean;
}

export function ScheduleToolbar({
  baselines,
  selectedBaselineId,
  onSelectBaseline,
  compare,
  onCompareChange,
  canWrite,
  canLock,
  onNewTask,
  onCreateBaseline,
  onLockSelected,
  onExportCsv,
  onManageBaselines,
  creatingBaseline,
  lockingBaseline,
}: Props) {
  const selected = baselines.find((b) => b.id === selectedBaselineId) ?? null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onNewTask} disabled={!canWrite}>
          <Plus size={14} aria-hidden />
          New task
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onCreateBaseline}
          disabled={!canWrite || creatingBaseline}
        >
          <Save size={14} aria-hidden />
          Create baseline
        </Button>
        <Button size="sm" variant="outline" onClick={onManageBaselines}>
          <SlidersHorizontal size={14} aria-hidden />
          Manage
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Baseline</Label>
          <Select
            value={selectedBaselineId ?? NONE}
            onValueChange={(v) => onSelectBaseline(v === NONE ? null : v)}
          >
            <SelectTrigger className="h-8 w-56">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {baselines.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.locked ? "🔒 " : ""}
                  {b.name}
                  {!b.locked ? " (draft)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selected && !selected.locked && (
            <Button
              size="sm"
              variant="outline"
              onClick={onLockSelected}
              disabled={!canLock || lockingBaseline}
            >
              <Lock size={12} aria-hidden />
              Lock
            </Button>
          )}
          {selected && selected.locked && (
            <Badge className="gap-1">
              <Lock size={10} aria-hidden />
              Locked
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="compare"
            checked={compare}
            onCheckedChange={onCompareChange}
            disabled={!selected}
          />
          <Label htmlFor="compare" className="cursor-pointer text-xs">
            Compare to baseline
          </Label>
        </div>

        <Button size="sm" variant="outline" onClick={onExportCsv}>
          <Download size={14} aria-hidden />
          Export CSV
        </Button>
      </div>
    </div>
  );
}
