/**
 * P-152 — Pure, deterministic PV layout geometry engine.
 *
 * No React, no Supabase, no I/O: every export is a total function of its
 * inputs so the whole module is unit-testable in isolation.
 *
 * Coordinate system: the site-local metre CRS established in P-151
 * (equirectangular projection about the site anchor). +x is east, +y is north.
 * Azimuth is measured in degrees clockwise from north, matching the site
 * configuration's `azimuth_deg`.
 */

export interface PointM {
  x: number;
  y: number;
}

/** A polygon ring in site-local metres. May be open or closed. */
export type RingM = PointM[];

export interface ModuleDims {
  /** Long edge of the module, millimetres. */
  lengthMm: number;
  /** Short edge of the module, millimetres. */
  widthMm: number;
}

export type Orientation = "portrait" | "landscape";

export interface TableSpec {
  module: ModuleDims;
  orientation: Orientation;
  /** Modules placed side-by-side along the table's length. */
  modulesAcross: number;
  /** Modules stacked up the slope (across the collector width). */
  modulesUp: number;
  /** Tilt from horizontal, degrees. */
  tiltDeg: number;
  /** Gap between adjacent modules along the table length, metres. */
  moduleGapM?: number;
  /** Gap between stacked module rows on the same table, metres. */
  rowGapM?: number;
}

export interface TableGeometry {
  /** Slope length of the collector (along the tilt), metres. */
  collectorWidthM: number;
  /** Horizontal projection of the collector width, metres. */
  projectedWidthM: number;
  /** Length of the table along its torque tube, metres. */
  tableLengthM: number;
  /** Vertical rise from the low edge to the high edge, metres. */
  heightM: number;
  /** Modules carried by one table. */
  moduleCount: number;
}

const MM_PER_M = 1000;
const DEG = Math.PI / 180;

function toRad(deg: number): number {
  return deg * DEG;
}

function assertFinitePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
}

/**
 * Collector geometry for a single array table.
 *
 * Portrait puts the module's long edge up the slope, so the collector width is
 * `modulesUp * lengthMm` and the table length is `modulesAcross * widthMm`.
 * Landscape swaps the two. Inter-module gaps are added between neighbours only
 * (n modules → n-1 gaps).
 */
export function makeTable(spec: TableSpec): TableGeometry {
  const { module, orientation, modulesAcross, modulesUp, tiltDeg } = spec;
  assertFinitePositive(module.lengthMm, "module.lengthMm");
  assertFinitePositive(module.widthMm, "module.widthMm");
  if (!Number.isInteger(modulesAcross) || modulesAcross <= 0) {
    throw new Error("modulesAcross must be a positive integer");
  }
  if (!Number.isInteger(modulesUp) || modulesUp <= 0) {
    throw new Error("modulesUp must be a positive integer");
  }
  if (!Number.isFinite(tiltDeg) || tiltDeg < 0 || tiltDeg >= 90) {
    throw new Error("tiltDeg must be within [0, 90)");
  }

  const moduleGapM = spec.moduleGapM ?? 0;
  const rowGapM = spec.rowGapM ?? 0;

  const upEdgeM = (orientation === "portrait" ? module.lengthMm : module.widthMm) / MM_PER_M;
  const acrossEdgeM = (orientation === "portrait" ? module.widthMm : module.lengthMm) / MM_PER_M;

  const collectorWidthM = modulesUp * upEdgeM + Math.max(modulesUp - 1, 0) * rowGapM;
  const tableLengthM = modulesAcross * acrossEdgeM + Math.max(modulesAcross - 1, 0) * moduleGapM;

  return {
    collectorWidthM,
    projectedWidthM: collectorWidthM * Math.cos(toRad(tiltDeg)),
    tableLengthM,
    heightM: collectorWidthM * Math.sin(toRad(tiltDeg)),
    moduleCount: modulesAcross * modulesUp,
  };
}

/**
 * Row pitch implied by a ground coverage ratio.
 *
 * GCR is the collector area divided by the ground area it occupies, so
 * `pitch = collectorWidth / gcr`.
 */
export function pitchFromGcr(collectorWidthM: number, gcr: number): number {
  assertFinitePositive(collectorWidthM, "collectorWidthM");
  if (!Number.isFinite(gcr) || gcr <= 0 || gcr > 1) {
    throw new Error("gcr must be within (0, 1]");
  }
  return collectorWidthM / gcr;
}

/** Inverse of {@link pitchFromGcr}. */
export function gcrFromPitch(collectorWidthM: number, pitchM: number): number {
  assertFinitePositive(collectorWidthM, "collectorWidthM");
  assertFinitePositive(pitchM, "pitchM");
  return collectorWidthM / pitchM;
}

export interface ShadingInput {
  /** Table tilt from horizontal, degrees. */
  tiltDeg: number;
  /** Site latitude, degrees (positive north). */
  latitude: number;
  /**
   * Minimum acceptable solar elevation, degrees. When omitted it is derived
   * from the winter-solstice solar noon elevation at the given latitude.
   */
  shadingAngleDeg?: number;
  /** Solar azimuth offset from due south/north at the design hour, degrees. */
  azimuthOffsetDeg?: number;
}

export interface ShadingResult {
  /** Solar elevation used for the calculation, degrees. */
  solarElevationDeg: number;
  /** Shadow cast by one table onto the ground, metres. */
  shadowLengthM: number;
  /** Clear gap needed between the back of one table and the next, metres. */
  rowSpacingM: number;
  /** Row pitch (spacing plus the table's own horizontal projection), metres. */
  pitchM: number;
}

/**
 * Winter-solstice shading separation.
 *
 * At solar noon on the December solstice the sun's elevation is
 * `alpha = 90 - latitude + declination`, with declination = -23.45 deg in the
 * northern hemisphere (+23.45 deg south of the equator, i.e. the June
 * solstice is the worst case there). A table of collector width `w` tilted at
 * `beta` has height `h = w * sin(beta)` and horizontal depth
 * `d = w * cos(beta)`. Its shadow on level ground measures
 * `h / tan(alpha)`, widened by `1 / cos(azimuthOffset)` when the design hour
 * is away from solar noon. The clear row spacing is that shadow length, and
 * the pitch adds the table's own horizontal projection `d`.
 */
export function rowSpacingFromShading(
  input: ShadingInput & { collectorWidthM: number },
): ShadingResult {
  const { tiltDeg, latitude, collectorWidthM } = input;
  assertFinitePositive(collectorWidthM, "collectorWidthM");
  if (!Number.isFinite(tiltDeg) || tiltDeg < 0 || tiltDeg >= 90) {
    throw new Error("tiltDeg must be within [0, 90)");
  }
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 66.5) {
    throw new Error("latitude must be within +/-66.5 degrees");
  }

  const declination = latitude >= 0 ? -23.45 : 23.45;
  const solarElevationDeg =
    input.shadingAngleDeg ?? 90 - Math.abs(latitude) + (latitude >= 0 ? declination : -declination);

  if (solarElevationDeg <= 0 || solarElevationDeg >= 90) {
    throw new Error("solar elevation must be within (0, 90) degrees");
  }

  const azimuthOffsetDeg = input.azimuthOffsetDeg ?? 0;
  if (!Number.isFinite(azimuthOffsetDeg) || Math.abs(azimuthOffsetDeg) >= 90) {
    throw new Error("azimuthOffsetDeg must be within (-90, 90)");
  }

  const heightM = collectorWidthM * Math.sin(toRad(tiltDeg));
  const depthM = collectorWidthM * Math.cos(toRad(tiltDeg));
  const shadowLengthM =
    heightM / Math.tan(toRad(solarElevationDeg)) / Math.cos(toRad(azimuthOffsetDeg));

  return {
    solarElevationDeg,
    shadowLengthM,
    rowSpacingM: shadowLengthM,
    pitchM: depthM + shadowLengthM,
  };
}

/**
 * Axis-aligned rectangle of a table, rotated by `azimuthDeg` about its centre.
 * The table's length runs perpendicular to the azimuth (rows face the azimuth).
 */
export function tableFootprint(
  centre: PointM,
  tableLengthM: number,
  projectedWidthM: number,
  azimuthDeg: number,
): RingM {
  assertFinitePositive(tableLengthM, "tableLengthM");
  assertFinitePositive(projectedWidthM, "projectedWidthM");
  const halfL = tableLengthM / 2;
  const halfW = projectedWidthM / 2;
  const local: RingM = [
    { x: -halfL, y: -halfW },
    { x: halfL, y: -halfW },
    { x: halfL, y: halfW },
    { x: -halfL, y: halfW },
  ];
  return local
    .map((p) => rotatePoint(p, azimuthDeg, { x: 0, y: 0 }))
    .map((p) => ({
      x: round6(p.x + centre.x),
      y: round6(p.y + centre.y),
    }));
}

/** Rotates a point clockwise by `azimuthDeg` (compass convention) about `origin`. */
export function rotatePoint(point: PointM, azimuthDeg: number, origin: PointM): PointM {
  const a = toRad(azimuthDeg);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  return {
    x: origin.x + dx * cos + dy * sin,
    y: origin.y - dx * sin + dy * cos,
  };
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Removes a duplicated closing vertex so ring algorithms see each point once. */
export function openRingM(ring: RingM): RingM {
  if (ring.length < 2) return [...ring];
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first.x === last.x && first.y === last.y ? ring.slice(0, -1) : [...ring];
}

/** Shoelace area, always positive. */
export function ringArea(ring: RingM): number {
  const pts = openRingM(ring);
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundingBox(ring: RingM): BBox {
  const pts = openRingM(ring);
  if (pts.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  return pts.reduce<BBox>(
    (acc, p) => ({
      minX: Math.min(acc.minX, p.x),
      minY: Math.min(acc.minY, p.y),
      maxX: Math.max(acc.maxX, p.x),
      maxY: Math.max(acc.maxY, p.y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

export function bboxesOverlap(a: BBox, b: BBox): boolean {
  return !(a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY);
}

/**
 * Ray-casting point-in-polygon test. Points exactly on an edge count as inside
 * so that a table flush with the setback line is not silently discarded.
 */
export function pointInPolygon(point: PointM, ring: RingM, epsilon = 1e-9): boolean {
  const pts = openRingM(ring);
  if (pts.length < 3) return false;

  for (let i = 0; i < pts.length; i += 1) {
    if (pointOnSegment(point, pts[i], pts[(i + 1) % pts.length], epsilon)) return true;
  }

  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const a = pts[i];
    const b = pts[j];
    const straddles = a.y > point.y !== b.y > point.y;
    if (!straddles) continue;
    const xCross = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < xCross) inside = !inside;
  }
  return inside;
}

function pointOnSegment(p: PointM, a: PointM, b: PointM, epsilon: number): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (Math.abs(cross) > epsilon) return false;
  const dot = (p.x - a.x) * (p.x - b.x) + (p.y - a.y) * (p.y - b.y);
  return dot <= epsilon;
}

function segmentsIntersect(p1: PointM, p2: PointM, p3: PointM, p4: PointM): boolean {
  const d = (a: PointM, b: PointM, c: PointM) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  const eps = 1e-9;
  if (Math.abs(d1) <= eps && pointOnSegment(p1, p3, p4, eps)) return true;
  if (Math.abs(d2) <= eps && pointOnSegment(p2, p3, p4, eps)) return true;
  if (Math.abs(d3) <= eps && pointOnSegment(p3, p1, p2, eps)) return true;
  if (Math.abs(d4) <= eps && pointOnSegment(p4, p1, p2, eps)) return true;
  return false;
}

/** True when two rings share any interior area, touch, or one contains the other. */
export function polygonsIntersect(a: RingM, b: RingM): boolean {
  const ra = openRingM(a);
  const rb = openRingM(b);
  if (ra.length < 3 || rb.length < 3) return false;
  if (!bboxesOverlap(boundingBox(ra), boundingBox(rb))) return false;

  for (let i = 0; i < ra.length; i += 1) {
    const a1 = ra[i];
    const a2 = ra[(i + 1) % ra.length];
    for (let j = 0; j < rb.length; j += 1) {
      const b1 = rb[j];
      const b2 = rb[(j + 1) % rb.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  // No edge crossings: containment either way still counts as an intersection.
  return pointInPolygon(ra[0], rb) || pointInPolygon(rb[0], ra);
}

/** True when every vertex of `inner` lies inside `outer`. */
export function polygonContains(outer: RingM, inner: RingM): boolean {
  const pts = openRingM(inner);
  if (pts.length === 0) return false;
  return pts.every((p) => pointInPolygon(p, outer));
}

/**
 * Inward offset of a convex-ish ring by `distanceM`, implemented as a
 * per-vertex pull toward the centroid scaled by the vertex's distance. It is
 * deliberately conservative: the result never leaves the original ring, which
 * is what a setback needs.
 */
export function insetRing(ring: RingM, distanceM: number): RingM {
  const pts = openRingM(ring);
  if (pts.length < 3 || distanceM <= 0) return pts;
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return pts.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy);
    if (len <= distanceM) return { x: round6(cx), y: round6(cy) };
    const k = (len - distanceM) / len;
    return { x: round6(cx + dx * k), y: round6(cy + dy * k) };
  });
}

export interface GridFillInput {
  /** Buildable boundary ring in site-local metres. */
  boundary: RingM;
  /** Zones that must stay clear (wadis, setbacks, easements). */
  exclusions?: RingM[];
  /** Perimeter setback applied to the boundary before filling, metres. */
  setbackM?: number;
  /** Centre-to-centre row pitch, metres. */
  pitchM: number;
  /** Table length along the torque tube, metres. */
  tableWidthM: number;
  /** Horizontal depth of one table, metres. Defaults to a thin strip. */
  tableDepthM?: number;
  /** Row azimuth, degrees clockwise from north. */
  azimuthDeg: number;
  /** Clear gap between neighbouring tables in the same row, metres. */
  tableGapM?: number;
  /** Safety valve for pathological inputs. */
  maxTables?: number;
}

export interface PlacedTable {
  row: number;
  column: number;
  centre: PointM;
  polygon: RingM;
}

export interface GridFillResult {
  tables: PlacedTable[];
  /** Boundary actually filled after the setback was applied. */
  buildable: RingM;
  buildableAreaM2: number;
  rows: number;
}

/**
 * Scanline grid fill.
 *
 * The boundary is inset by the setback, rotated into a frame aligned with the
 * row azimuth, then swept row by row at `pitchM`. Along each row, candidate
 * tables are stepped at `tableWidthM + tableGapM`; a candidate is kept only
 * when all four of its corners plus its centre are inside the buildable ring
 * (ray casting) and its rectangle does not intersect any exclusion zone.
 */
export function gridFill(input: GridFillInput): GridFillResult {
  const {
    boundary,
    exclusions = [],
    setbackM = 0,
    pitchM,
    tableWidthM,
    azimuthDeg,
    tableGapM = 0,
    maxTables = 100000,
  } = input;

  assertFinitePositive(pitchM, "pitchM");
  assertFinitePositive(tableWidthM, "tableWidthM");
  const tableDepthM = input.tableDepthM ?? Math.min(pitchM * 0.5, pitchM);
  assertFinitePositive(tableDepthM, "tableDepthM");

  const buildable = setbackM > 0 ? insetRing(boundary, setbackM) : openRingM(boundary);
  const empty: GridFillResult = {
    tables: [],
    buildable,
    buildableAreaM2: ringArea(buildable),
    rows: 0,
  };
  if (buildable.length < 3 || empty.buildableAreaM2 <= 0) return empty;

  const origin: PointM = { x: 0, y: 0 };
  // Rotate the world so rows run along +x.
  const rotated = buildable.map((p) => rotatePoint(p, -azimuthDeg, origin));
  const rotatedExclusions = exclusions
    .map((e) => openRingM(e))
    .filter((e) => e.length >= 3)
    .map((e) => e.map((p) => rotatePoint(p, -azimuthDeg, origin)));

  const bbox = boundingBox(rotated);
  const stepX = tableWidthM + tableGapM;
  const tables: PlacedTable[] = [];

  const rowCount = Math.floor((bbox.maxY - bbox.minY - tableDepthM) / pitchM) + 1;
  if (rowCount <= 0) return empty;

  let row = 0;
  for (let cy = bbox.minY + tableDepthM / 2; cy + tableDepthM / 2 <= bbox.maxY; cy += pitchM) {
    let column = 0;
    for (let cx = bbox.minX + tableWidthM / 2; cx + tableWidthM / 2 <= bbox.maxX; cx += stepX) {
      const halfW = tableWidthM / 2;
      const halfD = tableDepthM / 2;
      const rect: RingM = [
        { x: cx - halfW, y: cy - halfD },
        { x: cx + halfW, y: cy - halfD },
        { x: cx + halfW, y: cy + halfD },
        { x: cx - halfW, y: cy + halfD },
      ];

      const insideBoundary =
        pointInPolygon({ x: cx, y: cy }, rotated) && rect.every((p) => pointInPolygon(p, rotated));

      if (insideBoundary) {
        const blocked = rotatedExclusions.some((e) => polygonsIntersect(rect, e));
        if (!blocked) {
          tables.push({
            row,
            column,
            centre: {
              x: round6(rotatePoint({ x: cx, y: cy }, azimuthDeg, origin).x),
              y: round6(rotatePoint({ x: cx, y: cy }, azimuthDeg, origin).y),
            },
            polygon: rect.map((p) => {
              const w = rotatePoint(p, azimuthDeg, origin);
              return { x: round6(w.x), y: round6(w.y) };
            }),
          });
          if (tables.length >= maxTables) {
            return { tables, buildable, buildableAreaM2: empty.buildableAreaM2, rows: row + 1 };
          }
        }
      }
      column += 1;
    }
    row += 1;
  }

  return {
    tables,
    buildable,
    buildableAreaM2: empty.buildableAreaM2,
    rows: row,
  };
}

/** DC capacity of a set of tables, kWp. */
export function dcCapacityKwp(
  tableCount: number,
  modulesPerTable: number,
  moduleWp: number,
): number {
  if (tableCount <= 0 || modulesPerTable <= 0 || moduleWp <= 0) return 0;
  return round6((tableCount * modulesPerTable * moduleWp) / 1000);
}

/** A rectangular corridor (road, cable trench, drainage channel) along a centreline. */
export function corridorPolygon(from: PointM, to: PointM, widthM: number): RingM {
  assertFinitePositive(widthM, "widthM");
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return [];
  const nx = (-dy / len) * (widthM / 2);
  const ny = (dx / len) * (widthM / 2);
  return [
    { x: round6(from.x + nx), y: round6(from.y + ny) },
    { x: round6(to.x + nx), y: round6(to.y + ny) },
    { x: round6(to.x - nx), y: round6(to.y - ny) },
    { x: round6(from.x - nx), y: round6(from.y - ny) },
  ];
}

/** An axis-aligned equipment pad centred on a point, rotated by `azimuthDeg`. */
export function padPolygon(centre: PointM, widthM: number, depthM: number, azimuthDeg = 0): RingM {
  return tableFootprint(centre, widthM, depthM, azimuthDeg);
}

/* -------------------------------------------------------------------------
 * P-153 — Automatic block arrangement, compliance report and alternatives.
 * ---------------------------------------------------------------------- */

export type ArrangedBlockType =
  | "array_table"
  | "setback"
  | "internal_road"
  | "equipment_pad"
  | "inverter_station";

export interface ArrangedBlock {
  /** Stable key within one arrangement run. */
  key: string;
  type: ArrangedBlockType;
  label: string;
  polygon: RingM;
  moduleCount: number;
  dcKwp: number;
  row?: number;
  column?: number;
  /** Slope percent at the block, only present when terrain samples were given. */
  slopePct?: number;
}

export interface TerrainSample {
  x: number;
  y: number;
  elevationM: number;
}

export interface TerrainRef {
  samples: TerrainSample[];
  /** Structure/tracker slope limit in percent, from the equipment library entry. */
  slopeLimitPct: number;
}

export interface EquipmentPadSpec {
  label: string;
  widthM: number;
  depthM: number;
  count: number;
  type?: "equipment_pad" | "inverter_station";
}

export interface ArrangeInput {
  boundary: RingM;
  exclusionZones?: RingM[];
  table: TableGeometry;
  /** Module nameplate in watts, used for the DC capacity roll-up. */
  moduleWp: number;
  pitchM: number;
  setbackM: number;
  azimuthDeg: number;
  /** Insert an internal access road after every N rows. 0 disables roads. */
  roadEveryNRows?: number;
  roadWidthM?: number;
  equipmentPads?: EquipmentPadSpec[];
  tableGapM?: number;
  terrainRef?: TerrainRef | null;
  maxTables?: number;
}

export type ComplianceStatus = "pass" | "warn" | "fail";

export interface ComplianceFinding {
  code: string;
  message: string;
  /** Labels of the blocks involved — collisions always name both. */
  blocks: string[];
  /** Offending coordinates in site-local metres, when the check has a location. */
  coordinates?: PointM[];
}

export interface ComplianceCheck {
  id: "boundary" | "exclusions" | "collisions" | "slope" | "capacity";
  title: string;
  status: ComplianceStatus;
  findings: ComplianceFinding[];
}

export interface CapacityMetrics {
  tableCount: number;
  moduleCount: number;
  dcKwp: number;
  /** Achieved GCR = collector area / buildable area. */
  achievedGcr: number;
  usedAreaM2: number;
  buildableAreaM2: number;
  boundaryAreaM2: number;
  roadCount: number;
  padCount: number;
}

export interface ComplianceReport {
  status: ComplianceStatus;
  checks: ComplianceCheck[];
  warningCount: number;
  failureCount: number;
}

export interface ArrangeResult {
  blocks: ArrangedBlock[];
  buildable: RingM;
  metrics: CapacityMetrics;
  compliance: ComplianceReport;
}

function worstStatus(statuses: ComplianceStatus[]): ComplianceStatus {
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("warn")) return "warn";
  return "pass";
}

function centroidOf(ring: RingM): PointM {
  const pts = openRingM(ring);
  if (pts.length === 0) return { x: 0, y: 0 };
  return {
    x: round6(pts.reduce((s, p) => s + p.x, 0) / pts.length),
    y: round6(pts.reduce((s, p) => s + p.y, 0) / pts.length),
  };
}

/** Nearest-sample lookup; returns null when no terrain data was supplied. */
function elevationAt(point: PointM, samples: TerrainSample[]): number | null {
  if (samples.length === 0) return null;
  let best = samples[0];
  let bestD = Infinity;
  for (const s of samples) {
    const d = (s.x - point.x) ** 2 + (s.y - point.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best.elevationM;
}

/**
 * Slope percent across a block footprint, sampled at its vertices.
 * Returns null when terrain data is absent — the caller must emit
 * `no_terrain_data` rather than guessing a value.
 */
export function blockSlopePct(
  polygon: RingM,
  terrain: TerrainRef | null | undefined,
): number | null {
  if (!terrain || terrain.samples.length === 0) return null;
  const pts = openRingM(polygon);
  const elevations = pts
    .map((p) => elevationAt(p, terrain.samples))
    .filter((e): e is number => e !== null);
  if (elevations.length < 2) return null;
  const rise = Math.max(...elevations) - Math.min(...elevations);
  const bbox = boundingBox(pts);
  const run = Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
  if (run <= 0) return null;
  return round6((rise / run) * 100);
}

/**
 * Full automatic arrangement: scanline table fill, internal access roads every
 * N rows, equipment pads dropped road-adjacent, then the compliance report.
 * Pure and deterministic — the same input always yields the same blocks.
 */
export function arrangeBlocks(input: ArrangeInput): ArrangeResult {
  const {
    boundary,
    exclusionZones = [],
    table,
    moduleWp,
    pitchM,
    setbackM,
    azimuthDeg,
    roadEveryNRows = 0,
    roadWidthM = 6,
    equipmentPads = [],
    tableGapM = 0,
    terrainRef = null,
    maxTables,
  } = input;

  const fill = gridFill({
    boundary,
    exclusions: exclusionZones,
    setbackM,
    pitchM,
    tableWidthM: table.tableLengthM,
    tableDepthM: table.projectedWidthM,
    azimuthDeg,
    tableGapM,
    maxTables,
  });

  const blocks: ArrangedBlock[] = [];

  // 1. Setback ring (informational block so the canvas can draw it).
  if (setbackM > 0 && fill.buildable.length >= 3) {
    blocks.push({
      key: "setback-0",
      type: "setback",
      label: `Setback ${setbackM} m`,
      polygon: fill.buildable,
      moduleCount: 0,
      dcKwp: 0,
    });
  }

  // 2. Internal access roads every N rows (skip a whole table row for the road).
  const roadRows = new Set<number>();
  if (roadEveryNRows > 0 && roadWidthM > 0) {
    const maxRow = fill.tables.reduce((m, t) => Math.max(m, t.row), -1);
    for (let r = roadEveryNRows; r <= maxRow; r += roadEveryNRows + 1) {
      roadRows.add(r);
    }
  }

  const kept = fill.tables.filter((t) => !roadRows.has(t.row));
  const perTableKwp = (table.moduleCount * moduleWp) / 1000;

  kept.forEach((t, i) => {
    const polygon = t.polygon;
    const slopePct = blockSlopePct(polygon, terrainRef);
    blocks.push({
      key: `table-${i}`,
      type: "array_table",
      label: `T${String(t.row + 1).padStart(2, "0")}-${String(t.column + 1).padStart(2, "0")}`,
      polygon,
      moduleCount: table.moduleCount,
      dcKwp: round6(perTableKwp),
      row: t.row,
      column: t.column,
      ...(slopePct === null ? {} : { slopePct }),
    });
  });

  // Road centrelines follow the skipped rows, spanning the occupied extent.
  const roadCentres: PointM[] = [];
  let roadIndex = 0;
  for (const row of [...roadRows].sort((a, b) => a - b)) {
    const neighbours = fill.tables.filter((t) => t.row === row);
    if (neighbours.length < 2) continue;
    const first = neighbours[0].centre;
    const last = neighbours[neighbours.length - 1].centre;
    const polygon = corridorPolygon(first, last, roadWidthM);
    if (polygon.length === 0) continue;
    roadCentres.push(centroidOf(polygon));
    blocks.push({
      key: `road-${roadIndex}`,
      type: "internal_road",
      label: `Access road ${roadIndex + 1}`,
      polygon,
      moduleCount: 0,
      dcKwp: 0,
      row,
    });
    roadIndex += 1;
  }

  // 3. Equipment pads / inverter stations, dropped at road-adjacent centroids.
  const anchors: PointM[] =
    roadCentres.length > 0
      ? roadCentres
      : [centroidOf(fill.buildable.length ? fill.buildable : boundary)];
  let padIndex = 0;
  for (const spec of equipmentPads) {
    for (let n = 0; n < spec.count; n += 1) {
      const anchor = anchors[padIndex % anchors.length];
      // Fan pads out along the road so repeated pads do not stack.
      const offset = (Math.floor(padIndex / anchors.length) + 1) * (spec.widthM * 1.5);
      const centre = rotatePoint({ x: anchor.x + offset, y: anchor.y }, azimuthDeg, anchor);
      blocks.push({
        key: `pad-${padIndex}`,
        type: spec.type ?? "equipment_pad",
        label: spec.count > 1 ? `${spec.label} ${n + 1}` : spec.label,
        polygon: padPolygon(centre, spec.widthM, spec.depthM, azimuthDeg),
        moduleCount: 0,
        dcKwp: 0,
      });
      padIndex += 1;
    }
  }

  const tables = blocks.filter((b) => b.type === "array_table");
  const moduleCount = tables.reduce((s, b) => s + b.moduleCount, 0);
  const collectorAreaM2 = tables.length * table.collectorWidthM * table.tableLengthM;
  const usedAreaM2 = round6(
    blocks.filter((b) => b.type !== "setback").reduce((s, b) => s + ringArea(b.polygon), 0),
  );

  const metrics: CapacityMetrics = {
    tableCount: tables.length,
    moduleCount,
    dcKwp: round6((moduleCount * moduleWp) / 1000),
    achievedGcr: fill.buildableAreaM2 > 0 ? round6(collectorAreaM2 / fill.buildableAreaM2) : 0,
    usedAreaM2,
    buildableAreaM2: round6(fill.buildableAreaM2),
    boundaryAreaM2: round6(ringArea(boundary)),
    roadCount: blocks.filter((b) => b.type === "internal_road").length,
    padCount: blocks.filter((b) => b.type === "equipment_pad" || b.type === "inverter_station")
      .length,
  };

  const compliance = checkCompliance({
    blocks,
    boundary,
    buildable: fill.buildable,
    exclusionZones,
    terrainRef,
    metrics,
  });

  return { blocks, buildable: fill.buildable, metrics, compliance };
}

export interface ComplianceInput {
  blocks: ArrangedBlock[];
  boundary: RingM;
  /** Boundary minus setback; falls back to the boundary when no setback applies. */
  buildable: RingM;
  exclusionZones?: RingM[];
  terrainRef?: TerrainRef | null;
  metrics: CapacityMetrics;
}

/**
 * Five-part compliance report: boundary, exclusion zones, collisions, slope
 * limits and capacity. Every finding names the blocks involved; positional
 * findings carry the offending coordinates.
 */
export function checkCompliance(input: ComplianceInput): ComplianceReport {
  const { blocks, boundary, buildable, exclusionZones = [], terrainRef, metrics } = input;
  const placed = blocks.filter((b) => b.type !== "setback");
  const shrunk = buildable.length >= 3 ? buildable : openRingM(boundary);

  // (1) Boundary compliance — every vertex inside boundary minus setback.
  const boundaryFindings: ComplianceFinding[] = [];
  for (const block of placed) {
    const outside = openRingM(block.polygon).filter((p) => !pointInPolygon(p, shrunk));
    if (outside.length > 0) {
      boundaryFindings.push({
        code: "outside_buildable_area",
        message: `${block.label} has ${outside.length} vertex/vertices outside the boundary setback.`,
        blocks: [block.label],
        coordinates: outside,
      });
    }
  }

  // (2) Exclusion-zone compliance — zero intersections allowed.
  const exclusionFindings: ComplianceFinding[] = [];
  exclusionZones.forEach((zone, zi) => {
    for (const block of placed) {
      if (polygonsIntersect(block.polygon, zone)) {
        exclusionFindings.push({
          code: "exclusion_zone_conflict",
          message: `${block.label} intersects exclusion zone ${zi + 1}.`,
          blocks: [block.label, `Exclusion zone ${zi + 1}`],
          coordinates: [centroidOf(block.polygon)],
        });
      }
    }
  });

  // (3) Collision detection — pairwise, naming BOTH colliding blocks.
  const collisionFindings: ComplianceFinding[] = [];
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const a = placed[i];
      const b = placed[j];
      if (polygonsIntersect(a.polygon, b.polygon)) {
        collisionFindings.push({
          code: "block_collision",
          message: `${a.label} collides with ${b.label}.`,
          blocks: [a.label, b.label],
          coordinates: [centroidOf(a.polygon), centroidOf(b.polygon)],
        });
      }
    }
  }

  // (4) Slope limits — never fabricate a slope when terrain data is missing.
  const slopeFindings: ComplianceFinding[] = [];
  let slopeStatus: ComplianceStatus = "pass";
  if (!terrainRef || terrainRef.samples.length === 0) {
    slopeStatus = "warn";
    slopeFindings.push({
      code: "no_terrain_data",
      message:
        "No sampled elevations on the site configuration — slope compliance was not evaluated.",
      blocks: [],
    });
  } else {
    for (const block of placed.filter((b) => b.type === "array_table")) {
      const slope = block.slopePct ?? blockSlopePct(block.polygon, terrainRef);
      if (slope !== null && slope > terrainRef.slopeLimitPct) {
        slopeStatus = "warn";
        slopeFindings.push({
          code: "slope_limit_exceeded",
          message: `${block.label} sits on ${slope.toFixed(1)}% slope, above the ${terrainRef.slopeLimitPct}% structure limit.`,
          blocks: [block.label],
          coordinates: [centroidOf(block.polygon)],
        });
      }
    }
  }

  // (5) Capacity optimization roll-up.
  const capacityFindings: ComplianceFinding[] = [
    {
      code: "capacity_summary",
      message: `${metrics.tableCount} tables — ${metrics.moduleCount} modules — ${metrics.dcKwp.toFixed(1)} kWp DC at ${metrics.achievedGcr.toFixed(3)} achieved GCR.`,
      blocks: [],
    },
  ];
  if (metrics.tableCount === 0) {
    capacityFindings.push({
      code: "no_tables_placed",
      message: "The arrangement placed no tables — relax the setback, pitch or exclusion zones.",
      blocks: [],
    });
  }

  const checks: ComplianceCheck[] = [
    {
      id: "boundary",
      title: "Boundary and setback",
      status: boundaryFindings.length ? "fail" : "pass",
      findings: boundaryFindings,
    },
    {
      id: "exclusions",
      title: "Exclusion zones",
      status: exclusionFindings.length ? "fail" : "pass",
      findings: exclusionFindings,
    },
    {
      id: "collisions",
      title: "Block collisions",
      status: collisionFindings.length ? "fail" : "pass",
      findings: collisionFindings,
    },
    { id: "slope", title: "Slope limits", status: slopeStatus, findings: slopeFindings },
    {
      id: "capacity",
      title: "Capacity",
      status: metrics.tableCount === 0 ? "warn" : "pass",
      findings: capacityFindings,
    },
  ];

  return {
    status: worstStatus(checks.map((c) => c.status)),
    checks,
    warningCount: checks.filter((c) => c.status === "warn").length,
    failureCount: checks.filter((c) => c.status === "fail").length,
  };
}

export interface AlternativeParams {
  module: ModuleDims;
  moduleWp: number;
  orientation: Orientation;
  modulesAcross: number;
  modulesUp: number;
  tiltDeg: number;
  azimuthDeg: number;
  gcr: number;
  setbackM: number;
  roadEveryNRows: number;
  roadWidthM: number;
  tracker: boolean;
}

export interface AlternativeSiteConfig {
  boundary: RingM;
  exclusionZones?: RingM[];
  latitude: number;
  terrainRef?: TerrainRef | null;
  equipmentPads?: EquipmentPadSpec[];
}

export interface LayoutAlternative {
  option: "A" | "B" | "C";
  name: string;
  rationale: string;
  params: AlternativeParams;
  pitchM: number;
  table: TableGeometry;
  result: ArrangeResult;
}

const OPTION_KEYS = ["A", "B", "C"] as const;

/**
 * Up to three deterministic alternatives around the base parameters:
 * A = the base case, B = tracker/higher GCR, C = fixed tilt at a lower GCR
 * with wider road spacing. Each one is arranged and compliance-checked.
 */
export function generateAlternatives(
  site: AlternativeSiteConfig,
  base: AlternativeParams,
  count = 3,
): LayoutAlternative[] {
  const variants: { params: AlternativeParams; rationale: string }[] = [
    { params: base, rationale: "Base case — as configured." },
    {
      params: {
        ...base,
        tracker: !base.tracker,
        gcr: Math.min(0.95, base.gcr + 0.05),
        tiltDeg: base.tracker ? base.tiltDeg : Math.max(0, base.tiltDeg - 5),
        roadEveryNRows: Math.max(1, base.roadEveryNRows),
      },
      rationale: base.tracker
        ? "Fixed tilt at GCR +0.05 — denser packing, lower structure cost."
        : "Single-axis tracker at GCR +0.05 — higher yield, denser packing.",
    },
    {
      params: {
        ...base,
        gcr: Math.max(0.05, base.gcr - 0.05),
        azimuthDeg: base.azimuthDeg,
        tiltDeg: Math.min(60, base.tiltDeg + 5),
        roadEveryNRows: Math.max(1, base.roadEveryNRows + 2),
      },
      rationale: "GCR -0.05 with steeper tilt and wider road spacing — lower shading losses.",
    },
  ];

  return variants.slice(0, Math.max(1, Math.min(count, 3))).map((variant, index) => {
    const params = variant.params;
    const table = makeTable({
      module: params.module,
      orientation: params.orientation,
      modulesAcross: params.modulesAcross,
      modulesUp: params.modulesUp,
      tiltDeg: params.tracker ? 0 : params.tiltDeg,
    });
    const pitchM = pitchFromGcr(table.collectorWidthM, params.gcr);
    const result = arrangeBlocks({
      boundary: site.boundary,
      exclusionZones: site.exclusionZones ?? [],
      table,
      moduleWp: params.moduleWp,
      pitchM,
      setbackM: params.setbackM,
      azimuthDeg: params.azimuthDeg,
      roadEveryNRows: params.roadEveryNRows,
      roadWidthM: params.roadWidthM,
      equipmentPads: site.equipmentPads ?? [],
      terrainRef: site.terrainRef ?? null,
    });
    const option = OPTION_KEYS[index];
    return {
      option,
      name: `Option ${option}`,
      rationale: variant.rationale,
      params,
      pitchM: round6(pitchM),
      table,
      result,
    };
  });
}
