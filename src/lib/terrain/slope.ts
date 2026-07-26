// P-160 — Slope / aspect from central differences. Pure module.
import { valueAt, type ElevationGrid } from "@/lib/terrain/grid";

export type SlopeGrid = {
  rows: number;
  cols: number;
  spacing: number;
  originE: number;
  originN: number;
  /** slope in percent, row-major; null where undetermined */
  slopePct: (number | null)[];
  /** aspect in degrees clockwise from north (0..360); null where flat/undetermined */
  aspectDeg: (number | null)[];
};

export type SlopeStats = {
  min: number;
  max: number;
  mean: number;
  /** share of cells above the given threshold, 0..1 */
  aboveThreshold: number;
};

export function computeSlope(grid: ElevationGrid): SlopeGrid {
  const slopePct = new Array<number | null>(grid.rows * grid.cols).fill(null);
  const aspectDeg = new Array<number | null>(grid.rows * grid.cols).fill(null);
  const h = grid.spacing;

  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const centre = valueAt(grid, r, c);
      if (centre == null) continue;
      const e = valueAt(grid, r, c + 1) ?? centre;
      const w = valueAt(grid, r, c - 1) ?? centre;
      const n = valueAt(grid, r + 1, c) ?? centre;
      const s = valueAt(grid, r - 1, c) ?? centre;
      const spanX = (valueAt(grid, r, c + 1) != null ? 1 : 0) + (valueAt(grid, r, c - 1) != null ? 1 : 0);
      const spanY = (valueAt(grid, r + 1, c) != null ? 1 : 0) + (valueAt(grid, r - 1, c) != null ? 1 : 0);
      if (spanX === 0 && spanY === 0) continue;
      const dzdx = spanX > 0 ? (e - w) / (spanX * h) : 0;
      const dzdy = spanY > 0 ? (n - s) / (spanY * h) : 0;
      const i = r * grid.cols + c;
      slopePct[i] = Math.sqrt(dzdx * dzdx + dzdy * dzdy) * 100;
      if (Math.abs(dzdx) < 1e-12 && Math.abs(dzdy) < 1e-12) {
        aspectDeg[i] = null;
      } else {
        // downslope direction, clockwise from north
        let a = (Math.atan2(-dzdx, -dzdy) * 180) / Math.PI;
        if (a < 0) a += 360;
        aspectDeg[i] = a;
      }
    }
  }

  return {
    rows: grid.rows,
    cols: grid.cols,
    spacing: grid.spacing,
    originE: grid.originE,
    originN: grid.originN,
    slopePct,
    aspectDeg,
  };
}

export function slopeAt(slope: SlopeGrid, row: number, col: number): number | null {
  if (row < 0 || col < 0 || row >= slope.rows || col >= slope.cols) return null;
  return slope.slopePct[row * slope.cols + col] ?? null;
}

export function slopeStats(slope: SlopeGrid, threshold = 5): SlopeStats {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let n = 0;
  let above = 0;
  for (const v of slope.slopePct) {
    if (v == null) continue;
    n++;
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
    if (v > threshold) above++;
  }
  return {
    min: n ? min : 0,
    max: n ? max : 0,
    mean: n ? sum / n : 0,
    aboveThreshold: n ? above / n : 0,
  };
}

/** 0..1 ramp position for a slope value, clamped to [0, maxSlope]. */
export function slopeRampT(value: number, maxSlope: number): number {
  if (!(maxSlope > 0)) return 0;
  return Math.max(0, Math.min(1, value / maxSlope));
}
