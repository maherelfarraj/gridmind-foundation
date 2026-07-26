// P-164 — Cut/fill volumes + terrain parsers. Fully offline.
import { describe, expect, it } from "vitest";

import {
  CutFillError,
  buildDesignPlane,
  cellsInGeometry,
  computeCutFill,
} from "@/lib/civil/cutfill";
import type { GeoJsonGeometry } from "@/lib/civil/geom";
import { emptyGrid, idx, type ElevationGrid } from "@/lib/terrain/grid";
import { TerrainParseError, parseEsriAsciiGrid, parseTerrainCsv } from "@/lib/terrain/parse";

const SPACING = 5;
const CELL_AREA = SPACING * SPACING;

function flatGrid(rows: number, cols: number, z: number): ElevationGrid {
  const grid = emptyGrid(rows, cols, SPACING);
  grid.values.fill(z);
  return grid;
}

/** Axis-aligned closed rectangle in world coordinates. */
function box(minE: number, minN: number, maxE: number, maxN: number): GeoJsonGeometry {
  return {
    type: "Polygon",
    coordinates: [
      [
        [minE, minN],
        [maxE, minN],
        [maxE, maxN],
        [minE, maxN],
        [minE, minN],
      ],
    ],
  } as unknown as GeoJsonGeometry;
}

const FULL_ZONE = box(-1, -1, 9 * SPACING + 1, 9 * SPACING + 1);

describe("cut & fill volumes", () => {
  it("cuts 200·cell_area from a flat 10×10 grid down to a 98 m pad", () => {
    const grid = flatGrid(10, 10, 100);
    const result = computeCutFill(grid, FULL_ZONE, { design_elevation_m: 98 });

    expect(result.cells).toBe(100);
    expect(result.cell_area_m2).toBe(CELL_AREA);
    expect(result.cut_m3).toBeCloseTo(200 * CELL_AREA, 6);
    expect(result.fill_m3).toBe(0);
    expect(result.net_m3).toBeCloseTo(200 * CELL_AREA, 6);
    expect(result.net_m3).toBeGreaterThan(0);
    expect(result.method).toBe("flat_pad");
    expect(result.max_cut_m).toBeCloseTo(2, 6);
    expect(result.mean_existing_m).toBe(100);
  });

  it("balances cut and fill for a tilted plane through the centroid", () => {
    const grid = flatGrid(10, 10, 100);
    const result = computeCutFill(grid, FULL_ZONE, {
      design_slope_pct: 2,
      design_slope_direction_deg: 90,
    });

    expect(result.method).toBe("balanced_plane");
    const total = result.cut_m3 + result.fill_m3;
    expect(total).toBeGreaterThan(0);
    expect(Math.abs(result.cut_m3 - result.fill_m3)).toBeLessThan(1e-6 * total);
    expect(Math.abs(result.net_m3)).toBeLessThan(1e-6 * total);
  });

  it("halves the volumes when the zone covers exactly half the cells", () => {
    const grid = flatGrid(10, 10, 100);
    const full = computeCutFill(grid, FULL_ZONE, { design_elevation_m: 98 });
    const half = computeCutFill(grid, box(-1, -1, 4 * SPACING + 1, 9 * SPACING + 1), {
      design_elevation_m: 98,
    });

    expect(half.cells).toBe(full.cells / 2);
    expect(half.cut_m3).toBeCloseTo(full.cut_m3 / 2, 6);
    expect(half.fill_m3).toBe(0);
  });

  it("fills when the design pad sits above the ground", () => {
    const grid = flatGrid(4, 4, 100);
    const result = computeCutFill(grid, FULL_ZONE, { design_elevation_m: 103 });
    expect(result.cut_m3).toBe(0);
    expect(result.fill_m3).toBeCloseTo(3 * 16 * CELL_AREA, 6);
    expect(result.net_m3).toBeLessThan(0);
  });

  it("raises typed errors for empty overlap and missing design model", () => {
    const grid = flatGrid(4, 4, 100);
    expect(() =>
      computeCutFill(grid, box(1000, 1000, 1100, 1100), { design_elevation_m: 98 }),
    ).toThrowError(CutFillError);
    try {
      computeCutFill(grid, box(1000, 1000, 1100, 1100), { design_elevation_m: 98 });
    } catch (err) {
      expect((err as CutFillError).code).toBe("no_cells");
    }
    try {
      computeCutFill(grid, FULL_ZONE, {});
    } catch (err) {
      expect((err as CutFillError).code).toBe("no_design_model");
    }
  });

  it("builds no plane without cells and a flat plane with an elevation", () => {
    expect(buildDesignPlane({ design_elevation_m: 100 }, [])).toBeNull();
    const grid = flatGrid(3, 3, 100);
    const cells = cellsInGeometry(grid, FULL_ZONE);
    expect(cells).toHaveLength(9);
    const plane = buildDesignPlane({ design_elevation_m: 98 }, cells);
    expect(plane?.method).toBe("flat_pad");
    expect(plane?.gradeE).toBe(0);
  });
});

describe("terrain parsers", () => {
  const csv = ["easting,northing,elevation_m", "0,0,100", "10,0,101", "0,10,102", "10,10,103"].join(
    "\n",
  );

  it("accepts a valid CSV fixture", () => {
    const parsed = parseTerrainCsv(csv);
    expect(parsed.kind).toBe("csv_upload");
    expect(parsed.points).toHaveLength(4);
    expect(parsed.spacing).toBe(10);
    expect(parsed.minElevation).toBe(100);
    expect(parsed.maxElevation).toBe(103);
  });

  it("rejects ragged rows, bad headers and implausible spikes with typed errors", () => {
    const codeOf = (fn: () => unknown) => {
      try {
        fn();
      } catch (err) {
        expect(err).toBeInstanceOf(TerrainParseError);
        return (err as TerrainParseError).code;
      }
      return "no_error";
    };

    expect(codeOf(() => parseTerrainCsv("easting,northing,elevation_m\n0,0"))).toBe("ragged_row");
    expect(codeOf(() => parseTerrainCsv("a,b,c\n0,0,1"))).toBe("bad_header");
    expect(codeOf(() => parseTerrainCsv("easting,northing,elevation_m\n0,0,99999"))).toBe(
      "implausible_elevation",
    );
    expect(codeOf(() => parseTerrainCsv("easting,northing,elevation_m\nx,0,100"))).toBe(
      "bad_value",
    );
    expect(codeOf(() => parseTerrainCsv("easting,northing,elevation_m"))).toBe("empty_file");
  });

  it("parses a DEM-lite grid and keeps NODATA cells as holes", () => {
    const dem = [
      "ncols 3",
      "nrows 2",
      "xllcorner 100",
      "yllcorner 200",
      "cellsize 10",
      "NODATA_value -9999",
      "5 6 7",
      "1 -9999 3",
    ].join("\n");

    const parsed = parseEsriAsciiGrid(dem);
    expect(parsed.kind).toBe("dem_lite");
    expect(parsed.rows).toBe(2);
    expect(parsed.cols).toBe(3);
    expect(parsed.spacing).toBe(10);
    expect(parsed.points).toHaveLength(5); // the NODATA spike is dropped
    expect(parsed.minElevation).toBe(1);
    expect(parsed.maxElevation).toBe(7);

    const grid = emptyGrid(parsed.rows ?? 0, parsed.cols ?? 0, parsed.spacing);
    for (const p of parsed.points) {
      grid.values[idx(grid, p.grid_row ?? 0, p.grid_col ?? 0)] = p.elevation_m;
    }
    expect(grid.values.filter((v) => v == null)).toHaveLength(1);
  });

  it("rejects a DEM whose cells are all NODATA", () => {
    const dem = [
      "ncols 2",
      "nrows 1",
      "xllcorner 0",
      "yllcorner 0",
      "cellsize 10",
      "NODATA_value -9999",
      "-9999 -9999",
    ].join("\n");
    try {
      parseEsriAsciiGrid(dem);
      throw new Error("expected a parse error");
    } catch (err) {
      expect(err).toBeInstanceOf(TerrainParseError);
      expect((err as TerrainParseError).code).toBe("empty_file");
    }
  });
});
