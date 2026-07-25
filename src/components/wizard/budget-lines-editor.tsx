// P-035 — Budget lines editor (wizard step 3).
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { BUDGET_CATEGORIES, type BudgetLine } from "@/lib/schemas/project-wizard";

type Props = {
  value: BudgetLine[];
  onChange: (next: BudgetLine[]) => void;
};

export function BudgetLinesEditor({ value, onChange }: Props) {
  const total = value.reduce((s, l) => s + (l.share ?? 0), 0);
  const totalPct = Math.round(total * 1000) / 10;
  const ok = Math.abs(total - 1) < 0.005;

  const updateAt = (i: number, patch: Partial<BudgetLine>) => {
    onChange(value.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };
  const removeAt = (i: number) => {
    onChange(value.filter((_, idx) => idx !== i));
  };
  const add = () => {
    onChange([...value, { category: "EPC", code: "", label: "", share: 0 }]);
  };
  const normalize = () => {
    if (total <= 0) return;
    onChange(value.map((l) => ({ ...l, share: l.share / total })));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {value.map((l, i) => (
          <div
            key={i}
            className="grid grid-cols-[110px_120px_1fr_120px_auto] items-center gap-2 rounded-md border p-2"
          >
            <Select value={l.category} onValueChange={(v) => updateAt(i, { category: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUDGET_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={l.code}
              placeholder="Code"
              onChange={(e) => updateAt(i, { code: e.target.value.toUpperCase().slice(0, 24) })}
            />
            <Input
              value={l.label}
              placeholder="Label"
              onChange={(e) => updateAt(i, { label: e.target.value })}
            />
            <div className="relative">
              <Input
                type="number"
                inputMode="decimal"
                step="0.1"
                min={0}
                max={100}
                className="pr-8"
                value={Number.isFinite(l.share) ? Math.round(l.share * 1000) / 10 : ""}
                onChange={(e) => {
                  const pct = Number(e.target.value);
                  updateAt(i, {
                    share: Number.isFinite(pct) ? pct / 100 : 0,
                  });
                }}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                %
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => removeAt(i)}
              aria-label="Remove line"
            >
              <Trash2 size={16} aria-hidden />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus size={14} aria-hidden />
          Add line
        </Button>
        <div className="flex items-center gap-3">
          <span className={cn("text-sm", ok ? "text-muted-foreground" : "text-destructive")}>
            Total: {totalPct}% {ok ? "" : "— must sum to 100%"}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={normalize}
            disabled={ok || total <= 0}
          >
            Normalize to 100%
          </Button>
        </div>
      </div>
    </div>
  );
}
