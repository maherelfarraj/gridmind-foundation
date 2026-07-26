// P-145 — Unit tests: revision diff, graph hashing, revision codes, cloud geometry.
import { describe, expect, it } from "vitest";

import {
  diffGraphs,
  diffTotals,
  graphHash,
  LINEAGE_KEY,
  type DiffConnection,
  type DiffObject,
} from "@/lib/sld/diff";
import { nextRevisionCode, withLineage } from "@/lib/sld-revisions.server";
import { arrowHead, cloudPath, rectAround } from "@/lib/sld/markup";

const obj = (over: Partial<DiffObject> & { id: string }): DiffObject => ({
  symbol_type: "inverter",
  tag: null,
  x: 0,
  y: 0,
  rotation: 0,
  mirrored: false,
  layer_id: "equipment",
  properties: {},
  ...over,
});

const conn = (over: Partial<DiffConnection> & { id: string }): DiffConnection => ({
  from_object_id: "a",
  from_port: "out",
  to_object_id: "b",
  to_port: "in",
  connection_type: "cable",
  cable_number: null,
  properties: {},
  ...over,
});

/** Simulates the server deep-copy: fresh ids, lineage stamped from source. */
function deepCopy(objects: DiffObject[]): DiffObject[] {
  return objects.map((o, i) => ({
    ...o,
    id: `copy-${i}`,
    properties: withLineage(o.properties, o.id),
  }));
}

describe("diffGraphs", () => {
  it("reports a moved object with correct from/to coordinates", () => {
    const a = [obj({ id: "1", tag: "INV-01-01", x: 100, y: 100 })];
    const b = [obj({ id: "1", tag: "INV-01-01", x: 140, y: 160 })];
    const d = diffGraphs(a, [], b, []);

    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
    expect(d.moved).toHaveLength(1);
    expect(d.moved[0].from).toEqual({ x: 100, y: 100 });
    expect(d.moved[0].to).toEqual({ x: 140, y: 160 });
  });

  it("matches deep-copied objects through lineage, not row id", () => {
    const a = [obj({ id: "src-1", tag: "INV-01-01", x: 10, y: 10 })];
    const b = deepCopy(a).map((o) => ({ ...o, x: 30 }));

    expect(b[0].properties[LINEAGE_KEY]).toBe("src-1");
    const d = diffGraphs(a, [], b, []);
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
    expect(d.moved).toHaveLength(1);
  });

  it("detects added, removed, tag and property changes", () => {
    const a = [
      obj({ id: "1", tag: "INV-01-01", properties: { rating_kva: 100 } }),
      obj({ id: "2", tag: "TRF-01-01" }),
    ];
    const b = [
      obj({ id: "1", tag: "INV-01-02", properties: { rating_kva: 250 } }),
      obj({ id: "3", tag: "MV-01-01" }),
    ];
    const d = diffGraphs(a, [], b, []);

    expect(d.added.map((o) => o.tag)).toEqual(["MV-01-01"]);
    expect(d.removed.map((o) => o.tag)).toEqual(["TRF-01-01"]);
    expect(d.tagChanged).toHaveLength(1);
    expect(d.propertyChanged[0]).toMatchObject({ property: "rating_kva", from: 100, to: 250 });
    expect(diffTotals(d).added).toBe(1);
  });

  it("ignores internal lineage props as property changes", () => {
    const a = [obj({ id: "1", tag: "INV-01-01", properties: { kw: 10 } })];
    const b = deepCopy(a);
    const d = diffGraphs(a, [], b, []);
    expect(d.propertyChanged).toHaveLength(0);
  });

  it("reports connection changes", () => {
    const objects = [obj({ id: "a", tag: "A" }), obj({ id: "b", tag: "B" })];
    const d = diffGraphs(objects, [conn({ id: "c1" })], objects, []);
    expect(d.connectionChanged.some((c) => c.kind === "removed")).toBe(true);
  });
});

describe("graphHash", () => {
  it("is identical for a no-op deep copy and differs after a change", async () => {
    const a = [obj({ id: "1", tag: "INV-01-01", x: 10, y: 20 })];
    const copy = deepCopy(a);
    const changed = copy.map((o) => ({ ...o, x: 55 }));

    const [ha, hcopy, hchanged] = await Promise.all([
      graphHash(a, []),
      graphHash(copy, []),
      graphHash(changed, []),
    ]);

    expect(ha).toHaveLength(64);
    expect(hcopy).toBe(ha);
    expect(hchanged).not.toBe(ha);
  });

  it("is stable regardless of object ordering", async () => {
    const a = [obj({ id: "1", tag: "A" }), obj({ id: "2", tag: "B" })];
    expect(await graphHash(a, [])).toBe(await graphHash([...a].reverse(), []));
  });
});

describe("nextRevisionCode", () => {
  it("walks A → B → C and rolls into AA", () => {
    expect(nextRevisionCode([])).toBe("A");
    expect(nextRevisionCode(["A"])).toBe("B");
    expect(nextRevisionCode(["A", "B", "C"])).toBe("D");
    expect(nextRevisionCode(["Z"])).toBe("AA");
    expect(nextRevisionCode(["A", "0-bad"])).toBe("B");
  });
});

describe("markup geometry", () => {
  it("builds a padded bounding rect", () => {
    const r = rectAround(
      [
        { x: 10, y: 10 },
        { x: 30, y: 50 },
      ],
      5,
    )!;
    expect(r).toEqual({ minX: 5, minY: 5, maxX: 35, maxY: 55 });
    expect(rectAround([], 5)).toBeNull();
  });

  it("emits a closed scalloped cloud path", () => {
    const d = cloudPath({ minX: 0, minY: 0, maxX: 60, maxY: 30 }, 6);
    expect(d.startsWith("M 0 0")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect((d.match(/A /g) ?? []).length).toBe(2 * (10 + 5));
  });

  it("returns a 3-point arrow head aimed at the target", () => {
    const head = arrowHead({ x: 0, y: 0 }, { x: 10, y: 0 }, 4);
    expect(head).toHaveLength(3);
    expect(head[0]).toEqual({ x: 10, y: 0 });
  });
});
