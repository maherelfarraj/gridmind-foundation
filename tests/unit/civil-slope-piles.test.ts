// P-164 — Pile lengths, tracker slope tolerance and D8 flow routing. Fully offline.
import { describe, expect, it } from "vitest";

import { computeFlow } from "@/lib/civil/flow";
import type { GeoJsonGeometry } from "@/lib/civil/geom";
import {
  DEFAULT_EMBEDMENT_RULE,
  buildPileSchedule,
  embedmentFor,
  revealFor,
  type EmbedmentRule,
} from "@/lib/civil/piles";
import { runSlopeTolerance } from "@/lib/civil/slopeCheck";
import { emptyGrid, idx, type ElevationGrid } from "@/lib/terrain/grid";
import { computeSlope } from "@/lib/terrain/slope";

const SPACING = 10;

/** Grid tilted by `slopePct` towards +east (elevation falls eastward). */
function tiltedGrid(rows: number, cols: number, slopePct: number, base = 100): ElevationGrid {
  const grid = emptyGrid(rows, cols, SPACING);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      grid.values[idx(grid, r, c)] = base - (slopePct / 100) * c * SPACING;
    }
  }
  return grid;
}

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

describe("pile length rule", () => {
  const rule: EmbedmentRule = {
    ...DEFAULT_EMBEDMENT_RULE,
    round_up_to_m: 0, // exercise the raw arithmetic
  };

  it("computes pile_length = reveal + embedment", () => {
    const embedment = embedmentFor(rule);
    const reveal = revealFor(0, rule);
    const grid = tiltedGrid(3, 3, 0);
    const slope = computeSlope(grid);
    const { rows } = buildPileSchedule(
      [{ pile_ref: "P-1", easting: SPACING, northing: SPACING }],
      grid,
      slope,
      rule,
    );
    expect(rows[0].embedment_m).toBeCloseTo(embedment, 6);
    expect(rows[0].reveal_m).toBeCloseTo(reveal, 6);
    expect(rows[0].pile_length_m).toBeCloseTo(reveal + embedment, 6);
  });

  it("enforces the embedment floor (frost depth and uplift govern)", () => {
    expect(
      embedmentFor({ ...rule, min_embedment_m: 0.2, frost_depth_m: 1.5, uplift_factor: 1 }),
    ).toBeCloseTo(1.5, 6);
    expect(
      embedmentFor({ ...rule, min_embedment_m: 2, frost_depth_m: 0.5, uplift_factor: 1 }),
    ).toBeCloseTo(2, 6);
    // an uplift factor below 1 never reduces embedment
    expect(
      embedmentFor({ ...rule, min_embedment_m: 2, frost_depth_m: 0.5, uplift_factor: 0.5 }),
    ).toBeCloseTo(2, 6);
  });

  it("increases reveal — and therefore pile length — monotonically with slope", () => {
    const lengths = [0, 2, 5, 10, 20].map(
      (slopePct) => revealFor(slopePct, rule) + embedmentFor(rule),
    );
    for (let i = 1; i < lengths.length; i++) {
      expect(lengths[i]).toBeGreaterThan(lengths[i - 1]);
    }
    expect(revealFor(-10, rule)).toBeCloseTo(revealFor(10, rule), 9);
  });

  it("flags piles past the maximum length and rounds up to the increment", () => {
    const grid = tiltedGrid(5, 5, 25);
    const slope = computeSlope(grid);
    const capped: EmbedmentRule = { ...DEFAULT_EMBEDMENT_RULE, max_pile_length_m: 3 };
    const { rows, summary } = buildPileSchedule(
      [
        { pile_ref: "P-1", easting: SPACING, northing: SPACING },
        { pile_ref: "P-2", easting: 2 * SPACING, northing: 2 * SPACING },
      ],
      grid,
      slope,
      capped,
    );
    expect(summary.piles).toBe(2);
    expect(summary.exceeding).toBe(2);
    for (const row of rows) {
      expect(row.exceeds_max).toBe(true);
      expect((Math.round((row.pile_length_m / 0.25) * 1e6) / 1e6) % 1).toBe(0);
    }
    expect(summary.total_length_m).toBeCloseTo(rows[0].pile_length_m + rows[1].pile_length_m, 6);
  });
});

describe("tracker slope tolerance", () => {
  const zone = box(-1, -1, 4 * SPACING + 1, 4 * SPACING + 1);
  const check = (gradePct: number, tolerance = 10) =>
    runSlopeTolerance(
      tiltedGrid(5, 5, gradePct),
      [{ block_id: "B-1", label: "Block 1", geometry: zone }],
      tolerance,
    ).results[0];

  it("fails a 12% grade against a 10% tolerance", () => {
    const result = check(12);
    expect(result.status).toBe("fail");
    expect(result.max_in_row_pct).toBeCloseTo(12, 6);
    expect(result.max_cross_row_pct).toBeCloseTo(0, 6);
    expect(result.max_slope_pct).toBeCloseTo(12, 6);
  });

  it("passes an 8% grade", () => {
    const result = check(8);
    expect(result.status).toBe("warn"); // 8% sits in the 80%-of-tolerance warning band
    expect(result.max_slope_pct).toBeCloseTo(8, 6);
    expect(check(5).status).toBe("pass");
  });

  it("treats exactly at tolerance as passing with a margin warning (boundary inclusive)", () => {
    const result = check(10);
    expect(result.status).toBe("warn");
    expect(result.status).not.toBe("fail");
    expect(result.max_slope_pct).toBeCloseTo(10, 6);
  });

  it("honours a per-block tolerance override and reports no_data off-grid", () => {
    const grid = tiltedGrid(5, 5, 12);
    const { results, summary } = runSlopeTolerance(
      grid,
      [
        { block_id: "B-1", label: null, geometry: zone, max_slope_pct: 15 },
        { block_id: "B-2", label: null, geometry: box(9000, 9000, 9100, 9100) },
      ],
      10,
    );
    // 12% against a 15% block override sits in the 80%-of-tolerance warn band
    expect(results[0].status).toBe("warn");
    expect(results[0].status).not.toBe("fail");
    expect(results[0].tolerance_pct).toBe(15);
    expect(results[1].status).toBe("no_data");
    expect(summary.no_data).toBe(1);
    expect(summary.worst_block_id).toBe("B-1");
  });
});

describe("D8 flow routing", () => {
  it("routes a tilted plane consistently toward the lowest corner", () => {
    // falls to the east and to the south → lowest node is (row 0, last col)
    const rows = 5;
    const cols = 5;
    const grid = emptyGrid(rows, cols, SPACING);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        grid.values[idx(grid, r, c)] = 100 - 0.5 * c + 0.3 * r;
      }
    }

    const flow = computeFlow(grid);
    const outlet = 0 * cols + (cols - 1);
    expect(flow.direction[outlet]).toBe(-1); // sink: nothing lower to drain into
    expect(flow.accumulation[outlet]).toBe(rows * cols);

    let sinks = 0;
    for (let i = 0; i < rows * cols; i++) if (flow.direction[i] === -1) sinks++;
    expect(sinks).toBe(1);

    // every cell drains to a strictly lower neighbour
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const k = flow.direction[i];
        if (k === -1) continue;
        expect(flow.accumulation[i]).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("marks a flat grid entirely as sinks", () => {
    const grid = emptyGrid(3, 3, SPACING);
    grid.values.fill(100);
    const flow = computeFlow(grid);
    expect(Array.from(flow.direction)).toEqual(new Array(9).fill(-1));
    expect(Array.from(flow.accumulation)).toEqual(new Array(9).fill(1));
  });
});
