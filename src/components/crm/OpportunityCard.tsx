import { useDraggable } from "@dnd-kit/core";
import { format, parseISO } from "date-fns";
import { GripVertical } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { OpportunityRow } from "@/lib/crm.functions";

const ARCHETYPE_SHORT: Record<string, string> = {
  utility_pv: "Utility PV",
  standalone_bess: "BESS",
  c_and_i_rooftop: "C&I",
  onshore_wind: "Wind",
  hybrid_pv_bess: "Hybrid",
  transmission_substation: "T&S",
  green_hydrogen: "Green H₂",
};

interface Props {
  opp: OpportunityRow;
  readOnly?: boolean;
}

export function OpportunityCard({ opp, readOnly }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: opp.id,
    disabled: readOnly,
    data: { stage: opp.stage },
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const value =
    opp.estimated_value != null
      ? new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: opp.currency_code || "USD",
          maximumFractionDigits: 0,
        }).format(opp.estimated_value)
      : null;

  const owner = opp.owner;
  const ownerLabel = owner?.full_name || owner?.email || "Unassigned";
  const initials = (owner?.full_name || owner?.email || "?")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group rounded-md border border-border bg-card p-3 shadow-sm transition-shadow",
        isDragging && "opacity-50 shadow-lg",
        !readOnly && "cursor-grab active:cursor-grabbing",
      )}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-start gap-2">
        {!readOnly && (
          <GripVertical
            size={14}
            aria-hidden
            className="mt-0.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{opp.name}</p>
          {opp.account_name && (
            <p className="truncate text-xs text-muted-foreground">{opp.account_name}</p>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {opp.archetype && (
          <Badge variant="secondary" className="text-[10px] font-normal">
            {ARCHETYPE_SHORT[opp.archetype] ?? opp.archetype}
          </Badge>
        )}
        {opp.capacity_mw != null && (
          <span className="text-[11px] text-muted-foreground">{opp.capacity_mw} MW</span>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">{value ?? "—"}</span>
        {opp.expected_decision_date && (
          <span className="text-[11px] text-muted-foreground">
            {format(parseISO(opp.expected_decision_date), "MMM d")}
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
        <Avatar className="h-5 w-5">
          {owner && (owner as any).avatar_url ? (
            <AvatarImage src={(owner as any).avatar_url} alt={ownerLabel} />
          ) : null}
          <AvatarFallback className="text-[9px]">{initials}</AvatarFallback>
        </Avatar>
        <span className="truncate text-[11px] text-muted-foreground">{ownerLabel}</span>
      </div>
    </div>
  );
}
