// P-161 — Coordinate schedule rows + CSV serialization. Pure module.
import { geometryVertexLists, roundTo, type GeoJsonGeometry } from "@/lib/civil/geom";

export type ScheduleFeature = {
  feature_ref: string;
  name: string;
  feature_type: string;
  geometry: GeoJsonGeometry;
  status?: string | null;
};

export type CoordinateScheduleRow = {
  feature_ref: string;
  name: string;
  type: string;
  part: number;
  vertex: number;
  easting: number;
  northing: number;
  elevation_m: number | null;
};

export type ElevationSampler = (easting: number, northing: number) => number | null;

export function buildCoordinateSchedule(
  features: ScheduleFeature[],
  sampleElevationAt?: ElevationSampler,
): CoordinateScheduleRow[] {
  const rows: CoordinateScheduleRow[] = [];
  for (const feature of features) {
    const parts = geometryVertexLists(feature.geometry);
    parts.forEach((part, partIndex) => {
      part.forEach(([e, n], vertexIndex) => {
        const z = sampleElevationAt ? sampleElevationAt(e, n) : null;
        rows.push({
          feature_ref: feature.feature_ref,
          name: feature.name,
          type: feature.feature_type,
          part: partIndex + 1,
          vertex: vertexIndex + 1,
          easting: roundTo(e, 3),
          northing: roundTo(n, 3),
          elevation_m: z == null ? null : roundTo(z, 3),
        });
      });
    });
  }
  return rows;
}

const HEADERS = [
  "feature_ref",
  "name",
  "type",
  "part",
  "vertex",
  "easting",
  "northing",
  "elevation_m",
] as const;

function csvCell(value: string | number | null): string {
  if (value == null) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function coordinateScheduleToCsv(rows: CoordinateScheduleRow[]): string {
  const lines = [HEADERS.join(",")];
  for (const row of rows) {
    lines.push(HEADERS.map((h) => csvCell(row[h] as string | number | null)).join(","));
  }
  return `${lines.join("\n")}\n`;
}
