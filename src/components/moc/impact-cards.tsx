// P-190 — Impact summary cards: editable while draft, read-only afterwards.
import type { ChangeDetail } from "@/lib/moc.server";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/format";
import { unassessedAreas } from "@/lib/moc.rules";

export interface ImpactDraft {
  technical_impact: string;
  cost_impact: string;
  cost_impact_notes: string;
  schedule_impact_days: string;
  schedule_impact_notes: string;
  energy_yield_impact: string;
  contract_impact: string;
  hse_impact: string;
}

export function toDraft(cr: ChangeDetail["cr"]): ImpactDraft {
  return {
    technical_impact: cr.technical_impact ?? "",
    cost_impact: cr.cost_impact == null ? "" : String(cr.cost_impact),
    cost_impact_notes: cr.cost_impact_notes ?? "",
    schedule_impact_days: cr.schedule_impact_days == null ? "" : String(cr.schedule_impact_days),
    schedule_impact_notes: cr.schedule_impact_notes ?? "",
    energy_yield_impact: cr.energy_yield_impact ?? "",
    contract_impact: cr.contract_impact ?? "",
    hse_impact: cr.hse_impact ?? "",
  };
}

export function draftToPayload(draft: ImpactDraft) {
  const cost = draft.cost_impact.trim();
  const days = draft.schedule_impact_days.trim();
  return {
    technical_impact: draft.technical_impact.trim() || null,
    cost_impact: cost === "" ? null : Number(cost),
    cost_impact_notes: draft.cost_impact_notes.trim() || null,
    schedule_impact_days: days === "" ? null : Number.parseInt(days, 10),
    schedule_impact_notes: draft.schedule_impact_notes.trim() || null,
    energy_yield_impact: draft.energy_yield_impact.trim() || null,
    contract_impact: draft.contract_impact.trim() || null,
    hse_impact: draft.hse_impact.trim() || null,
  };
}

function NotAssessed() {
  return <p className="rounded-md bg-accent/15 px-2 py-1 text-xs text-accent">Not assessed</p>;
}

function ImpactCard({
  title,
  children,
  assessed,
}: {
  title: string;
  children: React.ReactNode;
  assessed: boolean;
}) {
  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {assessed ? null : <NotAssessed />}
      </div>
      {children}
    </Card>
  );
}

export function ImpactCards({
  cr,
  editable,
  draft,
  onChange,
}: {
  cr: ChangeDetail["cr"];
  editable: boolean;
  draft: ImpactDraft;
  onChange: (next: ImpactDraft) => void;
}) {
  const missing = unassessedAreas(cr);
  const set = (key: keyof ImpactDraft) => (value: string) => onChange({ ...draft, [key]: value });

  const text = (key: keyof ImpactDraft, placeholder: string) =>
    editable ? (
      <Textarea
        value={draft[key]}
        placeholder={placeholder}
        rows={3}
        onChange={(e) => set(key)(e.target.value)}
      />
    ) : (
      <p className="whitespace-pre-wrap text-sm text-muted-foreground">
        {draft[key] || "Nothing recorded."}
      </p>
    );

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <ImpactCard title="Technical impact" assessed={!missing.includes("technical")}>
        {text("technical_impact", "What changes technically?")}
      </ImpactCard>

      <ImpactCard title="Cost impact" assessed={!missing.includes("cost")}>
        {editable ? (
          <div className="space-y-2">
            <Label htmlFor="cost-impact" className="text-xs">
              Amount
            </Label>
            <Input
              id="cost-impact"
              type="number"
              inputMode="decimal"
              value={draft.cost_impact}
              onChange={(e) => set("cost_impact")(e.target.value)}
            />
            <Textarea
              rows={2}
              placeholder="Cost notes"
              value={draft.cost_impact_notes}
              onChange={(e) => set("cost_impact_notes")(e.target.value)}
            />
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-lg font-semibold text-foreground">
              {cr.cost_impact == null ? "—" : formatMoney(cr.cost_impact, "USD")}
            </p>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {draft.cost_impact_notes || "No notes."}
            </p>
          </div>
        )}
      </ImpactCard>

      <ImpactCard title="Schedule impact" assessed={!missing.includes("schedule")}>
        {editable ? (
          <div className="space-y-2">
            <Label htmlFor="schedule-impact" className="text-xs">
              Days
            </Label>
            <Input
              id="schedule-impact"
              type="number"
              inputMode="numeric"
              value={draft.schedule_impact_days}
              onChange={(e) => set("schedule_impact_days")(e.target.value)}
            />
            <Textarea
              rows={2}
              placeholder="Schedule notes"
              value={draft.schedule_impact_notes}
              onChange={(e) => set("schedule_impact_notes")(e.target.value)}
            />
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-lg font-semibold text-foreground">
              {cr.schedule_impact_days == null ? "—" : `${cr.schedule_impact_days} days`}
            </p>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {draft.schedule_impact_notes || "No notes."}
            </p>
          </div>
        )}
      </ImpactCard>

      <ImpactCard title="Energy-yield impact" assessed={!missing.includes("energy yield")}>
        {text("energy_yield_impact", "Expected effect on production")}
      </ImpactCard>
      <ImpactCard title="Contract impact" assessed={!missing.includes("contract")}>
        {text("contract_impact", "Contractual consequences")}
      </ImpactCard>
      <ImpactCard title="HSE impact" assessed={!missing.includes("HSE")}>
        {text("hse_impact", "Health, safety and environment effects")}
      </ImpactCard>
    </div>
  );
}
