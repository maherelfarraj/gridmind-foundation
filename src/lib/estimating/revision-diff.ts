// P-213 — Pure revision diff: margins, totals and per-line changes between
// two loaded estimate revisions. No server imports.
import { round2 } from "@/lib/estimating.rules";

export interface RevisionSummary {
  id: string;
  estimate_number: string | null;
  revision: number;
  status: string;
  currency_code: string;
  direct_cost: number;
  subtotal: number;
  total_price: number;
  escalation_pct: number;
  contingency_pct: number;
  overhead_pct: number;
  profit_pct: number;
  priced_at: string | null;
  submitted_at: string | null;
  supersedes_id: string | null;
  actor: string | null;
}

export interface RevisionLine {
  id: string;
  line_type: string;
  description: string;
  qty: number;
  uom: string;
  unit_rate: number;
  amount: number;
  source_bom_line_id: string | null;
}

export interface NumberChange {
  key: string;
  label: string;
  from: number;
  to: number;
  delta: number;
}

export interface LineChange {
  key: string;
  description: string;
  line_type: string;
  qty: { from: number; to: number } | null;
  unit_rate: { from: number; to: number } | null;
  amount: { from: number; to: number };
}

export interface RevisionDiff {
  margins: NumberChange[];
  totals: NumberChange[];
  added: RevisionLine[];
  removed: RevisionLine[];
  changed: LineChange[];
}

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/** Stable identity across revisions: BOM provenance first, then type+text. */
export function lineKey(line: RevisionLine): string {
  return (
    line.source_bom_line_id ?? `${line.line_type}|${(line.description ?? "").trim().toLowerCase()}`
  );
}

const MARGIN_FIELDS: Array<{ key: keyof RevisionSummary; label: string }> = [
  { key: "escalation_pct", label: "Escalation" },
  { key: "contingency_pct", label: "Contingency" },
  { key: "overhead_pct", label: "Overhead" },
  { key: "profit_pct", label: "Profit" },
];

const TOTAL_FIELDS: Array<{ key: keyof RevisionSummary; label: string }> = [
  { key: "direct_cost", label: "Direct cost" },
  { key: "subtotal", label: "Subtotal" },
  { key: "total_price", label: "Total price" },
];

function changes(
  prev: RevisionSummary,
  next: RevisionSummary,
  fields: Array<{ key: keyof RevisionSummary; label: string }>,
): NumberChange[] {
  const out: NumberChange[] = [];
  for (const f of fields) {
    const from = round2(n(prev[f.key]));
    const to = round2(n(next[f.key]));
    if (from === to) continue;
    out.push({ key: String(f.key), label: f.label, from, to, delta: round2(to - from) });
  }
  return out;
}

/** Diff `next` against the prior revision `prev`. */
export function diffRevisions(
  prev: { summary: RevisionSummary; lines: RevisionLine[] },
  next: { summary: RevisionSummary; lines: RevisionLine[] },
): RevisionDiff {
  const prevMap = new Map(prev.lines.map((l) => [lineKey(l), l]));
  const nextMap = new Map(next.lines.map((l) => [lineKey(l), l]));

  const added = next.lines.filter((l) => !prevMap.has(lineKey(l)));
  const removed = prev.lines.filter((l) => !nextMap.has(lineKey(l)));

  const changed: LineChange[] = [];
  for (const [key, after] of nextMap) {
    const before = prevMap.get(key);
    if (!before) continue;
    const qtyChanged = round2(n(before.qty)) !== round2(n(after.qty));
    const rateChanged = round2(n(before.unit_rate)) !== round2(n(after.unit_rate));
    if (!qtyChanged && !rateChanged) continue;
    changed.push({
      key,
      description: after.description,
      line_type: after.line_type,
      qty: qtyChanged ? { from: round2(n(before.qty)), to: round2(n(after.qty)) } : null,
      unit_rate: rateChanged
        ? { from: round2(n(before.unit_rate)), to: round2(n(after.unit_rate)) }
        : null,
      amount: { from: round2(n(before.amount)), to: round2(n(after.amount)) },
    });
  }

  return {
    margins: changes(prev.summary, next.summary, MARGIN_FIELDS),
    totals: changes(prev.summary, next.summary, TOTAL_FIELDS),
    added,
    removed,
    changed,
  };
}

/** Newest-first ordering of a supersedes chain. */
export function sortRevisionsDesc(rows: readonly RevisionSummary[]): RevisionSummary[] {
  return [...rows].sort((a, b) => b.revision - a.revision);
}

/** Statuses that may spawn a new revision. */
export const REVISIONABLE_STATUSES = ["approved", "priced"] as const;

export function canCreateRevision(status: string): boolean {
  return (REVISIONABLE_STATUSES as readonly string[]).includes(status);
}
