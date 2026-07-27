// P-223 — Acknowledgment chip shown on vendor and internal PO surfaces.
import { Check, MessageSquare, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateTime } from "@/lib/format";
import { ACKNOWLEDGMENT_LABELS, type AcknowledgmentStatus } from "@/lib/vendor-portal.rules";

const ICONS = {
  accepted: Check,
  accepted_with_comments: MessageSquare,
  rejected: X,
} as const;

const VARIANTS = {
  accepted: "secondary",
  accepted_with_comments: "outline",
  rejected: "destructive",
} as const;

export function AcknowledgmentChip({
  status,
  at,
  note,
  by,
}: {
  status: AcknowledgmentStatus;
  at?: string | null;
  note?: string | null;
  by?: string | null;
}) {
  const Icon = ICONS[status];
  const chip = (
    <Badge variant={VARIANTS[status]} className="gap-1">
      <Icon className="h-3 w-3" />
      {ACKNOWLEDGMENT_LABELS[status]}
    </Badge>
  );

  if (!at && !note && !by) return chip;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{chip}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs space-y-1">
        {at ? <p>{formatDateTime(at)}</p> : null}
        {by ? <p className="text-muted-foreground">{by}</p> : null}
        {note ? <p className="text-muted-foreground">“{note}”</p> : null}
      </TooltipContent>
    </Tooltip>
  );
}

/** Chip used when a PO is still awaiting the vendor's acknowledgment. */
export function AwaitingAcknowledgmentChip() {
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Awaiting acknowledgment
    </Badge>
  );
}
