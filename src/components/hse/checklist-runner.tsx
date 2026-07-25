// P-088 — Checklist runner (pass/fail/na per item with live findings tally).
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import {
  CHECKLIST_RESULTS,
  summarizeChecklist,
  type ChecklistItem,
  type ChecklistResult,
} from "@/lib/hse.rules";

interface Props {
  items: ChecklistItem[];
  onChange: (items: ChecklistItem[]) => void;
}

export function ChecklistRunner({ items, onChange }: Props) {
  const summary = summarizeChecklist(items);
  const patch = (i: number, next: Partial<ChecklistItem>) => {
    const clone = items.slice();
    clone[i] = { ...clone[i], ...next };
    onChange(clone);
  };
  const remove = (i: number) => {
    onChange(items.filter((_, idx) => idx !== i));
  };
  const add = () => {
    onChange([...items, { item: "", result: "pass" }]);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Checklist
        </div>
        <div className="text-xs text-muted-foreground">
          {summary.findingsCount} finding(s), {summary.openFindings} open
        </div>
      </div>
      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          No items yet — tap Add item.
        </div>
      ) : null}
      {items.map((it, i) => (
        <div
          key={i}
          className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 md:grid-cols-[1fr_auto_1fr_auto]"
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor={`item-${i}`} className="text-xs">
              Item
            </Label>
            <Input
              id={`item-${i}`}
              value={it.item}
              onChange={(e) => patch(i, { item: e.target.value })}
              placeholder="e.g. PPE compliance"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Result</Label>
            <div className="flex rounded-md border border-border p-1">
              {CHECKLIST_RESULTS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => patch(i, { result: r as ChecklistResult })}
                  className={`min-h-11 flex-1 rounded px-2 text-xs font-medium capitalize transition-colors ${
                    it.result === r
                      ? r === "fail"
                        ? "bg-destructive/15 text-destructive"
                        : r === "pass"
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`notes-${i}`} className="text-xs">
              Notes
            </Label>
            <Input
              id={`notes-${i}`}
              value={it.notes ?? ""}
              onChange={(e) => patch(i, { notes: e.target.value })}
              placeholder="Optional"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => remove(i)}
            aria-label={`Remove item ${i + 1}`}
            className="self-end"
          >
            <X size={16} aria-hidden />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        Add item
      </Button>
    </div>
  );
}
