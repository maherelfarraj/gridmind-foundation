// P-143 — Coordination tab: per-check collapsible groups with computed values.
import { useState } from "react";
import { AlertTriangle, CircleAlert, ChevronDown, ChevronRight, Info } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCanvasStore } from "@/lib/sld/canvas-store";
import {
  COORDINATION_CHECK_LABELS,
  COORDINATION_DISCLAIMER,
  type CoordinationCheckId,
  type CoordinationIssue,
} from "@/lib/sld/coordination";

const CHECK_ORDER: CoordinationCheckId[] = [
  "string_inverter",
  "dc_ac_ratio",
  "inverter_transformer",
  "transformer_loading",
  "bess",
  "protection_references",
  "cable_references",
];

function SeverityIcon({ severity }: { severity: CoordinationIssue["severity"] }) {
  if (severity === "error")
    return <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />;
  if (severity === "warning")
    return <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />;
  return <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />;
}

function IssueRow({ issue }: { issue: CoordinationIssue }) {
  const select = useCanvasStore((s) => s.select);
  const setZoom = useCanvasStore((s) => s.setZoom);

  const body = (
    <button
      type="button"
      onClick={() => {
        select(issue.objectIds);
        setZoom(Math.max(useCanvasStore.getState().zoom, 1.4));
      }}
      className="flex w-full items-start gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-muted"
    >
      <SeverityIcon severity={issue.severity} />
      <span className="min-w-0">
        <span className="block">{issue.message}</span>
        {issue.values ? (
          <span className="mt-0.5 flex flex-wrap gap-1">
            {Object.entries(issue.values).map(([k, v]) => (
              <Badge key={k} variant="secondary" className="font-mono text-[10px]">
                {k}: {v}
              </Badge>
            ))}
          </span>
        ) : null}
      </span>
    </button>
  );

  if (!issue.formula) return body;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{body}</TooltipTrigger>
      <TooltipContent side="left" className="max-w-72">
        <p className="font-mono text-[11px]">{issue.formula}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">{issue.note}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function CoordinationPanel({
  issues,
  errorCount,
  warningCount,
  infoCount,
  protectionRows,
  cableRows,
  onRun,
  running,
  lastRunAt,
}: {
  issues: CoordinationIssue[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
  protectionRows: number;
  cableRows: number;
  onRun: () => void;
  running: boolean;
  lastRunAt?: string | null;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({
    string_inverter: true,
    dc_ac_ratio: true,
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{COORDINATION_DISCLAIMER}</p>
        <Button size="sm" variant="outline" disabled={running} onClick={onRun}>
          {running ? "Checking…" : "Run checks"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Badge variant={errorCount > 0 ? "destructive" : "secondary"}>{errorCount} errors</Badge>
        <Badge variant="secondary" className="text-warning">
          {warningCount} warnings
        </Badge>
        <Badge variant="secondary">{infoCount} info</Badge>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {protectionRows} protection rows · {cableRows} cable rows
        {lastRunAt ? ` · saved ${new Date(lastRunAt).toLocaleString()}` : ""}
      </p>

      <ScrollArea className="h-52 pr-2">
        {issues.length === 0 ? (
          <p className="px-1 py-3 text-xs text-muted-foreground">
            No coordination findings yet — place equipment with ratings to see checks.
          </p>
        ) : (
          <div className="space-y-1">
            {CHECK_ORDER.map((check) => {
              const items = issues.filter((i) => i.check === check);
              if (items.length === 0) return null;
              const errors = items.filter((i) => i.severity === "error").length;
              const warnings = items.filter((i) => i.severity === "warning").length;
              const expanded = open[check] ?? false;
              return (
                <div key={check} className="rounded border border-border">
                  <button
                    type="button"
                    onClick={() => setOpen((s) => ({ ...s, [check]: !expanded }))}
                    className="flex w-full items-center gap-1.5 px-1.5 py-1 text-left text-xs font-medium hover:bg-muted"
                  >
                    {expanded ? (
                      <ChevronDown className="size-3.5" />
                    ) : (
                      <ChevronRight className="size-3.5" />
                    )}
                    <span className="flex-1">{COORDINATION_CHECK_LABELS[check]}</span>
                    {errors > 0 ? <Badge variant="destructive">{errors}</Badge> : null}
                    {warnings > 0 ? (
                      <Badge variant="secondary" className="text-warning">
                        {warnings}
                      </Badge>
                    ) : null}
                    <span className="text-muted-foreground">{items.length}</span>
                  </button>
                  {expanded ? (
                    <ul className="space-y-0.5 border-t border-border p-1">
                      {items.map((issue, i) => (
                        <li key={`${issue.code}-${i}`}>
                          <IssueRow issue={issue} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
