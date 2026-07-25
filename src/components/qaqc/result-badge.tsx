import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { QAQC_RESULT_LABELS, type QaqcResult } from "@/lib/qaqc.rules";

const STYLES: Record<QaqcResult, string> = {
  pending: "bg-muted text-muted-foreground",
  pass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  fail: "bg-destructive/15 text-destructive",
  conditional: "bg-warning/20 text-warning-foreground",
};

export function QaqcResultBadge({ result, className }: { result: QaqcResult; className?: string }) {
  return (
    <Badge variant="secondary" className={cn(STYLES[result], className)}>
      {QAQC_RESULT_LABELS[result]}
    </Badge>
  );
}
