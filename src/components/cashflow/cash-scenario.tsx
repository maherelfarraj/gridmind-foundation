// GC-13 — Non-posting liquidity scenario overlay and sensitivity comparison.
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { count, money } from "@/components/cashflow/cash-format";
import type { CashScenarioInput, ScenarioComparison } from "@/lib/cashflow.rules";
import { useI18n } from "@/lib/i18n/locale-provider";

const K = "financeMod.costing.cashFlow";

const NUMERIC_METRICS = new Set([
  "peak_funding_need",
  "minimum_liquidity",
  "net_cash_flow",
  "headroom",
  "unfunded_requirement",
]);

export interface ScenarioDraft {
  receipt_delay_days: string;
  payment_delay_days: string;
  cost_phasing_shift_days: string;
  fx_shock_pct: string;
  facility_change_pct: string;
  contingency_draw_amount: string;
}

const EMPTY: ScenarioDraft = {
  receipt_delay_days: "0",
  payment_delay_days: "0",
  cost_phasing_shift_days: "0",
  fx_shock_pct: "0",
  facility_change_pct: "0",
  contingency_draw_amount: "0",
};

/** Map the draft into validated scenario input; empty and zero fields are dropped. */
export function toScenarioInput(projectId: string, d: ScenarioDraft): CashScenarioInput {
  const num = (v: string) => (v.trim() === "" ? 0 : Number(v));
  const out: CashScenarioInput = { project_id: projectId };
  if (num(d.receipt_delay_days)) out.receipt_delay_days = Math.trunc(num(d.receipt_delay_days));
  if (num(d.payment_delay_days)) out.payment_delay_days = Math.trunc(num(d.payment_delay_days));
  if (num(d.cost_phasing_shift_days))
    out.cost_phasing_shift_days = Math.trunc(num(d.cost_phasing_shift_days));
  if (num(d.fx_shock_pct)) out.fx_shock_pct = num(d.fx_shock_pct);
  if (num(d.facility_change_pct)) out.facility_change_pct = num(d.facility_change_pct);
  if (num(d.contingency_draw_amount))
    out.contingency_draw_amount = Math.abs(num(d.contingency_draw_amount));
  return out;
}

export function CashScenarioPanel({
  currency,
  busy,
  comparison,
  onRun,
}: {
  currency: string;
  busy: boolean;
  comparison: ScenarioComparison[] | null;
  onRun: (draft: ScenarioDraft) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<ScenarioDraft>(EMPTY);

  const field = (key: keyof ScenarioDraft, labelKey: string) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`scenario-${key}`} className="text-xs">
        {t(`${K}.scenario.${labelKey}`)}
      </Label>
      <Input
        id={`scenario-${key}`}
        inputMode="decimal"
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{t(`${K}.scenario.title`)}</h2>
        <p className="text-xs text-muted-foreground">{t(`${K}.scenario.description`)}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {field("receipt_delay_days", "receiptDelay")}
        {field("payment_delay_days", "paymentDelay")}
        {field("cost_phasing_shift_days", "costShift")}
        {field("fx_shock_pct", "fxShock")}
        {field("facility_change_pct", "facilityChange")}
        {field("contingency_draw_amount", "contingencyDraw")}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => onRun(draft)}>
          {t(`${K}.scenario.run`)}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setDraft(EMPTY)}>
          {t(`${K}.scenario.reset`)}
        </Button>
      </div>

      {comparison === null ? (
        <p className="text-sm text-muted-foreground">{t(`${K}.scenario.empty`)}</p>
      ) : (
        <Table>
          <caption className="sr-only">{t(`${K}.scenario.title`)}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t(`${K}.scenario.metric`)}</TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.scenario.basis`)}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.scenario.overlay`)}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.scenario.delta`)}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {comparison.map((r) => {
              const fmt = (v: number | null) =>
                v === null ? "—" : NUMERIC_METRICS.has(r.metric) ? money(v, currency) : count(v);
              return (
                <TableRow key={r.metric}>
                  <TableCell className="font-medium">
                    {t(`${K}.scenario.metrics.${r.metric}`, { defaultValue: r.metric })}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(r.basis)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(r.scenario)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(r.delta)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
