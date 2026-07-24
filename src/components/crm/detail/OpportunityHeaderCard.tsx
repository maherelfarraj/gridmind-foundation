import { format, parseISO } from "date-fns";
import { useState } from "react";
import { Award, CalendarDays, Plus, User } from "lucide-react";

import { LossReasonDialog } from "@/components/crm/LossReasonDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMoveOpportunityStage } from "@/lib/crm-query";
import {
  OPPORTUNITY_STAGES,
  STAGE_LABELS,
  STAGE_PROBABILITY,
} from "@/lib/crm.functions";
import type { OpportunityDetail } from "@/lib/opportunity.functions";
import { useUpdateOpportunity } from "@/lib/opportunity-query";

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
  opportunity: OpportunityDetail;
  readOnly: boolean;
  onAddTenderEvent: () => void;
}

export function OpportunityHeaderCard({
  opportunity: opp,
  readOnly,
  onAddTenderEvent,
}: Props) {
  const update = useUpdateOpportunity(opp.id);
  const move = useMoveOpportunityStage();
  const [pendingLoss, setPendingLoss] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(opp.name);

  const value =
    opp.estimated_value != null
      ? new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: opp.currency_code || "USD",
          maximumFractionDigits: 0,
        }).format(opp.estimated_value)
      : "—";

  const owner = opp.owner;
  const ownerLabel = owner?.full_name || owner?.email || "Unassigned";

  const changeStage = (next: string) => {
    if (next === opp.stage) return;
    if (next === "lost") {
      setPendingLoss(true);
      return;
    }
    move.mutate({ id: opp.id, stage: next as any });
  };

  return (
    <>
      <Card className="flex flex-col gap-4 border-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {editingName && !readOnly ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (name.trim() && name !== opp.name) {
                    update.mutate({ name: name.trim() });
                  }
                  setEditingName(false);
                }}
              >
                <Input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="text-lg font-semibold"
                />
                <Button type="submit" size="sm">
                  Save
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setName(opp.name);
                    setEditingName(false);
                  }}
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <button
                type="button"
                disabled={readOnly}
                onClick={() => !readOnly && setEditingName(true)}
                className="text-left"
                aria-label="Edit name"
              >
                <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
                  {opp.name}
                </h1>
              </button>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {opp.account_name ? (
                <EditableInline
                  value={opp.account_name}
                  readOnly={readOnly}
                  onSave={(v) => update.mutate({ account_name: v || null })}
                />
              ) : !readOnly ? (
                <EditableInline
                  value=""
                  placeholder="+ account"
                  readOnly={readOnly}
                  onSave={(v) => update.mutate({ account_name: v || null })}
                />
              ) : (
                <span>—</span>
              )}
              {opp.archetype && (
                <Badge variant="secondary" className="text-xs">
                  {ARCHETYPE_SHORT[opp.archetype] ?? opp.archetype}
                </Badge>
              )}
              {opp.capacity_mw != null && (
                <span className="text-xs">· {opp.capacity_mw} MW</span>
              )}
            </div>
          </div>
          {!readOnly && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled
                title="Proposals ship in P-044"
              >
                New proposal
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  move.mutate({ id: opp.id, stage: "won" })
                }
                disabled={opp.stage === "won"}
              >
                <Award size={14} aria-hidden />
                Mark as won
              </Button>
              <Button size="sm" onClick={onAddTenderEvent}>
                <Plus size={14} aria-hidden />
                Add tender event
              </Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-4">
          <Field label="Stage">
            {readOnly ? (
              <span className="text-sm font-medium capitalize text-foreground">
                {STAGE_LABELS[opp.stage]}
              </span>
            ) : (
              <Select value={opp.stage} onValueChange={changeStage}>
                <SelectTrigger className="h-8 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPPORTUNITY_STAGES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STAGE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <span className="mt-1 text-[11px] text-muted-foreground">
              {STAGE_PROBABILITY[opp.stage]}% probability
            </span>
          </Field>

          <Field label="Estimated value">
            <EditableInline
              value={opp.estimated_value?.toString() ?? ""}
              readOnly={readOnly}
              type="number"
              display={value}
              onSave={(v) =>
                update.mutate({
                  estimated_value: v === "" ? null : Number(v),
                })
              }
            />
          </Field>

          <Field label="Decision date">
            {readOnly ? (
              <span className="text-sm text-foreground">
                {opp.expected_decision_date
                  ? format(parseISO(opp.expected_decision_date), "MMM d, yyyy")
                  : "—"}
              </span>
            ) : (
              <div className="relative">
                <CalendarDays
                  size={14}
                  aria-hidden
                  className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="date"
                  className="h-8 pl-7"
                  value={opp.expected_decision_date ?? ""}
                  onChange={(e) =>
                    update.mutate({
                      expected_decision_date: e.target.value || null,
                    })
                  }
                />
              </div>
            )}
          </Field>

          <Field label="Owner">
            <div className="flex items-center gap-2">
              <User size={14} aria-hidden className="text-muted-foreground" />
              <span className="truncate text-sm text-foreground">{ownerLabel}</span>
            </div>
          </Field>
        </div>
      </Card>

      <LossReasonDialog
        open={pendingLoss}
        onOpenChange={(o) => !o && setPendingLoss(false)}
        onCancel={() => setPendingLoss(false)}
        onConfirm={(reason) => {
          move.mutate({ id: opp.id, stage: "lost", lossReason: reason });
          setPendingLoss(false);
        }}
      />
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function EditableInline({
  value,
  readOnly,
  onSave,
  type = "text",
  display,
  placeholder,
}: {
  value: string;
  readOnly?: boolean;
  onSave: (v: string) => void;
  type?: "text" | "number";
  display?: string;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (editing && !readOnly) {
    return (
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft !== value) onSave(draft);
          setEditing(false);
        }}
      >
        <Input
          autoFocus
          type={type}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== value) onSave(draft);
            setEditing(false);
          }}
          className="h-7 text-sm"
        />
      </form>
    );
  }
  return (
    <button
      type="button"
      disabled={readOnly}
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      className="text-left text-sm text-foreground disabled:cursor-default"
    >
      {display ?? value ?? placeholder ?? "—"}
    </button>
  );
}
