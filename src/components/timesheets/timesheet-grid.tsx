// P-228 — Weekly grid: rows = project/CWP/activity, columns = Mon..Sun.
import { useState } from "react";
import { Info, Minus, NotebookPen, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { GridRow } from "@/lib/timesheets/grid";
import { clampHours } from "@/lib/timesheets/grid";
import { ACTIVITY_LABELS, overtimeRuleText, TIMESHEET_POLICY } from "@/lib/timesheets/policy";
import { computeWeeklyTotals } from "@/lib/timesheets/split";
import { isWeekend } from "@/lib/timesheets/week";
import { cn } from "@/lib/utils";

const hoursFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const dowFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
const dayNumFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric" });

export function TimesheetGrid({
  rows,
  days,
  readOnly,
  projectLabel,
  onCellChange,
  onNotesChange,
  onRemoveRow,
}: {
  rows: GridRow[];
  days: string[];
  readOnly: boolean;
  projectLabel: (projectId: string | null) => string;
  onCellChange: (key: string, day: string, hours: number) => void;
  onNotesChange: (key: string, notes: string) => void;
  onRemoveRow: (key: string) => void;
}) {
  const [notesFor, setNotesFor] = useState<GridRow | null>(null);

  const flat = rows.flatMap((r) =>
    days.map((d) => ({ work_date: d, activity: r.activity, hours: r.hours[d] ?? 0 })),
  );
  const totals = computeWeeklyTotals(flat);
  const perDay = (day: string) =>
    rows.reduce((sum, r) => sum + (Number(r.hours[day]) || 0), 0);

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="sticky left-0 z-10 bg-card p-2 text-left text-xs font-medium text-muted-foreground">
                Project / activity
              </th>
              {days.map((d) => (
                <th
                  key={d}
                  className={cn(
                    "p-2 text-center text-xs font-medium text-muted-foreground",
                    isWeekend(d) && "bg-muted/40",
                  )}
                >
                  <span className="block">{dowFmt.format(new Date(`${d}T00:00:00Z`))}</span>
                  <span className="block tabular-nums">
                    {dayNumFmt.format(new Date(`${d}T00:00:00Z`))}
                  </span>
                </th>
              ))}
              <th className="p-2 text-center text-xs font-medium text-muted-foreground">Total</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rowTotal = days.reduce((s, d) => s + (Number(row.hours[d]) || 0), 0);
              return (
                <tr key={row.key} className="border-b border-border last:border-0">
                  <td className="sticky left-0 z-10 min-w-[180px] bg-card p-2 align-top">
                    <p className="truncate text-sm font-medium">{projectLabel(row.project_id)}</p>
                    <p className="text-xs text-muted-foreground">
                      {ACTIVITY_LABELS[row.activity as keyof typeof ACTIVITY_LABELS] ??
                        row.activity}
                      {row.cwp_id ? " · CWP" : ""}
                    </p>
                    <button
                      type="button"
                      className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
                      onClick={() => setNotesFor(row)}
                    >
                      <NotebookPen className="h-3 w-3" />
                      {row.notes ? "Notes added" : "Add notes"}
                    </button>
                  </td>
                  {days.map((d) => (
                    <td
                      key={d}
                      className={cn("p-1 text-center", isWeekend(d) && "bg-muted/40")}
                    >
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="hidden h-7 w-7 sm:inline-flex"
                          aria-label="Decrease hours"
                          disabled={readOnly}
                          onClick={() =>
                            onCellChange(row.key, d, clampHours((row.hours[d] ?? 0) - 0.5))
                          }
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <Input
                          aria-label={`Hours for ${d}`}
                          inputMode="decimal"
                          className="h-9 w-16 text-center tabular-nums"
                          value={row.hours[d] ? String(row.hours[d]) : ""}
                          placeholder="0"
                          disabled={readOnly}
                          onChange={(e) =>
                            onCellChange(row.key, d, clampHours(Number(e.target.value)))
                          }
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="hidden h-7 w-7 sm:inline-flex"
                          aria-label="Increase hours"
                          disabled={readOnly}
                          onClick={() =>
                            onCellChange(row.key, d, clampHours((row.hours[d] ?? 0) + 0.5))
                          }
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  ))}
                  <td className="p-2 text-center font-medium tabular-nums">
                    {hoursFmt.format(rowTotal)}
                  </td>
                  <td className="p-1 text-center">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Remove row"
                      disabled={readOnly}
                      onClick={() => onRemoveRow(row.key)}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </td>
                </tr>
              );
            })}
            <tr className="border-t border-border bg-muted/30">
              <td className="sticky left-0 z-10 bg-muted/30 p-2 text-xs font-medium">
                <span className="inline-flex items-center gap-1">
                  Weekly totals
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help text-muted-foreground">
                        <Info className="h-3.5 w-3.5" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {overtimeRuleText(TIMESHEET_POLICY.standardDailyHours)}
                    </TooltipContent>
                  </Tooltip>
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {hoursFmt.format(totals.regular)} regular ·{" "}
                  {hoursFmt.format(totals.overtime)} overtime
                </span>
              </td>
              {days.map((d) => (
                <td
                  key={d}
                  className={cn(
                    "p-2 text-center text-xs font-medium tabular-nums",
                    isWeekend(d) && "bg-muted/40",
                  )}
                >
                  {hoursFmt.format(perDay(d))}
                </td>
              ))}
              <td className="p-2 text-center text-sm font-semibold tabular-nums">
                {hoursFmt.format(totals.regular + totals.overtime)}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <Sheet open={Boolean(notesFor)} onOpenChange={(o) => !o && setNotesFor(null)}>
        <SheetContent side="bottom" className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Row notes</SheetTitle>
          </SheetHeader>
          {notesFor ? (
            <div className="space-y-2 p-4">
              <Label htmlFor="row-notes" className="text-xs text-muted-foreground">
                {projectLabel(notesFor.project_id)}
              </Label>
              <Textarea
                id="row-notes"
                rows={4}
                disabled={readOnly}
                value={notesFor.notes ?? ""}
                onChange={(e) => {
                  setNotesFor({ ...notesFor, notes: e.target.value });
                  onNotesChange(notesFor.key, e.target.value);
                }}
              />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
