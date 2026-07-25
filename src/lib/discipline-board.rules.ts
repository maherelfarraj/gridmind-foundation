// P-085 — Pure helpers for the discipline board (no I/O, unit-testable).

export const BOARD_DISCIPLINES = ["civil", "mechanical", "electrical"] as const;
export type BoardDiscipline = (typeof BOARD_DISCIPLINES)[number];

export const DISCIPLINE_LABELS: Record<BoardDiscipline, string> = {
  civil: "Civil",
  mechanical: "Mechanical",
  electrical: "Electrical",
};

/** Loose normaliser: map free-text discipline strings from DPRs/WBS onto the
 *  three board disciplines. Returns null when it doesn't belong on the board. */
export function normalizeDiscipline(input: unknown): BoardDiscipline | null {
  if (typeof input !== "string") return null;
  const v = input.trim().toLowerCase();
  if (!v) return null;
  if (v.startsWith("civ")) return "civil";
  if (v.startsWith("mech") || v === "m") return "mechanical";
  if (
    v.startsWith("elec") ||
    v === "e" ||
    v.startsWith("i&c") ||
    v.startsWith("ic")
  )
    return "electrical";
  return null;
}

export interface DprQuantity {
  report_date: string; // YYYY-MM-DD
  wbs_item_id: string | null;
  discipline: string | null;
  area: string | null;
  qty: number;
  uom: string | null;
}

/** Parse a DPR `quantities` jsonb array defensively — bad rows are dropped. */
export function parseQuantities(input: unknown, reportDate: string): DprQuantity[] {
  if (!Array.isArray(input)) return [];
  const out: DprQuantity[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const qty = Number(r.qty ?? r.quantity);
    if (!Number.isFinite(qty)) continue;
    out.push({
      report_date: reportDate,
      wbs_item_id: typeof r.wbs_item_id === "string" ? r.wbs_item_id : null,
      discipline: typeof r.discipline === "string" ? r.discipline : null,
      area: typeof r.area === "string" ? r.area : null,
      qty,
      uom: typeof r.uom === "string" ? r.uom : null,
    });
  }
  return out;
}

export interface AreaRollup {
  area: string;
  wbsName: string | null;
  uom: string | null;
  installedToDate: number;
  plannedQty: number | null;
  progressPct: number | null;
  rate7d: number;
  ratePrev7d: number;
}

export interface ColumnRollup {
  discipline: BoardDiscipline;
  areas: AreaRollup[];
}

export interface RollupInputWbs {
  id: string;
  name: string | null;
  discipline: string | null;
  area: string | null;
  uom: string | null;
  planned_quantity: number | null;
}

export interface RollupOptions {
  /** ISO date (YYYY-MM-DD) treated as "today" for the rolling-window math. */
  today: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(a: string, b: string): number {
  const ta = Date.parse(a + "T00:00:00Z");
  const tb = Date.parse(b + "T00:00:00Z");
  return Math.round((ta - tb) / DAY_MS);
}

/** Average qty per distinct reporting day within [today-days+1, today]. */
function windowRate(entries: DprQuantity[], today: string, days: number): number {
  const totals = new Map<string, number>();
  for (const e of entries) {
    const d = daysBetween(today, e.report_date);
    if (d < 0 || d >= days) continue;
    totals.set(e.report_date, (totals.get(e.report_date) ?? 0) + e.qty);
  }
  if (totals.size === 0) return 0;
  let sum = 0;
  for (const v of totals.values()) sum += v;
  return sum / totals.size;
}

/** Same math, but for the prior window [today-2*days+1, today-days]. */
function priorWindowRate(entries: DprQuantity[], today: string, days: number): number {
  const totals = new Map<string, number>();
  for (const e of entries) {
    const d = daysBetween(today, e.report_date);
    if (d < days || d >= days * 2) continue;
    totals.set(e.report_date, (totals.get(e.report_date) ?? 0) + e.qty);
  }
  if (totals.size === 0) return 0;
  let sum = 0;
  for (const v of totals.values()) sum += v;
  return sum / totals.size;
}

export function rollupBoard(
  quantities: DprQuantity[],
  wbs: RollupInputWbs[],
  opts: RollupOptions,
): ColumnRollup[] {
  const wbsById = new Map(wbs.map((w) => [w.id, w]));

  // Group by (discipline, area).
  interface Bucket {
    discipline: BoardDiscipline;
    area: string;
    wbsName: string | null;
    uom: string | null;
    plannedQty: number | null;
    entries: DprQuantity[];
    plannedSeen: Set<string>; // wbs ids already added to plannedQty
  }
  const buckets = new Map<string, Bucket>();

  for (const q of quantities) {
    const w = q.wbs_item_id ? wbsById.get(q.wbs_item_id) ?? null : null;
    const disc = normalizeDiscipline(q.discipline) ?? normalizeDiscipline(w?.discipline);
    if (!disc) continue;
    const area = (q.area ?? w?.area ?? "Unassigned").trim() || "Unassigned";
    const uom = q.uom ?? w?.uom ?? null;
    const key = `${disc}::${area}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        discipline: disc,
        area,
        wbsName: w?.name ?? null,
        uom,
        plannedQty: null,
        entries: [],
        plannedSeen: new Set(),
      };
      buckets.set(key, b);
    }
    b.entries.push(q);
    if (!b.uom && uom) b.uom = uom;
    if (!b.wbsName && w?.name) b.wbsName = w.name;
    if (w && w.planned_quantity != null && !b.plannedSeen.has(w.id)) {
      b.plannedSeen.add(w.id);
      b.plannedQty = (b.plannedQty ?? 0) + Number(w.planned_quantity);
    }
  }

  // Materialise columns in stable order.
  const columns: ColumnRollup[] = BOARD_DISCIPLINES.map((d) => ({
    discipline: d,
    areas: [],
  }));
  const byDisc = new Map(columns.map((c) => [c.discipline, c]));

  for (const b of buckets.values()) {
    const installed = b.entries.reduce((s, e) => s + e.qty, 0);
    const progressPct =
      b.plannedQty != null && b.plannedQty > 0
        ? Math.min(999, (installed / b.plannedQty) * 100)
        : null;
    const rate7d = windowRate(b.entries, opts.today, 7);
    const ratePrev7d = priorWindowRate(b.entries, opts.today, 7);
    byDisc.get(b.discipline)!.areas.push({
      area: b.area,
      wbsName: b.wbsName,
      uom: b.uom,
      installedToDate: installed,
      plannedQty: b.plannedQty,
      progressPct,
      rate7d,
      ratePrev7d,
    });
  }

  for (const col of columns) {
    col.areas.sort((a, b) => a.area.localeCompare(b.area));
  }
  return columns;
}

export type Trend = "up" | "down" | "flat";
export function trendFor(current: number, prior: number): Trend {
  const diff = current - prior;
  const base = Math.max(Math.abs(prior), 0.0001);
  if (Math.abs(diff) / base < 0.02) return "flat";
  return diff > 0 ? "up" : "down";
}

export function spiCpiTone(v: number | null): "success" | "warning" | "destructive" | "muted" {
  if (v == null || !Number.isFinite(v)) return "muted";
  if (v >= 1.0) return "success";
  if (v >= 0.9) return "warning";
  return "destructive";
}

/** ISO date (YYYY-MM-DD) for `today`, in UTC — matches Postgres `current_date`. */
export function isoToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Sunday-anchored ISO date for the start of the current week (UTC). */
export function isoWeekStart(today: string): string {
  const t = new Date(today + "T00:00:00Z");
  const dow = t.getUTCDay(); // 0 = Sun
  t.setUTCDate(t.getUTCDate() - dow);
  return t.toISOString().slice(0, 10);
}
