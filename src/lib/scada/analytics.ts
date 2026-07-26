// P-175 — Performance analytics engine.
// PURE module: no React, no Supabase, no I/O. Inputs in, results out.
// Every exported function documents its formula so the UI can show it verbatim.

export const DOWNTIME_CLASSES = [
  "maintenance",
  "curtailment",
  "equipment_fault",
  "grid_outage",
  "comms_loss",
] as const;

export type DowntimeClass = (typeof DOWNTIME_CLASSES)[number];

/**
 * Overlap resolution order (highest priority first). A minute covered by more
 * than one source is attributed to the highest-priority class only, so the sum
 * of the buckets always equals the total downtime minutes.
 */
export const DOWNTIME_PRECEDENCE: readonly DowntimeClass[] = [
  "maintenance",
  "curtailment",
  "equipment_fault",
  "grid_outage",
  "comms_loss",
];

export const DOWNTIME_CLASS_LABELS: Record<DowntimeClass, string> = {
  maintenance: "Maintenance",
  curtailment: "Curtailment",
  equipment_fault: "Equipment fault",
  grid_outage: "Grid outage",
  comms_loss: "Comms loss",
};

export const FORMULAS = {
  classifyDowntime:
    "Down intervals are unioned per class, then resolved by precedence maintenance > curtailment > equipment fault > grid outage > comms loss. Each downtime minute is counted exactly once.",
  lostEnergy: "lost_kWh = Σ expected_power_kW(t) × down_hours(t) over down intervals only",
  availability: "availability % = 100 × (1 − downtime_minutes ÷ period_minutes)",
  availabilityExclGrid:
    "contractual availability % = 100 × (1 − (downtime − grid_outage) ÷ (period − grid_outage))",
  performanceRatio: "PR % = actual_kWh ÷ (irradiance_kWh/m² × nameplate_kW ÷ 1000) × 100",
  dataQuality: "data quality % = 100 × good_samples ÷ expected_samples",
  guarantee: "margin % = actual − guaranteed (percentage-point delta); breach when margin < 0",
} as const;

/* ------------------------------------------------------------------ */
/* Interval helpers                                                     */
/* ------------------------------------------------------------------ */

export interface Interval {
  /** epoch ms, inclusive */
  start: number;
  /** epoch ms, exclusive */
  end: number;
}

function normalize(intervals: Interval[]): Interval[] {
  const valid = intervals.filter((i) => Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start);
  const sorted = [...valid].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const cur of sorted) {
    const last = merged[merged.length - 1];
    if (last && cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

/** Remove every part of `base` that overlaps any interval in `taken`. */
function subtract(base: Interval[], taken: Interval[]): Interval[] {
  let out = normalize(base);
  for (const cut of normalize(taken)) {
    const next: Interval[] = [];
    for (const iv of out) {
      if (cut.end <= iv.start || cut.start >= iv.end) {
        next.push(iv);
        continue;
      }
      if (cut.start > iv.start) next.push({ start: iv.start, end: cut.start });
      if (cut.end < iv.end) next.push({ start: cut.end, end: iv.end });
    }
    out = next;
  }
  return out;
}

function clip(intervals: Interval[], window: Interval | undefined): Interval[] {
  if (!window) return intervals;
  return intervals
    .map((iv) => ({ start: Math.max(iv.start, window.start), end: Math.min(iv.end, window.end) }))
    .filter((iv) => iv.end > iv.start);
}

function totalMinutes(intervals: Interval[]): number {
  return normalize(intervals).reduce((sum, iv) => sum + (iv.end - iv.start) / 60_000, 0);
}

/* ------------------------------------------------------------------ */
/* 1. Downtime classification                                           */
/* ------------------------------------------------------------------ */

export interface AnalyticsEvent {
  event_type: string;
  severity?: string | null;
  occurred_at: string;
  /** optional explicit end; otherwise the next clearing event or window end */
  ended_at?: string | null;
}

export interface AnalyticsAlarm {
  severity: string;
  raised_at: string;
  cleared_at?: string | null;
}

export interface AnalyticsWorkOrder {
  type: string;
  scheduled_date?: string | null;
  completed_at?: string | null;
  closed_at?: string | null;
  created_at?: string | null;
}

export interface DowntimeResult {
  totalMinutes: number;
  byClass: Record<DowntimeClass, number>;
  intervalsByClass: Record<DowntimeClass, Interval[]>;
}

const EVENT_CLASS: Record<string, DowntimeClass> = {
  maintenance: "maintenance",
  setpoint_change: "curtailment",
  curtailment: "curtailment",
  trip: "equipment_fault",
  protection: "equipment_fault",
  comm_failure: "comms_loss",
};

/** Default assumed duration (minutes) for an event with no explicit end. */
export const DEFAULT_EVENT_DURATION_MIN = 15;

function eventInterval(e: AnalyticsEvent, window?: Interval): Interval | null {
  const start = Date.parse(e.occurred_at);
  if (Number.isNaN(start)) return null;
  const explicit = e.ended_at ? Date.parse(e.ended_at) : NaN;
  const end = Number.isNaN(explicit)
    ? Math.min(start + DEFAULT_EVENT_DURATION_MIN * 60_000, window?.end ?? Infinity)
    : explicit;
  return end > start ? { start, end } : null;
}

/**
 * classifyDowntime — bucket downtime minutes into mutually exclusive classes.
 *
 * Sources:
 *  - grid_outage:     grid/meter events (`status_change` with grid/meter code, `event` type
 *                     flagged `grid`) that carry no concurrent plant fault
 *  - equipment_fault: `trip` / `protection` events + critical alarms + corrective work orders
 *  - curtailment:     `setpoint_change` / curtailment events
 *  - maintenance:     `maintenance` events + preventive work-order windows
 *  - comms_loss:      `comm_failure` events
 *
 * Precedence: maintenance > curtailment > equipment_fault > grid_outage > comms_loss.
 */
export function classifyDowntime(
  events: AnalyticsEvent[],
  alarms: AnalyticsAlarm[] = [],
  workOrders: AnalyticsWorkOrder[] = [],
  window?: Interval,
): DowntimeResult {
  const raw: Record<DowntimeClass, Interval[]> = {
    maintenance: [],
    curtailment: [],
    equipment_fault: [],
    grid_outage: [],
    comms_loss: [],
  };

  for (const e of events) {
    const iv = eventInterval(e, window);
    if (!iv) continue;
    const cls =
      EVENT_CLASS[e.event_type] ??
      (e.event_type === "status_change" || e.event_type === "event" ? "grid_outage" : null);
    if (!cls) continue;
    raw[cls].push(iv);
  }

  for (const a of alarms) {
    if (a.severity !== "critical" && a.severity !== "major") continue;
    const start = Date.parse(a.raised_at);
    if (Number.isNaN(start)) continue;
    const cleared = a.cleared_at ? Date.parse(a.cleared_at) : NaN;
    const end = Number.isNaN(cleared) ? (window?.end ?? start + 60 * 60_000) : cleared;
    if (end > start) raw.equipment_fault.push({ start, end });
  }

  for (const wo of workOrders) {
    const startSrc = wo.scheduled_date ?? wo.created_at;
    if (!startSrc) continue;
    const start = Date.parse(startSrc);
    if (Number.isNaN(start)) continue;
    const endSrc = wo.completed_at ?? wo.closed_at;
    const parsedEnd = endSrc ? Date.parse(endSrc) : NaN;
    const end = Number.isNaN(parsedEnd) ? (window?.end ?? start + 4 * 60 * 60_000) : parsedEnd;
    if (end <= start) continue;
    if (wo.type === "preventive") raw.maintenance.push({ start, end });
    else if (wo.type === "corrective") raw.equipment_fault.push({ start, end });
  }

  const intervalsByClass = {} as Record<DowntimeClass, Interval[]>;
  const byClass = {} as Record<DowntimeClass, number>;
  const claimed: Interval[] = [];

  for (const cls of DOWNTIME_PRECEDENCE) {
    const own = subtract(clip(normalize(raw[cls]), window), claimed);
    intervalsByClass[cls] = own;
    byClass[cls] = Number(totalMinutes(own).toFixed(2));
    claimed.push(...own);
  }

  return {
    totalMinutes: Number(totalMinutes(claimed).toFixed(2)),
    byClass,
    intervalsByClass,
  };
}

/* ------------------------------------------------------------------ */
/* 2. Lost energy                                                       */
/* ------------------------------------------------------------------ */

export interface ExpectedPowerSample {
  /** ISO timestamp of the sample */
  ts: string;
  /** irradiance-expected AC power at that timestamp */
  expected_power_kw: number;
}

/**
 * lostEnergyKwh — energy that the plant would have produced during downtime.
 *
 *   lost_kWh = Σ expected_power_kW(t) × down_hours(t)
 *
 * Only the portion of each expected-power sample window that overlaps a down
 * interval is counted. `sampleMinutes` is the spacing of the expected curve.
 */
export function lostEnergyKwh(
  downIntervals: Interval[],
  expectedCurve: ExpectedPowerSample[],
  sampleMinutes = 15,
): number {
  const down = normalize(downIntervals);
  if (down.length === 0 || expectedCurve.length === 0) return 0;
  const width = sampleMinutes * 60_000;
  let total = 0;
  for (const s of expectedCurve) {
    const start = Date.parse(s.ts);
    if (Number.isNaN(start) || !Number.isFinite(s.expected_power_kw)) continue;
    const sample: Interval = { start, end: start + width };
    let overlapMs = 0;
    for (const iv of down) {
      overlapMs += Math.max(0, Math.min(iv.end, sample.end) - Math.max(iv.start, sample.start));
    }
    total += s.expected_power_kw * (overlapMs / 3_600_000);
  }
  return Number(total.toFixed(3));
}

/* ------------------------------------------------------------------ */
/* 3. Availability                                                      */
/* ------------------------------------------------------------------ */

export interface AvailabilityOptions {
  /** Contractual convention: grid-outage minutes leave the denominator too. */
  excludeGrid?: boolean;
  gridOutageMinutes?: number;
}

/**
 * availabilityPct — time-based availability.
 *
 *   raw:        100 × (1 − downtime ÷ period)
 *   excl. grid: 100 × (1 − (downtime − grid) ÷ (period − grid))
 *
 * Returns null when the period is zero or negative.
 */
export function availabilityPct(
  periodMinutes: number,
  downtimeMinutes: number,
  options: AvailabilityOptions = {},
): number | null {
  if (!Number.isFinite(periodMinutes) || periodMinutes <= 0) return null;
  const grid = options.excludeGrid ? Math.max(0, options.gridOutageMinutes ?? 0) : 0;
  const period = periodMinutes - grid;
  if (period <= 0) return null;
  const down = Math.max(0, Math.min(downtimeMinutes - grid, period));
  return Number((100 * (1 - down / period)).toFixed(3));
}

/* ------------------------------------------------------------------ */
/* 4. Performance ratio                                                 */
/* ------------------------------------------------------------------ */

/**
 * performanceRatio — IEC 61724 style PR.
 *
 *   PR % = actual_kWh ÷ (irradiance_kWh/m² × nameplate_kW ÷ 1000) × 100
 *
 * Returns null when irradiance or nameplate is missing/zero (never fabricates).
 */
export function performanceRatio(
  actualKwh: number | null | undefined,
  irradianceKwhM2: number | null | undefined,
  nameplateKw: number | null | undefined,
): number | null {
  if (actualKwh == null || irradianceKwhM2 == null || nameplateKw == null) return null;
  if (!Number.isFinite(actualKwh) || !Number.isFinite(irradianceKwhM2) || !Number.isFinite(nameplateKw))
    return null;
  if (irradianceKwhM2 <= 0 || nameplateKw <= 0) return null;
  const reference = (irradianceKwhM2 * nameplateKw) / 1000;
  if (reference <= 0) return null;
  return Number(((actualKwh / reference) * 100).toFixed(3));
}

/* ------------------------------------------------------------------ */
/* 5. Data quality                                                      */
/* ------------------------------------------------------------------ */

export interface RedundantSensorPair {
  label: string;
  /** aligned readings from the two redundant sensors */
  samples: Array<{ ts: string; a: number; b: number }>;
}

export interface DataQualityResult {
  /** 100 × good ÷ expected */
  qualityPct: number | null;
  expectedSamples: number;
  receivedSamples: number;
  missingSamples: number;
  missingPct: number | null;
  suspectSamples: number;
  badSamples: number;
  driftFlags: Array<{ label: string; maxDivergencePct: number; hours: number }>;
}

export const DRIFT_DIVERGENCE_PCT = 2;
export const DRIFT_MIN_HOURS = 24;

/**
 * dataQuality — missing-data detection plus redundant-sensor drift.
 *
 *   expected samples = period_minutes ÷ poll_interval_minutes
 *   quality %        = 100 × good ÷ expected   (good = received − suspect − bad)
 *
 * A drift flag is raised when two redundant sensors diverge by more than
 * DRIFT_DIVERGENCE_PCT (2%) continuously for more than DRIFT_MIN_HOURS (24 h).
 */
export function dataQuality(
  periodMinutes: number,
  pollIntervalMinutes: number,
  qualityFlags: string[],
  redundantPairs: RedundantSensorPair[] = [],
): DataQualityResult {
  const expectedSamples =
    pollIntervalMinutes > 0 && periodMinutes > 0
      ? Math.max(0, Math.round(periodMinutes / pollIntervalMinutes))
      : 0;
  const receivedSamples = qualityFlags.length;
  const suspectSamples = qualityFlags.filter((q) => q === "suspect").length;
  const badSamples = qualityFlags.filter((q) => q === "bad").length;
  const good = Math.max(0, receivedSamples - suspectSamples - badSamples);
  const missingSamples = Math.max(0, expectedSamples - receivedSamples);

  const driftFlags: DataQualityResult["driftFlags"] = [];
  for (const pair of redundantPairs) {
    const sorted = [...pair.samples]
      .map((s) => ({ t: Date.parse(s.ts), a: s.a, b: s.b }))
      .filter((s) => !Number.isNaN(s.t) && Number.isFinite(s.a) && Number.isFinite(s.b))
      .sort((x, y) => x.t - y.t);
    let runStart: number | null = null;
    let maxDiv = 0;
    let flagged = false;
    let flaggedHours = 0;
    for (const s of sorted) {
      const base = Math.max(Math.abs(s.a), Math.abs(s.b));
      const divPct = base === 0 ? 0 : (Math.abs(s.a - s.b) / base) * 100;
      if (divPct > DRIFT_DIVERGENCE_PCT) {
        runStart ??= s.t;
        maxDiv = Math.max(maxDiv, divPct);
        const hours = (s.t - runStart) / 3_600_000;
        if (hours > DRIFT_MIN_HOURS) {
          flagged = true;
          flaggedHours = hours;
        }
      } else {
        runStart = null;
      }
    }
    if (flagged) {
      driftFlags.push({
        label: pair.label,
        maxDivergencePct: Number(maxDiv.toFixed(2)),
        hours: Number(flaggedHours.toFixed(1)),
      });
    }
  }

  return {
    qualityPct: expectedSamples > 0 ? Number(((100 * good) / expectedSamples).toFixed(3)) : null,
    expectedSamples,
    receivedSamples,
    missingSamples,
    missingPct:
      expectedSamples > 0 ? Number(((100 * missingSamples) / expectedSamples).toFixed(3)) : null,
    suspectSamples,
    badSamples,
    driftFlags,
  };
}

/* ------------------------------------------------------------------ */
/* 6. Guarantee comparison                                              */
/* ------------------------------------------------------------------ */

export interface PpaGuaranteeTerms {
  availability_target_pct?: number | null;
  guaranteed_pr_pct?: number | null;
  annual_energy_mwh?: number | null;
}

export interface GuaranteeCheck {
  metric: "availability" | "performance_ratio" | "energy";
  label: string;
  unit: string;
  guaranteed: number;
  actual: number | null;
  margin_pct: number | null;
  breach: boolean;
}

export interface GuaranteeResult {
  status: "ok" | "no_guarantee";
  checks: GuaranteeCheck[];
}

export interface ActualsForGuarantee {
  availabilityPct: number | null;
  performanceRatioPct: number | null;
  /** actual energy for the compared period, in kWh */
  energyKwh: number | null;
  /** fraction of the guarantee year covered by the period (e.g. 1/365) */
  energyPeriodFraction?: number;
}

/**
 * compareToGuarantee — contractual comparison against ppa_terms.
 *
 *   margin_pct = actual − guaranteed (percentage points for %, % of target for energy)
 *   breach     = margin_pct < 0
 *
 * Missing or absent terms return { status: 'no_guarantee' } — the caller renders
 * an empty state rather than a fabricated pass.
 */
export function compareToGuarantee(
  actual: ActualsForGuarantee,
  terms: PpaGuaranteeTerms | null | undefined,
): GuaranteeResult {
  if (!terms) return { status: "no_guarantee", checks: [] };
  const checks: GuaranteeCheck[] = [];

  if (terms.availability_target_pct != null && Number.isFinite(terms.availability_target_pct)) {
    const guaranteed = Number(terms.availability_target_pct);
    const a = actual.availabilityPct;
    const margin = a == null ? null : Number((a - guaranteed).toFixed(3));
    checks.push({
      metric: "availability",
      label: "Availability",
      unit: "%",
      guaranteed,
      actual: a,
      margin_pct: margin,
      breach: margin != null && margin < 0,
    });
  }

  if (terms.guaranteed_pr_pct != null && Number.isFinite(terms.guaranteed_pr_pct)) {
    const guaranteed = Number(terms.guaranteed_pr_pct);
    const a = actual.performanceRatioPct;
    const margin = a == null ? null : Number((a - guaranteed).toFixed(3));
    checks.push({
      metric: "performance_ratio",
      label: "Performance ratio",
      unit: "%",
      guaranteed,
      actual: a,
      margin_pct: margin,
      breach: margin != null && margin < 0,
    });
  }

  if (terms.annual_energy_mwh != null && Number(terms.annual_energy_mwh) > 0) {
    const fraction = actual.energyPeriodFraction ?? 1;
    const guaranteed = Number((Number(terms.annual_energy_mwh) * fraction).toFixed(3));
    const a = actual.energyKwh == null ? null : Number((actual.energyKwh / 1000).toFixed(3));
    const margin =
      a == null || guaranteed <= 0 ? null : Number((((a - guaranteed) / guaranteed) * 100).toFixed(3));
    checks.push({
      metric: "energy",
      label: "Energy delivered",
      unit: "MWh",
      guaranteed,
      actual: a,
      margin_pct: margin,
      breach: margin != null && margin < 0,
    });
  }

  return checks.length === 0 ? { status: "no_guarantee", checks: [] } : { status: "ok", checks };
}

/* ------------------------------------------------------------------ */
/* 7. Expected-yield baseline                                           */
/* ------------------------------------------------------------------ */

/**
 * expectedDailyKwhFromMonthlyProfile — pro-rate a Batch 17 monthly simulation
 * profile (MWh per calendar month) to a single day.
 *
 *   expected_day_kWh = monthly_MWh × 1000 ÷ days_in_month
 *
 * Returns null when the baseline is missing.
 */
export function expectedDailyKwhFromMonthlyProfile(
  monthlyMwh: Array<number | null> | null | undefined,
  day: Date,
): number | null {
  if (!monthlyMwh || monthlyMwh.length < 12) return null;
  const value = monthlyMwh[day.getUTCMonth()];
  if (value == null || !Number.isFinite(value)) return null;
  const daysInMonth = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
  return Number(((Number(value) * 1000) / daysInMonth).toFixed(3));
}

/* ------------------------------------------------------------------ */
/* 8. Asset performance ranking                                         */
/* ------------------------------------------------------------------ */

export interface AssetEnergyInput {
  assetId: string;
  name: string;
  actualKwh: number;
  expectedKwh: number | null;
}

export interface AssetPerformanceRow extends AssetEnergyInput {
  ratioPct: number | null;
}

/** rank assets by actual ÷ expected × 100 (null-safe; unranked when no baseline). */
export function rankAssetPerformance(assets: AssetEnergyInput[]): {
  rows: AssetPerformanceRow[];
  top: AssetPerformanceRow[];
  bottom: AssetPerformanceRow[];
} {
  const rows: AssetPerformanceRow[] = assets.map((a) => ({
    ...a,
    ratioPct:
      a.expectedKwh != null && a.expectedKwh > 0
        ? Number(((a.actualKwh / a.expectedKwh) * 100).toFixed(2))
        : null,
  }));
  const ranked = rows.filter((r) => r.ratioPct != null).sort((a, b) => b.ratioPct! - a.ratioPct!);
  return { rows, top: ranked.slice(0, 5), bottom: ranked.slice(-5).reverse() };
}
