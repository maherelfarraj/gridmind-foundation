// P-229 — Weekly timesheet summary shown to approvers inside the P-112 inbox.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getTimesheetApprovalSummary } from "@/lib/timesheets.functions";

const hoursFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function TimesheetApprovalCard({ timesheetId }: { timesheetId: string }) {
  const fn = useServerFn(getTimesheetApprovalSummary);
  const query = useQuery({
    queryKey: ["timesheets", "approval-summary", timesheetId],
    queryFn: () => fn({ data: { timesheetId } }),
  });

  if (query.isLoading) return <Skeleton className="h-32 w-full" />;
  if (query.isError || !query.data) {
    return (
      <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        Weekly summary unavailable.
      </p>
    );
  }

  const s = query.data;
  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">
            {s.employeeName ?? "Employee"} · week of {s.weekStart}
          </p>
          <p className="text-xs text-muted-foreground">{s.timesheetNumber ?? "Timesheet"}</p>
        </div>
        {s.overtimeFlagged ? (
          <Badge variant="destructive" className="shrink-0 gap-1">
            <AlertTriangle className="h-3 w-3" />
            Overtime {hoursFmt.format(s.totals.overtime)}h
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-4 text-xs">
        <span>
          <span className="text-muted-foreground">Regular: </span>
          <span className="font-medium tabular-nums">{hoursFmt.format(s.totals.regular)}h</span>
        </span>
        <span>
          <span className="text-muted-foreground">Overtime: </span>
          <span className="font-medium tabular-nums">{hoursFmt.format(s.totals.overtime)}h</span>
        </span>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Hours by project
        </p>
        <ul className="space-y-1">
          {s.byProject.length === 0 && <li className="text-muted-foreground">No hours booked.</li>}
          {s.byProject.map((p) => (
            <li key={p.project_id ?? "none"} className="flex justify-between gap-3">
              <span className="min-w-0 truncate">{p.label}</span>
              <span className="shrink-0 tabular-nums">{hoursFmt.format(p.hours)}h</span>
            </li>
          ))}
        </ul>
      </div>

      {s.notes.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Notes
          </p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {s.notes.map((n) => (
              <li key={n}>“{n}”</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
