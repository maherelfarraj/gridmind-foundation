// P-161 — Civil analysis engine tests (pure modules only).
import { describe, expect, it } from "vitest";

import { computeCutFill, buildDesignPlane, cellsInGeometry } from "@/lib/civil/cutfill";
import { proposeDrainagePaths, computeFlow } from "@/lib/civil/flow";
import { pointInGeometry, polygonArea } from "@/lib/civil/geom";
import { buildPileSchedule, DEFAULT_EMBEDMENT_RULE, embedmentFor, revealFor } from "@/lib/civil/piles";
import { buildCoordinateSchedule, coordinateScheduleToCsv } from "@/lib/civil/schedule";
import { runSlopeTolerance } from "@/lib/civil/slopeCheck";
import { emptyGrid, type ElevationGrid } from "@/lib/terrain/grid";
import { computeSlope } from "@/lib/terrain/slope";

function gridFrom(values: number[][], spacing = 1): ElevationGrid {
  const rows = values.length;
  const cols = values[0].length;
  const grid = emptyGrid(rows, cols, spacing, 0, 0);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) grid.values[r * cols + c] = values[r][c];
  }
  return grid;
}

const square = (size: number) => ({
  type: "Polygon",
  coordinates: [
    [
      [-0.5, -0.5],
      [size + 0.5, -0.5],
      [size + 0.5, size + 0.5],
      [-0.5, size + 0.5],
      [-0.5, -0.5],
    ],
  ],
});

describe("geom", () => {
  it("computes polygon area and containment", () => {
    const poly = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    };
    expect(polygonArea(poly)).toBe(100);
    expect(pointInGeometry(5, 5, poly)).toBe(true);
    expect(pointInGeometry(15, 5, poly)).toBe(false);
  });
});

describe("cutfill", () => {
  it("returns exact volumes on a flat synthetic grid", () => {
    // 3x3 grid at 10 m spacing, all at 12 m; design pad at 10 m → pure cut.
    const grid = gridFrom(
      [
        [12, 12, 12],
        [12, 12, 12],
        [12, 12, 12],
      ],
      10,
    );
    const geometry = {
      type: "Polygon",
      coordinates: [
        [
          [-1, -1],
          [21, -1],
          [21, 21],
          [-1, 21],
          [-1, -1],
        ],
      ],
    };
    const res = computeCutFill(grid, geometry, { design_elevation_m: 10 });
    // 9 cells × 100 m² × 2 m
    expect(res.cut_m3).toBe(1800);
    expect(res.fill_m3).toBe(0);
    expect(res.net_m3).toBe(1800);
    expect(res.area_m2).toBe(900);
    expect(res.method).toBe("flat_pad");
  });

  it("splits cut and fill about the design elevation", () => {
    const grid = gridFrom(
      [
        [9, 9],
        [11, 11],
      ],
      1,
    );
    const res = computeCutFill(grid, square(1), { design_elevation_m: 10 });
    expect(res.cut_m3).toBe(2);
    expect(res.fill_m3).toBe(2);
    expect(res.net_m3).toBe(0);
    expect(res.cells).toBe(4);
  });

  it("balances a sloped plane when no reference elevation is given", () => {
    const grid = gridFrom(
      [
        [10, 11],
        [10, 11],
      ],
      1,
    );
    const cells = cellsInGeometry(grid, square(1));
    const plane = buildDesignPlane({ design_slope_pct: 2, design_slope_direction_deg: 90 }, cells);
    expect(plane?.method).toBe("balanced_plane");
    const res = computeCutFill(grid, square(1), {
      design_slope_pct: 2,
      design_slope_direction_deg: 90,
    });
    expect(Math.abs(res.net_m3)).toBeLessThan(1e-6);
  });

  it("throws when no design model is present", () => {
    const grid = gridFrom([[10]], 1);
    expect(() => computeCutFill(grid, square(0), {})).toThrow(/design/i);
  });
});

describe("piles", () => {
  it("honours the embedment rule and slope reveal", () => {
    const rule = {
      ...DEFAULT_EMBEDMENT_RULE,
      min_embedment_m: 2,
      frost_depth_m: 1,
      uplift_factor: 1.5,
      target_reveal_m: 1.5,
      slope_allowance_span_m: 2,
      round_up_to_m: 0,
    };
    expect(embedmentFor(rule)).toBe(3); // max(2,1) × 1.5
    expect(revealFor(10, rule)).toBe(1.7); // 1.5 + 0.10 × 2

    // Flat first row, 10% slope towards the east on the second row.
    const grid = gridFrom(
      [
        [10, 10, 10],
        [10, 10, 10],
        [10, 10, 10],
      ],
      1,
    );
    const slope = computeSlope(grid);
    const { rows, summary } = buildPileSchedule(
      [{ pile_ref: "P1", easting: 1, northing: 1 }],
      grid,
      slope,
      rule,
    );
    expect(rows[0].embedment_m).toBe(3);
    expect(rows[0].reveal_m).toBe(1.5);
    expect(rows[0].pile_length_m).toBe(4.5);
    expect(summary.piles).toBe(1);
  });

  it("rounds pile lengths up to the increment", () => {
    const grid = gridFrom([[10, 10]], 1);
    const slope = computeSlope(grid);
    const { rows } = buildPileSchedule([{ pile_ref: "P1", easting: 0, northing: 0 }], grid, slope, {
      ...DEFAULT_EMBEDMENT_RULE,
      min_embedment_m: 1.8,
      frost_depth_m: 0.9,
      uplift_factor: 1,
      target_reveal_m: 1.41,
      slope_allowance_span_m: 0,
      round_up_to_m: 0.25,
    });
    expect(rows[0].pile_length_m).toBe(3.25);
  });
});

describe("slopeCheck", () => {
  it("flags blocks above tolerance", () => {
    // 20% east-west slope at 1 m spacing.
    const grid = gridFrom(
      [
        [10, 10.2, 10.4],
        [10, 10.2, 10.4],
        [10, 10.2, 10.4],
      ],
      1,
    );
    const flat = gridFrom(
      [
        [10, 10, 10],
        [10, 10, 10],
      ],
      1,
    );
    const geometry = square(2);
    const steep = runSlopeTolerance(grid, [
      { block_id: "b1", label: "B1", geometry },
    ]);
    expect(steep.results[0].max_in_row_pct).toBeCloseTo(20, 5);
    expect(steep.results[0].status).toBe("fail");
    expect(steep.summary.failing).toBe(1);

    const ok = runSlopeTolerance(flat, [{ block_id: "b2", label: "B2", geometry: square(1) }]);
    expect(ok.results[0].status).toBe("pass");
    expect(ok.summary.passing).toBe(1);
  });

  it("reports no_data when the block misses the grid", () => {
    const grid = gridFrom([[10, 10]], 1);
    const away = {
      type: "Polygon",
      coordinates: [
        [
          [500, 500],
          [510, 500],
          [510, 510],
          [500, 510],
          [500, 500],
        ],
      ],
    };
    const res = runSlopeTolerance(grid, [{ block_id: "b", label: null, geometry: away }]);
    expect(res.results[0].status).toBe("no_data");
  });
});

describe("flow", () => {
  it("accumulates D8 flow downslope", () => {
    const grid = gridFrom(
      [
        [3, 3, 3],
        [2, 2, 2],
        [1, 1, 1],
      ],
      1,
    );
    const flow = computeFlow(grid);
    const total = flow.accumulation.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(9);
    // bottom row (row 0 is originN) — the lowest row holds the outlets
    const lowest = [0, 1, 2].map((c) => flow.accumulation[0 * 3 + c]);
    expect(Math.max(...lowest)).toBeGreaterThan(1);
  });

  it("proposes deterministic drainage paths", () => {
    const rows = 8;
    const cols = 8;
    const values: number[][] = [];
    for (let r = 0; r < rows; r++) {
      const row: number[] = [];
      for (let c = 0; c < cols; c++) row.push(r * 0.5 + Math.abs(c - 3.5) * 0.3);
      values.push(row);
    }
    const grid = gridFrom(values, 5);
    const a = proposeDrainagePaths(grid, { minAccumulationCells: 3, maxPaths: 3 });
    const b = proposeDrainagePaths(grid, { minAccumulationCells: 3, maxPaths: 3 });
    expect(a.length).toBeGreaterThan(0);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a[0].coordinates.length).toBeGreaterThan(1);
  });
});

describe("coordinate schedule", () => {
  it("emits one row per vertex with CSV headers", () => {
    const rows = buildCoordinateSchedule(
      [
        {
          feature_ref: "GRD-001",
          name: "Pad A",
          feature_type: "grading_zone",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [10, 0],
                [10, 10],
                [0, 0],
              ],
            ],
          },
        },
      ],
      () => 812.345,
    );
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ feature_ref: "GRD-001", vertex: 1, elevation_m: 812.345 });
    const csv = coordinateScheduleToCsv(rows);
    expect(csv.split("\n")[0]).toBe(
      "feature_ref,name,type,part,vertex,easting,northing,elevation_m",
    );
    expect(csv.trim().split("\n")).toHaveLength(5);
  });
});
