// P-161 — Pile length estimation from ground slope + embedment rule. Pure module.
import type { ElevationGrid } from "@/lib/terrain/grid";
import { sampleElevation } from "@/lib/terrain/grid";
import { slopeAt, type SlopeGrid } from "@/lib/terrain/slope";

import { pointInGeometry, polygonRings, ringBBox, roundTo } from "@/lib/civil/geom";

export type PilePosition = {
  pile_ref: string;
  easting: number;
  northing: number;
  /** optional grouping (tracker row / block) carried through to the schedule */
  row_ref?: string | null;
  block_ref?: string | null;
};

export type EmbedmentRule = {
  /** structural minimum embedment depth (m) */
  min_embedment_m: number;
  /** frost / weak-soil depth that embedment must reach (m) */
  frost_depth_m: number;
  /** uplift multiplier applied to the governing embedment */
  uplift_factor: number;
  /** nominal reveal at a flat position (m) */
  target_reveal_m: number;
  /**
   * Half-length of the pile's tributary beam (m). Reveal grows by the ground
   * fall across this distance so the upslope pile keeps the table planar.
   */
  slope_allowance_span_m: number;
  /** round the finished pile length up to this increment (m); 0 = no rounding */
  round_up_to_m?: number;
  /** hard cap used to flag piles needing a special foundation (m) */
  max_pile_length_m?: number;
};

export const DEFAULT_EMBEDMENT_RULE: EmbedmentRule = {
  min_embedment_m: 1.8,
  frost_depth_m: 0.9,
  uplift_factor: 1.15,
  target_reveal_m: 1.4,
  slope_allowance_span_m: 2.5,
  round_up_to_m: 0.25,
  max_pile_length_m: 6,
};

export type PileScheduleRow = {
  pile_ref: string;
  row_ref: string | null;
  block_ref: string | null;
  easting: number;
  northing: number;
  ground_elevation_m: number | null;
  slope_pct: number;
  reveal_m: number;
  embedment_m: number;
  pile_length_m: number;
  exceeds_max: boolean;
};

export type PileScheduleSummary = {
  piles: number;
  total_length_m: number;
  min_length_m: number;
  max_length_m: number;
  mean_length_m: number;
  exceeding: number;
};

export function embedmentFor(rule: EmbedmentRule): number {
  const governing = Math.max(rule.min_embedment_m, rule.frost_depth_m);
  return roundTo(governing * Math.max(1, rule.uplift_factor), 3);
}

export function revealFor(slopePct: number, rule: EmbedmentRule): number {
  const fall = (Math.abs(slopePct) / 100) * Math.max(0, rule.slope_allowance_span_m);
  return roundTo(rule.target_reveal_m + fall, 3);
}

function roundUp(value: number, increment: number): number {
  if (!increment || increment <= 0) return roundTo(value, 3);
  return roundTo(Math.ceil(value / increment - 1e-9) * increment, 3);
}

export function buildPileSchedule(
  positions: PilePosition[],
  grid: ElevationGrid,
  slope: SlopeGrid,
  rule: EmbedmentRule = DEFAULT_EMBEDMENT_RULE,
): { rows: PileScheduleRow[]; summary: PileScheduleSummary; embedment_m: number } {
  const embedment = embedmentFor(rule);
  const rows: PileScheduleRow[] = positions.map((p) => {
    const r = Math.round((p.northing - grid.originN) / grid.spacing);
    const c = Math.round((p.easting - grid.originE) / grid.spacing);
    const slopePct = slopeAt(slope, r, c) ?? 0;
    const reveal = revealFor(slopePct, rule);
    const length = roundUp(reveal + embedment, rule.round_up_to_m ?? 0);
    return {
      pile_ref: p.pile_ref,
      row_ref: p.row_ref ?? null,
      block_ref: p.block_ref ?? null,
      easting: p.easting,
      northing: p.northing,
      ground_elevation_m: sampleElevation(grid, p.easting, p.northing),
      slope_pct: roundTo(slopePct, 2),
      reveal_m: reveal,
      embedment_m: embedment,
      pile_length_m: length,
      exceeds_max: rule.max_pile_length_m != null && length > rule.max_pile_length_m + 1e-9,
    };
  });

  const lengths = rows.map((r) => r.pile_length_m);
  const total = lengths.reduce((a, b) => a + b, 0);
  return {
    rows,
    embedment_m: embedment,
    summary: {
      piles: rows.length,
      total_length_m: roundTo(total, 2),
      min_length_m: lengths.length ? roundTo(Math.min(...lengths), 3) : 0,
      max_length_m: lengths.length ? roundTo(Math.max(...lengths), 3) : 0,
      mean_length_m: lengths.length ? roundTo(total / lengths.length, 3) : 0,
      exceeding: rows.filter((r) => r.exceeds_max).length,
    },
  };
}

/**
 * Derive pile positions from a PV layout block polygon (blocks are read-only
 * inputs). Rows run east-west; piles are placed at a fixed spacing along each
 * row, inset half a spacing from the block edge.
 */
export function pilePositionsFromBlock(
  block: {
    block_id: string;
    label?: string | null;
    geometry: { type: string; coordinates: unknown };
    module_rows?: number | null;
  },
  options: { pile_spacing_m?: number; max_piles_per_block?: number } = {},
): PilePosition[] {
  const rings = polygonRings(block.geometry);
  const bbox = ringBBox(rings);
  if (!bbox) return [];
  const spacing = Math.max(1, options.pile_spacing_m ?? 6);
  const maxPiles = options.max_piles_per_block ?? 400;
  const rows = Math.max(1, Math.round(block.module_rows ?? 1));
  const width = bbox.maxX - bbox.minX;
  const height = bbox.maxY - bbox.minY;
  const perRow = Math.max(2, Math.floor(width / spacing) + 1);
  const out: PilePosition[] = [];

  for (let r = 0; r < rows; r++) {
    const n = rows === 1 ? bbox.minY + height / 2 : bbox.minY + (height * (r + 0.5)) / rows;
    for (let p = 0; p < perRow; p++) {
      if (out.length >= maxPiles) return out;
      const e = perRow === 1 ? bbox.minX + width / 2 : bbox.minX + (width * p) / (perRow - 1);
      if (!pointInGeometry(e, n, block.geometry)) continue;
      out.push({
        pile_ref: `${block.label ?? block.block_id.slice(0, 8)}-R${r + 1}-P${p + 1}`,
        easting: roundTo(e, 3),
        northing: roundTo(n, 3),
        row_ref: `R${r + 1}`,
        block_ref: block.label ?? block.block_id,
      });
    }
  }
  return out;
}
