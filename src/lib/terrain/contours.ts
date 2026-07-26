// P-160 — Marching-squares contour extraction. Pure module (no React / Supabase / GIS libs).
import { valueAt, type ElevationGrid } from "@/lib/terrain/grid";

export type ContourLine = {
  elevation_m: number;
  is_major: boolean;
  /** [easting, northing] world coordinates */
  coordinates: [number, number][];
};

type Seg = { a: [number, number]; b: [number, number] };

function lerp(p: number, q: number, vp: number, vq: number, level: number): number {
  const d = vq - vp;
  if (Math.abs(d) < 1e-9) return p;
  return p + ((level - vp) / d) * (q - p);
}

/** Contour levels covering [min,max] at a fixed interval, snapped to interval multiples. */
export function contourLevels(min: number, max: number, interval: number): number[] {
  if (!(interval > 0) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const start = Math.ceil(min / interval) * interval;
  const levels: number[] = [];
  for (let l = start; l < max; l += interval) {
    levels.push(Number(l.toFixed(6)));
    if (levels.length > 500) break;
  }
  return levels;
}

function cellSegments(grid: ElevationGrid, r: number, c: number, level: number): Seg[] {
  const tl = valueAt(grid, r + 1, c);
  const tr = valueAt(grid, r + 1, c + 1);
  const br = valueAt(grid, r, c + 1);
  const bl = valueAt(grid, r, c);
  if (tl == null || tr == null || br == null || bl == null) return [];

  const x0 = grid.originE + c * grid.spacing;
  const x1 = x0 + grid.spacing;
  const y0 = grid.originN + r * grid.spacing;
  const y1 = y0 + grid.spacing;

  const state =
    (tl > level ? 8 : 0) + (tr > level ? 4 : 0) + (br > level ? 2 : 0) + (bl > level ? 1 : 0);

  const top = (): [number, number] => [lerp(x0, x1, tl, tr, level), y1];
  const bottom = (): [number, number] => [lerp(x0, x1, bl, br, level), y0];
  const left = (): [number, number] => [x0, lerp(y0, y1, bl, tl, level)];
  const right = (): [number, number] => [x1, lerp(y0, y1, br, tr, level)];

  switch (state) {
    case 1:
    case 14:
      return [{ a: left(), b: bottom() }];
    case 2:
    case 13:
      return [{ a: bottom(), b: right() }];
    case 3:
    case 12:
      return [{ a: left(), b: right() }];
    case 4:
    case 11:
      return [{ a: top(), b: right() }];
    case 5:
      return [
        { a: left(), b: top() },
        { a: bottom(), b: right() },
      ];
    case 6:
    case 9:
      return [{ a: top(), b: bottom() }];
    case 7:
    case 8:
      return [{ a: left(), b: top() }];
    case 10:
      return [
        { a: left(), b: bottom() },
        { a: top(), b: right() },
      ];
    default:
      return [];
  }
}

function key(p: [number, number]): string {
  return `${p[0].toFixed(4)}:${p[1].toFixed(4)}`;
}

/** Join unordered segments into polylines by shared endpoints. */
function joinSegments(segments: Seg[]): [number, number][][] {
  const remaining = new Map<string, Seg[]>();
  for (const s of segments) {
    for (const k of [key(s.a), key(s.b)]) {
      const list = remaining.get(k) ?? [];
      list.push(s);
      remaining.set(k, list);
    }
  }
  const used = new Set<Seg>();
  const lines: [number, number][][] = [];

  const take = (from: [number, number]): Seg | null => {
    const list = remaining.get(key(from)) ?? [];
    for (const s of list) if (!used.has(s)) return s;
    return null;
  };

  for (const seed of segments) {
    if (used.has(seed)) continue;
    used.add(seed);
    const line: [number, number][] = [seed.a, seed.b];

    // extend forward
    for (;;) {
      const tail = line[line.length - 1];
      const next = take(tail);
      if (!next) break;
      used.add(next);
      line.push(key(next.a) === key(tail) ? next.b : next.a);
      if (line.length > 20000) break;
    }
    // extend backward
    for (;;) {
      const head = line[0];
      const prev = take(head);
      if (!prev) break;
      used.add(prev);
      line.unshift(key(prev.a) === key(head) ? prev.b : prev.a);
      if (line.length > 20000) break;
    }
    if (line.length >= 2) lines.push(line);
  }
  return lines;
}

/**
 * Extract contour polylines at `interval` metres. Every `majorEvery`-th level
 * (counted from the first level) is flagged major.
 */
export function extractContours(
  grid: ElevationGrid,
  interval: number,
  opts?: { min?: number; max?: number; majorEvery?: number },
): ContourLine[] {
  if (grid.rows < 2 || grid.cols < 2) return [];
  const values = grid.values.filter((v): v is number => v != null);
  if (values.length === 0) return [];
  const min = opts?.min ?? Math.min(...values);
  const max = opts?.max ?? Math.max(...values);
  const majorEvery = opts?.majorEvery ?? 5;
  const levels = contourLevels(min, max, interval);

  const out: ContourLine[] = [];
  levels.forEach((level, li) => {
    const segments: Seg[] = [];
    for (let r = 0; r < grid.rows - 1; r++) {
      for (let c = 0; c < grid.cols - 1; c++) {
        segments.push(...cellSegments(grid, r, c, level));
      }
    }
    for (const coordinates of joinSegments(segments)) {
      out.push({ elevation_m: level, is_major: li % majorEvery === 0, coordinates });
    }
  });
  return out;
}

export function contourToGeoJson(line: ContourLine) {
  return { type: "LineString" as const, coordinates: line.coordinates.map(([x, y]) => [x, y]) };
}
