// P-161 — Pure GeoJSON geometry helpers for civil analysis.
// No React, no Supabase, no GIS dependency.

export type Vertex = [number, number];
export type Ring = Vertex[];

export type GeoJsonGeometry = {
  type: string;
  coordinates: unknown;
};

function isVertex(v: unknown): v is Vertex {
  return (
    Array.isArray(v) && v.length >= 2 && typeof v[0] === "number" && typeof v[1] === "number"
  );
}

function asRing(v: unknown): Ring | null {
  if (!Array.isArray(v)) return null;
  const ring: Ring = [];
  for (const p of v) {
    if (!isVertex(p)) return null;
    ring.push([p[0], p[1]]);
  }
  return ring.length ? ring : null;
}

/** Outer rings of a Polygon / MultiPolygon (holes are ignored — see ringsWithHoles). */
export function polygonRings(geometry: GeoJsonGeometry | null | undefined): Ring[] {
  if (!geometry || typeof geometry !== "object") return [];
  const coords = geometry.coordinates;
  const type = String(geometry.type ?? "");
  if (type === "Polygon" && Array.isArray(coords)) {
    const outer = asRing(coords[0]);
    return outer ? [outer] : [];
  }
  if (type === "MultiPolygon" && Array.isArray(coords)) {
    const out: Ring[] = [];
    for (const poly of coords) {
      if (!Array.isArray(poly)) continue;
      const outer = asRing(poly[0]);
      if (outer) out.push(outer);
    }
    return out;
  }
  return [];
}

/** Hole rings of a Polygon / MultiPolygon. */
export function polygonHoles(geometry: GeoJsonGeometry | null | undefined): Ring[] {
  if (!geometry || typeof geometry !== "object") return [];
  const coords = geometry.coordinates;
  const type = String(geometry.type ?? "");
  const out: Ring[] = [];
  if (type === "Polygon" && Array.isArray(coords)) {
    for (let i = 1; i < coords.length; i++) {
      const r = asRing(coords[i]);
      if (r) out.push(r);
    }
  } else if (type === "MultiPolygon" && Array.isArray(coords)) {
    for (const poly of coords) {
      if (!Array.isArray(poly)) continue;
      for (let i = 1; i < poly.length; i++) {
        const r = asRing(poly[i]);
        if (r) out.push(r);
      }
    }
  }
  return out;
}

/** Every vertex list of any geometry type, in document order. */
export function geometryVertexLists(geometry: GeoJsonGeometry | null | undefined): Ring[] {
  if (!geometry || typeof geometry !== "object") return [];
  const type = String(geometry.type ?? "");
  const coords = geometry.coordinates;
  if (type === "Point") {
    return isVertex(coords) ? [[[coords[0], coords[1]]]] : [];
  }
  if (type === "LineString" || type === "MultiPoint") {
    const r = asRing(coords);
    return r ? [r] : [];
  }
  if (type === "MultiLineString" || type === "Polygon") {
    if (!Array.isArray(coords)) return [];
    return coords.map((c) => asRing(c)).filter((r): r is Ring => r != null);
  }
  if (type === "MultiPolygon") {
    if (!Array.isArray(coords)) return [];
    const out: Ring[] = [];
    for (const poly of coords) {
      if (!Array.isArray(poly)) continue;
      for (const r of poly) {
        const ring = asRing(r);
        if (ring) out.push(ring);
      }
    }
    return out;
  }
  return [];
}

export type BBox = { minX: number; minY: number; maxX: number; maxY: number };

export function ringBBox(rings: Ring[]): BBox | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let seen = false;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      seen = true;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return seen ? { minX, minY, maxX, maxY } : null;
}

/** Ray casting; points exactly on an edge count as inside. */
export function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    // on-edge test
    const cross = (xj - xi) * (y - yi) - (yj - yi) * (x - xi);
    if (
      Math.abs(cross) < 1e-9 &&
      x >= Math.min(xi, xj) - 1e-9 &&
      x <= Math.max(xi, xj) + 1e-9 &&
      y >= Math.min(yi, yj) - 1e-9 &&
      y <= Math.max(yi, yj) + 1e-9
    ) {
      return true;
    }
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function pointInGeometry(
  x: number,
  y: number,
  geometry: GeoJsonGeometry | null | undefined,
): boolean {
  const outers = polygonRings(geometry);
  if (!outers.length) return false;
  const inOuter = outers.some((r) => pointInRing(x, y, r));
  if (!inOuter) return false;
  return !polygonHoles(geometry).some((h) => pointInRing(x, y, h));
}

/** Shoelace area (absolute) of a ring, in squared coordinate units. */
export function ringArea(ring: Ring): number {
  if (ring.length < 3) return 0;
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(sum) / 2;
}

export function polygonArea(geometry: GeoJsonGeometry | null | undefined): number {
  const outer = polygonRings(geometry).reduce((a, r) => a + ringArea(r), 0);
  const holes = polygonHoles(geometry).reduce((a, r) => a + ringArea(r), 0);
  return Math.max(0, outer - holes);
}

export function lineLength(ring: Ring): number {
  let total = 0;
  for (let i = 1; i < ring.length; i++) {
    total += Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]);
  }
  return total;
}

export function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
