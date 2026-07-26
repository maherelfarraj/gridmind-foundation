// P-160 — terrain grid / contour / slope / parse unit coverage.
import { describe, expect, it } from "vitest";

import { extractContours } from "@/lib/terrain/contours";
import { buildElevationGrid, fillHoles, sampleElevation } from "@/lib/terrain/grid";
import { computeSlope, slopeRampT, slopeStats } from "@/lib/terrain/slope";
import { parseTerrainFile, SAMPLE_TERRAIN_CSV, TerrainParseError } from "@/lib/terrain/parse";

/** 3x3 plane rising 1 m per 10 m eastward → 10% slope. */
function planePoints() {
  const pts = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      pts.push({ easting: c * 10, northing: r * 10, elevation_m: 100 + c });
    }
  }
  return pts;
}

describe("terrain grid", () => {
  it("snaps points onto a regular lattice", () => {
    const grid = buildElevationGrid(planePoints(), { spacing: 10 });
    expect(grid.rows).toBe(3);
    expect(grid.cols).toBe(3);
    expect(grid.spacing).toBe(10);
  });

  it("interpolates elevation between nodes", () => {
    const grid = buildElevationGrid(planePoints(), { spacing: 10 });
    expect(sampleElevation(grid, 5, 0)).toBeCloseTo(100.5, 6);
  });

  it("fills holes without changing known nodes", () => {
    const pts = planePoints().filter((p) => !(p.easting === 10 && p.northing === 10));
    const filled = fillHoles(buildElevationGrid(pts, { spacing: 10 }));
    expect(filled.values.every((v) => v != null)).toBe(true);
    expect(sampleElevation(filled, 0, 0)).toBeCloseTo(100, 6);
  });
});

describe("terrain slope", () => {
  it("computes a 10% slope on a constant-grade plane", () => {
    const slope = computeSlope(buildElevationGrid(planePoints(), { spacing: 10 }));
    const stats = slopeStats(slope);
    expect(stats.max).toBeCloseTo(10, 3);
    expect(stats.mean).toBeCloseTo(10, 3);
  });

  it("normalises the heat-map ramp to 0..1", () => {
    expect(slopeRampT(0, 20)).toBe(0);
    expect(slopeRampT(20, 20)).toBe(1);
    expect(slopeRampT(40, 20)).toBe(1);
  });
});

describe("terrain contours", () => {
  it("extracts one polyline per level on a plane", () => {
    const grid = buildElevationGrid(planePoints(), { spacing: 10 });
    const lines = extractContours(grid, 1);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.coordinates.length).toBeGreaterThanOrEqual(2);
      expect(Number.isFinite(line.elevation_m)).toBe(true);
    }
    expect(lines.some((l) => l.is_major)).toBe(true);
  });

  it("is deterministic", () => {
    const grid = buildElevationGrid(planePoints(), { spacing: 10 });
    expect(JSON.stringify(extractContours(grid, 1))).toBe(
      JSON.stringify(extractContours(grid, 1)),
    );
  });
});

describe("terrain parsing", () => {
  it("parses the sample CSV", () => {
    const parsed = parseTerrainFile("sample.csv", SAMPLE_TERRAIN_CSV);
    expect(parsed.kind).toBe("csv_upload");
    expect(parsed.points.length).toBeGreaterThan(3);
    expect(parsed.maxElevation).toBeGreaterThanOrEqual(parsed.minElevation);
  });

  it("parses an Esri ASCII grid", () => {
    const asc = [
      "ncols 3",
      "nrows 2",
      "xllcorner 100",
      "yllcorner 200",
      "cellsize 10",
      "NODATA_value -9999",
      "1 2 3",
      "4 -9999 6",
    ].join("\n");
    const parsed = parseTerrainFile("dem.asc", asc);
    expect(parsed.kind).toBe("dem_lite");
    expect(parsed.points).toHaveLength(5); // NODATA dropped
    expect(parsed.spacing).toBe(10);
  });

  it("rejects unsupported extensions and implausible elevations", () => {
    expect(() => parseTerrainFile("x.pdf", "")).toThrow(TerrainParseError);
    expect(() =>
      parseTerrainFile("bad.csv", "easting,northing,elevation_m\n0,0,99999"),
    ).toThrow(TerrainParseError);
  });
});
