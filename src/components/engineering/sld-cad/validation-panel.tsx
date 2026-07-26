// P-142 — Validation dock: issues grouped by severity, click to select + zoom.
import { AlertTriangle, CircleAlert, CircleCheck, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCanvasStore } from "@/lib/sld/canvas-store";
import type { IssueSeverity, ValidationIssue } from "@/lib/sld/connectivity";

const CODE_LABELS: Record<string, string> = {
  disconnected_equipment: "Disconnected equipment",
  open_circuit: "Open circuit",
  unterminated_port: "Unterminated port",
  duplicate_tag: "Duplicate tag",
  voltage_mismatch: "Voltage mismatch",
  unknown_voltage_level: "Unknown voltage level",
  rating_exceeded: "Rating exceeded",
  multiple_sources_one_input: "Multiple sources on one input",
};

export function ValidationPanel({
  issues,
  errorCount,
  warningCount,
  onRun,
  running,
  lastRunAt,
}: {
  issues: ValidationIssue[];
  errorCount: number;
  warningCount: number;
  onRun: () => void;
  running: boolean;
  lastRunAt?: string | null;
}) {
  const select = useCanvasStore((s) => s.select);
  const setZoom = useCanvasStore((s) => s.setZoom);

  const focus = (issue: ValidationIssue) => {
    select(issue.objectIds);
    setZoom(Math.max(useCanvasStore.getState().zoom, 1.4));
  };

  const groups: Array<{ severity: IssueSeverity; label: string; items: ValidationIssue[] }> = [
    { severity: "error", label: "Errors", items: issues.filter((i) => i.severity === "error") },
    {
      severity: "warning",
      label: "Warnings",
      items: issues.filter((i) => i.severity === "warning"),
    },
  ];

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          Validation
        </p>
        <Button size="sm" variant="outline" disabled={running} onClick={onRun}>
          {running ? "Validating…" : "Validate"}
        </Button>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <Badge variant={errorCount > 0 ? "destructive" : "secondary"}>{errorCount} errors</Badge>
        <Badge variant="secondary" className="text-warning">
          {warningCount} warnings
        </Badge>
      </div>
      {lastRunAt ? (
        <p className="text-[11px] text-muted-foreground">
          Last saved run {new Date(lastRunAt).toLocaleString()}
        </p>
      ) : null}

      <ScrollArea className="h-52 pr-2">
        {issues.length === 0 ? (
          <p className="flex items-center gap-1.5 px-1 py-3 text-xs text-muted-foreground">
            <CircleCheck className="size-3.5 text-success" />
            No connectivity issues detected.
          </p>
        ) : (
          <div className="space-y-3">
            {groups
              .filter((g) => g.items.length > 0)
              .map((group) => (
                <div key={group.severity} className="space-y-1">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {group.label} ({group.items.length})
                  </p>
                  <ul className="space-y-0.5">
                    {group.items.map((issue, i) => (
                      <li key={`${issue.code}-${issue.objectIds.join(",")}-${i}`}>
                        <button
                          type="button"
                          onClick={() => focus(issue)}
                          className="flex w-full items-start gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-muted"
                        >
                          {group.severity === "error" ? (
                            <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                          ) : (
                            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                          )}
                          <span className="min-w-0">
                            <span className="block font-medium">
                              {CODE_LABELS[issue.code] ?? issue.code}
                            </span>
                            <span className="block text-muted-foreground">{issue.message}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
