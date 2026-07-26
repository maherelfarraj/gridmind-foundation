/**
 * P-174 — Pure helpers for the multi-tag time-series explorer.
 * No React / Supabase imports.
 */
import { z } from "zod";

export const MAX_TREND_TAGS = 6;

export const RANGE_PRESETS = ["24h", "7d", "30d", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export type BucketWidth = "5m" | "1h" | "1d";

export const BUCKET_MS: Record<BucketWidth, number> = {
  "5m": 5 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

/** Auto bucket width: 5 min ≤ 24 h, 1 h ≤ 7 d, else 1 day. */
export function pickBucketWidth(fromIso: string, toIso: string): BucketWidth {
  const span = Math.max(0, Date.parse(toIso) - Date.parse(fromIso));
  if (span <= 24 * 60 * 60_000 + 60_000) return "5m";
  if (span <= 7 * 24 * 60 * 60_000 + 60_000) return "1h";
  return "1d";
}

export function presetRange(preset: Exclude<RangePreset, "custom">, now = new Date()) {
  const days = preset === "24h" ? 1 : preset === "7d" ? 7 : 30;
  return {
    from: new Date(now.getTime() - days * 24 * 60 * 60_000).toISOString(),
    to: now.toISOString(),
  };
}

export const trendQuerySchema = z
  .object({
    tagIds: z.array(z.string().uuid()).min(1).max(MAX_TREND_TAGS),
    from: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "from must be ISO 8601"),
    to: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "to must be ISO 8601"),
  })
  .refine((v) => Date.parse(v.to) > Date.parse(v.from), {
    message: "to must be after from",
    path: ["to"],
  });
export type TrendQuery = z.infer<typeof trendQuerySchema>;

export interface RawSample {
  ts: string;
  /** Raw (unscaled) source value. */
  value: number;
  quality: string | null;
}

export interface TagScaling {
  scaling_factor: number | null;
  scaling_offset: number | null;
}

/** raw → engineering units. Missing factors behave as identity. */
export function scaleValue(raw: number, tag: TagScaling): number {
  const factor = tag.scaling_factor == null ? 1 : Number(tag.scaling_factor);
  const offset = tag.scaling_offset == null ? 0 : Number(tag.scaling_offset);
  return raw * factor + offset;
}

export interface BucketPoint {
  /** Bucket start, ISO. */
  t: string;
  value: number;
  /** True when any contributing sample was flagged `suspect`. */
  suspect: boolean;
}

export interface BucketResult {
  points: BucketPoint[];
  /** Samples excluded because quality was `bad`. */
  badCount: number;
}

/**
 * Bucketize + scale a single tag's samples. `bad` quality is excluded (counted),
 * `suspect` marks the bucket for dimmed rendering.
 */
export function bucketizeTag(
  samples: RawSample[],
  tag: TagScaling,
  bucket: BucketWidth,
): BucketResult {
  const width = BUCKET_MS[bucket];
  const acc = new Map<number, { sum: number; n: number; suspect: boolean }>();
  let badCount = 0;
  for (const s of samples) {
    const q = (s.quality ?? "good").toLowerCase();
    if (q === "bad") {
      badCount += 1;
      continue;
    }
    const ms = Date.parse(s.ts);
    if (Number.isNaN(ms)) continue;
    const key = Math.floor(ms / width) * width;
    const cur = acc.get(key) ?? { sum: 0, n: 0, suspect: false };
    cur.sum += scaleValue(Number(s.value), tag);
    cur.n += 1;
    if (q === "suspect") cur.suspect = true;
    acc.set(key, cur);
  }
  const points = Array.from(acc, ([key, v]) => ({
    t: new Date(key).toISOString(),
    value: Number((v.sum / v.n).toFixed(4)),
    suspect: v.suspect,
  })).sort((a, b) => a.t.localeCompare(b.t));
  return { points, badCount };
}

export interface TrendSeries {
  tagId: string;
  tag: string;
  metric: string;
  unit: string | null;
  nodeName: string | null;
  axis: "left" | "right";
  points: BucketPoint[];
  badCount: number;
}

/** Merge series into Recharts rows keyed by bucket timestamp. */
export function mergeSeriesForChart(series: TrendSeries[]): Record<string, number | string>[] {
  const rows = new Map<string, Record<string, number | string>>();
  for (const s of series) {
    for (const p of s.points) {
      const row = rows.get(p.t) ?? { t: p.t };
      row[s.tagId] = p.value;
      rows.set(p.t, row);
    }
  }
  return Array.from(rows.values()).sort((a, b) => String(a.t).localeCompare(String(b.t)));
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** Long-format CSV: timestamp,tag,metric,unit,value,quality. */
export function buildTrendCsv(series: TrendSeries[]): string {
  const lines = ["timestamp,tag,metric,unit,value,quality"];
  for (const s of series) {
    for (const p of s.points) {
      lines.push(
        [p.t, s.tag, s.metric, s.unit ?? "", p.value, p.suspect ? "suspect" : "good"]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return lines.join("\n");
}

/** Deterministic axis assignment: first unit → left, second distinct unit → right. */
export function assignAxes(units: (string | null)[]): ("left" | "right")[] {
  const seen: string[] = [];
  return units.map((u) => {
    const key = u ?? "";
    if (!seen.includes(key)) seen.push(key);
    return seen.indexOf(key) === 0 ? "left" : "right";
  });
}
