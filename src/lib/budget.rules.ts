// P-075 — Pure rules and zod schemas for budgets + cost codes.
import { z } from "zod";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface CostCodeNode {
  id: string;
  code: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  wbs_item_id: string | null;
  is_active: boolean;
}

export interface BudgetLite {
  cost_code_id: string;
  original_amount: number;
  approved_changes: number;
  current_amount: number;
  committed_amount: number;
  actual_amount: number;
  currency_code: string;
}

export interface PoCommitmentEntry {
  po_id: string;
  po_number: string;
  vendor: string | null;
  amount: number;
  currency_code: string;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------
export const COST_CODE_REGEX = /^[A-Za-z0-9]+(?:[-.][A-Za-z0-9]+)*$/;

export const costCodeCreateSchema = z.object({
  projectId: z.string().uuid(),
  code: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(COST_CODE_REGEX, "Use letters/numbers with '-' or '.' separators"),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).optional().nullable(),
  parent_id: z.string().uuid().optional().nullable(),
  wbs_item_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().default(true),
});

export const costCodeUpdateSchema = z.object({
  id: z.string().uuid(),
  patch: costCodeCreateSchema.partial().omit({ projectId: true }),
});

export const costCodeDeleteSchema = z.object({ id: z.string().uuid() });

export const budgetUpsertSchema = z.object({
  projectId: z.string().uuid(),
  cost_code_id: z.string().uuid(),
  wbs_item_id: z.string().uuid().optional().nullable(),
  original_amount: z.number().nonnegative().max(999_999_999_999),
  currency_code: z.string().trim().min(3).max(3),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const poAssignmentSchema = z.object({
  po_id: z.string().uuid(),
  cost_code_id: z.string().uuid().nullable(),
});

export const importPoCommitmentsSchema = z.object({
  projectId: z.string().uuid(),
  assignments: z.array(poAssignmentSchema).max(500),
});

export type CostCodeCreateInput = z.infer<typeof costCodeCreateSchema>;
export type CostCodeUpdateInput = z.infer<typeof costCodeUpdateSchema>;
export type BudgetUpsertInput = z.infer<typeof budgetUpsertSchema>;
export type PoAssignment = z.infer<typeof poAssignmentSchema>;

// ---------------------------------------------------------------------------
// Variance
// ---------------------------------------------------------------------------
export type VarianceBand = "ok" | "warning" | "destructive";

export function variance(
  current: number,
  committed: number,
  actual: number,
): number {
  return round2(current - committed - actual);
}

/** Negative variance = over budget. Bands scale by ratio to current amount. */
export function varianceBand(v: number, current: number): VarianceBand {
  if (current <= 0) return v < 0 ? "destructive" : "ok";
  const ratio = v / current;
  if (ratio < -0.05) return "destructive";
  if (ratio < 0) return "warning";
  return "ok";
}

export function varianceClass(band: VarianceBand): string {
  switch (band) {
    case "destructive":
      return "text-destructive";
    case "warning":
      return "text-warning";
    default:
      return "text-foreground";
  }
}

// ---------------------------------------------------------------------------
// Snapshot helpers
// ---------------------------------------------------------------------------
export function sumSnapshot(entries: PoCommitmentEntry[]): number {
  return round2(entries.reduce((acc, e) => acc + (Number(e.amount) || 0), 0));
}

export function buildPoSnapshotEntry(po: {
  id: string;
  po_number: string;
  vendor_name?: string | null;
  total_amount: number | string;
  currency_code: string;
}): PoCommitmentEntry {
  return {
    po_id: po.id,
    po_number: po.po_number,
    vendor: po.vendor_name ?? null,
    amount: Number(po.total_amount) || 0,
    currency_code: po.currency_code,
  };
}

// ---------------------------------------------------------------------------
// Tree grouping
// ---------------------------------------------------------------------------
export interface CostCodeTreeNode extends CostCodeNode {
  children: CostCodeTreeNode[];
  depth: number;
}

export function groupCostCodesByParent(
  rows: CostCodeNode[],
): CostCodeTreeNode[] {
  const byId = new Map<string, CostCodeTreeNode>();
  for (const r of rows) {
    byId.set(r.id, { ...r, children: [], depth: 0 });
  }
  const roots: CostCodeTreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const setDepth = (n: CostCodeTreeNode, d: number) => {
    n.depth = d;
    n.children.sort((a, b) => a.code.localeCompare(b.code));
    for (const c of n.children) setDepth(c, d + 1);
  };
  roots.sort((a, b) => a.code.localeCompare(b.code));
  for (const r of roots) setDepth(r, 0);
  return roots;
}

export function flattenTree(nodes: CostCodeTreeNode[]): CostCodeTreeNode[] {
  const out: CostCodeTreeNode[] = [];
  const walk = (n: CostCodeTreeNode) => {
    out.push(n);
    for (const c of n.children) walk(c);
  };
  for (const n of nodes) walk(n);
  return out;
}

// ---------------------------------------------------------------------------
// KPI aggregates
// ---------------------------------------------------------------------------
export interface CurrencyTotals {
  currency_code: string;
  current: number;
  committed: number;
  actual: number;
  variance: number;
}

export function totalsByCurrency(budgets: BudgetLite[]): CurrencyTotals[] {
  const map = new Map<string, CurrencyTotals>();
  for (const b of budgets) {
    const key = b.currency_code;
    const t =
      map.get(key) ?? {
        currency_code: key,
        current: 0,
        committed: 0,
        actual: 0,
        variance: 0,
      };
    t.current += Number(b.current_amount) || 0;
    t.committed += Number(b.committed_amount) || 0;
    t.actual += Number(b.actual_amount) || 0;
    map.set(key, t);
  }
  for (const t of map.values()) {
    t.current = round2(t.current);
    t.committed = round2(t.committed);
    t.actual = round2(t.actual);
    t.variance = variance(t.current, t.committed, t.actual);
  }
  return [...map.values()].sort((a, b) =>
    a.currency_code.localeCompare(b.currency_code),
  );
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
