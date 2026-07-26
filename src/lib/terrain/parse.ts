// P-160 — Pure parsers for terrain sources (CSV survey points + Esri ASCII grid).
// No React / Supabase / GIS imports.
import { emptyGrid, idx, type ElevationGrid, type TerrainPointInput } from "@/lib/terrain/grid";

export class TerrainParseError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "TerrainParseError";
  }
}

export type ParsedSurface = {
  kind: "csv_upload" | "dem_lite";
  points: TerrainPointInput[];
  spacing: number;
  rows: number | null;
  cols: number | null;
  minElevation: number;
  maxElevation: number;
  originE: number | null;
  originN: number | null;
};

const MIN_ELEVATION_M = -500;
const MAX_ELEVATION_M = 9000;
export const MAX_TERRAIN_POINTS = 40000;

function assertPlausible(z: number, line: number) {
  if (!Number.isFinite(z)) throw new TerrainParseError("bad_value", `Line ${line}: elevation is not a number.`);
  if (z < MIN_ELEVATION_M || z > MAX_ELEVATION_M) {
    throw new TerrainParseError(
      "implausible_elevation",
      `Line ${line}: elevation ${z} m is outside the plausible range ${MIN_ELEVATION_M}…${MAX_ELEVATION_M} m.`,
    );
  }
}

function splitLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

/** CSV with a header containing easting, northing, elevation_m (any order). */
export function parseTerrainCsv(text: string): ParsedSurface {
  const lines = splitLines(text);
  if (lines.length < 2) throw new TerrainParseError("empty_file", "The file has no data rows.");

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const iE = header.findIndex((h) => h === "easting" || h === "x");
  const iN = header.findIndex((h) => h === "northing" || h === "y");
  const iZ = header.findIndex((h) => h === "elevation_m" || h === "elevation" || h === "z");
  if (iE < 0 || iN < 0 || iZ < 0) {
    throw new TerrainParseError(
      "bad_header",
      "CSV header must contain easting, northing and elevation_m columns.",
    );
  }

  const points: TerrainPointInput[] = [];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim());
    if (cells.length < header.length) {
      throw new TerrainParseError(
        "ragged_row",
        `Line ${i + 1}: expected ${header.length} columns, found ${cells.length}.`,
      );
    }
    const easting = Number(cells[iE]);
    const northing = Number(cells[iN]);
    const elevation = Number(cells[iZ]);
    if (!Number.isFinite(easting) || !Number.isFinite(northing)) {
      throw new TerrainParseError("bad_value", `Line ${i + 1}: easting/northing is not a number.`);
    }
    assertPlausible(elevation, i + 1);
    points.push({ easting, northing, elevation_m: elevation });
    if (elevation < min) min = elevation;
    if (elevation > max) max = elevation;
    if (points.length > MAX_TERRAIN_POINTS) {
      throw new TerrainParseError(
        "too_many_points",
        `Files are limited to ${MAX_TERRAIN_POINTS.toLocaleString()} points.`,
      );
    }
  }

  if (points.length === 0) throw new TerrainParseError("empty_file", "No usable rows found.");

  return {
    kind: "csv_upload",
    points,
    spacing: inferSpacingFromPoints(points),
    rows: null,
    cols: null,
    minElevation: min,
    maxElevation: max,
    originE: Math.min(...points.map((p) => p.easting)),
    originN: Math.min(...points.map((p) => p.northing)),
  };
}

function inferSpacingFromPoints(points: TerrainPointInput[]): number {
  const uniq = (xs: number[]) => Array.from(new Set(xs)).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (const axis of [uniq(points.map((p) => p.easting)), uniq(points.map((p) => p.northing))]) {
    for (let i = 1; i < axis.length; i++) {
      const d = axis[i] - axis[i - 1];
      if (d > 1e-6) gaps.push(d);
    }
  }
  if (gaps.length === 0) return 1;
  return Math.min(...gaps);
}

/** Esri ASCII grid (DEM-lite). */
export function parseEsriAsciiGrid(text: string): ParsedSurface {
  const lines = splitLines(text);
  const header: Record<string, number> = {};
  let cursor = 0;
  const required = ["ncols", "nrows", "xllcorner", "yllcorner", "cellsize"];

  while (cursor < lines.length) {
    const parts = lines[cursor].split(/\s+/);
    const k = parts[0]?.toLowerCase();
    if (!k || !/^[a-z_]+$/.test(k)) break;
    const v = Number(parts[1]);
    if (!Number.isFinite(v)) {
      throw new TerrainParseError("bad_header", `Header "${lines[cursor]}" has no numeric value.`);
    }
    header[k] = v;
    cursor++;
  }

  for (const k of required) {
    if (header[k] === undefined) {
      throw new TerrainParseError("bad_header", `Missing "${k}" in the DEM header.`);
    }
  }
  const cols = Math.round(header.ncols);
  const rows = Math.round(header.nrows);
  const cellsize = header.cellsize;
  if (!(cols > 0 && rows > 0)) throw new TerrainParseError("bad_header", "ncols/nrows must be positive.");
  if (!(cellsize > 0)) throw new TerrainParseError("bad_header", "cellsize must be greater than zero.");
  if (rows * cols > MAX_TERRAIN_POINTS) {
    throw new TerrainParseError(
      "too_many_points",
      `Grid of ${rows}×${cols} exceeds the ${MAX_TERRAIN_POINTS.toLocaleString()} point limit.`,
    );
  }
  const nodata = header.nodata_value ?? -9999;

  const body = lines.slice(cursor);
  if (body.length !== rows) {
    throw new TerrainParseError(
      "ragged_row",
      `Expected ${rows} data rows after the header, found ${body.length}.`,
    );
  }

  const points: TerrainPointInput[] = [];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  body.forEach((line, r) => {
    const cells = line.split(/\s+/).filter(Boolean);
    if (cells.length !== cols) {
      throw new TerrainParseError(
        "ragged_row",
        `Data row ${r + 1}: expected ${cols} values, found ${cells.length}.`,
      );
    }
    cells.forEach((cell, c) => {
      const z = Number(cell);
      if (!Number.isFinite(z)) {
        throw new TerrainParseError("bad_value", `Data row ${r + 1}, column ${c + 1}: not a number.`);
      }
      if (z === nodata) return;
      assertPlausible(z, r + 1);
      // Esri rows run north → south; flip to a north-up row index.
      const gridRow = rows - 1 - r;
      points.push({
        easting: header.xllcorner + c * cellsize,
        northing: header.yllcorner + gridRow * cellsize,
        elevation_m: z,
        grid_row: gridRow,
        grid_col: c,
      });
      if (z < min) min = z;
      if (z > max) max = z;
    });
  });

  if (points.length === 0) {
    throw new TerrainParseError("empty_file", "Every cell was NODATA — nothing to import.");
  }

  return {
    kind: "dem_lite",
    points,
    spacing: cellsize,
    rows,
    cols,
    minElevation: min,
    maxElevation: max,
    originE: header.xllcorner,
    originN: header.yllcorner,
  };
}

export function parseTerrainFile(fileName: string, text: string): ParsedSurface {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".asc") || lower.endsWith(".txt") || lower.endsWith(".dem")) {
    return parseEsriAsciiGrid(text);
  }
  if (lower.endsWith(".csv")) return parseTerrainCsv(text);
  throw new TerrainParseError("unsupported_extension", "Upload a .csv or Esri ASCII .asc/.txt file.");
}

/** Grid straight from a parsed DEM (keeps NODATA holes as nulls). */
export function parsedToGrid(parsed: ParsedSurface): ElevationGrid {
  if (parsed.rows == null || parsed.cols == null) {
    throw new TerrainParseError("not_a_grid", "This source is not a regular grid.");
  }
  const grid = emptyGrid(
    parsed.rows,
    parsed.cols,
    parsed.spacing,
    parsed.originE ?? 0,
    parsed.originN ?? 0,
  );
  for (const p of parsed.points) {
    if (p.grid_row == null || p.grid_col == null) continue;
    grid.values[idx(grid, p.grid_row, p.grid_col)] = p.elevation_m;
  }
  return grid;
}

export const SAMPLE_TERRAIN_CSV = `easting,northing,elevation_m
0,0,742.1
5,0,742.6
10,0,743.4
15,0,744.5
0,5,741.8
5,5,742.4
10,5,743.3
15,5,744.6
0,10,741.2
5,10,741.9
10,10,742.9
15,10,744.4
0,15,740.5
5,15,741.3
10,15,742.5
15,15,744.1
`;
