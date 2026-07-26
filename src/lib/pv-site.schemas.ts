// P-151 — Zod schemas + shared types for PV site configurations.
import { z } from "zod";

import { closeRing, ringSelfIntersects, type Ring } from "@/lib/pv-site.geo";

export const PV_WEATHER_SOURCES = [
  "typical_year",
  "pvgis",
  "nasa_power",
  "meteonorm",
  "solargis",
  "custom_tmy",
] as const;
export type PvWeatherSource = (typeof PV_WEATHER_SOURCES)[number];

export const PV_WEATHER_SOURCE_LABELS: Record<PvWeatherSource, string> = {
  typical_year: "Typical year (demo set)",
  pvgis: "PVGIS",
  nasa_power: "NASA POWER",
  meteonorm: "Meteonorm",
  solargis: "Solargis",
  custom_tmy: "Custom upload (TMY)",
};

export const PV_SITE_STATUSES = ["draft", "active", "approved", "superseded"] as const;
export type PvSiteStatus = (typeof PV_SITE_STATUSES)[number];

export const MOUNTING_TYPES = ["fixed_tilt", "single_axis_tracker"] as const;
export type MountingType = (typeof MOUNTING_TYPES)[number];

const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

export const ringSchema = z
  .array(position)
  .min(4, "A polygon needs at least 4 positions (closed ring).")
  .superRefine((ring, ctx) => {
    const closed = closeRing(ring as Ring);
    const first = closed[0];
    const last = closed[closed.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ctx.addIssue({ code: "custom", message: "Ring must be closed." });
    }
    if (closed.length < 4) {
      ctx.addIssue({ code: "custom", message: "A polygon needs at least 3 distinct vertices." });
    }
    if (ringSelfIntersects(closed)) {
      ctx.addIssue({ code: "custom", message: "Polygon edges must not cross each other." });
    }
  });

export const polygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(ringSchema).min(1),
});
export type PvPolygon = z.infer<typeof polygonSchema>;

export const emptyPolygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(position)).max(0),
});

/** Boundary is either a valid polygon or the "not drawn yet" empty shape. */
export const boundarySchema = z.union([polygonSchema, emptyPolygonSchema]);
export type PvBoundary = z.infer<typeof boundarySchema>;

export const EXCLUSION_REASONS = [
  "watercourse",
  "wadi",
  "archaeology",
  "setback",
  "access_road",
  "substation",
  "terrain",
  "environmental",
  "other",
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export const EXCLUSION_REASON_LABELS: Record<ExclusionReason, string> = {
  watercourse: "Watercourse",
  wadi: "Wadi / flood path",
  archaeology: "Archaeology",
  setback: "Boundary setback",
  access_road: "Access road",
  substation: "Substation / BOP",
  terrain: "Terrain / slope",
  environmental: "Environmental",
  other: "Other",
};

export const exclusionSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  reason: z.enum(EXCLUSION_REASONS),
  notes: z.string().trim().max(500).nullable().optional(),
  polygon: polygonSchema,
});
export type PvExclusion = z.infer<typeof exclusionSchema>;

export const soilingSchema = z
  .array(z.number().min(0, "0–30% only").max(30, "0–30% only"))
  .length(12, "Provide exactly 12 monthly soiling values.");

export const weatherMetaSchema = z.object({
  dataset_label: z.string().trim().max(160).nullable().optional(),
  source_file: z.string().trim().max(500).nullable().optional(),
  ghi_kwh_m2_yr: z.number().min(0).max(3500).nullable().optional(),
  avg_ambient_c: z.number().min(-40).max(60).nullable().optional(),
  avg_wind_ms: z.number().min(0).max(40).nullable().optional(),
  soiling_monthly_pct: soilingSchema,
  north_offset_deg: z.number().min(-180).max(180),
  grid: z.object({
    max_export_kw: z.number().min(0).max(5_000_000).nullable().optional(),
    poi_voltage_kv: z.number().min(0).max(1000).nullable().optional(),
    curtailment_pct: z.number().min(0).max(100).nullable().optional(),
  }),
  targets: z.object({
    target_dc_kwp: z.number().min(0).max(10_000_000).nullable().optional(),
    target_ac_kwp: z.number().min(0).max(10_000_000).nullable().optional(),
    mounting_type: z.enum(MOUNTING_TYPES),
    tilt_deg: z.number().min(0).max(90).nullable().optional(),
    azimuth_deg: z.number().min(0).max(360).nullable().optional(),
    axis_azimuth_deg: z.number().min(0).max(360).nullable().optional(),
    rotation_limit_deg: z.number().min(0).max(90).nullable().optional(),
    backtracking: z.boolean(),
  }),
  terrain: z.object({
    source: z.string().trim().max(160).nullable().optional(),
    surface_id: z.string().trim().max(160).nullable().optional(),
    crs: z.string().trim().max(60).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  }),
});
export type PvWeatherMeta = z.infer<typeof weatherMetaSchema>;

export const pvSiteConfigSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  altitude_m: z.number().min(-500).max(9000).nullable().optional(),
  timezone: z.string().trim().max(60).nullable().optional(),
  terrain_slope_pct: z.number().min(0).max(100).nullable().optional(),
  terrain_azimuth_deg: z.number().min(0).max(360).nullable().optional(),
  albedo: z.number().min(0.05, "Albedo must be 0.05–0.9").max(0.9, "Albedo must be 0.05–0.9"),
  weather_source: z.enum(PV_WEATHER_SOURCES),
  weather_meta: weatherMetaSchema,
  boundary: boundarySchema,
  exclusions: z.array(exclusionSchema).max(60),
  usable_area_ha: z.number().min(0).nullable().optional(),
});
export type PvSiteConfigInput = z.infer<typeof pvSiteConfigSchema>;

export interface PvSiteConfigRow {
  id: string;
  company_id: string;
  project_id: string;
  name: string;
  status: PvSiteStatus;
  latitude: number | null;
  longitude: number | null;
  altitude_m: number | null;
  timezone: string | null;
  terrain_slope_pct: number | null;
  terrain_azimuth_deg: number | null;
  albedo: number;
  weather_source: PvWeatherSource;
  weather_meta: PvWeatherMeta;
  boundary: PvBoundary;
  exclusions: PvExclusion[];
  usable_area_ha: number | null;
  created_at: string;
  updated_at: string;
}

export function defaultWeatherMeta(): PvWeatherMeta {
  return {
    dataset_label: null,
    source_file: null,
    ghi_kwh_m2_yr: null,
    avg_ambient_c: null,
    avg_wind_ms: null,
    soiling_monthly_pct: Array.from({ length: 12 }, () => 2),
    north_offset_deg: 0,
    grid: { max_export_kw: null, poi_voltage_kv: null, curtailment_pct: null },
    targets: {
      target_dc_kwp: null,
      target_ac_kwp: null,
      mounting_type: "fixed_tilt",
      tilt_deg: 25,
      azimuth_deg: 180,
      axis_azimuth_deg: 0,
      rotation_limit_deg: 55,
      backtracking: true,
    },
    terrain: { source: null, surface_id: null, crs: "EPSG:4326", notes: null },
  };
}

export const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
