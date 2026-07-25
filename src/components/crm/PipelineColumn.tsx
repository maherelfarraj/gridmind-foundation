import { useDroppable } from "@dnd-kit/core";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { OpportunityStage } from "@/lib/crm.functions";

interface Props {
  stage: OpportunityStage;
  label: string;
  count: number;
  totalValue: number;
  currency: string;
  children: ReactNode;
}

export function PipelineColumn({ stage, label, count, totalValue, currency, children }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${stage}`, data: { stage } });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-w-[240px] flex-1 flex-col rounded-lg border border-border bg-muted/30 transition-colors",
        isOver && "border-primary bg-primary/5",
      )}
    >
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-wide text-foreground">
            {label}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {count} ·{" "}
            {new Intl.NumberFormat(undefined, {
              style: "currency",
              currency: currency || "USD",
              maximumFractionDigits: 0,
              notation: "compact",
            }).format(totalValue)}
          </p>
        </div>
      </header>
      <div className="flex flex-col gap-2 p-2 min-h-[120px]">{children}</div>
    </div>
  );
}
