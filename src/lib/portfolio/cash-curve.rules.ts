// P-253 — Consolidated cash curve math (pure, framework-free).
// Doctrine: amounts arrive already converted at FX-at-entry; we only sum and
// accumulate. Monthly ↔ cumulative is a transform on the same series.

export interface ProjectCurveRow {
  month: string;
  project_id: string;
  project_code: string;
  project_name: string;
  base_currency: string;
  forecast_inflow: number;
  forecast_outflow: number;
  actual_inflow: number;
  actual_outflow: number;
  forecast_net: number;
  actual_net: number;
}

export interface CurveMonth {
  month: string;
  forecast_inflow: number;
  forecast_outflow: number;
  actual_inflow: number;
  actual_outflow: number;
  forecast_net: number;
  actual_net: number;
}

export interface CurvePoint extends CurveMonth {
  forecast: number;
  actual: number;
}

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/** Sum every project's contribution into one company-wide monthly series. */
export function consolidateCurve(rows: readonly ProjectCurveRow[]): CurveMonth[] {
  const by = new Map<string, CurveMonth>();
  for (const r of rows) {
    const acc = by.get(r.month) ?? {
      month: r.month,
      forecast_inflow: 0,
      forecast_outflow: 0,
      actual_inflow: 0,
      actual_outflow: 0,
      forecast_net: 0,
      actual_net: 0,
    };
    acc.forecast_inflow += n(r.forecast_inflow);
    acc.forecast_outflow += n(r.forecast_outflow);
    acc.actual_inflow += n(r.actual_inflow);
    acc.actual_outflow += n(r.actual_outflow);
    acc.forecast_net += n(r.forecast_net);
    acc.actual_net += n(r.actual_net);
    by.set(r.month, acc);
  }
  return [...by.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** Monthly view: `forecast`/`actual` carry the month's net. */
export function monthlyPoints(months: readonly CurveMonth[]): CurvePoint[] {
  return months.map((m) => ({ ...m, forecast: m.forecast_net, actual: m.actual_net }));
}

/** Cumulative (exec S-curve) view: running totals of the monthly nets. */
export function cumulativePoints(months: readonly CurveMonth[]): CurvePoint[] {
  let f = 0;
  let a = 0;
  return months.map((m) => {
    f += m.forecast_net;
    a += m.actual_net;
    return { ...m, forecast: f, actual: a };
  });
}

export function curvePoints(months: readonly CurveMonth[], cumulative: boolean): CurvePoint[] {
  return cumulative ? cumulativePoints(months) : monthlyPoints(months);
}

export interface ProjectSeriesMeta {
  project_id: string;
  project_code: string;
  project_name: string;
}

export interface ProjectSeries {
  projects: ProjectSeriesMeta[];
  /** One row per month; each project id is a numeric key holding its net. */
  data: Array<Record<string, string | number>>;
}

/**
 * Per-project contribution series. With a single project this is a single
 * series — we never fabricate stacking that isn't there.
 */
export function projectContributionSeries(
  rows: readonly ProjectCurveRow[],
  options: { cumulative?: boolean; basis?: "actual" | "forecast" } = {},
): ProjectSeries {
  const basis = options.basis ?? "actual";
  const projects = new Map<string, ProjectSeriesMeta>();
  const months = new Set<string>();
  const cell = new Map<string, number>();

  for (const r of rows) {
    projects.set(r.project_id, {
      project_id: r.project_id,
      project_code: r.project_code,
      project_name: r.project_name,
    });
    months.add(r.month);
    const key = `${r.month}|${r.project_id}`;
    const value = basis === "actual" ? n(r.actual_net) : n(r.forecast_net);
    cell.set(key, (cell.get(key) ?? 0) + value);
  }

  const projectList = [...projects.values()].sort((a, b) =>
    a.project_code.localeCompare(b.project_code),
  );
  const monthList = [...months].sort((a, b) => a.localeCompare(b));
  const running = new Map<string, number>();

  const data = monthList.map((month) => {
    const row: Record<string, string | number> = { month };
    for (const p of projectList) {
      const v = cell.get(`${month}|${p.project_id}`) ?? 0;
      if (options.cumulative) {
        const total = (running.get(p.project_id) ?? 0) + v;
        running.set(p.project_id, total);
        row[p.project_id] = total;
      } else {
        row[p.project_id] = v;
      }
    }
    return row;
  });

  return { projects: projectList, data };
}

/** "2026-07-01" → "2026-07" for axis labels (numbers stay Western/LTR). */
export function monthLabel(month: string): string {
  return month.slice(0, 7);
}

export interface CashMovement {
  id: string;
  period: string;
  project_id: string;
  project_code: string;
  project_name: string;
  direction: string;
  kind: string;
  category: string | null;
  amount: number;
  currency_code: string;
  amount_base: number;
  base_currency: string;
  reference_type: string | null;
  reference_id: string | null;
  notes: string | null;
}

export interface MovementTotals {
  inflow: number;
  outflow: number;
  net: number;
  count: number;
}

/** Drill-panel footer totals for one month, in base currency. */
export function movementTotals(
  rows: readonly CashMovement[],
  kind?: "actual" | "forecast",
): MovementTotals {
  const scoped = kind ? rows.filter((r) => r.kind === kind) : rows;
  const inflow = scoped
    .filter((r) => r.direction === "inflow")
    .reduce((a, r) => a + n(r.amount_base), 0);
  const outflow = scoped
    .filter((r) => r.direction === "outflow")
    .reduce((a, r) => a + n(r.amount_base), 0);
  return { inflow, outflow, net: inflow - outflow, count: scoped.length };
}
