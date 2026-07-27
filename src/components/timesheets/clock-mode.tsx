// P-228 — Clock in/out mode: per-day start/end cards feeding editable hours.
import { Clock } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ClockDay } from "@/lib/timesheets.server";
import { clockHours } from "@/lib/timesheets/split";
import { isWeekend, weekDays } from "@/lib/timesheets/week";
import { cn } from "@/lib/utils";

const hoursFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });

export function ClockMode({
  weekStart,
  clock,
  hoursByDay,
  readOnly,
  onChange,
}: {
  weekStart: string;
  clock: Record<string, ClockDay>;
  hoursByDay: Record<string, number>;
  readOnly: boolean;
  onChange: (day: string, next: { clock?: ClockDay; hours?: number }) => void;
}) {
  return (
    <div className="space-y-2">
      {weekDays(weekStart).map((day) => {
        const entry = clock[day] ?? { start: null, end: null };
        const computed = clockHours(entry.start, entry.end);
        return (
          <Card key={day} className={cn(isWeekend(day) && "bg-muted/40")}>
            <CardContent className="space-y-3 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{dayFmt.format(new Date(`${day}T00:00:00Z`))}</p>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  {hoursFmt.format(hoursByDay[day] ?? 0)} h
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Start</Label>
                  <Input
                    type="time"
                    value={entry.start ?? ""}
                    disabled={readOnly}
                    onChange={(e) => {
                      const start = e.target.value || null;
                      onChange(day, {
                        clock: { start, end: entry.end },
                        hours: clockHours(start, entry.end),
                      });
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">End</Label>
                  <Input
                    type="time"
                    value={entry.end ?? ""}
                    disabled={readOnly}
                    onChange={(e) => {
                      const end = e.target.value || null;
                      onChange(day, {
                        clock: { start: entry.start, end },
                        hours: clockHours(entry.start, end),
                      });
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Hours</Label>
                  <Input
                    inputMode="decimal"
                    value={String(hoursByDay[day] ?? computed ?? 0)}
                    disabled={readOnly}
                    onChange={(e) => onChange(day, { hours: Number(e.target.value) || 0 })}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
