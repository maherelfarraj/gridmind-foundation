// P-103 — Pure helpers for the SCADA telemetry ingestion hook.
// Extracted so the route file stays thin and unit-testable.
import { z } from "zod";

export const TELEMETRY_METRICS = [
  "ac_power_kw",
  "dc_power_kw",
  "energy_kwh",
  "irradiance_wm2",
  "ambient_temp_c",
  "module_temp_c",
  "wind_speed_ms",
  "soc_pct",
] as const;

export type TelemetryMetric = (typeof TELEMETRY_METRICS)[number];

export const TELEMETRY_QUALITIES = ["good", "suspect", "bad"] as const;

export const MAX_READINGS_PER_REQUEST = 1000;
export const INSERT_CHUNK_SIZE = 500;
export const MAX_ERROR_DETAILS = 20;

export const readingSchema = z.object({
  asset_key: z.string().trim().min(1).max(128),
  ts: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "ts must be ISO 8601"),
  metric: z.enum(TELEMETRY_METRICS),
  value: z.number().finite(),
  quality: z.enum(TELEMETRY_QUALITIES).optional(),
});

export const ingestBodySchema = z.object({
  readings: z
    .array(readingSchema)
    .min(1, "readings must not be empty")
    .max(MAX_READINGS_PER_REQUEST, "too_many_readings"),
});

export type Reading = z.infer<typeof readingSchema>;
export type IngestBody = z.infer<typeof ingestBodySchema>;

export interface AssetLookup {
  scada_asset_id: string;
  project_id: string;
}

export interface RejectedReading {
  index: number;
  asset_key: string;
  reason: string;
}

export interface FilterResult {
  accepted: Array<Reading & AssetLookup>;
  rejected: RejectedReading[];
}

/**
 * Filter readings against the caller's company asset map. Any reading whose
 * asset_key is not present in the map is rejected — this is how we prevent
 * cross-company writes even before the full guardPublicHook lands.
 */
export function filterReadingsByAsset(
  readings: Reading[],
  assetMap: ReadonlyMap<string, AssetLookup>,
): FilterResult {
  const accepted: FilterResult["accepted"] = [];
  const rejected: RejectedReading[] = [];
  readings.forEach((r, index) => {
    const hit = assetMap.get(r.asset_key);
    if (!hit) {
      if (rejected.length < MAX_ERROR_DETAILS) {
        rejected.push({
          index,
          asset_key: r.asset_key,
          reason: "unknown_asset_or_cross_company",
        });
      } else {
        rejected.push({ index, asset_key: r.asset_key, reason: "unknown_asset_or_cross_company" });
      }
      return;
    }
    accepted.push({ ...r, ...hit });
  });
  return { accepted, rejected };
}

export function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
