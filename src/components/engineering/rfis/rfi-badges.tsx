// P-059 — RFI status/priority badges.
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_CLASS: Record<string, string> = {
  open: "border-transparent bg-primary/15 text-primary",
  in_review: "border-transparent bg-accent text-accent-foreground",
  answered: "border-transparent bg-secondary text-secondary-foreground",
  closed: "border-transparent bg-muted text-muted-foreground",
  void: "border-transparent bg-destructive/15 text-destructive",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_review: "In review",
  answered: "Answered",
  closed: "Closed",
  void: "Void",
};

export function RfiStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn(STATUS_CLASS[status] ?? "")}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

const PRIORITY_CLASS: Record<string, string> = {
  low: "border-transparent bg-muted text-muted-foreground",
  normal: "border-border text-foreground",
  high: "border-transparent bg-primary/15 text-primary",
  urgent: "border-transparent bg-destructive/15 text-destructive",
};

const PRIORITY_LABEL: Record<string, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export function RfiPriorityBadge({ priority }: { priority: string }) {
  return (
    <Badge variant="outline" className={cn(PRIORITY_CLASS[priority] ?? "")}>
      {PRIORITY_LABEL[priority] ?? priority}
    </Badge>
  );
}
