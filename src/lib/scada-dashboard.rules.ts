// P-104 — Pure helpers for the live SCADA dashboard. Kept out of
// *.functions.ts so tests can import without server-fn transforms.
import { z } from "zod";

export const getScadaDashboardInput = z.object({
  projectId: z.string().uuid().optional(),
});
export type GetScadaDashboardInput = z.infer<typeof getScadaDashboardInput>;

export const getPlantDetailInput = z.object({
  projectId: z.string().uuid(),
});
export type GetPlantDetailInput = z.infer<typeof getPlantDetailInput>;

export interface TelemetryRow {
  scada_asset_id: string;
  ts: string; // ISO
  metric: string;
  value: number;
}

// ---- Rules ----------------------------------------------------------------

/** Latest value per (asset, metric) — assumes rows are unsorted. */
export function latestPerAsset(
  rows: TelemetryRow[],
  metric: string,
): Map<string, { ts: string; value: number }> {
  const out = new Map<string, { ts: string; value: number }>();
  for (const r of rows) {
    if (r.metric !== metric) continue;
    const existing = out.get(r.scada_asset_id);
    if (!existing || existing.ts < r.ts) {
      out.set(r.scada_asset_id, { ts: r.ts, value: Number(r.value) });
    }
  }
  return out;
}

/**
 * Sum of energy delta per asset since the given start time.
 * energy_kwh is a monotonic counter → delta = max − min in the window.
 * When only a single reading exists we return 0 for that asset.
 */
export function energyDelta(rows: TelemetryRow[], sinceIso: string): number {
  const perAsset = new Map<string, { min: number; max: number }>();
  for (const r of rows) {
    if (r.metric !== "energy_kwh") continue;
    if (r.ts < sinceIso) continue;
    const v = Number(r.value);
    const existing = perAsset.get(r.scada_asset_id);
    if (!existing) perAsset.set(r.scada_asset_id, { min: v, max: v });
    else {
      if (v < existing.min) existing.min = v;
      if (v > existing.max) existing.max = v;
    }
  }
  let total = 0;
  for (const { min, max } of perAsset.values()) total += Math.max(0, max - min);
  return total;
}

export interface PowerCurvePoint {
  bucket: string; // ISO bucket start
  ac_power_kw: number;
  irradiance_wm2: number | null;
}

/** 5-minute buckets: sum of ac_power_kw per bucket, mean irradiance per bucket. */
export function bucketPowerCurve(
  rows: TelemetryRow[],
  minutes = 5,
): PowerCurvePoint[] {
  const bucketMs = minutes * 60 * 1000;
  interface Agg {
    powerByAsset: Map<string, number>; // latest ac_power_kw per asset in bucket
    irrSum: number;
    irrCount: number;
  }
  const buckets = new Map<number, Agg>();

  for (const r of rows) {
    const t = new Date(r.ts).getTime();
    if (Number.isNaN(t)) continue;
    const bucket = Math.floor(t / bucketMs) * bucketMs;
    let agg = buckets.get(bucket);
    if (!agg) {
      agg = { powerByAsset: new Map(), irrSum: 0, irrCount: 0 };
      buckets.set(bucket, agg);
    }
    const v = Number(r.value);
    if (r.metric === "ac_power_kw") {
      // Use the last value seen for each asset in this bucket (5-min).
      agg.powerByAsset.set(r.scada_asset_id, v);
    } else if (r.metric === "irradiance_wm2") {
      agg.irrSum += v;
      agg.irrCount += 1;
    }
  }

  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, agg]) => {
      let power = 0;
      for (const v of agg.powerByAsset.values()) power += v;
      return {
        bucket: new Date(bucket).toISOString(),
        ac_power_kw: Number(power.toFixed(2)),
        irradiance_wm2:
          agg.irrCount > 0 ? Number((agg.irrSum / agg.irrCount).toFixed(1)) : null,
      };
    });
}

/**
 * Performance ratio %.
 * expected_kwh = Σ(irradiance_wm2 × Δt_h) / 1000 × nameplate_kw
 * Returns null when there is no irradiance data or no nameplate capacity.
 */
export function performanceRatio(input: {
  actualKwh: number;
  irradianceSeries: { ts: string; value: number }[];
  nameplateKw: number;
}): number | null {
  const { actualKwh, irradianceSeries, nameplateKw } = input;
  if (!nameplateKw || nameplateKw <= 0) return null;
  if (irradianceSeries.length < 2) return null;
  const sorted = [...irradianceSeries].sort((a, b) => a.ts.localeCompare(b.ts));
  let sumWhPerM2 = 0;
  for (let i = 1; i < sorted.length; i++) {
    const dtHours =
      (new Date(sorted[i]!.ts).getTime() - new Date(sorted[i - 1]!.ts).getTime()) /
      3_600_000;
    if (dtHours <= 0 || dtHours > 1) continue; // guard huge gaps
    const meanIrr = (sorted[i]!.value + sorted[i - 1]!.value) / 2;
    sumWhPerM2 += meanIrr * dtHours;
  }
  const expectedKwh = (sumWhPerM2 / 1000) * nameplateKw;
  if (expectedKwh <= 0) return null;
  return Number(((actualKwh / expectedKwh) * 100).toFixed(1));
}

export type AvailabilityTier = "excellent" | "warning" | "critical" | "unknown";

export function plantAvailabilityBadge(pct: number | null): AvailabilityTier {
  if (pct == null || Number.isNaN(pct)) return "unknown";
  if (pct >= 99) return "excellent";
  if (pct >= 97) return "warning";
  return "critical";
}

export function isStale(lastSeen: string | null, minutes = 15): boolean {
  if (!lastSeen) return true;
  const age = Date.now() - new Date(lastSeen).getTime();
  return age > minutes * 60 * 1000;
}

/** UTC midnight for "today", used as the energy-today window start. */
export function utcMidnightIso(now = new Date()): string {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

// ---- Payload shape --------------------------------------------------------

export interface KpiTiles {
  fleetPowerKw: number;
  energyTodayKwh: number;
  availabilityPct: number | null; // null → "—" until P-105/P-106
  performanceRatioPct: number | null; // null → "insufficient data"
  activeAlarms: { critical: number; major: number; total: number } | null;
}

export interface PlantRow {
  projectId: string;
  name: string;
  capacityMw: number;
  currentPowerKw: number;
  todayEnergyKwh: number;
  availabilityPct: number | null;
  activeAlarms: number;
  lastSeenAt: string | null;
  stale: boolean;
}

export interface DashboardPayload {
  scope: { projectId: string | null };
  tiles: KpiTiles;
  powerCurve: PowerCurvePoint[];
  plants: PlantRow[];
  weatherAvailable: boolean;
  windowStart: string;
  windowEnd: string;
}

export interface PlantDetailPayload extends DashboardPayload {
  plant: PlantRow | null;
  perInverter: {
    assetId: string;
    name: string;
    currentKw: number;
    todayKwh: number;
    lastSeen: string | null;
  }[];
}
