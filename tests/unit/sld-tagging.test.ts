// P-141 — unit tests for the deterministic tagging engine.
import { describe, expect, it } from "vitest";

import {
  autoResolveDuplicates,
  duplicateTagIds,
  findDuplicateTags,
  generateCableNumbers,
  generateTags,
  isValidTag,
  planRetag,
  type TagArea,
  type TaggableConnection,
  type TaggableObject,
} from "@/lib/sld/tagging";

const symbols = [
  { type_key: "inverter", tag_prefix: "INV" },
  { type_key: "transformer", tag_prefix: "TR" },
  { type_key: "cable", tag_prefix: "" },
];

const obj = (o: Partial<TaggableObject> & { id: string }): TaggableObject => ({
  symbol_type: "inverter",
  tag: null,
  x: 0,
  y: 0,
  ...o,
});

const conn = (c: Partial<TaggableConnection> & { id: string }): TaggableConnection => ({
  connection_type: "cable",
  cable_number: null,
  from_object_id: "a",
  to_object_id: "b",
  ...c,
});

describe("generateTags", () => {
  it("numbers two inverters in area 01 deterministically", () => {
    const objects = [obj({ id: "b", y: 200 }), obj({ id: "a", y: 100 })];
    const first = generateTags(objects, symbols);
    expect(first).toEqual([
      { id: "a", previous: null, tag: "INV-01-01" },
      { id: "b", previous: null, tag: "INV-01-02" },
    ]);
    // Re-running over the same graph is identical.
    expect(generateTags(objects, symbols)).toEqual(first);
  });

  it("sorts by y then x within a prefix", () => {
    const objects = [obj({ id: "r", x: 300, y: 100 }), obj({ id: "l", x: 10, y: 100 })];
    expect(generateTags(objects, symbols).map((a) => a.id)).toEqual(["l", "r"]);
  });

  it("keeps existing tags without force and reserves their sequence", () => {
    const objects = [
      obj({ id: "a", y: 100, tag: "INV-01-05" }),
      obj({ id: "b", y: 200, tag: "INV-01-01" }),
      obj({ id: "c", y: 300 }),
    ];
    const plan = generateTags(objects, symbols);
    expect(plan).toEqual([{ id: "c", previous: null, tag: "INV-01-02" }]);
  });

  it("is a no-op when every object is already tagged (no force)", () => {
    const objects = [
      obj({ id: "a", tag: "INV-01-01", y: 1 }),
      obj({ id: "b", tag: "INV-01-02", y: 2 }),
    ];
    expect(generateTags(objects, symbols)).toEqual([]);
  });

  it("renumbers everything with force", () => {
    const objects = [
      obj({ id: "a", tag: "INV-01-09", y: 1 }),
      obj({ id: "b", tag: "INV-01-04", y: 2 }),
    ];
    expect(generateTags(objects, symbols, [], { force: true })).toEqual([
      { id: "a", previous: "INV-01-09", tag: "INV-01-01" },
      { id: "b", previous: "INV-01-04", tag: "INV-01-02" },
    ]);
  });

  it("keeps separate counters per prefix", () => {
    const objects = [
      obj({ id: "i1", y: 1 }),
      obj({ id: "t1", symbol_type: "transformer", y: 2 }),
      obj({ id: "i2", y: 3 }),
    ];
    const tags = Object.fromEntries(generateTags(objects, symbols).map((a) => [a.id, a.tag]));
    expect(tags).toEqual({ i1: "INV-01-01", i2: "INV-01-02", t1: "TR-01-01" });
  });

  it("skips symbols with no tag prefix", () => {
    const objects = [obj({ id: "c1", symbol_type: "cable" }), obj({ id: "x", symbol_type: "??" })];
    expect(generateTags(objects, symbols)).toEqual([]);
  });

  it("assigns area codes from bounds and counts per area", () => {
    const areas: TagArea[] = [
      { id: "a1", name: "PV block", code: "01", bounds: { x: 0, y: 0, w: 100, h: 100 } },
      { id: "a2", name: "BESS", code: "02", bounds: { x: 200, y: 0, w: 100, h: 100 } },
    ];
    const objects = [
      obj({ id: "p1", x: 10, y: 10 }),
      obj({ id: "b1", x: 210, y: 10 }),
      obj({ id: "b2", x: 220, y: 50 }),
      obj({ id: "out", x: 900, y: 900 }),
    ];
    const tags = Object.fromEntries(
      generateTags(objects, symbols, areas).map((a) => [a.id, a.tag]),
    );
    expect(tags).toEqual({
      p1: "INV-01-01",
      b1: "INV-02-01",
      b2: "INV-02-02",
      out: "INV-01-02",
    });
  });

  it("emits tags matching the canonical pattern", () => {
    const plan = generateTags([obj({ id: "a" })], symbols);
    expect(isValidTag(plan[0].tag)).toBe(true);
    expect(isValidTag("inv-01-01")).toBe(false);
    expect(isValidTag("INV-1-1")).toBe(false);
  });
});

describe("generateCableNumbers", () => {
  it("numbers cable and dc_string sequentially, skipping earth and signal", () => {
    const connections = [
      conn({ id: "c1" }),
      conn({ id: "c2", connection_type: "dc_string" }),
      conn({ id: "e1", connection_type: "earth" }),
      conn({ id: "s1", connection_type: "signal" }),
    ];
    const plan = generateCableNumbers(connections, []);
    expect(plan.map((c) => [c.id, c.cable_number])).toEqual([
      ["c1", "CBL-01-01"],
      ["c2", "CBL-01-02"],
    ]);
  });

  it("keeps existing cable numbers without force", () => {
    const connections = [conn({ id: "c1", cable_number: "CBL-01-07" }), conn({ id: "c2" })];
    expect(generateCableNumbers(connections, [])).toEqual([
      { id: "c2", previous: null, cable_number: "CBL-01-01" },
    ]);
    expect(generateCableNumbers(connections, [])).toHaveLength(1);
  });

  it("derives the area from the source object", () => {
    const areas: TagArea[] = [
      { id: "a2", name: "BESS", code: "02", bounds: { x: 200, y: 0, w: 100, h: 100 } },
    ];
    const objects = [obj({ id: "src", x: 210, y: 10 })];
    const plan = generateCableNumbers([conn({ id: "c1", from_object_id: "src" })], objects, areas);
    expect(plan[0].cable_number).toBe("CBL-02-01");
  });
});

describe("duplicate detection", () => {
  const objects = [
    obj({ id: "a", tag: "INV-01-01", y: 1 }),
    obj({ id: "b", tag: "INV-01-01", y: 2 }),
    obj({ id: "c", tag: "INV-01-02", y: 3 }),
  ];

  it("reports collisions with offenders after the first", () => {
    expect(findDuplicateTags(objects)).toEqual([
      { tag: "INV-01-01", ids: ["a", "b"], offenderIds: ["b"] },
    ]);
    expect([...duplicateTagIds(objects)]).toEqual(["a", "b"]);
  });

  it("auto-resolve renumbers only the later duplicate", () => {
    const fixes = autoResolveDuplicates(objects, symbols);
    expect(fixes).toEqual([{ id: "b", previous: null, tag: "INV-01-03" }]);
  });

  it("auto-resolve is a no-op when tags are unique", () => {
    expect(autoResolveDuplicates([obj({ id: "a", tag: "INV-01-01" })], symbols)).toEqual([]);
  });
});

describe("planRetag", () => {
  it("returns both tag and cable plans and is idempotent after applying", () => {
    const objects = [obj({ id: "a", y: 1 }), obj({ id: "b", y: 2 })];
    const connections = [conn({ id: "c1", from_object_id: "a", to_object_id: "b" })];
    const plan = planRetag(objects, connections, symbols);
    expect(plan.tags).toHaveLength(2);
    expect(plan.cables).toHaveLength(1);

    const applied = objects.map((o) => ({
      ...o,
      tag: plan.tags.find((t) => t.id === o.id)?.tag ?? o.tag,
    }));
    const appliedConns = connections.map((c) => ({
      ...c,
      cable_number: plan.cables.find((x) => x.id === c.id)?.cable_number ?? c.cable_number,
    }));
    const second = planRetag(applied, appliedConns, symbols);
    expect(second.tags).toEqual([]);
    expect(second.cables).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// P-148 acceptance — determinism under input shuffling.
// --------------------------------------------------------------------------
describe("P-148 acceptance — tagging determinism", () => {
  const graph: TaggableObject[] = [
    obj({ id: "i1", x: 100, y: 100 }),
    obj({ id: "i2", x: 400, y: 100 }),
    obj({ id: "i3", x: 100, y: 400 }),
    obj({ id: "t1", symbol_type: "transformer", x: 700, y: 100 }),
    obj({ id: "t2", symbol_type: "transformer", x: 700, y: 500 }),
  ];

  it("produces identical tags regardless of input array order", () => {
    const expected = new Map(generateTags(graph, symbols).map((a) => [a.id, a.tag]));
    const orders = [
      [...graph].reverse(),
      [graph[3], graph[0], graph[4], graph[2], graph[1]],
      [graph[2], graph[4], graph[1], graph[3], graph[0]],
    ];
    for (const shuffled of orders) {
      const got = new Map(generateTags(shuffled, symbols).map((a) => [a.id, a.tag]));
      expect(got).toEqual(expected);
    }
  });

  it("every generated tag matches the canonical regex", () => {
    for (const a of generateTags(graph, symbols)) expect(isValidTag(a.tag)).toBe(true);
  });

  it("is idempotent without force and renumbers with force", () => {
    const applied = graph.map((o) => ({
      ...o,
      tag: generateTags(graph, symbols).find((a) => a.id === o.id)!.tag,
    }));
    expect(generateTags(applied, symbols)).toEqual([]);
    expect(generateTags(applied, symbols, { force: true }).length).toBe(applied.length);
  });
});
