// P-140 — Unit tests for pure canvas geometry helpers.
import { describe, expect, it } from "vitest";

import {
  alignGeometry,
  boundsOf,
  distributeGeometry,
  expandSelectionToGroups,
  GROUP_KEY,
  marqueeHits,
  measure,
  mirrorSelectionGeometry,
  normalizeRotation,
  orthogonalRoute,
  pathFromPoints,
  rectFromPoints,
  rotateAbout,
  rotateSelectionGeometry,
  routeLength,
  snap,
  snapPoint,
} from "@/lib/sld/geometry";

const size = () => ({ w: 10, h: 10 });
const obj = (id: string, x: number, y: number, rotation = 0, mirrored = false) => ({
  id,
  x,
  y,
  rotation,
  mirrored,
});

describe("snap", () => {
  it("snaps to the nearest grid step", () => {
    expect(snap(12.4, 5)).toBe(10);
    expect(snap(13, 5)).toBe(15);
    expect(snapPoint({ x: 3, y: 8 }, 5)).toEqual({ x: 5, y: 10 });
  });

  it("is a no-op when disabled or grid invalid", () => {
    expect(snap(12.4, 5, false)).toBe(12.4);
    expect(snap(12.4, 0)).toBe(12.4);
  });
});

describe("bounds", () => {
  it("accounts for footprint and 90° rotation swap", () => {
    expect(boundsOf([obj("a", 10, 10)], () => ({ w: 20, h: 10 }))).toEqual({
      minX: 0,
      minY: 5,
      maxX: 20,
      maxY: 15,
    });
    expect(boundsOf([obj("a", 10, 10, 90)], () => ({ w: 20, h: 10 }))).toEqual({
      minX: 5,
      minY: 0,
      maxX: 15,
      maxY: 20,
    });
  });
});

describe("rotate", () => {
  it("rotates about a centre", () => {
    expect(rotateAbout({ x: 10, y: 0 }, { x: 0, y: 0 }, 90)).toEqual({ x: 0, y: 10 });
  });

  it("rotates a single object in place", () => {
    expect(rotateSelectionGeometry([obj("a", 25, 40)], 90, size)).toEqual([
      { id: "a", x: 25, y: 40, rotation: 90 },
    ]);
  });

  it("orbits multi-selections about the selection centre", () => {
    const out = rotateSelectionGeometry([obj("a", 0, 0), obj("b", 20, 0)], 90, size);
    expect(out).toEqual([
      { id: "a", x: 10, y: -10, rotation: 90 },
      { id: "b", x: 10, y: 10, rotation: 90 },
    ]);
  });

  it("normalizes rotation into the 0/90/180/270 set", () => {
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(-90)).toBe(270);
  });
});

describe("mirror", () => {
  it("flips x about the selection centre and toggles the flag", () => {
    const out = mirrorSelectionGeometry([obj("a", 0, 5), obj("b", 20, 5)], size);
    expect(out).toEqual([
      { id: "a", x: 20, y: 5, mirrored: true },
      { id: "b", x: 0, y: 5, mirrored: true },
    ]);
  });
});

describe("align + distribute", () => {
  it("aligns to bounding-box edges", () => {
    const objs = [obj("a", 10, 10), obj("b", 40, 30)];
    expect(alignGeometry(objs, "left", size)).toEqual([
      { id: "a", x: 10, y: 10 },
      { id: "b", x: 10, y: 30 },
    ]);
    expect(alignGeometry(objs, "top", size)).toEqual([
      { id: "a", x: 10, y: 10 },
      { id: "b", x: 40, y: 10 },
    ]);
    expect(alignGeometry(objs, "middle", size)).toEqual([
      { id: "a", x: 10, y: 20 },
      { id: "b", x: 40, y: 20 },
    ]);
  });

  it("needs at least two objects", () => {
    expect(alignGeometry([obj("a", 1, 1)], "left", size)).toEqual([]);
  });

  it("distributes evenly between the extremes", () => {
    const out = distributeGeometry(
      [obj("a", 0, 0), obj("b", 5, 0), obj("c", 30, 0)],
      "horizontal",
    );
    expect(out.map((o) => o.x)).toEqual([0, 15, 30]);
  });
});

describe("marquee", () => {
  it("selects intersecting objects only", () => {
    const rect = rectFromPoints({ x: 30, y: 30 }, { x: 0, y: 0 });
    expect(marqueeHits([obj("a", 10, 10), obj("b", 90, 90)], rect, size)).toEqual(["a"]);
  });
});

describe("measure", () => {
  it("reports mm distance", () => {
    const m = measure({ x: 0, y: 0 }, { x: 30, y: 40 });
    expect(m.distance).toBe(50);
  });

  it("axis-locks onto the dominant axis", () => {
    const m = measure({ x: 0, y: 0 }, { x: 30, y: 4 }, true);
    expect(m.end).toEqual({ x: 30, y: 0 });
    expect(m.distance).toBe(30);
    const v = measure({ x: 0, y: 0 }, { x: 4, y: 30 }, true);
    expect(v.end).toEqual({ x: 0, y: 30 });
    expect(v.distance).toBe(30);
  });
});

describe("orthogonal routing", () => {
  it("returns a straight run when already aligned", () => {
    expect(orthogonalRoute({ x: 0, y: 0 }, { x: 20, y: 0 })).toHaveLength(2);
  });

  it("inserts exactly one elbow", () => {
    const route = orthogonalRoute({ x: 0, y: 0 }, { x: 20, y: 10 });
    expect(route).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
    ]);
    expect(routeLength(route)).toBe(30);
    expect(pathFromPoints(route)).toBe("M 0 0 L 20 0 L 20 10");
  });
});

describe("groups", () => {
  it("expands a selection across shared group ids", () => {
    const objects = [
      { id: "a", properties: { [GROUP_KEY]: "g1" } },
      { id: "b", properties: { [GROUP_KEY]: "g1" } },
      { id: "c", properties: {} },
    ];
    expect(expandSelectionToGroups(["a"], objects).sort()).toEqual(["a", "b"]);
    expect(expandSelectionToGroups(["c"], objects)).toEqual(["c"]);
  });
});
