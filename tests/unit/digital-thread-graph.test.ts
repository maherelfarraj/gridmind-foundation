// P-192 — Digital-thread graph integrity: cycle safety, dedupe, orphan mapping.
// Pure in-memory fixtures; no Supabase, no DB.
import { describe, expect, it } from "vitest";

import {
  buildGraphLayers,
  computeDepths,
  graphKey,
  mapOrphanRows,
  type OrphanRow,
} from "@/lib/digital-thread/graph-layout";
import type { GraphEdge, GraphNode } from "@/lib/digital-thread/thread.server";

/** The documented 17-step EPC chain, opportunity → warranty_claim. */
const CHAIN = [
  "opportunity",
  "proposal",
  "contract",
  "project",
  "design_basis",
  "layout",
  "sld",
  "simulation",
  "bom",
  "rfq",
  "po",
  "delivery",
  "cwp",
  "work_order",
  "itp_record",
  "asbuilt",
  "warranty_claim",
] as const;

const KNOWN_TYPES = [...CHAIN, "vendor", "drawing", "equipment", "spare_part"] as const;

function id(t: string) {
  return `id-${t}`;
}

function chainNodes(): GraphNode[] {
  return CHAIN.map((t, i) => ({
    entity_type: t,
    entity_id: id(t),
    label: `${t} node`,
    depth: i,
  })) as GraphNode[];
}

function chainEdges(): GraphEdge[] {
  return CHAIN.slice(0, -1).map((t, i) => ({
    id: `e-${i}`,
    source_type: t,
    source_id: id(t),
    target_type: CHAIN[i + 1],
    target_id: id(CHAIN[i + 1]),
    link_type: "derives",
  })) as GraphEdge[];
}

describe("buildGraphLayers — 17-step chain", () => {
  it("places the full opportunity → warranty_claim chain in one column per step", () => {
    const root = { entity_type: "opportunity", entity_id: id("opportunity") };
    const layout = buildGraphLayers(chainNodes(), chainEdges(), root);

    expect(layout.layers).toHaveLength(17);
    expect(layout.placed).toHaveLength(17);
    expect(layout.layers.map((l) => l.depth)).toEqual(
      Array.from({ length: 17 }, (_, i) => i),
    );
    expect(layout.layers.at(-1)!.nodes[0].entity_type).toBe("warranty_claim");
    // Columns advance left → right, one node per column.
    const xs = layout.placed.map((p) => p.x);
    expect(new Set(xs).size).toBe(17);
  });

  it("puts upstream nodes at negative depth and downstream at positive", () => {
    const root = { entity_type: "project", entity_id: id("project") };
    const depths = computeDepths(chainNodes(), chainEdges(), root);

    expect(depths.get(graphKey("project", id("project")))).toBe(0);
    expect(depths.get(graphKey("opportunity", id("opportunity")))).toBe(-3);
    expect(depths.get(graphKey("contract", id("contract")))).toBe(-1);
    expect(depths.get(graphKey("layout", id("layout")))).toBe(2);
    expect(depths.get(graphKey("warranty_claim", id("warranty_claim")))).toBe(13);
  });
});

describe("buildGraphLayers — resilience", () => {
  it("terminates on a cycle instead of looping forever", () => {
    const nodes = [
      { entity_type: "layout", entity_id: "a", label: "A", depth: 0 },
      { entity_type: "bom", entity_id: "b", label: "B", depth: 1 },
      { entity_type: "rfq", entity_id: "c", label: "C", depth: 2 },
    ] as GraphNode[];
    const edges = [
      { id: "1", source_type: "layout", source_id: "a", target_type: "bom", target_id: "b", link_type: "impacts" },
      { id: "2", source_type: "bom", source_id: "b", target_type: "rfq", target_id: "c", link_type: "impacts" },
      // closes the loop back to the root
      { id: "3", source_type: "rfq", source_id: "c", target_type: "layout", target_id: "a", link_type: "impacts" },
    ] as GraphEdge[];

    const layout = buildGraphLayers(nodes, edges, { entity_type: "layout", entity_id: "a" });
    expect(layout.placed).toHaveLength(3);
    expect(layout.placed.filter((p) => p.entity_id === "a")).toHaveLength(1);
    // the root keeps depth 0 even though a back-edge points at it
    expect(layout.index.get(graphKey("layout", "a"))!.depth).toBe(0);
  });

  it("dedupes repeated nodes and ignores edges to unknown endpoints", () => {
    const dup = { entity_type: "bom", entity_id: "b", label: "B", depth: 1 } as GraphNode;
    const nodes = [
      { entity_type: "layout", entity_id: "a", label: "A", depth: 0 } as GraphNode,
      dup,
      { ...dup, label: "B (copy)" },
    ];
    const edges = [
      { id: "1", source_type: "layout", source_id: "a", target_type: "bom", target_id: "b", link_type: "impacts" },
      { id: "2", source_type: "layout", source_id: "a", target_type: "ghost", target_id: "zz", link_type: "impacts" },
    ] as GraphEdge[];

    const layout = buildGraphLayers(nodes, edges, { entity_type: "layout", entity_id: "a" });
    expect(layout.placed).toHaveLength(2);
    expect(layout.index.get(graphKey("bom", "b"))!.label).toBe("B");
  });

  it("falls back to reported depths when no root is given", () => {
    const layout = buildGraphLayers(chainNodes(), chainEdges(), null);
    expect(layout.layers.map((l) => l.depth)).toEqual(Array.from({ length: 17 }, (_, i) => i));
  });

  it("handles an empty graph without dividing by zero", () => {
    const layout = buildGraphLayers([], [], null);
    expect(layout.placed).toEqual([]);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });
});

describe("entity_link_orphans mapping", () => {
  const base: OrphanRow = {
    link_id: "l1",
    company_id: "c1",
    endpoint: "target",
    entity_type: "po",
    entity_id: "gone",
  };

  it("flags a link whose target row was deleted", () => {
    const { orphans, skipped } = mapOrphanRows([base], KNOWN_TYPES);
    expect(skipped).toHaveLength(0);
    expect(orphans).toHaveLength(1);
    expect(orphans[0].reason).toBe("missing_target");
    expect(orphans[0].label).toContain("po");
  });

  it("skips unknown entity types instead of reporting them as orphans", () => {
    const rows = [base, { ...base, link_id: "l2", entity_type: "mystery_table" }];
    const { orphans, skipped } = mapOrphanRows(rows, KNOWN_TYPES);
    expect(orphans.map((o) => o.link_id)).toEqual(["l1"]);
    expect(skipped.map((s) => s.entity_type)).toEqual(["mystery_table"]);
  });

  it("dedupes repeated rows for the same link endpoint", () => {
    const { orphans } = mapOrphanRows([base, { ...base }], KNOWN_TYPES);
    expect(orphans).toHaveLength(1);
  });

  it("tolerates no orphan links in a healthy fixture set", () => {
    const { orphans, skipped } = mapOrphanRows([], KNOWN_TYPES);
    expect(orphans).toHaveLength(0);
    expect(skipped).toHaveLength(0);
  });
});
