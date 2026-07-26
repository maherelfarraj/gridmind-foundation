// P-161 — D8 flow direction / accumulation and proposed drainage paths.
// Pure module: the engine only PROPOSES paths; persistence requires human
// confirmation upstream (draft civil_features).
import type { ElevationGrid } from "@/lib/terrain/grid";
import { valueAt } from "@/lib/terrain/grid";

import { lineLength, roundTo, type Vertex } from "@/lib/civil/geom";

/** D8 neighbour offsets: [dRow, dCol]. Diagonals use √2 distance weighting. */
const NEIGHBOURS: Array<[number, number]> = [
  [0, 1],
  [1, 1],
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
];

export type FlowGrid = {
  rows: number;
  cols: number;
  /** index into NEIGHBOURS, or -1 for a sink / no-data cell */
  direction: Int8Array;
  /** number of upstream cells draining through each cell (including itself) */
  accumulation: Float64Array;
};

export function computeFlow(grid: ElevationGrid): FlowGrid {
  const n = grid.rows * grid.cols;
  const direction = new Int8Array(n).fill(-1);
  const accumulation = new Float64Array(n);

  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const i = r * grid.cols + c;
      const z = valueAt(grid, r, c);
      if (z == null) continue;
      accumulation[i] = 1;
      let best = -1;
      let bestDrop = 0;
      for (let k = 0; k < NEIGHBOURS.length; k++) {
        const [dr, dc] = NEIGHBOURS[k];
        const zn = valueAt(grid, r + dr, c + dc);
        if (zn == null) continue;
        const dist = grid.spacing * (dr !== 0 && dc !== 0 ? Math.SQRT2 : 1);
        const drop = (z - zn) / dist;
        if (drop > bestDrop + 1e-12) {
          bestDrop = drop;
          best = k;
        }
      }
      direction[i] = best;
    }
  }

  // Accumulate in descending-elevation order so upstream cells resolve first.
  const order: number[] = [];
  for (let i = 0; i < n; i++) if (direction[i] !== -1 || grid.values[i] != null) order.push(i);
  order.sort((a, b) => (grid.values[b] ?? -Infinity) - (grid.values[a] ?? -Infinity));

  for (const i of order) {
    const k = direction[i];
    if (k === -1) continue;
    const r = Math.floor(i / grid.cols);
    const c = i % grid.cols;
    const [dr, dc] = NEIGHBOURS[k];
    const j = (r + dr) * grid.cols + (c + dc);
    accumulation[j] += accumulation[i];
  }

  return { rows: grid.rows, cols: grid.cols, direction, accumulation };
}

export type DrainageProposal = {
  proposal_ref: string;
  coordinates: Vertex[];
  /** peak contributing cells along the path */
  accumulation_cells: number;
  /** contributing catchment area in m² */
  catchment_m2: number;
  length_m: number;
};

export type DrainageOptions = {
  /** a cell starts a channel once this many upstream cells drain through it */
  minAccumulationCells?: number;
  maxPaths?: number;
  /** ignore proposals shorter than this (m) */
  minLengthM?: number;
};

/**
 * Walk downslope from the highest-accumulation channel heads. Cells already
 * consumed by a previous path terminate the walk, so paths never duplicate.
 */
export function proposeDrainagePaths(
  grid: ElevationGrid,
  options: DrainageOptions = {},
): DrainageProposal[] {
  const flow = computeFlow(grid);
  const cellArea = grid.spacing * grid.spacing;
  const threshold = Math.max(
    2,
    options.minAccumulationCells ?? Math.max(8, Math.round((grid.rows * grid.cols) / 50)),
  );
  const maxPaths = options.maxPaths ?? 5;
  const minLength = options.minLengthM ?? grid.spacing * 3;

  const candidates: number[] = [];
  for (let i = 0; i < flow.accumulation.length; i++) {
    if (flow.accumulation[i] >= threshold) candidates.push(i);
  }
  candidates.sort((a, b) => flow.accumulation[b] - flow.accumulation[a]);

  const used = new Set<number>();
  const proposals: DrainageProposal[] = [];

  for (const start of candidates) {
    if (proposals.length >= maxPaths) break;
    if (used.has(start)) continue;
    const coords: Vertex[] = [];
    let peak = 0;
    let i = start;
    const guard = grid.rows * grid.cols;
    for (let step = 0; step < guard; step++) {
      if (used.has(i)) break;
      used.add(i);
      const r = Math.floor(i / grid.cols);
      const c = i % grid.cols;
      coords.push([grid.originE + c * grid.spacing, grid.originN + r * grid.spacing]);
      peak = Math.max(peak, flow.accumulation[i]);
      const k = flow.direction[i];
      if (k === -1) break;
      const [dr, dc] = NEIGHBOURS[k];
      i = (r + dr) * grid.cols + (c + dc);
    }
    if (coords.length < 2) continue;
    const length = lineLength(coords);
    if (length < minLength) continue;
    proposals.push({
      proposal_ref: `DR-${String(proposals.length + 1).padStart(2, "0")}`,
      coordinates: coords,
      accumulation_cells: Math.round(peak),
      catchment_m2: roundTo(peak * cellArea, 2),
      length_m: roundTo(length, 2),
    });
  }

  return proposals;
}

export function proposalToGeoJson(proposal: DrainageProposal) {
  return { type: "LineString", coordinates: proposal.coordinates } as const;
}
