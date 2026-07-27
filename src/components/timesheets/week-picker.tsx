// P-228 — Monday-anchored week picker.
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";

import { Button } from "@/components/ui/button";
import { shiftWeek, weekDays, weekStartOf } from "@/lib/timesheets/week";

const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const fmtFull = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function WeekPicker({
  weekStart,
  onChange,
}: {
  weekStart: string;
  onChange: (weekStart: string) => void;
}) {
  const days = weekDays(weekStart);
  const start = new Date(`${days[0]}T00:00:00Z`);
  const end = new Date(`${days[6]}T00:00:00Z`);
  const isThisWeek = weekStart === weekStartOf();

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border bg-card p-2">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Previous week"
        onClick={() => onChange(shiftWeek(weekStart, -1))}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <div className="min-w-0 text-center">
        <p className="truncate text-sm font-semibold">
          {fmt.format(start)} – {fmtFull.format(end)}
        </p>
        <p className="text-xs text-muted-foreground">Week starting Monday</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Next week"
          onClick={() => onChange(shiftWeek(weekStart, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant={isThisWeek ? "secondary" : "outline"}
          size="sm"
          onClick={() => onChange(weekStartOf())}
        >
          <CalendarDays className="mr-1 h-3.5 w-3.5" />
          This week
        </Button>
      </div>
    </div>
  );
}
