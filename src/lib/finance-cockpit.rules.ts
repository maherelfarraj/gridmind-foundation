// P-196 — Finance cockpit: pure rules (no I/O, unit-testable).
import { z } from "zod";

import type { KpiStatus } from "@/components/ui/kpi-tile";

export const GetFinanceCockpitSchema = z.object({
  company_id: z.string().uuid().optional(),
});
export type GetFinanceCockpitInput = z.infer<typeof GetFinanceCockpitSchema>;

/** Access levels for the cockpit. */
export type FinanceAccessLevel = "full" | "read" | "none";
export const FINANCE_FULL_ROLES = ["finance_admin", "company_admin"] as const;
export const FINANCE_READ_ROLES = ["project_admin"] as const;

/** Audit entities surfaced in the "Recent finance activity" feed. */
export const FINANCE_ACTIVITY_ENTITIES = [
  "payments",
  "invoices",
  "pay_applications",
  "change_orders",
  "contracts",
  "budgets",
  "ar_reminders",
  "finance_periods",
] as const;

/** Approval entity types counted as finance approvals. */
export const FINANCE_APPROVAL_ENTITIES = ["pay_application", "change_order", "invoice"] as const;

/** Every tile states its exact formula + source tables. */
export const COCKPIT_FORMULAS = {
  cash_position:
    "Σ payments.amount_base (record_status='recorded', direction='receivable', payment_date in current month) − Σ same for direction='payable'. Cross-check against cash_flows actuals for the same month.",
  ar_total:
    "AR total = Σ open receivable balances (invoices.amount + tax_amount − paid_amount, FX-converted); overdue = Σ balances past due (non-current aging buckets). Source: invoices, fx_rates.",
  open_pay_apps:
    "Σ pay_applications.net_amount where status in ('submitted','certified'). Source: pay_applications.",
  budget_vs_actual:
    "Σ budgets.current_amount vs Σ budgets.actual_amount across company projects; consumed % = actual ÷ current × 100. Source: budgets.",
  pending_approvals:
    "count(approval_instances) where status='pending' and entity type in (pay_application, change_order, invoice). Source: approval_instances.",
  co_exposure:
    "Σ change_orders.amount (status in approved, incorporated) ÷ Σ contracts.value (status in signed, active) × 100. Source: change_orders, contracts.",
  sla_credits:
    "Σ sla_records.credit_amount for open (unresolved) records created in the current period. Source: sla_records.",
  bonds_expiring_30:
    "count + Σ amount of bond_instruments where status in ('active','expiring_soon') and expiry_date − current_date ≤ 30, summed per currency (never converted). Source: bond_instruments.",

  aging_chart:
    "Aging buckets from the same getArAging pass used by /finance/receivables: current (≤0d), 1-30, 31-60, 61-90, 90+.",
  cash_trend:
    "Monthly Σ cash_flows.amount_base by direction where kind='actual' and voided=false; net = inflow − outflow. Dashed series uses kind='forecast'.",
  activity:
    "Latest 20 audit_logs rows whose entity is a finance entity, newest first. Source: audit_logs.",
} as const;

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** First/last day (inclusive) of the month containing `iso`. */
export function monthBounds(iso: string): { start: string; end: string } {
  const [y, m] = iso.split("-").map(Number);
  const start = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(y, m, 0));
  return { start, end: endDate.toISOString().slice(0, 10) };
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** Last `count` month keys (YYYY-MM) ending with the month of `iso`, oldest first. */
export function lastMonthKeys(iso: string, count = 6): string[] {
  const [y, m] = iso.split("-").map(Number);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    keys.push(d.toISOString().slice(0, 7));
  }
  return keys;
}

/** Inclusive ISO date range covering the last `count` months ending at `iso`. */
export function trendRange(iso: string, count = 6): { start: string; end: string } {
  const keys = lastMonthKeys(iso, count);
  return {
    start: `${keys[0]}-01`,
    end: monthBounds(iso).end,
  };
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, {
    month: "short",
    year: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------
export interface CashFlowRow {
  period: string;
  direction: "inflow" | "outflow";
  kind: "actual" | "forecast";
  amount_base: number | null;
  voided?: boolean | null;
}

export interface CashTrendPoint {
  month: string;
  label: string;
  inflow: number;
  outflow: number;
  net: number;
  forecast_net: number | null;
}

export function aggregateCashTrend(rows: CashFlowRow[], months: string[]): CashTrendPoint[] {
  const base = new Map<string, CashTrendPoint>(
    months.map((month) => [
      month,
      { month, label: monthLabel(month), inflow: 0, outflow: 0, net: 0, forecast_net: null },
    ]),
  );
  const forecast = new Map<string, number>();
  for (const r of rows) {
    if (r.voided) continue;
    const key = monthKey(r.period ?? "");
    const point = base.get(key);
    if (!point) continue;
    const amount = Number(r.amount_base ?? 0);
    if (!Number.isFinite(amount)) continue;
    if (r.kind === "forecast") {
      forecast.set(key, (forecast.get(key) ?? 0) + (r.direction === "inflow" ? amount : -amount));
      continue;
    }
    if (r.direction === "inflow") point.inflow += amount;
    else point.outflow += amount;
    point.net = point.inflow - point.outflow;
  }
  for (const [key, value] of forecast) {
    const point = base.get(key);
    if (point) point.forecast_net = value;
  }
  return months.map((m) => base.get(m)!);
}

export function sumPayments(
  rows: { direction: string; amount_base: number | null }[],
  direction: "receivable" | "payable",
): number {
  return rows
    .filter((r) => r.direction === direction)
    .reduce((acc, r) => acc + Number(r.amount_base ?? 0), 0);
}

export function percent(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return (numerator / denominator) * 100;
}

// ---------------------------------------------------------------------------
// Tile status thresholds
// ---------------------------------------------------------------------------
export function budgetStatus(consumedPct: number | null): KpiStatus {
  if (consumedPct == null) return "neutral";
  if (consumedPct > 100) return "bad";
  if (consumedPct > 85) return "warning";
  return "good";
}

export function coExposureStatus(pct: number | null): KpiStatus {
  if (pct == null) return "neutral";
  if (pct > 10) return "bad";
  if (pct > 5) return "warning";
  return "good";
}

export function cashPositionStatus(net: number | null): KpiStatus {
  if (net == null) return "neutral";
  if (net < 0) return "bad";
  return "good";
}
