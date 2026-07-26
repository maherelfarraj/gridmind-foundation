// P-161 — Cut & fill volumes over a grading zone. Pure module.
import type { ElevationGrid } from "@/lib/terrain/grid";
import { valueAt } from "@/lib/terrain/grid";

import { pointInGeometry, polygonArea, roundTo, type GeoJsonGeometry } from "@/lib/civil/geom";

/**
 * Design model taken from a grading_zone feature's `properties`:
 *  - flat pad:  { design_elevation_m: 812.5 }
 *  - sloped:    { design_slope_pct: 2, design_slope_direction_deg: 90,
 *                 design_reference_elevation_m: 812, design_reference_easting/northing }
 * When no reference point is supplied the zone centroid is used at the mean
 * existing elevation, which yields a balanced (best-fit) plane origin.
 */
export type DesignModel = {
  design_elevation_m?: number | null;
  design_slope_pct?: number | null;
  design_slope_direction_deg?: number | null;
  design_reference_elevation_m?: number | null;
  design_reference_easting?: number | null;
  design_reference_northing?: number | null;
};

export type CutFillResult = {
  cut_m3: number;
  fill_m3: number;
  net_m3: number;
  area_m2: number;
  polygon_area_m2: number;
  cell_area_m2: number;
  cells: number;
  max_cut_m: number;
  max_fill_m: number;
  mean_existing_m: number | null;
  method: "flat_pad" | "sloped_plane" | "balanced_plane";
};

export type DesignPlane = {
  /** elevation at the reference point */
  z0: number;
  e0: number;
  n0: number;
  /** metres of rise per metre east / north */
  gradeE: number;
  gradeN: number;
  method: CutFillResult["method"];
};

type Cell = { e: number; n: number; z: number };

/** Grid nodes inside the geometry, each representing one spacing² cell. */
export function cellsInGeometry(grid: ElevationGrid, geometry: GeoJsonGeometry): Cell[] {
  const out: Cell[] = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const z = valueAt(grid, r, c);
      if (z == null) continue;
      const e = grid.originE + c * grid.spacing;
      const n = grid.originN + r * grid.spacing;
      if (!pointInGeometry(e, n, geometry)) continue;
      out.push({ e, n, z });
    }
  }
  return out;
}

export function buildDesignPlane(model: DesignModel, cells: Cell[]): DesignPlane | null {
  if (cells.length === 0) return null;
  const meanE = cells.reduce((a, c) => a + c.e, 0) / cells.length;
  const meanN = cells.reduce((a, c) => a + c.n, 0) / cells.length;
  const meanZ = cells.reduce((a, c) => a + c.z, 0) / cells.length;

  const slopePct = Number(model.design_slope_pct ?? 0);
  const hasSlope = Number.isFinite(slopePct) && Math.abs(slopePct) > 1e-9;
  const flat = model.design_elevation_m;
  const hasFlat = flat != null && Number.isFinite(Number(flat));

  const e0 =
    model.design_reference_easting != null && Number.isFinite(Number(model.design_reference_easting))
      ? Number(model.design_reference_easting)
      : meanE;
  const n0 =
    model.design_reference_northing != null &&
    Number.isFinite(Number(model.design_reference_northing))
      ? Number(model.design_reference_northing)
      : meanN;

  if (!hasSlope) {
    if (!hasFlat) return null;
    return { z0: Number(flat), e0, n0, gradeE: 0, gradeN: 0, method: "flat_pad" };
  }

  // Direction the surface falls towards, clockwise from north.
  const dirDeg = Number(model.design_slope_direction_deg ?? 0);
  const rad = (dirDeg * Math.PI) / 180;
  const unitE = Math.sin(rad);
  const unitN = Math.cos(rad);
  const grade = slopePct / 100;
  const gradeE = -grade * unitE;
  const gradeN = -grade * unitN;

  const refZ =
    model.design_reference_elevation_m != null &&
    Number.isFinite(Number(model.design_reference_elevation_m))
      ? Number(model.design_reference_elevation_m)
      : hasFlat
        ? Number(flat)
        : null;

  if (refZ == null) {
    // Balanced plane: same gradient, elevation set so cut ≈ fill at the centroid.
    return {
      z0: meanZ,
      e0: meanE,
      n0: meanN,
      gradeE,
      gradeN,
      method: "balanced_plane",
    };
  }
  return { z0: refZ, e0, n0, gradeE, gradeN, method: "sloped_plane" };
}

export function designElevationAt(plane: DesignPlane, easting: number, northing: number): number {
  return plane.z0 + (easting - plane.e0) * plane.gradeE + (northing - plane.n0) * plane.gradeN;
}

export class CutFillError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "CutFillError";
  }
}

export function computeCutFill(
  grid: ElevationGrid,
  geometry: GeoJsonGeometry,
  model: DesignModel,
): CutFillResult {
  const cells = cellsInGeometry(grid, geometry);
  if (cells.length === 0) {
    throw new CutFillError(
      "no_cells",
      "The grading zone does not overlap any terrain grid nodes on this surface.",
    );
  }
  const plane = buildDesignPlane(model, cells);
  if (!plane) {
    throw new CutFillError(
      "no_design_model",
      "Set design_elevation_m, or design_slope_pct with a direction, on the zone properties.",
    );
  }

  const cellArea = grid.spacing * grid.spacing;
  let cut = 0;
  let fill = 0;
  let maxCut = 0;
  let maxFill = 0;
  let sumZ = 0;
  for (const cell of cells) {
    const dz = cell.z - designElevationAt(plane, cell.e, cell.n);
    sumZ += cell.z;
    if (dz > 0) {
      cut += dz * cellArea;
      if (dz > maxCut) maxCut = dz;
    } else if (dz < 0) {
      fill += -dz * cellArea;
      if (-dz > maxFill) maxFill = -dz;
    }
  }

  return {
    cut_m3: roundTo(cut, 2),
    fill_m3: roundTo(fill, 2),
    net_m3: roundTo(cut - fill, 2),
    area_m2: roundTo(cells.length * cellArea, 2),
    polygon_area_m2: roundTo(polygonArea(geometry), 2),
    cell_area_m2: roundTo(cellArea, 4),
    cells: cells.length,
    max_cut_m: roundTo(maxCut, 3),
    max_fill_m: roundTo(maxFill, 3),
    mean_existing_m: roundTo(sumZ / cells.length, 3),
    method: plane.method,
  };
}
