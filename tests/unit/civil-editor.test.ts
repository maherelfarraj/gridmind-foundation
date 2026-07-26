// @vitest-environment jsdom
// P-162 — civil feature editor: geometry helpers, kind enforcement, GeoJSON/KML round-trip.
import { describe, expect, it } from "vitest";

import {
  allowedGeometryTypes,
  formatFeatureRef,
  geometryMatchesType,
  isReadOnlyStatus,
  nextRevisionCode,
} from "@/lib/civil/feature-types";
import {
  geometryFromVertices,
  geometryVertexLists,
  measureGeometry,
  replaceVertex,
  type GeoJsonGeometry,
  type Vertex,
} from "@/lib/civil/geom";
import { buildKml, geometryToLngLat, geometryToLocal, parseKml } from "@/lib/civil/kml";
import { buildFeatureCollection, isValidGeoJSON, parseGeoJSON } from "@/lib/geojson";

const square: Vertex[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

describe("geometry construction", () => {
  it("closes polygon rings and rejects degenerate sketches", () => {
    const poly = geometryFromVertices("polygon", square)!;
    expect(poly.type).toBe("Polygon");
    const ring = geometryVertexLists(poly)[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(geometryFromVertices("polygon", square.slice(0, 2))).toBeNull();
    expect(geometryFromVertices("line", [[0, 0]])).toBeNull();
    expect(geometryFromVertices("point", [])).toBeNull();
  });

  it("measures line length and polygon area/perimeter", () => {
    expect(
      measureGeometry("line", [
        [0, 0],
        [3, 4],
      ]).lengthM,
    ).toBe(5);
    const m = measureGeometry("polygon", square);
    expect(m.areaM2).toBe(100);
    expect(m.perimeterM).toBe(40);
  });

  it("moves a vertex and keeps polygon rings closed", () => {
    const poly = geometryFromVertices("polygon", square)!;
    const moved = replaceVertex(poly, 0, 0, [-5, -5]);
    const ring = geometryVertexLists(moved)[0];
    expect(ring[0]).toEqual([-5, -5]);
    expect(ring[ring.length - 1]).toEqual([-5, -5]);
  });
});

describe("geometry-kind enforcement", () => {
  it("binds each feature type to its allowed geometry", () => {
    expect(geometryMatchesType("road_alignment", "LineString")).toBe(true);
    expect(geometryMatchesType("road_alignment", "Polygon")).toBe(false);
    expect(geometryMatchesType("grading_zone", "Polygon")).toBe(true);
    expect(geometryMatchesType("gate", "Point")).toBe(true);
    expect(geometryMatchesType("gate", "LineString")).toBe(false);
    expect(allowedGeometryTypes("laydown_area")).toContain("Polygon");
  });

  it("freezes approved and superseded features", () => {
    expect(isReadOnlyStatus("approved")).toBe(true);
    expect(isReadOnlyStatus("superseded")).toBe(true);
    expect(isReadOnlyStatus("draft")).toBe(false);
    expect(nextRevisionCode("A")).toBe("B");
    expect(formatFeatureRef(7)).toBe("CVL-0007");
  });
});

describe("GeoJSON round-trip", () => {
  it("preserves geometries through build → parse", () => {
    const geometry = geometryFromVertices("line", [
      [0, 0],
      [25.5, 12.25],
    ])!;
    const collection = buildFeatureCollection([
      { geometry: geometry as never, properties: { kind: "road_alignment", name: "Site road" } },
    ]);
    expect(isValidGeoJSON(collection)).toBe(true);
    const parsed = parseGeoJSON(JSON.stringify(collection));
    expect(parsed.features[0].geometry).toEqual(geometry);
    expect(parsed.features[0].properties?.kind).toBe("road_alignment");
  });
});

describe("KML export", () => {
  it("emits KML 2.2 with per-type styles and lon/lat coordinates", () => {
    const anchor = { lon: 35.95, lat: 31.95 };
    const local = geometryFromVertices("polygon", square)! as GeoJsonGeometry;
    const kml = buildKml(
      [
        {
          feature_ref: "CVL-0001",
          name: "Laydown",
          feature_type: "laydown_area",
          status: "draft",
          revision_code: "A",
          geometry: geometryToLngLat(local, anchor),
          properties: {},
        },
      ],
      { documentName: "Test site" },
    );
    expect(kml).toContain('xmlns="http://www.opengis.net/kml/2.2"');
    expect(kml).toContain("<Placemark>");
    expect(kml).toContain("<Style id=");
    expect(kml).toContain("CVL-0001");
  });

  it("converts lon/lat back to local metres within tolerance", () => {
    const anchor = { lon: 35.95, lat: 31.95 };
    const local = geometryFromVertices("line", [
      [0, 0],
      [100, 50],
    ])!;
    const back = geometryToLocal(geometryToLngLat(local, anchor), anchor);
    const ring = geometryVertexLists(back)[0];
    expect(ring[1][0]).toBeCloseTo(100, 1);
    expect(ring[1][1]).toBeCloseTo(50, 1);
  });

  it("parses placemarks when a DOM parser is supplied", () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Trench</name>
<LineString><coordinates>35.95,31.95,0 35.951,31.951,0</coordinates></LineString>
</Placemark></Document></kml>`;
    const placemarks = parseKml(kml, new DOMParser());
    expect(placemarks).toHaveLength(1);
    expect(placemarks[0].name).toBe("Trench");
    expect(placemarks[0].geometry.type).toBe("LineString");
  });
});
