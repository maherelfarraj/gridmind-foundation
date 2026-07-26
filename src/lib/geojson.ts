// P-162 — Minimal GeoJSON validation + IO. Pure module (no DOM, no network).
import type { GeoJsonGeometry, Vertex } from "@/lib/civil/geom";

export type GeoJsonFeature = {
  type: "Feature";
  geometry: GeoJsonGeometry;
  properties: Record<string, unknown> | null;
};

export type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
};

const GEOMETRY_TYPES = [
  "Point",
  "LineString",
  "Polygon",
  "MultiPoint",
  "MultiLineString",
  "MultiPolygon",
];

function isPosition(value: unknown): value is Vertex {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(Number(value[0])) &&
    Number.isFinite(Number(value[1]))
  );
}

function isPositionArray(value: unknown, depth: number): boolean {
  if (depth === 0) return isPosition(value);
  return (
    Array.isArray(value) && value.length > 0 && value.every((v) => isPositionArray(v, depth - 1))
  );
}

export function isValidGeometry(value: unknown): value is GeoJsonGeometry {
  if (!value || typeof value !== "object") return false;
  const geom = value as { type?: unknown; coordinates?: unknown };
  if (typeof geom.type !== "string" || !GEOMETRY_TYPES.includes(geom.type)) return false;
  switch (geom.type) {
    case "Point":
      return isPositionArray(geom.coordinates, 0);
    case "MultiPoint":
    case "LineString":
      return isPositionArray(geom.coordinates, 1);
    case "MultiLineString":
    case "Polygon":
      return isPositionArray(geom.coordinates, 2);
    case "MultiPolygon":
      return isPositionArray(geom.coordinates, 3);
    default:
      return false;
  }
}

/**
 * Accepts a FeatureCollection, a single Feature or a bare geometry and reports
 * whether it is structurally valid GeoJSON we can import.
 */
export function isValidGeoJSON(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const doc = value as { type?: unknown; features?: unknown; geometry?: unknown };
  if (doc.type === "FeatureCollection") {
    return (
      Array.isArray(doc.features) &&
      doc.features.every(
        (f) =>
          !!f &&
          typeof f === "object" &&
          (f as { type?: unknown }).type === "Feature" &&
          isValidGeometry((f as { geometry?: unknown }).geometry),
      )
    );
  }
  if (doc.type === "Feature") return isValidGeometry(doc.geometry);
  return isValidGeometry(value);
}

export class GeoJsonError extends Error {}

/** Normalise any accepted GeoJSON shape into a FeatureCollection. */
export function toFeatureCollection(value: unknown): GeoJsonFeatureCollection {
  if (!isValidGeoJSON(value)) throw new GeoJsonError("Not a valid GeoJSON document.");
  const doc = value as Record<string, unknown>;
  if (doc.type === "FeatureCollection") {
    return {
      type: "FeatureCollection",
      features: (doc.features as GeoJsonFeature[]).map((f) => ({
        type: "Feature",
        geometry: f.geometry,
        properties: (f.properties ?? {}) as Record<string, unknown>,
      })),
    };
  }
  if (doc.type === "Feature") {
    const f = value as GeoJsonFeature;
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: f.geometry,
          properties: (f.properties ?? {}) as Record<string, unknown>,
        },
      ],
    };
  }
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: value as GeoJsonGeometry, properties: {} }],
  };
}

export function parseGeoJSON(text: string): GeoJsonFeatureCollection {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GeoJsonError("File is not valid JSON.");
  }
  return toFeatureCollection(parsed);
}

export function buildFeatureCollection(
  features: Array<{ geometry: GeoJsonGeometry; properties: Record<string, unknown> }>,
): GeoJsonFeatureCollection {
  return {
    type: "FeatureCollection",
    features: features.map((f) => ({
      type: "Feature",
      geometry: f.geometry,
      properties: f.properties,
    })),
  };
}

export function featureKind(feature: GeoJsonFeature): string {
  const raw = (feature.properties ?? {}) as Record<string, unknown>;
  const kind = raw.kind ?? raw.feature_type ?? raw.type;
  return typeof kind === "string" && kind.trim() ? kind.trim() : "(unspecified)";
}

/** Distinct `properties.kind` values, used to drive the import mapping dialog. */
export function collectKinds(collection: GeoJsonFeatureCollection): string[] {
  return [...new Set(collection.features.map(featureKind))].sort();
}
