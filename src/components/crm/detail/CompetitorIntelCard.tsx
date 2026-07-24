import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { OpportunityDetail } from "@/lib/opportunity.functions";
import { useUpdateOpportunity } from "@/lib/opportunity-query";

interface Props {
  opportunity: OpportunityDetail;
  readOnly: boolean;
}

export function CompetitorIntelCard({ opportunity: opp, readOnly }: Props) {
  const update = useUpdateOpportunity(opp.id);
  const [competitor, setCompetitor] = useState(opp.competitor ?? "");
  const [lossReason, setLossReason] = useState(opp.loss_reason ?? "");
  const [notes, setNotes] = useState(opp.notes ?? "");

  useEffect(() => {
    setCompetitor(opp.competitor ?? "");
    setLossReason(opp.loss_reason ?? "");
    setNotes(opp.notes ?? "");
  }, [opp.competitor, opp.loss_reason, opp.notes]);

  const dirty =
    competitor !== (opp.competitor ?? "") ||
    lossReason !== (opp.loss_reason ?? "") ||
    notes !== (opp.notes ?? "");

  const save = () => {
    const patch: Record<string, any> = {};
    if (competitor !== (opp.competitor ?? "")) patch.competitor = competitor || null;
    if (lossReason !== (opp.loss_reason ?? "")) patch.loss_reason = lossReason || null;
    if (notes !== (opp.notes ?? "")) patch.notes = notes || null;
    if (Object.keys(patch).length > 0) update.mutate(patch);
  };

  return (
    <Card className="flex flex-col gap-3 border-border bg-card p-5">
      <header>
        <h2 className="font-display text-sm font-semibold text-foreground">
          Competitor & intel
        </h2>
        <p className="text-xs text-muted-foreground">
          Track who else is bidding and what you know
        </p>
      </header>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="ci-competitor">Competitor</Label>
          <Textarea
            id="ci-competitor"
            rows={2}
            value={competitor}
            onChange={(e) => setCompetitor(e.target.value)}
            readOnly={readOnly}
            placeholder="Who else is on the shortlist?"
          />
        </div>
        {opp.stage === "lost" && (
          <div className="space-y-1.5">
            <Label htmlFor="ci-loss">Loss reason</Label>
            <Textarea
              id="ci-loss"
              rows={2}
              value={lossReason}
              onChange={(e) => setLossReason(e.target.value)}
              readOnly={readOnly}
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="ci-notes">Notes</Label>
          <Textarea
            id="ci-notes"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            readOnly={readOnly}
            placeholder="Context, next steps, internal discussion…"
          />
        </div>
        {!readOnly && (
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!dirty || update.isPending}
              onClick={save}
            >
              Save
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
