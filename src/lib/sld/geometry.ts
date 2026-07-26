// P-140 — Pure geometry helpers for the SLD canvas (unit-testable, no React).
// All coordinates are sheet millimetres with the origin at the sheet top-left.

export type Pt = { x: number; y: number };
export type Rect = { minX: number; minY: number; maxX: number; maxY: number };

export type GeomObject = {
  id: string;
  x: number;
  y: number;
  rotation: number;
  mirrored: boolean;
};

export type Footprint = { w: number; h: number };

export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type DistributeAxis = "horizontal" | "vertical";

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Snap a scalar to the grid (no-op when snapping is off or grid is invalid). */
export function snap(value: number, gridMm: number, enabled = true): number {
  if (!enabled || !Number.isFinite(gridMm) || gridMm <= 0) return round(value);
  return round(Math.round(value / gridMm) * gridMm);
}

export function snapPoint(p: Pt, gridMm: number, enabled = true): Pt {
  return { x: snap(p.x, gridMm, enabled), y: snap(p.y, gridMm, enabled) };
}

/** Axis-aligned bounds of a set of objects using each object's footprint. */
export function boundsOf(objects: GeomObject[], size: (o: GeomObject) => Footprint): Rect | null {
  if (objects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const o of objects) {
    const { w, h } = size(o);
    // Rotation of 90/270 swaps the footprint axes.
    const swapped = Math.abs(o.rotation % 180) === 90;
    const halfW = (swapped ? h : w) / 2;
    const halfH = (swapped ? w : h) / 2;
    minX = Math.min(minX, o.x - halfW);
    maxX = Math.max(maxX, o.x + halfW);
    minY = Math.min(minY, o.y - halfH);
    maxY = Math.max(maxY, o.y + halfH);
  }
  return { minX: round(minX), minY: round(minY), maxX: round(maxX), maxY: round(maxY) };
}

export function rectCenter(r: Rect): Pt {
  return { x: round((r.minX + r.maxX) / 2), y: round((r.minY + r.maxY) / 2) };
}

/** Rotate a point about a centre by `deg` degrees (clockwise in screen space). */
export function rotateAbout(point: Pt, center: Pt, deg: number): Pt {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: round(center.x + dx * cos - dy * sin),
    y: round(center.y + dx * sin + dy * cos),
  };
}

export function normalizeRotation(deg: number): 0 | 90 | 180 | 270 {
  const n = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  return n as 0 | 90 | 180 | 270;
}

/**
 * Rotate a selection by `deg` about the selection's own centre.
 * A single object rotates in place; groups orbit their shared centre.
 */
export function rotateSelectionGeometry<T extends GeomObject>(
  objects: T[],
  deg: number,
  size: (o: GeomObject) => Footprint,
): Array<{ id: string; x: number; y: number; rotation: 0 | 90 | 180 | 270 }> {
  const b = boundsOf(objects, size);
  if (!b) return [];
  const c = rectCenter(b);
  return objects.map((o) => {
    const p = objects.length === 1 ? { x: o.x, y: o.y } : rotateAbout({ x: o.x, y: o.y }, c, deg);
    return { id: o.id, x: p.x, y: p.y, rotation: normalizeRotation(o.rotation + deg) };
  });
}

/** Mirror a selection horizontally about the selection centre. */
export function mirrorSelectionGeometry<T extends GeomObject>(
  objects: T[],
  size: (o: GeomObject) => Footprint,
): Array<{ id: string; x: number; y: number; mirrored: boolean }> {
  const b = boundsOf(objects, size);
  if (!b) return [];
  const c = rectCenter(b);
  return objects.map((o) => ({
    id: o.id,
    x: round(2 * c.x - o.x),
    y: round(o.y),
    mirrored: !o.mirrored,
  }));
}

/** Align ≥2 objects to the selection bounding box edge / centre line. */
export function alignGeometry<T extends GeomObject>(
  objects: T[],
  mode: AlignMode,
  size: (o: GeomObject) => Footprint,
): Array<{ id: string; x: number; y: number }> {
  if (objects.length < 2) return [];
  const b = boundsOf(objects, size)!;
  const c = rectCenter(b);
  return objects.map((o) => {
    const { w, h } = size(o);
    const swapped = Math.abs(o.rotation % 180) === 90;
    const halfW = (swapped ? h : w) / 2;
    const halfH = (swapped ? w : h) / 2;
    switch (mode) {
      case "left":
        return { id: o.id, x: round(b.minX + halfW), y: round(o.y) };
      case "right":
        return { id: o.id, x: round(b.maxX - halfW), y: round(o.y) };
      case "center":
        return { id: o.id, x: c.x, y: round(o.y) };
      case "top":
        return { id: o.id, x: round(o.x), y: round(b.minY + halfH) };
      case "bottom":
        return { id: o.id, x: round(o.x), y: round(b.maxY - halfH) };
      case "middle":
      default:
        return { id: o.id, x: round(o.x), y: c.y };
    }
  });
}

/** Even centre-to-centre spacing between the two extreme objects. */
export function distributeGeometry<T extends GeomObject>(
  objects: T[],
  axis: DistributeAxis,
): Array<{ id: string; x: number; y: number }> {
  if (objects.length < 3) return objects.map((o) => ({ id: o.id, x: round(o.x), y: round(o.y) }));
  const key = axis === "horizontal" ? "x" : "y";
  const sorted = [...objects].sort((a, b) => a[key] - b[key]);
  const first = sorted[0][key];
  const last = sorted[sorted.length - 1][key];
  const step = (last - first) / (sorted.length - 1);
  return sorted.map((o, i) => ({
    id: o.id,
    x: axis === "horizontal" ? round(first + step * i) : round(o.x),
    y: axis === "vertical" ? round(first + step * i) : round(o.y),
  }));
}

// --- marquee ---------------------------------------------------------------

export function rectFromPoints(a: Pt, b: Pt): Rect {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

export function rectContainsPoint(r: Rect, p: Pt): boolean {
  return p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

/** Ids of objects whose footprint intersects the marquee rectangle. */
export function marqueeHits<T extends GeomObject>(
  objects: T[],
  marquee: Rect,
  size: (o: GeomObject) => Footprint,
): string[] {
  return objects
    .filter((o) => {
      const b = boundsOf([o], size)!;
      return rectsIntersect(b, marquee);
    })
    .map((o) => o.id);
}

// --- measurement -----------------------------------------------------------

export type Measurement = { start: Pt; end: Pt; dx: number; dy: number; distance: number };

/**
 * Distance between two points in mm. With `axisLock` (shift) the measurement
 * collapses onto the dominant axis.
 */
export function measure(start: Pt, end: Pt, axisLock = false): Measurement {
  let target = { x: end.x, y: end.y };
  if (axisLock) {
    target =
      Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
        ? { x: end.x, y: start.y }
        : { x: start.x, y: end.y };
  }
  const dx = round(target.x - start.x);
  const dy = round(target.y - start.y);
  return { start, end: target, dx, dy, distance: round(Math.hypot(dx, dy)) };
}

export function formatMm(value: number): string {
  return `${Math.round(value * 10) / 10} mm`;
}

// --- connector routing -----------------------------------------------------

/**
 * Orthogonal route with a single automatic elbow. The elbow leaves the source
 * along its dominant axis so busbar drops read cleanly.
 */
export function orthogonalRoute(from: Pt, to: Pt, preferHorizontal?: boolean): Pt[] {
  if (from.x === to.x || from.y === to.y) return [from, to];
  const horizontalFirst = preferHorizontal ?? Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
  const elbow = horizontalFirst ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
  return [from, elbow, to];
}

export function pathFromPoints(points: Pt[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

export function routeLength(points: Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return round(total);
}

// --- grouping --------------------------------------------------------------

export const GROUP_KEY = "group_id";

export function groupIdOf(properties: Record<string, unknown> | null | undefined): string | null {
  const v = properties?.[GROUP_KEY];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Expand a selection so every member of a touched group is included. */
export function expandSelectionToGroups(
  ids: string[],
  objects: Array<{ id: string; properties: Record<string, unknown> }>,
): string[] {
  const groups = new Set(
    objects.filter((o) => ids.includes(o.id)).map((o) => groupIdOf(o.properties)),
  );
  groups.delete(null);
  const out = new Set(ids);
  for (const o of objects) {
    const g = groupIdOf(o.properties);
    if (g && groups.has(g)) out.add(o.id);
  }
  return Array.from(out);
}
