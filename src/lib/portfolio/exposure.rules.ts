// P-254 — HSE/quality exposure math (pure, framework-free).
// Doctrine: TRIR is hours-weighted (recordables × 200,000 / exposure hours);
// heat intensity is relative to the worst cell in the same dimension so one
// project renders as an honest single row, never a fake gradient.

export interface ExposureProjectRow {
  project_id: string;
  project_code: string;
  project_name: string;
  incidents_open: number;
  punch_a_open: number;
  punch_b_open: number;
  punch_c_open: number;
  ncr_open: number;
  hold_points_open: number;
  last_incident_at: string | null;
  days_since_last_incident: number | null;
}

export interface PortfolioExposure {
  incidents_open: number;
  incidents_by_severity: Record<string, number>;
  trir_current: number | null;
  trir_prior: number | null;
  exposure_hours_current: number;
  exposure_hours_prior: number;
  punch_open: Record<string, number>;
  ncr_open_by_status: Record<string, number>;
  hold_points_open: number;
  by_project: ExposureProjectRow[];
}

export const SEVERITY_ORDER = ["fatal", "critical", "major", "moderate", "minor"] as const;
export type IncidentSeverity = (typeof SEVERITY_ORDER)[number];

export const PUNCH_ORDER = ["A", "B", "C"] as const;
export type PunchLetter = (typeof PUNCH_ORDER)[number];

/** Exposure dimensions shown as columns in the project heat table. */
export const EXPOSURE_DIMENSIONS = [
  "incidents_open",
  "punch_a_open",
  "punch_b_open",
  "ncr_open",
  "hold_points_open",
] as const;
export type ExposureDimension = (typeof EXPOSURE_DIMENSIONS)[number];

const num = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/** Counts by key in a fixed order, zero-filled — no missing bars. */
export function orderedCounts<K extends string>(
  map: Record<string, number> | null | undefined,
  order: readonly K[],
): Array<{ key: K; count: number }> {
  return order.map((key) => ({ key, count: num(map?.[key]) }));
}

export function totalCounts(map: Record<string, number> | null | undefined): number {
  return Object.values(map ?? {}).reduce((a, b) => a + num(b), 0);
}

export type TrendDirection = "up" | "down" | "flat" | "unknown";

export interface TrirTrend {
  direction: TrendDirection;
  /** Signed absolute delta (current − prior), null when incomparable. */
  delta: number | null;
  /** Signed percentage change vs prior, null when prior is 0/absent. */
  pct: number | null;
  /** For safety metrics, down is good. */
  tone: "good" | "bad" | "neutral";
}

/**
 * TRIR trend vs the prior period. A lower rate is better, so a falling TRIR
 * is toned "good". Missing exposure on either side yields "unknown".
 */
export function trirTrend(current: number | null, prior: number | null): TrirTrend {
  if (current === null || prior === null || !Number.isFinite(current) || !Number.isFinite(prior)) {
    return { direction: "unknown", delta: null, pct: null, tone: "neutral" };
  }
  const delta = current - prior;
  const pct = prior === 0 ? null : (delta / prior) * 100;
  if (Math.abs(delta) < 1e-9) return { direction: "flat", delta: 0, pct: 0, tone: "neutral" };
  return {
    direction: delta > 0 ? "up" : "down",
    delta,
    pct,
    tone: delta > 0 ? "bad" : "good",
  };
}

/**
 * Heat level 0–4 for a cell, relative to the largest value in its dimension.
 * Zero is always level 0; any non-zero value is at least level 1 so a lone
 * open item never disappears into the background.
 */
export function heatLevel(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  const v = num(value);
  const m = num(max);
  if (v <= 0) return 0;
  if (m <= 0) return 1;
  const share = v / m;
  if (share > 0.75) return 4;
  if (share > 0.5) return 3;
  if (share > 0.25) return 2;
  return 1;
}

/** Column maxima across the heat table, per dimension. */
export function dimensionMaxima(
  rows: readonly ExposureProjectRow[],
): Record<ExposureDimension, number> {
  const out = {} as Record<ExposureDimension, number>;
  for (const dim of EXPOSURE_DIMENSIONS) {
    out[dim] = rows.reduce((m, r) => Math.max(m, num(r[dim])), 0);
  }
  return out;
}

/** Total open exposure of a project — used to sort the worst offender first. */
export function exposureScore(row: ExposureProjectRow): number {
  return (
    num(row.incidents_open) * 5 +
    num(row.punch_a_open) * 3 +
    num(row.ncr_open) * 2 +
    num(row.hold_points_open) * 2 +
    num(row.punch_b_open)
  );
}

export function sortByExposure(rows: readonly ExposureProjectRow[]): ExposureProjectRow[] {
  return [...rows].sort(
    (a, b) => exposureScore(b) - exposureScore(a) || a.project_code.localeCompare(b.project_code),
  );
}

// ------------------------------------------------------------- drill-through
// Every number on the exposure view clicks through to its filtered source
// list. Shapes match each destination route's validateSearch schema.

export interface DrillTarget {
  to: string;
  search: Record<string, string>;
}

export function punchDrill(projectId: string | null, category: PunchLetter): DrillTarget {
  return {
    to: "/qaqc/punch",
    search: {
      ...(projectId ? { projectId } : {}),
      category,
      status: "open",
      view: "list",
    },
  };
}

export function ncrDrill(projectId: string | null, status: "open" | "in_progress"): DrillTarget {
  return {
    to: "/qaqc/ncrs",
    search: { ...(projectId ? { projectId } : {}), status },
  };
}

export function incidentDrill(
  projectId: string | null,
  status: "open" | "investigating" | null = null,
): DrillTarget {
  return {
    to: "/hse/incidents",
    search: {
      ...(projectId ? { projectId } : {}),
      ...(status ? { status } : {}),
    },
  };
}

export function holdPointDrill(projectId: string | null): DrillTarget {
  return {
    to: "/quality/itp",
    search: { ...(projectId ? { projectId } : {}), pointType: "hold" },
  };
}
