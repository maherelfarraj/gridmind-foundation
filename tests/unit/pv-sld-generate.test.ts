// P-155 — Unit tests for automatic SLD generation from an approved PV layout.
import { describe, expect, it } from "vitest";

import { METRES_TO_CANVAS, buildSldGraph, diffTagSets, type GenInput } from "@/lib/pv/sld-generate";

const SYMBOLS = [
  { type_key: "pv_string", tag_prefix: "STR" },
  { type_key: "string_combiner", tag_prefix: "SCB" },
  { type_key: "inverter", tag_prefix: "INV" },
  { type_key: "transformer", tag_prefix: "TX" },
  { type_key: "mv_switchgear", tag_prefix: "MVSG" },
  { type_key: "grid_connection_point", tag_prefix: "POI" },
];

function input(overrides: Partial<GenInput> = {}): GenInput {
  const blocks = Array.from({ length: 2 }, (_, i) => ({
    id: `b${i + 1}`,
    label: `T${i + 1}`,
    centroid: { x: i * 50, y: 100 },
  }));
  const strings = Array.from({ length: 6 }, (_, i) => ({
    id: `s${i + 1}`,
    string_label: `STR-${String(i + 1).padStart(3, "0")}`,
    block_id: blocks[i % 2].id,
    combiner_label: i < 3 ? "CB-01" : "CB-02",
    inverter_station_label: i < 3 ? "INV-01" : "INV-02",
    mppt_index: (i % 3) + 1,
    modules_in_series: 26,
    dc_power_kwp: 15.08,
    voc_at_min_temp_v: 1420,
    vmp_at_max_temp_v: 980,
  }));
  const assignments = ["INV-01", "INV-02"].map((label, i) => ({
    inverter_station_label: label,
    inverter_id: null,
    mppt_index: 1,
    loading_pct: 118,
    dc_ac_ratio: 1.18,
    inverter_ac_kw: 250,
    inverter_dc_kwp: 295,
    mv_feeder: { label: "FDR-01", voltage_kv: 33 },
    transformer: { transformer_id: null, station_label: `TX-0${i + 1}`, loading_pct: 62 },
  }));
  return {
    layoutId: "11111111-1111-1111-1111-111111111111",
    layoutNumber: "PV-LAY-0001",
    strings,
    assignments,
    blocks,
    grid: {
      voltageKv: 33,
      exportCapacityMw: 50,
      importCapacityMw: null,
      utility: "NEPCO",
    },
    symbolTypes: SYMBOLS,
    ...overrides,
  };
}

describe("P-155 SLD generation from layout", () => {
  it("produces a fully connected graph with no orphan strings", () => {
    const g = buildSldGraph(input());
    expect(g.warnings.filter((w) => w.code === "orphan_string")).toHaveLength(0);
    const poi = g.objects.find((o) => o.symbol_type === "grid_connection_point")!;

    // Every string reaches the POI by walking the connection graph.
    const edges = new Map<string, string[]>();
    for (const c of g.connections) edges.set(c.from, [...(edges.get(c.from) ?? []), c.to]);
    const reaches = (start: string): boolean => {
      const stack = [start];
      const seen = new Set<string>();
      while (stack.length) {
        const n = stack.pop()!;
        if (n === poi.key) return true;
        if (seen.has(n)) continue;
        seen.add(n);
        stack.push(...(edges.get(n) ?? []));
      }
      return false;
    };
    for (const s of g.objects.filter((o) => o.symbol_type === "pv_string")) {
      expect(reaches(s.key)).toBe(true);
    }
  });

  it("maps block centroids to canvas millimetres deterministically", () => {
    const g = buildSldGraph(input());
    const first = g.objects.find((o) => o.label === "STR-001")!;
    expect(first.x).toBe(0 * METRES_TO_CANVAS);
    expect(first.y).toBe(100 * METRES_TO_CANVAS);
  });

  it("emits the expected symbol mix and connection types", () => {
    const g = buildSldGraph(input());
    expect(g.counts.byType).toEqual({
      pv_string: 6,
      string_combiner: 2,
      inverter: 2,
      transformer: 2,
      mv_switchgear: 1,
      grid_connection_point: 1,
    });
    const types = new Set(g.connections.map((c) => c.connection_type));
    expect(types).toEqual(new Set(["dc_string", "cable", "busbar"]));
    expect(g.connections.filter((c) => c.connection_type === "dc_string")).toHaveLength(6);
    expect(g.connections.every((c) => c.cable_number?.startsWith("CBL-"))).toBe(true);
  });

  it("is idempotent in count and tag set across regenerations", () => {
    const a = buildSldGraph(input());
    const b = buildSldGraph(input());
    expect(a.objects.map((o) => o.tag)).toEqual(b.objects.map((o) => o.tag));
    expect(a.counts).toEqual(b.counts);
    const diff = diffTagSets(
      a.objects.map((o) => o.tag),
      b.objects.map((o) => o.tag),
    );
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.unchanged).toBe(a.objects.length);
  });

  it("gives duplicate tags a deterministic suffix and a warning", () => {
    const g = buildSldGraph(
      input({ symbolTypes: SYMBOLS.map((s) => ({ ...s, tag_prefix: "EQ" })) }),
    );
    const tags = g.objects.map((o) => o.tag);
    expect(new Set(tags).size).toBe(tags.length);
    // Same prefix for every symbol still yields unique sequential tags.
    expect(g.warnings.filter((w) => w.code === "duplicate_tag")).toHaveLength(0);

    const forced = buildSldGraph(
      input({
        symbolTypes: [
          { type_key: "pv_string", tag_prefix: "STR" },
          { type_key: "inverter", tag_prefix: "INV" },
        ],
      }),
    );
    // Symbols without a registry prefix keep the empty base tag → suffixes.
    const dup = forced.warnings.filter((w) => w.code === "duplicate_tag");
    expect(dup.length).toBeGreaterThan(0);
    expect(forced.objects.filter((o) => o.tag.endsWith("-2")).length).toBeGreaterThan(0);
    expect(new Set(forced.objects.map((o) => o.tag)).size).toBe(forced.objects.length);
  });

  it("warns instead of dropping a string with no combiner or station", () => {
    const base = input();
    base.strings[0].combiner_label = null;
    base.strings[0].inverter_station_label = null;
    const g = buildSldGraph(base);
    const warn = g.warnings.find((w) => w.code === "orphan_string");
    expect(warn?.refs).toEqual(["STR-001"]);
  });

  it("falls back to direct transformer → grid links when no MV feeder exists", () => {
    const base = input();
    base.assignments = base.assignments.map((a) => ({ ...a, mv_feeder: null }));
    const g = buildSldGraph(base);
    expect(g.objects.filter((o) => o.symbol_type === "mv_switchgear")).toHaveLength(0);
    expect(
      g.connections.filter((c) => c.to === "poi:grid" && c.connection_type === "cable"),
    ).toHaveLength(2);
  });

  it("carries string electricals and inverter loading into properties", () => {
    const g = buildSldGraph(input());
    const s = g.objects.find((o) => o.symbol_type === "pv_string")!;
    expect(s.properties).toMatchObject({
      modules_in_series: 26,
      dc_power_kwp: 15.08,
      voc_at_min_temp_v: 1420,
      vmp_at_max_temp_v: 980,
    });
    const inv = g.objects.find((o) => o.symbol_type === "inverter")!;
    expect(inv.properties).toMatchObject({ loading_pct: 118, dc_ac_ratio: 1.18 });
    const poi = g.objects.find((o) => o.symbol_type === "grid_connection_point")!;
    expect(poi.properties).toMatchObject({
      voltage_kv: 33,
      export_capacity_mw: 50,
      utility: "NEPCO",
    });
  });

  it("reports added and removed tags between generations", () => {
    const a = buildSldGraph(input());
    const smaller = input();
    smaller.strings = smaller.strings.slice(0, 3);
    smaller.assignments = smaller.assignments.slice(0, 1);
    const b = buildSldGraph(smaller);
    const diff = diffTagSets(
      a.objects.map((o) => o.tag),
      b.objects.map((o) => o.tag),
    );
    expect(diff.removed.length).toBeGreaterThan(0);
    expect(diff.added).toEqual([]);
  });
});
