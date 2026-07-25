// P-079 — Change orders: shared rules and schemas.
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
export function nextChangeOrderNumber(
  existing: readonly string[],
  now: Date = new Date(),
): string {
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
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}
