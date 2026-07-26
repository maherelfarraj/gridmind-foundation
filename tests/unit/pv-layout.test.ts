// P-152 — Unit tests for the deterministic PV layout engine.
import { describe, expect, it } from "vitest";

import {
  arrangeBlocks,
  checkCompliance,
  corridorPolygon,
  dcCapacityKwp,
  gcrFromPitch,
  generateAlternatives,
  gridFill,
  insetRing,
  makeTable,
  pitchFromGcr,
  pointInPolygon,
  polygonsIntersect,
  ringArea,
  rotatePoint,
  rowSpacingFromShading,
  tableFootprint,
  type RingM,
} from "@/lib/pv/layout";

const MODULE = { lengthMm: 2278, widthMm: 1134 }; // Jinko Tiger Neo 580 W

describe("makeTable", () => {
  it("computes portrait collector geometry", () => {
    const t = makeTable({
      module: MODULE,
      orientation: "portrait",
      modulesAcross: 28,
      modulesUp: 2,
      tiltDeg: 25,
    });
    expect(t.collectorWidthM).toBeCloseTo(4.556, 3);
    expect(t.tableLengthM).toBeCloseTo(31.752, 3);
    expect(t.moduleCount).toBe(56);
    expect(t.projectedWidthM).toBeCloseTo(4.556 * Math.cos((25 * Math.PI) / 180), 3);
    expect(t.heightM).toBeCloseTo(4.556 * Math.sin((25 * Math.PI) / 180), 3);
  });

  it("swaps the edges in landscape", () => {
    const t = makeTable({
      module: MODULE,
      orientation: "landscape",
      modulesAcross: 10,
      modulesUp: 4,
      tiltDeg: 20,
    });
    expect(t.collectorWidthM).toBeCloseTo(4.536, 3);
    expect(t.tableLengthM).toBeCloseTo(22.78, 3);
  });

  it("adds gaps only between neighbours", () => {
    const t = makeTable({
      module: MODULE,
      orientation: "portrait",
      modulesAcross: 4,
      modulesUp: 2,
      tiltDeg: 10,
      moduleGapM: 0.02,
      rowGapM: 0.05,
    });
    expect(t.tableLengthM).toBeCloseTo(4 * 1.134 + 3 * 0.02, 6);
    expect(t.collectorWidthM).toBeCloseTo(2 * 2.278 + 0.05, 6);
  });

  it("rejects invalid inputs", () => {
    const base = { module: MODULE, orientation: "portrait", modulesUp: 2, tiltDeg: 25 } as const;
    expect(() => makeTable({ ...base, modulesAcross: 0 })).toThrow();
    expect(() => makeTable({ ...base, modulesAcross: 2, tiltDeg: 90 })).toThrow();
  });
});

describe("pitch and GCR", () => {
  it("pitch is collector width divided by GCR", () => {
    expect(pitchFromGcr(4.556, 0.4)).toBeCloseTo(11.39, 4);
    expect(pitchFromGcr(4, 1)).toBe(4);
  });

  it("round-trips through gcrFromPitch", () => {
    const pitch = pitchFromGcr(4.556, 0.35);
    expect(gcrFromPitch(4.556, pitch)).toBeCloseTo(0.35, 9);
  });

  it("rejects out-of-range GCR", () => {
    expect(() => pitchFromGcr(4, 0)).toThrow();
    expect(() => pitchFromGcr(4, 1.2)).toThrow();
  });
});

describe("rowSpacingFromShading", () => {
  it("uses the winter-solstice elevation at East Amman (31.9N)", () => {
    const r = rowSpacingFromShading({ tiltDeg: 25, latitude: 31.9, collectorWidthM: 4.556 });
    expect(r.solarElevationDeg).toBeCloseTo(34.65, 2);
    const h = 4.556 * Math.sin((25 * Math.PI) / 180);
    expect(r.shadowLengthM).toBeCloseTo(h / Math.tan((34.65 * Math.PI) / 180), 2);
    expect(r.pitchM).toBeCloseTo(4.556 * Math.cos((25 * Math.PI) / 180) + r.shadowLengthM, 6);
  });

  it("mirrors the declination south of the equator", () => {
    const north = rowSpacingFromShading({ tiltDeg: 20, latitude: 30, collectorWidthM: 4 });
    const south = rowSpacingFromShading({ tiltDeg: 20, latitude: -30, collectorWidthM: 4 });
    expect(south.solarElevationDeg).toBeCloseTo(north.solarElevationDeg, 9);
  });

  it("widens the shadow away from solar noon", () => {
    const noon = rowSpacingFromShading({ tiltDeg: 25, latitude: 31.9, collectorWidthM: 4.556 });
    const offset = rowSpacingFromShading({
      tiltDeg: 25,
      latitude: 31.9,
      collectorWidthM: 4.556,
      azimuthOffsetDeg: 45,
    });
    expect(offset.shadowLengthM).toBeGreaterThan(noon.shadowLengthM);
  });

  it("honours an explicit shading angle and rejects impossible ones", () => {
    const r = rowSpacingFromShading({
      tiltDeg: 30,
      latitude: 31.9,
      collectorWidthM: 4,
      shadingAngleDeg: 45,
    });
    expect(r.shadowLengthM).toBeCloseTo(4 * Math.sin((30 * Math.PI) / 180), 6);
    expect(() =>
      rowSpacingFromShading({
        tiltDeg: 30,
        latitude: 31.9,
        collectorWidthM: 4,
        shadingAngleDeg: 0,
      }),
    ).toThrow();
  });
});

describe("geometry primitives", () => {
  const square: RingM = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  it("computes ring area regardless of winding or closure", () => {
    expect(ringArea(square)).toBe(10000);
    expect(ringArea([...square, { x: 0, y: 0 }])).toBe(10000);
    expect(ringArea([...square].reverse())).toBe(10000);
  });

  it("ray-casts points, edges included", () => {
    expect(pointInPolygon({ x: 50, y: 50 }, square)).toBe(true);
    expect(pointInPolygon({ x: 150, y: 50 }, square)).toBe(false);
    expect(pointInPolygon({ x: 0, y: 50 }, square)).toBe(true);
    expect(pointInPolygon({ x: 100, y: 100 }, square)).toBe(true);
  });

  it("detects overlap, containment and separation", () => {
    const overlapping: RingM = [
      { x: 90, y: 90 },
      { x: 150, y: 90 },
      { x: 150, y: 150 },
      { x: 90, y: 150 },
    ];
    const inside: RingM = [
      { x: 40, y: 40 },
      { x: 60, y: 40 },
      { x: 60, y: 60 },
      { x: 40, y: 60 },
    ];
    const away: RingM = [
      { x: 300, y: 300 },
      { x: 320, y: 300 },
      { x: 320, y: 320 },
      { x: 300, y: 320 },
    ];
    expect(polygonsIntersect(square, overlapping)).toBe(true);
    expect(polygonsIntersect(square, inside)).toBe(true);
    expect(polygonsIntersect(square, away)).toBe(false);
  });

  it("insets a ring inward and keeps it inside the original", () => {
    const inset = insetRing(square, 10);
    expect(ringArea(inset)).toBeLessThan(ringArea(square));
    expect(inset.every((p) => pointInPolygon(p, square))).toBe(true);
  });

  it("rotates clockwise on the compass convention", () => {
    const p = rotatePoint({ x: 0, y: 1 }, 90, { x: 0, y: 0 });
    expect(p.x).toBeCloseTo(1, 9);
    expect(p.y).toBeCloseTo(0, 9);
  });

  it("builds table, corridor and pad footprints", () => {
    const foot = tableFootprint({ x: 10, y: 10 }, 30, 4, 0);
    expect(foot).toHaveLength(4);
    expect(ringArea(foot)).toBeCloseTo(120, 6);
    const rotated = tableFootprint({ x: 10, y: 10 }, 30, 4, 37);
    expect(ringArea(rotated)).toBeCloseTo(120, 4);
    const road = corridorPolygon({ x: 0, y: 0 }, { x: 100, y: 0 }, 6);
    expect(ringArea(road)).toBeCloseTo(600, 6);
    expect(corridorPolygon({ x: 0, y: 0 }, { x: 0, y: 0 }, 6)).toEqual([]);
  });
});

describe("gridFill", () => {
  const field: RingM = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 200 },
    { x: 0, y: 200 },
  ];

  it("is deterministic for identical inputs", () => {
    const args = { boundary: field, pitchM: 10, tableWidthM: 30, tableDepthM: 4, azimuthDeg: 180 };
    const a = gridFill(args);
    const b = gridFill(args);
    expect(a.tables).toEqual(b.tables);
    expect(a.tables.length).toBeGreaterThan(0);
  });

  it("keeps every placed table inside the boundary", () => {
    const r = gridFill({
      boundary: field,
      pitchM: 12,
      tableWidthM: 30,
      tableDepthM: 4,
      azimuthDeg: 0,
    });
    for (const t of r.tables) {
      expect(t.polygon.every((p) => pointInPolygon(p, field))).toBe(true);
    }
  });

  it("respects setbacks by shrinking the fill", () => {
    const none = gridFill({
      boundary: field,
      pitchM: 10,
      tableWidthM: 20,
      tableDepthM: 4,
      azimuthDeg: 0,
    });
    const withSetback = gridFill({
      boundary: field,
      pitchM: 10,
      tableWidthM: 20,
      tableDepthM: 4,
      azimuthDeg: 0,
      setbackM: 25,
    });
    expect(withSetback.buildableAreaM2).toBeLessThan(none.buildableAreaM2);
    expect(withSetback.tables.length).toBeLessThan(none.tables.length);
  });

  it("skips tables that hit an exclusion zone", () => {
    const exclusion: RingM = [
      { x: 60, y: 60 },
      { x: 140, y: 60 },
      { x: 140, y: 140 },
      { x: 60, y: 140 },
    ];
    const without = gridFill({
      boundary: field,
      pitchM: 10,
      tableWidthM: 20,
      tableDepthM: 4,
      azimuthDeg: 0,
    });
    const withExclusion = gridFill({
      boundary: field,
      exclusions: [exclusion],
      pitchM: 10,
      tableWidthM: 20,
      tableDepthM: 4,
      azimuthDeg: 0,
    });
    expect(withExclusion.tables.length).toBeLessThan(without.tables.length);
    for (const t of withExclusion.tables) {
      expect(polygonsIntersect(t.polygon, exclusion)).toBe(false);
    }
  });

  it("packs fewer rows as the pitch grows", () => {
    const tight = gridFill({
      boundary: field,
      pitchM: 6,
      tableWidthM: 20,
      tableDepthM: 4,
      azimuthDeg: 0,
    });
    const loose = gridFill({
      boundary: field,
      pitchM: 20,
      tableWidthM: 20,
      tableDepthM: 4,
      azimuthDeg: 0,
    });
    expect(loose.tables.length).toBeLessThan(tight.tables.length);
  });

  it("returns nothing when the setback consumes the site", () => {
    const r = gridFill({
      boundary: field,
      pitchM: 10,
      tableWidthM: 30,
      tableDepthM: 4,
      azimuthDeg: 0,
      setbackM: 500,
    });
    expect(r.tables).toEqual([]);
  });

  it("honours the maxTables safety valve", () => {
    const r = gridFill({
      boundary: field,
      pitchM: 5,
      tableWidthM: 5,
      tableDepthM: 2,
      azimuthDeg: 0,
      maxTables: 7,
    });
    expect(r.tables).toHaveLength(7);
  });

  it("rejects non-positive pitch or table width", () => {
    expect(() =>
      gridFill({ boundary: field, pitchM: 0, tableWidthM: 10, azimuthDeg: 0 }),
    ).toThrow();
    expect(() =>
      gridFill({ boundary: field, pitchM: 10, tableWidthM: -1, azimuthDeg: 0 }),
    ).toThrow();
  });
});

describe("dcCapacityKwp", () => {
  it("multiplies tables, modules and watt-peak into kWp", () => {
    expect(dcCapacityKwp(100, 56, 580)).toBeCloseTo(3248, 6);
    expect(dcCapacityKwp(0, 56, 580)).toBe(0);
    expect(dcCapacityKwp(10, 10, 0)).toBe(0);
  });
});

describe("P-153 arrangement, compliance and alternatives", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 300, y: 0 },
    { x: 300, y: 300 },
    { x: 0, y: 300 },
  ];
  const table = makeTable({
    module: { lengthMm: 2278, widthMm: 1134 },
    orientation: "portrait",
    modulesAcross: 28,
    modulesUp: 2,
    tiltDeg: 25,
  });

  const base = {
    boundary: square,
    table,
    moduleWp: 580,
    pitchM: pitchFromGcr(table.collectorWidthM, 0.35),
    setbackM: 10,
    azimuthDeg: 0,
    roadEveryNRows: 4,
    roadWidthM: 6,
  };

  it("places tables, roads and pads deterministically", () => {
    const a = arrangeBlocks(base);
    const b = arrangeBlocks(base);
    expect(a.metrics.tableCount).toBeGreaterThan(0);
    expect(a.metrics.roadCount).toBeGreaterThan(0);
    expect(JSON.stringify(a.blocks)).toEqual(JSON.stringify(b.blocks));
    expect(a.metrics.dcKwp).toBeCloseTo((a.metrics.moduleCount * 580) / 1000, 3);
  });

  it("reports no_terrain_data instead of guessing a slope", () => {
    const { compliance, blocks } = arrangeBlocks(base);
    const slope = compliance.checks.find((c) => c.id === "slope")!;
    expect(slope.status).toBe("warn");
    expect(slope.findings[0].code).toBe("no_terrain_data");
    expect(blocks.every((b) => b.slopePct === undefined)).toBe(true);
  });

  it("flags slope limits when terrain samples exist", () => {
    const terrain = {
      slopeLimitPct: 1,
      samples: [
        { x: 0, y: 0, elevationM: 0 },
        { x: 300, y: 300, elevationM: 120 },
      ],
    };
    const { compliance } = arrangeBlocks({ ...base, terrainRef: terrain });
    const slope = compliance.checks.find((c) => c.id === "slope")!;
    expect(slope.findings.some((f) => f.code === "slope_limit_exceeded")).toBe(true);
  });

  it("names both blocks in a collision and coordinates in violations", () => {
    const overlap = [
      {
        key: "a",
        type: "array_table" as const,
        label: "T01-01",
        polygon: square,
        moduleCount: 0,
        dcKwp: 0,
      },
      {
        key: "b",
        type: "array_table" as const,
        label: "T01-02",
        polygon: square,
        moduleCount: 0,
        dcKwp: 0,
      },
    ];
    const report = checkCompliance({
      blocks: overlap,
      boundary: square,
      buildable: square,
      exclusionZones: [],
      metrics: {
        tableCount: 2,
        moduleCount: 0,
        dcKwp: 0,
        achievedGcr: 0,
        usedAreaM2: 0,
        buildableAreaM2: 1,
        boundaryAreaM2: 1,
        roadCount: 0,
        padCount: 0,
      },
    });
    const collision = report.checks.find((c) => c.id === "collisions")!;
    expect(collision.status).toBe("fail");
    expect(collision.findings[0].blocks).toEqual(["T01-01", "T01-02"]);
    expect(collision.findings[0].coordinates).toHaveLength(2);
  });

  it("detects exclusion-zone conflicts with coordinates", () => {
    const zone = [
      { x: 20, y: 20 },
      { x: 280, y: 20 },
      { x: 280, y: 280 },
      { x: 20, y: 280 },
    ];
    const { compliance } = arrangeBlocks({ ...base, exclusionZones: [] });
    expect(compliance.checks.find((c) => c.id === "exclusions")!.status).toBe("pass");
    const report = checkCompliance({
      blocks: [
        {
          key: "a",
          type: "array_table",
          label: "T01-01",
          polygon: square,
          moduleCount: 0,
          dcKwp: 0,
        },
      ],
      boundary: square,
      buildable: square,
      exclusionZones: [zone],
      metrics: {
        tableCount: 1,
        moduleCount: 0,
        dcKwp: 0,
        achievedGcr: 0,
        usedAreaM2: 0,
        buildableAreaM2: 1,
        boundaryAreaM2: 1,
        roadCount: 0,
        padCount: 0,
      },
    });
    const ex = report.checks.find((c) => c.id === "exclusions")!;
    expect(ex.status).toBe("fail");
    expect(ex.findings[0].coordinates).toHaveLength(1);
  });

  it("generates up to three alternatives with distinct GCR and correct capacity", () => {
    const alts = generateAlternatives(
      { boundary: square, exclusionZones: [], latitude: 31.9 },
      {
        module: { lengthMm: 2278, widthMm: 1134 },
        moduleWp: 580,
        orientation: "portrait",
        modulesAcross: 28,
        modulesUp: 2,
        tiltDeg: 25,
        azimuthDeg: 180,
        gcr: 0.35,
        setbackM: 10,
        roadEveryNRows: 6,
        roadWidthM: 6,
        tracker: false,
      },
    );
    expect(alts).toHaveLength(3);
    expect(alts.map((a) => a.name)).toEqual(["Option A", "Option B", "Option C"]);
    expect(new Set(alts.map((a) => a.params.gcr)).size).toBe(3);
    for (const alt of alts) {
      expect(alt.result.metrics.dcKwp).toBeCloseTo(
        (alt.result.metrics.moduleCount * 580) / 1000,
        3,
      );
    }
  });
});
