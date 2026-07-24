import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useMemo, useState } from "react";

import { LossReasonDialog } from "@/components/crm/LossReasonDialog";
import { OpportunityCard } from "@/components/crm/OpportunityCard";
import { PipelineColumn } from "@/components/crm/PipelineColumn";
import { useMoveOpportunityStage } from "@/lib/crm-query";
import {
  OPPORTUNITY_STAGES,
  STAGE_LABELS,
  type OpportunityRow,
  type OpportunityStage,
} from "@/lib/crm.functions";

interface Props {
  opportunities: OpportunityRow[];
  readOnly?: boolean;
}

export function CrmPipelineBoard({ opportunities, readOnly }: Props) {
  const move = useMoveOpportunityStage();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingLoss, setPendingLoss] = useState<{ id: string } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const grouped = useMemo(() => {
    const map: Record<OpportunityStage, OpportunityRow[]> = {
      prospecting: [],
      qualification: [],
      proposal: [],
      negotiation: [],
      won: [],
      lost: [],
    };
    for (const o of opportunities) map[o.stage]?.push(o);
    return map;
  }, [opportunities]);

  const activeOpp = activeId
    ? opportunities.find((o) => o.id === activeId) ?? null
    : null;

  const handleDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const overStage = e.over?.data.current?.stage as OpportunityStage | undefined;
    const fromStage = e.active.data.current?.stage as OpportunityStage | undefined;
    if (!overStage || !fromStage || overStage === fromStage) return;
    const id = String(e.active.id);
    if (overStage === "lost") {
      setPendingLoss({ id });
      return;
    }
    move.mutate({ id, stage: overStage });
  };

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="flex gap-3 overflow-x-auto pb-2">
          {OPPORTUNITY_STAGES.map((stage) => {
            const items = grouped[stage];
            const total = items.reduce(
              (a, o) => a + Number(o.estimated_value ?? 0),
              0,
            );
            const currency = items[0]?.currency_code ?? "USD";
            return (
              <PipelineColumn
                key={stage}
                stage={stage}
                label={STAGE_LABELS[stage]}
                count={items.length}
                totalValue={total}
                currency={currency}
              >
                {items.length === 0 ? (
                  <p className="px-2 py-6 text-center text-[11px] text-muted-foreground">
                    Drop opportunities here
                  </p>
                ) : (
                  items.map((o) => (
                    <OpportunityCard key={o.id} opp={o} readOnly={readOnly} />
                  ))
                )}
              </PipelineColumn>
            );
          })}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeOpp ? <OpportunityCard opp={activeOpp} readOnly /> : null}
        </DragOverlay>
      </DndContext>

      <LossReasonDialog
        open={!!pendingLoss}
        onOpenChange={(o) => {
          if (!o) setPendingLoss(null);
        }}
        onCancel={() => setPendingLoss(null)}
        onConfirm={(reason) => {
          if (pendingLoss)
            move.mutate({ id: pendingLoss.id, stage: "lost", lossReason: reason });
          setPendingLoss(null);
        }}
      />
    </>
  );
}
