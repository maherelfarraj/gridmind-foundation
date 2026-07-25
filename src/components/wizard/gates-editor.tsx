// P-035 — Gates editor (wizard step 3).
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PHASE_LABELS,
  PROJECT_PHASES,
  type Gate,
  type ProjectPhase,
} from "@/lib/schemas/project-wizard";

type Props = {
  value: Gate[];
  onChange: (next: Gate[]) => void;
};

function resequence(gates: Gate[]): Gate[] {
  return gates.map((g, i) => ({ ...g, sort_order: i + 1 }));
}

export function GatesEditor({ value, onChange }: Props) {
  const updateAt = (i: number, patch: Partial<Gate>) => {
    const next = value.map((g, idx) => (idx === i ? { ...g, ...patch } : g));
    onChange(resequence(next));
  };
  const removeAt = (i: number) => {
    onChange(resequence(value.filter((_, idx) => idx !== i)));
  };
  const addToPhase = (phase: ProjectPhase) => {
    const next = [...value, { phase, name: "", sort_order: value.length + 1 }];
    onChange(resequence(next));
  };
  const moveWithinPhase = (i: number, dir: -1 | 1) => {
    const gate = value[i];
    if (!gate) return;
    const sameIdxs = value
      .map((g, idx) => (g.phase === gate.phase ? idx : -1))
      .filter((x) => x >= 0);
    const pos = sameIdxs.indexOf(i);
    const swap = sameIdxs[pos + dir];
    if (swap === undefined) return;
    const next = [...value];
    next[i] = value[swap]!;
    next[swap] = gate;
    onChange(resequence(next));
  };

  return (
    <div className="flex flex-col gap-6">
      {PROJECT_PHASES.map((phase) => {
        const rows = value.map((g, idx) => ({ g, idx })).filter((x) => x.g.phase === phase);
        return (
          <div key={phase} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">{PHASE_LABELS[phase]}</h3>
              <Button type="button" size="sm" variant="outline" onClick={() => addToPhase(phase)}>
                <Plus size={14} aria-hidden />
                Add gate
              </Button>
            </div>
            {rows.length === 0 ? (
              <p className="text-xs text-muted-foreground">No gates in this phase.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {rows.map(({ g, idx }, posInPhase) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 rounded-md border p-2"
                  >
                    <div className="flex flex-col">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={posInPhase === 0}
                        onClick={() => moveWithinPhase(idx, -1)}
                        aria-label="Move up"
                      >
                        <ChevronUp size={14} aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={posInPhase === rows.length - 1}
                        onClick={() => moveWithinPhase(idx, 1)}
                        aria-label="Move down"
                      >
                        <ChevronDown size={14} aria-hidden />
                      </Button>
                    </div>
                    <Input
                      value={g.name}
                      placeholder="Gate name"
                      onChange={(e) => updateAt(idx, { name: e.target.value })}
                      className="flex-1"
                    />
                    <Select
                      value={g.phase}
                      onValueChange={(v) => updateAt(idx, { phase: v as ProjectPhase })}
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PROJECT_PHASES.map((p) => (
                          <SelectItem key={p} value={p}>
                            {PHASE_LABELS[p]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeAt(idx)}
                      aria-label="Remove gate"
                    >
                      <Trash2 size={16} aria-hidden />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {value.length === 0 ? (
        <p className="text-sm text-destructive">At least one gate is required.</p>
      ) : null}
    </div>
  );
}
