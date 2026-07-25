// POL-3: canonical StatusBadge map.
import { StatusBadge } from "@/components/ui/status-badge";
import { QAQC_RESULT_LABELS, type QaqcResult } from "@/lib/qaqc.rules";

export function QaqcResultBadge({ result, className }: { result: QaqcResult; className?: string }) {
  return <StatusBadge status={result} label={QAQC_RESULT_LABELS[result]} className={className} />;
}
