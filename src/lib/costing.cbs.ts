// GC-02 — Deterministic CBS (cost breakdown structure) roll-up.
//
// Rules:
//   * Every fact row lands on exactly one bucket: its cost code, or the
//     explicit UNASSIGNED bucket. Project totals therefore always reconcile
//     to the sum of the root rows.
//   * Parent rows are the decimal-safe sum of their own facts plus every
//     descendant. Leaves reconcile to their underlying documents.
//   * ETC per node: the subtree's forecast sum when the subtree has any
//     forecast rows, else the residual max(0, current - actual - accruals).
//   * All amounts entering here are ALREADY converted to project currency.
import {
  isBookedInvoice,
  isCommittedChangeOrder,
  isCommittedPo,
  isCommittedSubcontract,
  isCountedAccrual,
  isRecordedPayment,
} from "@/lib/costing.rules";
import { fromMinor, toMinor } from "@/lib/costing.fx";

export const UNASSIGNED_ID = "__unassigned__";

export interface CbsCodeInput {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
}

export interface CbsBudgetFact {
  cost_code_id: string | null;
  original: number;
  approved_changes: number;
  current: number;
}
export interface CbsCommitmentFact {
  id: string;
  cost_code_id: string | null;
  kind: "purchase_order" | "subcontract" | "change_order";
  status: string;
  amount_base: number;
}
export interface CbsInvoiceFact {
  id: string;
  cost_code_id: string | null;
  direction: string;
  status: string;
  amount_base: number;
}
export interface CbsPaymentFact {
  id: string;
  cost_code_id: string | null;
  direction: string;
  record_status: string;
  amount_base: number;
}
export interface CbsAccrualFact {
  id: string;
  cost_code_id: string | null;
  status: string;
  amount_base: number;
}
export interface CbsForecastFact {
  id: string;
  cost_code_id: string | null;
  etc_amount_base: number;
}

export interface CbsFacts {
  costCodes: CbsCodeInput[];
  budgets: CbsBudgetFact[];
  commitments: CbsCommitmentFact[];
  invoices: CbsInvoiceFact[];
  payments: CbsPaymentFact[];
  accruals: CbsAccrualFact[];
  forecasts: CbsForecastFact[];
}

export interface CbsMetrics {
  original: number;
  approved_changes: number;
  current: number;
  committed: number;
  committed_po: number;
  committed_subcontract: number;
  committed_change_order: number;
  actual: number;
  accruals: number;
  etc: number;
  eac: number;
  variance_at_completion: number;
  available: number;
  paid: number;
  outstanding: number;
  percent_consumed: number;
}

export interface CbsRow extends CbsMetrics {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  depth: number;
  has_children: boolean;
  is_unassigned: boolean;
  /** Number of source documents attached directly to this node. */
  own_document_count: number;
}

// --- internal accumulator (integer minor units, decimal-safe) --------------
interface Acc {
  original: number;
  approved_changes: number;
  current: number;
  po: number;
  sub: number;
  co: number;
  actual: number;
  accruals: number;
  forecast: number;
  paid: number;
  forecastRows: number;
  docs: number;
}

function emptyAcc(): Acc {
  return {
    original: 0,
    approved_changes: 0,
    current: 0,
    po: 0,
    sub: 0,
    co: 0,
    actual: 0,
    accruals: 0,
    forecast: 0,
    paid: 0,
    forecastRows: 0,
    docs: 0,
  };
}

function addAcc(target: Acc, src: Acc): void {
  target.original += src.original;
  target.approved_changes += src.approved_changes;
  target.current += src.current;
  target.po += src.po;
  target.sub += src.sub;
  target.co += src.co;
  target.actual += src.actual;
  target.accruals += src.accruals;
  target.forecast += src.forecast;
  target.paid += src.paid;
  target.forecastRows += src.forecastRows;
  target.docs += src.docs;
}

function dedupe<T extends { id: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

/**
 * Build the flattened CBS tree (pre-order) plus the reconciled project total.
 * Rows are returned in display order; callers handle expand/collapse.
 */
export function buildCbsTree(facts: CbsFacts): { rows: CbsRow[]; total: CbsMetrics } {
  const codes = facts.costCodes;
  const known = new Set(codes.map((c) => c.id));
  const bucketOf = (id: string | null): string => (id && known.has(id) ? id : UNASSIGNED_ID);

  const own = new Map<string, Acc>();
  const get = (key: string): Acc => {
    let a = own.get(key);
    if (!a) {
      a = emptyAcc();
      own.set(key, a);
    }
    return a;
  };
  for (const c of codes) get(c.id);
  get(UNASSIGNED_ID);

  for (const b of facts.budgets) {
    const a = get(bucketOf(b.cost_code_id));
    a.original += toMinor(b.original);
    a.approved_changes += toMinor(b.approved_changes);
    a.current += toMinor(b.current);
  }
  for (const c of dedupe(facts.commitments)) {
    const a = get(bucketOf(c.cost_code_id));
    const v = toMinor(c.amount_base);
    if (c.kind === "purchase_order" && isCommittedPo(c.status)) {
      a.po += v;
      a.docs += 1;
    } else if (c.kind === "subcontract" && isCommittedSubcontract(c.status)) {
      a.sub += v;
      a.docs += 1;
    } else if (c.kind === "change_order" && isCommittedChangeOrder(c.status)) {
      a.co += v;
      a.docs += 1;
    }
  }
  for (const i of dedupe(facts.invoices)) {
    if (!isBookedInvoice(i.direction, i.status)) continue;
    const a = get(bucketOf(i.cost_code_id));
    a.actual += toMinor(i.amount_base);
    a.docs += 1;
  }
  for (const p of dedupe(facts.payments)) {
    if (!isRecordedPayment(p.direction, p.record_status)) continue;
    const a = get(bucketOf(p.cost_code_id));
    a.paid += toMinor(p.amount_base);
    a.docs += 1;
  }
  for (const ac of dedupe(facts.accruals)) {
    if (!isCountedAccrual(ac.status)) continue;
    const a = get(bucketOf(ac.cost_code_id));
    a.accruals += toMinor(ac.amount_base);
    a.docs += 1;
  }
  for (const f of dedupe(facts.forecasts)) {
    const a = get(bucketOf(f.cost_code_id));
    a.forecast += toMinor(f.etc_amount_base);
    a.forecastRows += 1;
    a.docs += 1;
  }

  // --- hierarchy -----------------------------------------------------------
  const children = new Map<string | null, CbsCodeInput[]>();
  for (const c of codes) {
    const parent = c.parent_id && known.has(c.parent_id) ? c.parent_id : null;
    const list = children.get(parent) ?? [];
    list.push({ ...c, parent_id: parent });
    children.set(parent, list);
  }
  for (const list of children.values()) {
    list.sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  }

  const subtree = new Map<string, Acc>();
  const guard = new Set<string>();
  function collect(id: string): Acc {
    const cached = subtree.get(id);
    if (cached) return cached;
    if (guard.has(id)) return emptyAcc(); // cycle safety
    guard.add(id);
    const acc = emptyAcc();
    addAcc(acc, own.get(id) ?? emptyAcc());
    for (const child of children.get(id) ?? []) addAcc(acc, collect(child.id));
    guard.delete(id);
    subtree.set(id, acc);
    return acc;
  }

  const rows: CbsRow[] = [];
  function walk(node: CbsCodeInput, depth: number): void {
    const kids = children.get(node.id) ?? [];
    rows.push({
      id: node.id,
      code: node.code,
      name: node.name,
      parent_id: node.parent_id,
      depth,
      has_children: kids.length > 0,
      is_unassigned: false,
      own_document_count: own.get(node.id)?.docs ?? 0,
      ...metricsOf(collect(node.id)),
    });
    for (const kid of kids) walk(kid, depth + 1);
  }
  for (const root of children.get(null) ?? []) walk(root, 0);

  const unassignedAcc = own.get(UNASSIGNED_ID) ?? emptyAcc();
  rows.push({
    id: UNASSIGNED_ID,
    code: "—",
    name: "Unassigned",
    parent_id: null,
    depth: 0,
    has_children: false,
    is_unassigned: true,
    own_document_count: unassignedAcc.docs,
    ...metricsOf(unassignedAcc),
  });

  const totalAcc = emptyAcc();
  for (const root of children.get(null) ?? []) addAcc(totalAcc, collect(root.id));
  addAcc(totalAcc, unassignedAcc);

  return { rows, total: metricsOf(totalAcc) };
}

function metricsOf(a: Acc): CbsMetrics {
  const current = a.current;
  const committed = a.po + a.sub + a.co;
  const actual = a.actual;
  const accruals = a.accruals;
  const etc = a.forecastRows > 0 ? a.forecast : Math.max(0, current - actual - accruals);
  const eac = actual + accruals + etc;
  const consumedBase = actual + accruals;
  return {
    original: fromMinor(a.original),
    approved_changes: fromMinor(a.approved_changes),
    current: fromMinor(current),
    committed: fromMinor(committed),
    committed_po: fromMinor(a.po),
    committed_subcontract: fromMinor(a.sub),
    committed_change_order: fromMinor(a.co),
    actual: fromMinor(actual),
    accruals: fromMinor(accruals),
    etc: fromMinor(etc),
    eac: fromMinor(eac),
    variance_at_completion: fromMinor(current - eac),
    available: fromMinor(current - Math.max(committed, consumedBase)),
    paid: fromMinor(a.paid),
    outstanding: fromMinor(actual - a.paid),
    percent_consumed: current > 0 ? Math.round((consumedBase / current) * 1000) / 10 : 0,
  };
}

/** Ids of a node plus all of its descendants — used by the detail drawer. */
export function descendantIds(rows: readonly CbsRow[], id: string): string[] {
  const kids = new Map<string | null, string[]>();
  for (const r of rows) {
    const list = kids.get(r.parent_id) ?? [];
    list.push(r.id);
    kids.set(r.parent_id, list);
  }
  const out: string[] = [];
  const stack = [id];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    out.push(cur);
    for (const k of kids.get(cur) ?? []) stack.push(k);
  }
  return out;
}
