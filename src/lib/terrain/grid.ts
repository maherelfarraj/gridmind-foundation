// P-160 — Pure elevation-grid assembly. No React, no Supabase, no GIS libs.

export type TerrainPointInput = {
  easting: number;
  northing: number;
  elevation_m: number;
  grid_row?: number | null;
  grid_col?: number | null;
};

export type ElevationGrid = {
  rows: number;
  cols: number;
  /** grid spacing in metres */
  spacing: number;
  /** easting of column 0 */
  originE: number;
  /** northing of row 0 */
  originN: number;
  /** row-major values; null = hole */
  values: (number | null)[];
};

export type GridStats = { min: number; max: number; mean: number; filled: number; holes: number };

export function emptyGrid(rows: number, cols: number, spacing: number, originE = 0, originN = 0) {
  return {
    rows,
    cols,
    spacing,
    originE,
    originN,
    values: new Array<number | null>(rows * cols).fill(null),
  } satisfies ElevationGrid;
}

export function idx(grid: ElevationGrid, row: number, col: number): number {
  return row * grid.cols + col;
}

export function valueAt(grid: ElevationGrid, row: number, col: number): number | null {
  if (row < 0 || col < 0 || row >= grid.rows || col >= grid.cols) return null;
  return grid.values[idx(grid, row, col)] ?? null;
}

/** Smallest positive difference between sorted unique coordinates. */
function inferSpacing(sorted: number[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i] - sorted[i - 1];
    if (d > 1e-6 && d < best) best = d;
  }
  return Number.isFinite(best) ? best : 1;
}

/**
 * Assemble points into a row-major grid. Uses grid_row/grid_col when present,
 * otherwise snaps easting/northing onto an inferred regular lattice.
 */
export function buildElevationGrid(
  points: TerrainPointInput[],
  opts?: { spacing?: number },
): ElevationGrid {
  if (points.length === 0) return emptyGrid(0, 0, opts?.spacing ?? 1);

  const eastings = Array.from(new Set(points.map((p) => p.easting))).sort((a, b) => a - b);
  const northings = Array.from(new Set(points.map((p) => p.northing))).sort((a, b) => a - b);
  const spacing = opts?.spacing ?? Math.min(inferSpacing(eastings), inferSpacing(northings));

  const hasIndices = points.every(
    (p) => p.grid_row != null && p.grid_col != null && p.grid_row >= 0 && p.grid_col >= 0,
  );

  const originE = eastings[0];
  const originN = northings[0];

  let rows: number;
  let cols: number;
  const cell = (p: TerrainPointInput): { r: number; c: number } =>
    hasIndices
      ? { r: p.grid_row as number, c: p.grid_col as number }
      : {
          r: Math.round((p.northing - originN) / spacing),
          c: Math.round((p.easting - originE) / spacing),
        };

  if (hasIndices) {
    rows = Math.max(...points.map((p) => p.grid_row as number)) + 1;
    cols = Math.max(...points.map((p) => p.grid_col as number)) + 1;
  } else {
    rows = Math.round((northings[northings.length - 1] - originN) / spacing) + 1;
    cols = Math.round((eastings[eastings.length - 1] - originE) / spacing) + 1;
  }

  const grid = emptyGrid(rows, cols, spacing, originE, originN);
  for (const p of points) {
    const { r, c } = cell(p);
    if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
    grid.values[idx(grid, r, c)] = p.elevation_m;
  }
  return grid;
}

/** Fill nulls by bilinear-style weighted average of the nearest known value on each axis. */
export function fillHoles(grid: ElevationGrid): ElevationGrid {
  const out: ElevationGrid = { ...grid, values: grid.values.slice() };
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (valueAt(grid, r, c) != null) continue;
      const samples: { v: number; w: number }[] = [];
      const scan = (dr: number, dc: number) => {
        let rr = r + dr;
        let cc = c + dc;
        let dist = 1;
        while (rr >= 0 && cc >= 0 && rr < grid.rows && cc < grid.cols) {
          const v = valueAt(grid, rr, cc);
          if (v != null) {
            samples.push({ v, w: 1 / dist });
            return;
          }
          rr += dr;
          cc += dc;
          dist++;
        }
      };
      scan(-1, 0);
      scan(1, 0);
      scan(0, -1);
      scan(0, 1);
      if (samples.length === 0) continue;
      const wsum = samples.reduce((s, x) => s + x.w, 0);
      out.values[idx(grid, r, c)] = samples.reduce((s, x) => s + x.v * x.w, 0) / wsum;
    }
  }
  return out;
}

export function gridStats(grid: ElevationGrid): GridStats {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let filled = 0;
  for (const v of grid.values) {
    if (v == null) continue;
    filled++;
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return {
    min: filled ? min : 0,
    max: filled ? max : 0,
    mean: filled ? sum / filled : 0,
    filled,
    holes: grid.values.length - filled,
  };
}

/** Bilinear sample at world coordinates; null when outside or unresolved. */
export function sampleElevation(grid: ElevationGrid, easting: number, northing: number) {
  if (grid.rows === 0 || grid.cols === 0) return null;
  const fc = (easting - grid.originE) / grid.spacing;
  const fr = (northing - grid.originN) / grid.spacing;
  const c0 = Math.floor(fc);
  const r0 = Math.floor(fr);
  const tx = fc - c0;
  const ty = fr - r0;
  const v00 = valueAt(grid, r0, c0);
  const v01 = valueAt(grid, r0, c0 + 1) ?? v00;
  const v10 = valueAt(grid, r0 + 1, c0) ?? v00;
  const v11 = valueAt(grid, r0 + 1, c0 + 1) ?? v01 ?? v10 ?? v00;
  if (v00 == null || v01 == null || v10 == null || v11 == null) return null;
  const a = v00 * (1 - tx) + v01 * tx;
  const b = v10 * (1 - tx) + v11 * tx;
  return a * (1 - ty) + b * ty;
}

export function gridToPointRows(grid: ElevationGrid): {
  easting: number;
  northing: number;
  elevation_m: number;
  grid_row: number;
  grid_col: number;
}[] {
  const rows: ReturnType<typeof gridToPointRows> = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const v = valueAt(grid, r, c);
      if (v == null) continue;
      rows.push({
        easting: grid.originE + c * grid.spacing,
        northing: grid.originN + r * grid.spacing,
        elevation_m: v,
        grid_row: r,
        grid_col: c,
      });
    }
  }
  return rows;
}
