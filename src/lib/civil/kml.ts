// P-162 — KML 2.2 parsing and writing without a GIS dependency.
// Parsing uses DOMParser (browser + jsdom); writing is pure string building.
import { CIVIL_TYPE_SPECS, type CivilFeatureType } from "@/lib/civil/feature-types";
import type { GeoJsonGeometry, Vertex } from "@/lib/civil/geom";
import { toLngLat, toLocalMeters, type LngLat } from "@/lib/pv-site.geo";

export class KmlError extends Error {}

export type KmlPlacemark = {
  name: string;
  description: string | null;
  /** geometry in lon/lat degrees */
  geometry: GeoJsonGeometry;
};

function parseCoordinateBlock(text: string): Vertex[] {
  const out: Vertex[] = [];
  for (const chunk of text.trim().split(/\s+/)) {
    if (!chunk) continue;
    const parts = chunk.split(",");
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    out.push([lon, lat]);
  }
  return out;
}

type DomParserLike = { parseFromString: (text: string, type: string) => Document };

function resolveParser(parser?: DomParserLike): DomParserLike {
  if (parser) return parser;
  const Ctor = (globalThis as { DOMParser?: new () => DomParserLike }).DOMParser;
  if (!Ctor) throw new KmlError("KML parsing is only available in the browser.");
  return new Ctor();
}

function textOf(el: Element | null): string | null {
  const value = el?.textContent?.trim();
  return value ? value : null;
}

/** Parse a KML document into placemarks with lon/lat geometry. */
export function parseKml(text: string, parser?: DomParserLike): KmlPlacemark[] {
  const doc = resolveParser(parser).parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new KmlError("File is not valid XML/KML.");
  }
  const placemarks = Array.from(doc.getElementsByTagName("Placemark"));
  if (placemarks.length === 0) throw new KmlError("No <Placemark> elements found in this KML.");

  const out: KmlPlacemark[] = [];
  for (const pm of placemarks) {
    const name = textOf(pm.getElementsByTagName("name")[0] ?? null) ?? "Imported feature";
    const description = textOf(pm.getElementsByTagName("description")[0] ?? null);

    const point = pm.getElementsByTagName("Point")[0];
    const line = pm.getElementsByTagName("LineString")[0];
    const polygon = pm.getElementsByTagName("Polygon")[0];

    if (point) {
      const coords = parseCoordinateBlock(
        textOf(point.getElementsByTagName("coordinates")[0] ?? null) ?? "",
      );
      if (coords.length) {
        out.push({ name, description, geometry: { type: "Point", coordinates: coords[0] } });
      }
      continue;
    }
    if (line) {
      const coords = parseCoordinateBlock(
        textOf(line.getElementsByTagName("coordinates")[0] ?? null) ?? "",
      );
      if (coords.length >= 2) {
        out.push({ name, description, geometry: { type: "LineString", coordinates: coords } });
      }
      continue;
    }
    if (polygon) {
      const outer = polygon.getElementsByTagName("outerBoundaryIs")[0];
      const inners = Array.from(polygon.getElementsByTagName("innerBoundaryIs"));
      const ringOf = (el: Element | undefined) =>
        el
          ? parseCoordinateBlock(
              textOf(
                (el.getElementsByTagName("LinearRing")[0] ?? el).getElementsByTagName(
                  "coordinates",
                )[0] ?? null,
              ) ?? "",
            )
          : [];
      const rings = [ringOf(outer), ...inners.map((i) => ringOf(i))].filter((r) => r.length >= 3);
      if (rings.length) {
        out.push({ name, description, geometry: { type: "Polygon", coordinates: rings } });
      }
    }
  }
  if (out.length === 0) throw new KmlError("No supported Point, LineString or Polygon geometry.");
  return out;
}

/** Apply a coordinate transform to every position of a geometry. */
export function mapGeometryCoordinates(
  geometry: GeoJsonGeometry,
  fn: (v: Vertex) => Vertex,
): GeoJsonGeometry {
  const walk = (value: unknown, depth: number): unknown => {
    if (depth === 0) return fn(value as Vertex);
    return (value as unknown[]).map((v) => walk(v, depth - 1));
  };
  const depth =
    geometry.type === "Point"
      ? 0
      : geometry.type === "LineString" || geometry.type === "MultiPoint"
        ? 1
        : geometry.type === "Polygon" || geometry.type === "MultiLineString"
          ? 2
          : 3;
  return { type: geometry.type, coordinates: walk(geometry.coordinates, depth) as never };
}

export function geometryToLocal(geometry: GeoJsonGeometry, anchor: LngLat): GeoJsonGeometry {
  return mapGeometryCoordinates(geometry, ([lng, lat]) => {
    const p = toLocalMeters({ lng, lat }, anchor);
    return [p.x, p.y];
  });
}

export function geometryToLngLat(geometry: GeoJsonGeometry, anchor: LngLat): GeoJsonGeometry {
  return mapGeometryCoordinates(geometry, ([x, y]) => {
    const p = toLngLat({ x, y }, anchor);
    return [p.lng, p.lat];
  });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function coordString(coords: Vertex[]): string {
  return coords.map(([lng, lat]) => `${lng.toFixed(8)},${lat.toFixed(8)},0`).join(" ");
}

/**
 * KML colours are aabbggrr. Callers pass resolved rgb values read from theme
 * tokens (never literals in component code).
 */
export type KmlStyle = { id: string; colorAabbggrr: string; width: number };

export const DEFAULT_KML_STYLES: Record<CivilFeatureType, KmlStyle> = {
  grading_zone: { id: "grading_zone", colorAabbggrr: "7d1e9ecf", width: 2 },
  flood_risk_zone: { id: "flood_risk_zone", colorAabbggrr: "7ddd9a3c", width: 2 },
  equipment_platform: { id: "equipment_platform", colorAabbggrr: "7d8f8f8f", width: 2 },
  laydown_area: { id: "laydown_area", colorAabbggrr: "7d63c6b0", width: 2 },
  construction_compound: { id: "construction_compound", colorAabbggrr: "7dc9a06a", width: 2 },
  drainage_path: { id: "drainage_path", colorAabbggrr: "ffd4863c", width: 3 },
  road_alignment: { id: "road_alignment", colorAabbggrr: "ff4b4bd4", width: 4 },
  trench_route: { id: "trench_route", colorAabbggrr: "ff30a0e0", width: 3 },
  fence_line: { id: "fence_line", colorAabbggrr: "ff7a7a7a", width: 2 },
  crane_access: { id: "crane_access", colorAabbggrr: "ff2fb5d2", width: 3 },
  emergency_access: { id: "emergency_access", colorAabbggrr: "ff3c3ce0", width: 3 },
  gate: { id: "gate", colorAabbggrr: "ff58d68d", width: 2 },
};

export type KmlExportFeature = {
  feature_ref: string;
  name: string;
  feature_type: string;
  status: string;
  revision_code: string;
  /** geometry already in lon/lat degrees */
  geometry: GeoJsonGeometry;
  properties?: Record<string, unknown>;
};

function geometryXml(geometry: GeoJsonGeometry): string {
  switch (geometry.type) {
    case "Point":
      return `<Point><coordinates>${coordString([geometry.coordinates as Vertex])}</coordinates></Point>`;
    case "LineString":
      return `<LineString><tessellate>1</tessellate><coordinates>${coordString(
        geometry.coordinates as Vertex[],
      )}</coordinates></LineString>`;
    case "Polygon": {
      const rings = geometry.coordinates as Vertex[][];
      const ring = (r: Vertex[]) => {
        const closed =
          r.length > 2 && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])
            ? [...r, r[0]]
            : r;
        return `<LinearRing><coordinates>${coordString(closed)}</coordinates></LinearRing>`;
      };
      const outer = `<outerBoundaryIs>${ring(rings[0] ?? [])}</outerBoundaryIs>`;
      const inner = rings
        .slice(1)
        .map((r) => `<innerBoundaryIs>${ring(r)}</innerBoundaryIs>`)
        .join("");
      return `<Polygon><tessellate>1</tessellate>${outer}${inner}</Polygon>`;
    }
    default:
      return "";
  }
}

export function buildKml(
  features: KmlExportFeature[],
  options: { documentName?: string; styles?: Record<string, KmlStyle> } = {},
): string {
  const styles = { ...DEFAULT_KML_STYLES, ...(options.styles ?? {}) };
  const used = [...new Set(features.map((f) => f.feature_type))].filter((t) => t in styles);
  const styleXml = used
    .map((t) => {
      const s = styles[t as CivilFeatureType];
      return `<Style id="${escapeXml(s.id)}"><LineStyle><color>${s.colorAabbggrr}</color><width>${s.width}</width></LineStyle><PolyStyle><color>${s.colorAabbggrr}</color></PolyStyle><IconStyle><color>${s.colorAabbggrr}</color></IconStyle></Style>`;
    })
    .join("");

  const placemarks = features
    .map((f) => {
      const label = CIVIL_TYPE_SPECS[f.feature_type as CivilFeatureType]?.label ?? f.feature_type;
      const desc = [
        `Type: ${label}`,
        `Status: ${f.status}`,
        `Revision: ${f.revision_code}`,
        ...Object.entries(f.properties ?? {})
          .filter(([k]) => k !== "analysis")
          .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`),
      ].join("\n");
      return `<Placemark><name>${escapeXml(`${f.feature_ref} ${f.name}`)}</name><description>${escapeXml(
        desc,
      )}</description><styleUrl>#${escapeXml(f.feature_type)}</styleUrl>${geometryXml(f.geometry)}</Placemark>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${escapeXml(
    options.documentName ?? "Civil features",
  )}</name>${styleXml}${placemarks}</Document></kml>`;
}
