// P-079/P-081 — Change orders: shared rules and schemas.
import { z } from "zod";

export const CHANGE_ORDER_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "incorporated",
] as const;
export type ChangeOrderStatus = (typeof CHANGE_ORDER_STATUSES)[number];

export const BudgetImpactLineSchema = z.object({
  cost_code_id: z.string().uuid(),
  amount: z.number().finite(),
});
export type BudgetImpactLine = z.infer<typeof BudgetImpactLineSchema>;

export const ChangeOrderUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  project_id: z.string().uuid(),
  contract_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(300),
  description: z.string().max(4000).nullable().optional(),
  amount: z.number().finite(),
  currency_code: z.string().length(3).nullable().optional(),
  schedule_impact_days: z.number().int().default(0),
  budget_impact: z.array(BudgetImpactLineSchema).default([]),
  wbs_item_id: z.string().uuid().nullable().optional(),
  status: z.enum(CHANGE_ORDER_STATUSES).optional(),
});
export type ChangeOrderUpsertInput = z.infer<typeof ChangeOrderUpsertSchema>;

/** Next CO-YYYY-#### scoped to year. `existing` are same-year CO numbers. */
export function nextChangeOrderNumber(existing: readonly string[], now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const prefix = `CO-${year}-`;
  let max = 0;
  for (const n of existing) {
    if (!n.startsWith(prefix)) continue;
    const m = /-(\d+)$/.exec(n);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

export interface ChangeOrderRow {
  id: string;
  company_id: string;
  project_id: string;
  contract_id: string | null;
  co_number: string;
  title: string;
  description: string | null;
  status: ChangeOrderStatus;
  amount: number;
  currency_code: string | null;
  schedule_impact_days: number;
  budget_impact: BudgetImpactLine[];
  wbs_item_id: string | null;
  approval_instance_id: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

// ---------- Balance ----------
const CENT = 0.01;

export function sumBudgetImpact(lines: readonly BudgetImpactLine[]): number {
  const cents = lines.reduce((s, l) => s + Math.round(l.amount * 100), 0);
  return cents / 100;
}

export function isBudgetImpactBalanced(
  lines: readonly BudgetImpactLine[],
  amount: number,
): boolean {
  return Math.abs(sumBudgetImpact(lines) - amount) <= CENT;
}

// ---------- Transitions ----------
export const CO_LOCKED_STATUSES: readonly ChangeOrderStatus[] = [
  "approved",
  "rejected",
  "incorporated",
];

export function isChangeOrderLocked(status: ChangeOrderStatus): boolean {
  return CO_LOCKED_STATUSES.includes(status);
}

const TRANSITIONS: Record<ChangeOrderStatus, readonly ChangeOrderStatus[]> = {
  draft: ["submitted"],
  submitted: ["under_review", "approved", "rejected"],
  under_review: ["approved", "rejected"],
  approved: ["incorporated"],
  rejected: [],
  incorporated: [],
};

export function canTransition(from: ChangeOrderStatus, to: ChangeOrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

// ---------- Exposure ----------
export type ExposureBucket = "ok" | "warn" | "danger";

export function exposurePct(approvedCoAmount: number, contractValue: number): number {
  if (contractValue <= 0) return 0;
  return (approvedCoAmount / contractValue) * 100;
}

export function exposureBucket(pct: number): ExposureBucket {
  if (pct > 10) return "danger";
  if (pct > 5) return "warn";
  return "ok";
}

// ---------- Schedule shift preview ----------
export interface ShiftableTask {
  id: string;
  name: string;
  status: string;
  start_date: string; // ISO date
  end_date: string;
}

export interface ShiftResult<T extends ShiftableTask> {
  shifted: Array<T & { new_start_date: string; new_end_date: string }>;
  skipped: T[];
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function shiftUnstartedTasks<T extends ShiftableTask>(
  tasks: readonly T[],
  days: number,
): ShiftResult<T> {
  const shifted: ShiftResult<T>["shifted"] = [];
  const skipped: T[] = [];
  for (const t of tasks) {
    if (t.status === "not_started" && days !== 0) {
      shifted.push({
        ...t,
        new_start_date: addDaysISO(t.start_date, days),
        new_end_date: addDaysISO(t.end_date, days),
      });
    } else {
      skipped.push(t);
    }
  }
  return { shifted, skipped };
}
