import { Badge } from "@/components/ui/badge";
import type { GrnStatus } from "@/lib/grn-rules";

const LABELS: Record<GrnStatus, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  has_defects: "Has defects",
  closed: "Closed",
};

const VARIANTS: Record<GrnStatus, "secondary" | "default" | "destructive" | "outline"> = {
  draft: "secondary",
  confirmed: "default",
  has_defects: "destructive",
  closed: "outline",
};

export function GrnStatusBadge({ status }: { status: GrnStatus }) {
  return <Badge variant={VARIANTS[status]}>{LABELS[status]}</Badge>;
}
