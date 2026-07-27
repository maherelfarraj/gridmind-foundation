// P-161 — Tracker / fixed-tilt slope tolerance check. Pure module.
// pv_layout_blocks are READ-ONLY inputs here; this module never writes them.
import type { ElevationGrid } from "@/lib/terrain/grid";
import { valueAt } from "@/lib/terrain/grid";

import {
  pointInGeometry,
  ringBBox,
  polygonRings,
  roundTo,
  type GeoJsonGeometry,
} from "@/lib/civil/geom";

export const DEFAULT_MAX_SLOPE_PCT = 10;
/** Blocks between warn_ratio·tolerance and tolerance are flagged "warn". */
export const WARN_RATIO = 0.8;

export type SlopeCheckBlockInput = {
  block_id: string;
  label: string | null;
  geometry: GeoJsonGeometry;
  /** per-block override from pv_layout_blocks/layout properties */
  max_slope_pct?: number | null;
};

export type SlopeCheckStatus = "pass" | "warn" | "fail" | "no_data";

export type SlopeCheckBlockResult = {
  block_id: string;
  label: string | null;
  status: SlopeCheckStatus;
  tolerance_pct: number;
  /** slope along the east-west (in-row) axis, % */
  max_in_row_pct: number;
  /** slope along the north-south (cross-row) axis, % */
  max_cross_row_pct: number;
  max_slope_pct: number;
  samples: number;
};

export type SlopeCheckSummary = {
  blocks: number;
  passing: number;
  warning: number;
  failing: number;
  no_data: number;
  tolerance_pct: number;
  worst_block_id: string | null;
  worst_slope_pct: number;
};

function statusFor(worst: number, tolerance: number, samples: number): SlopeCheckStatus {
  if (samples === 0) return "no_data";
  if (worst > tolerance + 1e-9) return "fail";
  if (worst >= tolerance * WARN_RATIO) return "warn";
  return "pass";
}

/** Directional slopes (%) sampled from the grid nodes inside a block polygon. */
export function sampleBlockSlopes(
  grid: ElevationGrid,
  geometry: GeoJsonGeometry,
): { inRow: number; crossRow: number; samples: number } {
  const rings = polygonRings(geometry);
  const bbox = ringBBox(rings);
  if (!bbox || grid.rows === 0 || grid.cols === 0) return { inRow: 0, crossRow: 0, samples: 0 };

  const cMin = Math.max(0, Math.floor((bbox.minX - grid.originE) / grid.spacing));
  const cMax = Math.min(grid.cols - 1, Math.ceil((bbox.maxX - grid.originE) / grid.spacing));
  const rMin = Math.max(0, Math.floor((bbox.minY - grid.originN) / grid.spacing));
  const rMax = Math.min(grid.rows - 1, Math.ceil((bbox.maxY - grid.originN) / grid.spacing));

  let inRow = 0;
  let crossRow = 0;
  let samples = 0;
  for (let r = rMin; r <= rMax; r++) {
    for (let c = cMin; c <= cMax; c++) {
      const z = valueAt(grid, r, c);
      if (z == null) continue;
      const e = grid.originE + c * grid.spacing;
      const n = grid.originN + r * grid.spacing;
      if (!pointInGeometry(e, n, geometry)) continue;
      samples++;
      const east = valueAt(grid, r, c + 1);
      if (east != null) inRow = Math.max(inRow, (Math.abs(east - z) / grid.spacing) * 100);
      const north = valueAt(grid, r + 1, c);
      if (north != null) crossRow = Math.max(crossRow, (Math.abs(north - z) / grid.spacing) * 100);
    }
  }
  return { inRow, crossRow, samples };
}

export function runSlopeTolerance(
  grid: ElevationGrid,
  blocks: SlopeCheckBlockInput[],
  defaultTolerancePct = DEFAULT_MAX_SLOPE_PCT,
): { results: SlopeCheckBlockResult[]; summary: SlopeCheckSummary } {
  const results: SlopeCheckBlockResult[] = blocks.map((block) => {
    const tolerance =
      block.max_slope_pct != null && Number.isFinite(Number(block.max_slope_pct))
        ? Number(block.max_slope_pct)
        : defaultTolerancePct;
    const { inRow, crossRow, samples } = sampleBlockSlopes(grid, block.geometry);
    const worst = Math.max(inRow, crossRow);
    return {
      block_id: block.block_id,
      label: block.label ?? null,
      status: statusFor(worst, tolerance, samples),
      tolerance_pct: roundTo(tolerance, 2),
      max_in_row_pct: roundTo(inRow, 2),
      max_cross_row_pct: roundTo(crossRow, 2),
      max_slope_pct: roundTo(worst, 2),
      samples,
    };
  });

  let worstBlock: SlopeCheckBlockResult | null = null;
  for (const r of results) {
    if (r.status === "no_data") continue;
    if (!worstBlock || r.max_slope_pct > worstBlock.max_slope_pct) worstBlock = r;
  }

  return {
    results,
    summary: {
      blocks: results.length,
      passing: results.filter((r) => r.status === "pass").length,
      warning: results.filter((r) => r.status === "warn").length,
      failing: results.filter((r) => r.status === "fail").length,
      no_data: results.filter((r) => r.status === "no_data").length,
      tolerance_pct: roundTo(defaultTolerancePct, 2),
      worst_block_id: worstBlock?.block_id ?? null,
      worst_slope_pct: worstBlock?.max_slope_pct ?? 0,
    },
  };
}
