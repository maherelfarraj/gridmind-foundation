// P-164 — Terrain grid / interpolation / contours / slope. Fully offline.
import { describe, expect, it } from "vitest";

import { contourLevels, extractContours } from "@/lib/terrain/contours";
import {
  buildElevationGrid,
  emptyGrid,
  fillHoles,
  gridStats,
  idx,
  sampleElevation,
  valueAt,
  type TerrainPointInput,
} from "@/lib/terrain/grid";
import { computeSlope, slopeAt, slopeStats } from "@/lib/terrain/slope";

/** Analytic test plane: z = 2·easting + 3·northing. */
const planeZ = (e: number, n: number) => 2 * e + 3 * n;

function planePoints(rows: number, cols: number, spacing: number): TerrainPointInput[] {
  const pts: TerrainPointInput[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const easting = c * spacing;
      const northing = r * spacing;
      pts.push({ easting, northing, elevation_m: planeZ(easting, northing) });
    }
  }
  return pts;
}

function planeGrid(rows: number, cols: number, spacing: number) {
  const grid = emptyGrid(rows, cols, spacing);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      grid.values[idx(grid, r, c)] = planeZ(c * spacing, r * spacing);
    }
  }
  return grid;
}

describe("terrain grid assembly", () => {
  it("preserves point values at their grid nodes", () => {
    const points = planePoints(4, 5, 10);
    const grid = buildElevationGrid(points);
    expect(grid.rows).toBe(4);
    expect(grid.cols).toBe(5);
    expect(grid.spacing).toBe(10);
    for (const p of points) {
      const r = Math.round(p.northing / 10);
      const c = Math.round(p.easting / 10);
      expect(valueAt(grid, r, c)).toBeCloseTo(p.elevation_m, 12);
    }
    expect(gridStats(grid).holes).toBe(0);
  });

  it("honours explicit grid_row / grid_col indices", () => {
    const grid = buildElevationGrid([
      { easting: 0, northing: 0, elevation_m: 10, grid_row: 0, grid_col: 0 },
      { easting: 5, northing: 0, elevation_m: 11, grid_row: 0, grid_col: 1 },
      { easting: 0, northing: 5, elevation_m: 12, grid_row: 1, grid_col: 0 },
      { easting: 5, northing: 5, elevation_m: 13, grid_row: 1, grid_col: 1 },
    ]);
    expect(grid.rows).toBe(2);
    expect(grid.cols).toBe(2);
    expect(valueAt(grid, 1, 1)).toBe(13);
  });

  it("fills a missing interior node with the exact plane value", () => {
    const grid = planeGrid(5, 5, 10);
    const hole = idx(grid, 2, 2);
    const truth = grid.values[hole] as number;
    grid.values[hole] = null;
    expect(gridStats(grid).holes).toBe(1);

    const filled = fillHoles(grid);
    expect(filled.values[hole]).toBeCloseTo(truth, 9);
    expect(gridStats(filled).holes).toBe(0);
  });

  it("bilinearly samples a cell interior at the exact plane value", () => {
    const grid = planeGrid(5, 5, 10);
    for (const [e, n] of [
      [15, 15],
      [23.5, 7.25],
      [0, 0],
      [40, 40],
    ]) {
      expect(sampleElevation(grid, e, n)).toBeCloseTo(planeZ(e, n), 9);
    }
    expect(sampleElevation(grid, 1000, 1000)).toBeNull();
  });
});

describe("marching-squares contours", () => {
  // z = 100 + 0.5·easting → contours are vertical lines, no level lands on a node.
  const grid = (() => {
    const g = emptyGrid(5, 5, 10);
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) g.values[idx(g, r, c)] = 100 + 0.5 * (c * 10);
    }
    return g;
  })();

  it("produces the requested interval count", () => {
    const levels = contourLevels(100, 120, 6);
    expect(levels).toEqual([102, 108, 114]);
    expect(contourLevels(100, 120, 0)).toEqual([]);
    expect(contourLevels(120, 100, 6)).toEqual([]);

    const lines = extractContours(grid, 6);
    expect(new Set(lines.map((l) => l.elevation_m))).toEqual(new Set(levels));
  });

  it("returns straight segments at the expected crossings", () => {
    const lines = extractContours(grid, 6);
    for (const line of lines) {
      const expectedX = (line.elevation_m - 100) / 0.5;
      expect(line.coordinates.length).toBeGreaterThanOrEqual(2);
      for (const [x] of line.coordinates) expect(x).toBeCloseTo(expectedX, 9);
      const ys = line.coordinates.map(([, y]) => y);
      expect(Math.min(...ys)).toBeCloseTo(0, 9);
      expect(Math.max(...ys)).toBeCloseTo(40, 9);
    }
  });

  it("flags every majorEvery-th level as major", () => {
    const lines = extractContours(grid, 6, { majorEvery: 2 });
    const majors = new Set(lines.filter((l) => l.is_major).map((l) => l.elevation_m));
    expect(majors).toEqual(new Set([102, 114]));
  });
});

describe("slope and aspect", () => {
  it("matches the analytic slope of a constant-gradient plane", () => {
    const grid = planeGrid(5, 5, 10);
    const slope = computeSlope(grid);
    const analytic = Math.sqrt(2 * 2 + 3 * 3) * 100;
    for (let r = 1; r < 4; r++) {
      for (let c = 1; c < 4; c++) {
        expect(slopeAt(slope, r, c) as number).toBeCloseTo(analytic, 9);
      }
    }
    expect(slopeAt(slope, 99, 99)).toBeNull();
  });

  it("points aspect downslope", () => {
    const grid = planeGrid(5, 5, 10);
    const slope = computeSlope(grid);
    // gradient rises to the north-east, so water runs to the south-west
    const expected = ((Math.atan2(-2, -3) * 180) / Math.PI + 360) % 360;
    expect(slope.aspectDeg[2 * 5 + 2] as number).toBeCloseTo(expected, 9);
    expect(expected).toBeGreaterThan(180);
    expect(expected).toBeLessThan(270);
  });

  it("reports null aspect and zero slope on a flat surface", () => {
    const flat = emptyGrid(3, 3, 10);
    flat.values.fill(500);
    const slope = computeSlope(flat);
    expect(slopeAt(slope, 1, 1)).toBe(0);
    expect(slope.aspectDeg[4]).toBeNull();
    const stats = slopeStats(slope, 5);
    expect(stats.max).toBe(0);
    expect(stats.aboveThreshold).toBe(0);
  });
});
