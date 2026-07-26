// P-151 — geometry core: projection, area, ring validation.
import { describe, expect, it } from "vitest";

import {
  closeRing,
  isRingClosed,
  m2ToHectares,
  openRing,
  polygonAreaM2,
  ringAreaM2,
  ringSelfIntersects,
  snapMeters,
  toLngLat,
  toLocalMeters,
  validateRing,
  type Ring,
} from "@/lib/pv-site.geo";

const ANCHOR = { lat: 31.9, lon: 36.1 };

describe("equirectangular projection", () => {
  it("maps the anchor to the origin", () => {
    expect(toLocalMeters(ANCHOR, ANCHOR)).toEqual({ x: 0, y: 0 });
  });

  it("scales latitude by 110540 m/deg", () => {
    const p = toLocalMeters({ lat: 31.91, lon: 36.1 }, ANCHOR);
    expect(p.y).toBeCloseTo(0.01 * 110540, 3);
    expect(p.x).toBeCloseTo(0, 6);
  });

  it("scales longitude by cos(lat0) * 111320 m/deg", () => {
    const p = toLocalMeters({ lat: 31.9, lon: 36.11 }, ANCHOR);
    expect(p.x).toBeCloseTo(0.01 * Math.cos((31.9 * Math.PI) / 180) * 111320, 3);
  });

  it("round-trips back to WGS84", () => {
    const original = { lat: 31.9042, lon: 36.1075 };
    const back = toLngLat(toLocalMeters(original, ANCHOR), ANCHOR);
    expect(back.lat).toBeCloseTo(original.lat, 9);
    expect(back.lon).toBeCloseTo(original.lon, 9);
  });
});

describe("shoelace area", () => {
  it("computes a 100 x 200 m rectangle as 20000 m²", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 200 },
      { x: 0, y: 200 },
    ];
    expect(polygonAreaM2(pts)).toBeCloseTo(20000, 6);
  });

  it("is orientation independent", () => {
    const cw = [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
    ];
    expect(polygonAreaM2(cw)).toBeCloseTo(100, 6);
  });

  it("converts m² to hectares", () => {
    expect(m2ToHectares(25000)).toBeCloseTo(2.5, 9);
  });

  it("matches shoelace math for a geographic ring", () => {
    const ring: Ring = [
      [36.1, 31.9],
      [36.11, 31.9],
      [36.11, 31.91],
      [36.1, 31.91],
      [36.1, 31.9],
    ];
    const width = 0.01 * Math.cos((31.9 * Math.PI) / 180) * 111320;
    const height = 0.01 * 110540;
    expect(ringAreaM2(ring, ANCHOR)).toBeCloseTo(width * height, 3);
  });
});

describe("ring open/close", () => {
  const open: Ring = [
    [36.1, 31.9],
    [36.11, 31.9],
    [36.11, 31.91],
  ];

  it("closes an open ring", () => {
    const closed = closeRing(open);
    expect(closed).toHaveLength(4);
    expect(isRingClosed(closed)).toBe(true);
    expect(closed[0]).toEqual(closed[closed.length - 1]);
  });

  it("is idempotent", () => {
    expect(closeRing(closeRing(open))).toEqual(closeRing(open));
  });

  it("re-opens a closed ring", () => {
    expect(openRing(closeRing(open))).toEqual(open);
  });
});

describe("ring validation", () => {
  it("accepts a valid closed square", () => {
    const ring: Ring = [
      [36.1, 31.9],
      [36.11, 31.9],
      [36.11, 31.91],
      [36.1, 31.91],
      [36.1, 31.9],
    ];
    expect(validateRing(ring)).toBeNull();
  });

  it("rejects rings with fewer than 4 points", () => {
    const ring: Ring = [
      [36.1, 31.9],
      [36.11, 31.9],
      [36.1, 31.9],
    ];
    const issue = validateRing(ring);
    expect(issue).not.toBeNull();
    expect(issue?.code).toBe("too_few_points");
  });

  it("rejects a self-intersecting bowtie", () => {
    const bowtie: Ring = [
      [36.1, 31.9],
      [36.11, 31.91],
      [36.11, 31.9],
      [36.1, 31.91],
      [36.1, 31.9],
    ];
    expect(ringSelfIntersects(bowtie)).toBe(true);
    expect(validateRing(bowtie)?.code).toBe("self_intersecting");
  });

  it("does not flag adjacent shared vertices as intersections", () => {
    const ring: Ring = [
      [36.1, 31.9],
      [36.12, 31.9],
      [36.12, 31.92],
      [36.105, 31.91],
      [36.1, 31.92],
      [36.1, 31.9],
    ];
    expect(ringSelfIntersects(ring)).toBe(false);
  });
});

describe("snap to grid", () => {
  it("snaps to the nearest step", () => {
    expect(snapMeters(12.4, 5)).toBe(10);
    expect(snapMeters(13.1, 5)).toBe(15);
  });

  it("returns the value unchanged for a non-positive step", () => {
    expect(snapMeters(12.4, 0)).toBe(12.4);
  });
});
