// P-180 — Pure planning & controls rules. No React / Supabase imports: every
// function here is deterministic and unit-testable.

export interface CpTask {
  id: string;
  start_date: string;
  end_date: string;
  predecessor_ids: string[];
  status: string;
  progress_pct?: number;
}

/** Inclusive calendar-day duration of a task (min 1). */
export function taskDurationDays(startIso: string, endIso: string): number {
  const a = Date.parse(`${startIso}T00:00:00Z`);
  const b = Date.parse(`${endIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

/** Signed day difference (to - from). */
export function daysBetweenIso(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Longest path (by total duration) through the predecessor DAG, restricted to
 * non-complete tasks. Deterministic: ties break on the lexicographically
 * smallest task id. Cycles are ignored (a task never revisits itself).
 */
export function criticalPathTaskIds(tasks: readonly CpTask[]): string[] {
  const open = tasks.filter((t) => t.status !== "complete");
  const byId = new Map(open.map((t) => [t.id, t]));
  const memo = new Map<string, { length: number; path: string[] }>();

  const walk = (id: string, seen: ReadonlySet<string>): { length: number; path: string[] } => {
    const cached = memo.get(id);
    if (cached) return cached;
    const task = byId.get(id)!;
    const dur = taskDurationDays(task.start_date, task.end_date);
    let best: { length: number; path: string[] } = { length: dur, path: [id] };
    const preds = [...new Set(task.predecessor_ids ?? [])]
      .filter((p) => byId.has(p) && !seen.has(p))
      .sort();
    for (const p of preds) {
      const sub = walk(p, new Set([...seen, id]));
      const length = sub.length + dur;
      if (
        length > best.length ||
        (length === best.length && best.path.length > 1 && sub.path[0]! < best.path[0]!)
      ) {
        best = { length, path: [...sub.path, id] };
      }
    }
    if (seen.size === 0) memo.set(id, best);
    return best;
  };

  let winner: { length: number; path: string[] } = { length: 0, path: [] };
  for (const t of [...open].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const r = walk(t.id, new Set());
    if (r.length > winner.length) winner = r;
  }
  return [...winner.path].sort();
}

// ---------------------------------------------------------------------------
// Baseline compare
// ---------------------------------------------------------------------------
export interface BaselineEntry {
  task_id: string;
  name: string;
  start_date: string;
  end_date: string;
  progress_pct: number;
}

export interface BaselineVarianceRow {
  taskId: string;
  name: string;
  baselineStart: string | null;
  baselineEnd: string | null;
  currentStart: string | null;
  currentEnd: string | null;
  startVarianceDays: number | null;
  finishVarianceDays: number | null;
  progressDelta: number | null;
  slipping: boolean;
}

export const SLIPPAGE_THRESHOLD_DAYS = 7;

export function compareToBaseline(
  current: ReadonlyArray<{
    id: string;
    name: string;
    start_date: string;
    end_date: string;
    progress_pct: number;
  }>,
  baseline: readonly BaselineEntry[],
): BaselineVarianceRow[] {
  const baseMap = new Map(baseline.map((b) => [b.task_id, b]));
  const rows: BaselineVarianceRow[] = current.map((t) => {
    const b = baseMap.get(t.id);
    const startVarianceDays = b ? daysBetweenIso(b.start_date, t.start_date) : null;
    const finishVarianceDays = b ? daysBetweenIso(b.end_date, t.end_date) : null;
    return {
      taskId: t.id,
      name: t.name,
      baselineStart: b?.start_date ?? null,
      baselineEnd: b?.end_date ?? null,
      currentStart: t.start_date,
      currentEnd: t.end_date,
      startVarianceDays,
      finishVarianceDays,
      progressDelta: b ? Number((t.progress_pct - b.progress_pct).toFixed(2)) : null,
      slipping: (finishVarianceDays ?? 0) > SLIPPAGE_THRESHOLD_DAYS,
    };
  });
  return rows.sort((a, b) => (b.finishVarianceDays ?? -1) - (a.finishVarianceDays ?? -1));
}

// ---------------------------------------------------------------------------
// Quantity → progress
// ---------------------------------------------------------------------------
export interface QuantityFact {
  discipline: string;
  uom: string;
  quantity: number;
}

export interface WeightingRule {
  id: string;
  project_id: string | null;
  discipline: string;
  uom: string;
  target_qty: number;
  is_active: boolean;
}

/** Project-specific rule wins over the company default for a discipline+uom. */
export function pickRule(
  rules: readonly WeightingRule[],
  discipline: string,
  uom: string,
): WeightingRule | null {
  const matches = rules.filter(
    (r) => r.is_active && r.discipline === discipline && r.uom === uom,
  );
  return matches.find((r) => r.project_id != null) ?? matches[0] ?? null;
}

export function sumQuantities(facts: readonly QuantityFact[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of facts) {
    const key = `${f.discipline}|${f.uom}`;
    out.set(key, (out.get(key) ?? 0) + (Number(f.quantity) || 0));
  }
  return out;
}

/** Installed-vs-target percentage per discipline, clamped to 0..100. */
export function disciplineProgress(
  facts: readonly QuantityFact[],
  rules: readonly WeightingRule[],
): Map<string, number> {
  const sums = sumQuantities(facts);
  const best = new Map<string, number>();
  for (const [key, qty] of sums) {
    const [discipline, uom] = key.split("|") as [string, string];
    const rule = pickRule(rules, discipline, uom);
    if (!rule || rule.target_qty <= 0) continue;
    const pct = Math.min(100, Math.max(0, (qty / rule.target_qty) * 100));
    best.set(discipline, Math.max(best.get(discipline) ?? 0, Number(pct.toFixed(2))));
  }
  return best;
}

/** Weighted EV share: sum(weight * progress) / sum(weight), 0 when unweighted. */
export function weightedProgressPct(
  packages: ReadonlyArray<{ weight: number; progress_pct: number }>,
): number {
  const total = packages.reduce((s, p) => s + (Number(p.weight) || 0), 0);
  if (total <= 0) return 0;
  const earned = packages.reduce(
    (s, p) => s + (Number(p.weight) || 0) * (Number(p.progress_pct) || 0),
    0,
  );
  return Number((earned / total).toFixed(2));
}

// ---------------------------------------------------------------------------
// Productivity
// ---------------------------------------------------------------------------
export interface ProductivityFact {
  bucket: string;
  qty: number;
  hours: number;
}

export interface ProductivityRow {
  bucket: string;
  qty: number;
  hours: number;
  /** null when hours = 0 — the UI renders "—". */
  unitsPerManhour: number | null;
}

export function productivityRows(facts: readonly ProductivityFact[]): ProductivityRow[] {
  const acc = new Map<string, { qty: number; hours: number }>();
  for (const f of facts) {
    const cur = acc.get(f.bucket) ?? { qty: 0, hours: 0 };
    cur.qty += Number(f.qty) || 0;
    cur.hours += Number(f.hours) || 0;
    acc.set(f.bucket, cur);
  }
  return [...acc.entries()]
    .map(([bucket, v]) => ({
      bucket,
      qty: Number(v.qty.toFixed(2)),
      hours: Number(v.hours.toFixed(2)),
      unitsPerManhour: v.hours > 0 ? Number((v.qty / v.hours).toFixed(3)) : null,
    }))
    .sort((a, b) => (a.bucket < b.bucket ? -1 : 1));
}

export function formatPerManhour(v: number | null): string {
  return v == null ? "—" : v.toFixed(3);
}

/** Monday-only ISO week start for a given date (UTC). */
export function mondayOf(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  const day = d.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
