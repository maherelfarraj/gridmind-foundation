import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { QAQC_RESULT_LABELS, type QaqcResult } from "@/lib/qaqc.rules";

const STYLES: Record<QaqcResult, string> = {
  pending: "bg-muted text-muted-foreground",
  pass: "bg-success/15 text-success",
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
