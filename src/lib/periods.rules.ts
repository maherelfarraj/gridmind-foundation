// P-200 — Period close: pure rules (no I/O), unit-testable in isolation.
import { z } from "zod";

import { AGING_BUCKETS, type AgingBucketKey } from "@/lib/finance/aging-weights";
import { periodKey, periodMonth } from "@/lib/finance/periods";

export const PERIOD_FULL_ROLES = ["finance_admin", "company_admin"] as const;
export const PERIOD_REOPEN_ROLES = ["company_admin"] as const;
export const PERIOD_READ_ROLES = ["project_admin"] as const;
export type PeriodAccess = "full" | "reopen" | "read" | "none";

export const PeriodMonthSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ClosePeriodSchema = z.object({ period_month: PeriodMonthSchema });
export type ClosePeriodInput = z.infer<typeof ClosePeriodSchema>;

/** Reopening a closed month is a governed act: the reason is mandatory and audited. */
export const REOPEN_REASON_MIN = 10;
export const ReopenPeriodSchema = z.object({
  period_month: PeriodMonthSchema,
  reason: z
    .string()
    .trim()
    .min(REOPEN_REASON_MIN, "Reason must be at least 10 characters — it is written to the audit log.")
    .max(500),
});
export type ReopenPeriodInput = z.infer<typeof ReopenPeriodSchema>;


export const SaveChecklistSchema = z.object({
  period_month: PeriodMonthSchema,
  unbilled_reviewed: z.boolean(),
  note: z.string().max(500).optional(),
});
export type SaveChecklistInput = z.infer<typeof SaveChecklistSchema>;

export const ComparePeriodsSchema = z.object({ period_month: PeriodMonthSchema });
export type ComparePeriodsInput = z.infer<typeof ComparePeriodsSchema>;

export type PeriodStatus = "open" | "closing" | "closed";

export interface PeriodChecklistState {
  unbilled_reviewed?: boolean;
  note?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
}

export interface PeriodRow {
  id: string | null;
  period_month: string;
  status: PeriodStatus;
  closed_by: string | null;
  closed_by_name: string | null;
  closed_at: string | null;
  close_checklist: PeriodChecklistState;
}

// ---------------------------------------------------------------------------
// Month helpers
// ---------------------------------------------------------------------------
export function monthStart(month: string): string {
  return periodMonth(month);
}

export function monthEnd(month: string): string {
  const [y, m] = periodKey(month).split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0));
  return last.toISOString().slice(0, 10);
}

export function monthLabel(month: string): string {
  const [y, m] = periodKey(month).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = periodKey(month).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 10);
}

/** Current month plus `count - 1` prior months, newest first. */
export function recentMonths(today: string, count = 13): string[] {
  const base = periodMonth(today);
  return Array.from({ length: count }, (_, i) => shiftMonth(base, -i));
}

export function inMonth(date: string | null | undefined, month: string): boolean {
  return Boolean(date) && periodKey(date as string) === periodKey(month);
}

// ---------------------------------------------------------------------------
// Close checklist
// ---------------------------------------------------------------------------
export const CHECKLIST_ITEMS = [
  "payables_matched",
  "unbilled_reviewed",
  "unmatched_resolved",
  "alerts_acknowledged",
] as const;
export type ChecklistKey = (typeof CHECKLIST_ITEMS)[number];

export const CHECKLIST_LABELS: Record<ChecklistKey, string> = {
  payables_matched: "Payables matched",
  unbilled_reviewed: "Unbilled certified work reviewed",
  unmatched_resolved: "Unmatched payments resolved",
  alerts_acknowledged: "Finance alerts acknowledged",
};

export const CHECKLIST_HINTS: Record<ChecklistKey, string> = {
  payables_matched: "No three-way matches in the month are blocking payment release.",
  unbilled_reviewed: "Manual confirmation that certified-but-unbilled work has been reviewed.",
  unmatched_resolved: "Every payment dated in the month is matched, partial or excluded.",
  alerts_acknowledged: "No finance alerts remain open.",
};

export const CHECKLIST_LINKS: Record<ChecklistKey, string> = {
  payables_matched: "/procurement/three-way-match",
  unbilled_reviewed: "/finance/revenue-recognition",
  unmatched_resolved: "/finance/reconciliation",
  alerts_acknowledged: "/finance/alerts",
};

export interface ChecklistItem {
  key: ChecklistKey;
  label: string;
  hint: string;
  link: string;
  pass: boolean;
  detail: string;
  manual: boolean;
}

export interface ChecklistFacts {
  blocked_matches: number;
  unmatched_payments: number;
  open_alerts: number;
  unbilled_contracts: number;
  unbilled_reviewed: boolean;
}

export function buildChecklist(facts: ChecklistFacts): ChecklistItem[] {
  const detail = (n: number, noun: string, plural: string) =>
    n === 0 ? `0 ${plural}` : `${n} ${n === 1 ? noun : plural} outstanding`;
  const base: { key: ChecklistKey; pass: boolean; detail: string; manual: boolean }[] = [
    {
      key: "payables_matched",
      pass: facts.blocked_matches === 0,
      detail: detail(facts.blocked_matches, "blocked match", "blocked matches"),
      manual: false,
    },
    {
      key: "unbilled_reviewed",
      pass: facts.unbilled_contracts === 0 || facts.unbilled_reviewed,
      detail:
        facts.unbilled_contracts === 0
          ? "No contract over the WIP threshold"
          : `${facts.unbilled_contracts} contract(s) over threshold — confirm review`,
      manual: true,
    },
    {
      key: "unmatched_resolved",
      pass: facts.unmatched_payments === 0,
      detail: detail(facts.unmatched_payments, "unmatched payment", "unmatched payments"),
      manual: false,
    },
    {
      key: "alerts_acknowledged",
      pass: facts.open_alerts === 0,
      detail: detail(facts.open_alerts, "open alert", "open alerts"),
      manual: false,
    },
  ];
  return base.map((i) => ({
    ...i,
    label: CHECKLIST_LABELS[i.key],
    hint: CHECKLIST_HINTS[i.key],
    link: CHECKLIST_LINKS[i.key],
  }));
}

export function canClose(items: ChecklistItem[]): boolean {
  return items.length > 0 && items.every((i) => i.pass);
}

// ---------------------------------------------------------------------------
// Comparison report
// ---------------------------------------------------------------------------
export interface PeriodTotals {
  period_month: string;
  revenue: number;
  collected: number;
  wip: number;
  aging: Record<AgingBucketKey, number>;
}

export interface ComparisonLine {
  metric: string;
  current: number;
  prior: number;
  delta: number;
}

export function emptyTotals(month: string): PeriodTotals {
  return {
    period_month: month,
    revenue: 0,
    collected: 0,
    wip: 0,
    aging: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 },
  };
}

export function comparisonLines(
  current: PeriodTotals,
  prior: PeriodTotals | null,
): ComparisonLine[] {
  const p = prior ?? emptyTotals("—");
  const line = (metric: string, a: number, b: number): ComparisonLine => ({
    metric,
    current: a,
    prior: b,
    delta: Number((a - b).toFixed(2)),
  });
  return [
    line("Revenue (issued receivables)", current.revenue, p.revenue),
    line("Collected (payments recorded)", current.collected, p.collected),
    line("WIP (earned − billed)", current.wip, p.wip),
    ...AGING_BUCKETS.map((b) =>
      line(`Aging ${b.replace("d", "").replace("_", "-")}`, current.aging[b], p.aging[b]),
    ),
  ];
}

export function periodStatusTone(status: PeriodStatus): "positive" | "attention" | "active" {
  if (status === "closed") return "positive";
  if (status === "closing") return "attention";
  return "active";
}
