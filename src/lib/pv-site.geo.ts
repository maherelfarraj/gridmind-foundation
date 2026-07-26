// P-151 — Pure geometry helpers for the PV site configuration workspace.
// No DOM, no server imports — safe on both sides and unit-testable.

export interface LngLat {
  lon: number;
  lat: number;
}

export interface PointM {
  x: number;
  y: number;
}

export const METERS_PER_DEG_LAT = 110540;
export const METERS_PER_DEG_LON = 111320;

/** Equirectangular projection of WGS84 degrees to local metres about an anchor. */
export function toLocalMeters(point: LngLat, anchor: LngLat): PointM {
  const cos0 = Math.cos((anchor.lat * Math.PI) / 180);
  return {
    x: (point.lon - anchor.lon) * cos0 * METERS_PER_DEG_LON,
    y: (point.lat - anchor.lat) * METERS_PER_DEG_LAT,
  };
}

/** Inverse of {@link toLocalMeters}. */
export function toLngLat(point: PointM, anchor: LngLat): LngLat {
  const cos0 = Math.cos((anchor.lat * Math.PI) / 180);
  return {
    lon: anchor.lon + point.x / (cos0 * METERS_PER_DEG_LON),
    lat: anchor.lat + point.y / METERS_PER_DEG_LAT,
  };
}

/** Signed shoelace area in square metres (positive = counter-clockwise). */
export function signedArea(points: PointM[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function polygonAreaM2(points: PointM[]): number {
  return Math.abs(signedArea(points));
}

export function m2ToHectares(area: number): number {
  return area / 10_000;
}

/** Ring as stored in GeoJSON: [lon, lat] pairs, first === last. */
export type Ring = [number, number][];

export function ringToLocal(ring: Ring, anchor: LngLat): PointM[] {
  const open = openRing(ring);
  return open.map(([lon, lat]) => toLocalMeters({ lon, lat }, anchor));
}

/** Strip the duplicated closing vertex, if present. */
export function openRing(ring: Ring): Ring {
  if (ring.length < 2) return [...ring];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring.slice(0, -1);
  return [...ring];
}

/** Append the first vertex so the ring is explicitly closed. */
export function closeRing(ring: Ring): Ring {
  if (ring.length === 0) return [];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return [...ring];
  return [...ring, [first[0], first[1]]];
}

export function isRingClosed(ring: Ring): boolean {
  if (ring.length < 4) return false;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

function orientation(p: [number, number], q: [number, number], r: [number, number]): number {
  const v = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
  if (Math.abs(v) < 1e-12) return 0;
  return v > 0 ? 1 : 2;
}

function onSegment(p: [number, number], q: [number, number], r: [number, number]): boolean {
  return (
    q[0] <= Math.max(p[0], r[0]) &&
    q[0] >= Math.min(p[0], r[0]) &&
    q[1] <= Math.max(p[1], r[1]) &&
    q[1] >= Math.min(p[1], r[1])
  );
}

/** Proper/improper segment intersection test (shared endpoints excluded by caller). */
export function segmentsIntersect(
  p1: [number, number],
  q1: [number, number],
  p2: [number, number],
  q2: [number, number],
): boolean {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

function sameVertex(a: [number, number], b: [number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/** True when any two non-adjacent edges of the ring cross. */
export function ringSelfIntersects(ring: Ring): boolean {
  const pts = openRing(ring);
  const n = pts.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i += 1) {
    const a1 = pts[i];
    const a2 = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j += 1) {
      const b1 = pts[j];
      const b2 = pts[(j + 1) % n];
      // skip adjacent edges (they legitimately share a vertex)
      if (i === j) continue;
      const adjacent =
        sameVertex(a1, b1) || sameVertex(a1, b2) || sameVertex(a2, b1) || sameVertex(a2, b2);
      if (adjacent) continue;
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

export interface RingIssue {
  code: "too_few_points" | "not_closed" | "self_intersecting";
  message: string;
}

export function validateRing(ring: Ring): RingIssue | null {
  const closed = closeRing(ring);
  if (closed.length < 4) {
    return { code: "too_few_points", message: "A polygon needs at least 3 distinct vertices." };
  }
  if (!isRingClosed(closed)) {
    return { code: "not_closed", message: "Ring must be closed (first point repeated last)." };
  }
  if (ringSelfIntersects(closed)) {
    return { code: "self_intersecting", message: "Polygon edges must not cross each other." };
  }
  return null;
}

/** Area of a lon/lat ring in m², via the local projection about its own anchor. */
export function ringAreaM2(ring: Ring, anchor?: LngLat): number {
  const open = openRing(ring);
  if (open.length < 3) return 0;
  const base = anchor ?? { lon: open[0][0], lat: open[0][1] };
  return polygonAreaM2(ringToLocal(open, base));
}

export function snapMeters(value: number, step: number): number {
  if (!step || step <= 0) return value;
  return Math.round(value / step) * step;
}

/** Nice round scale-bar length (1/2/5 × 10ⁿ) for the given metres-per-pixel. */
export function scaleBarMeters(metersPerPixel: number, targetPx = 120): number {
  const raw = Math.max(metersPerPixel * targetPx, 1);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  const nice = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
  return nice * pow;
}

export function formatArea(areaM2: number): string {
  const ha = m2ToHectares(areaM2);
  if (areaM2 < 10_000) return `${Math.round(areaM2).toLocaleString()} m²`;
  return `${ha.toFixed(2)} ha (${Math.round(areaM2).toLocaleString()} m²)`;
}
