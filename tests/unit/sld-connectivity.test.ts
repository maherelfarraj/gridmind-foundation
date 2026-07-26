// P-142 — Fixture-graph tests for the pure connectivity engine.
import { describe, expect, it } from "vitest";

import {
  buildGraph,
  runValidation,
  summarizeIssues,
  type ConnEdge,
  type ConnObject,
  type ConnSymbolMeta,
} from "@/lib/sld/connectivity";

const symbols: ConnSymbolMeta[] = [
  { type_key: "pv_string", category: "generation", ports: [{ key: "out", required: true }] },
  {
    type_key: "inverter",
    category: "conversion",
    ports: [
      { key: "in", required: true },
      { key: "out", required: true },
    ],
  },
  {
    type_key: "transformer",
    category: "transformation",
    ports: [
      { key: "lv", required: true },
      { key: "hv", required: true },
    ],
  },
  { type_key: "grid_connection_point", category: "grid", ports: [{ key: "in", required: true }] },
  { type_key: "busbar", category: "distribution", ports: [] },
  { type_key: "weather_station", category: "monitoring", ports: [] },
  { type_key: "earthing", category: "earthing", ports: [] },
];

function obj(
  id: string,
  symbol_type: string,
  properties: Record<string, unknown> = {},
  tag: string | null = null,
): ConnObject {
  return { id, symbol_type, tag, properties };
}

function edge(
  id: string,
  from: string,
  fromPort: string,
  to: string,
  toPort: string,
  connection_type = "cable",
  properties: Record<string, unknown> = {},
): ConnEdge {
  return {
    id,
    from_object_id: from,
    from_port: fromPort,
    to_object_id: to,
    to_port: toPort,
    connection_type,
    properties,
  };
}

/** PV string → inverter → transformer → grid point. */
function healthyChain() {
  const objects = [
    obj("s1", "pv_string", { voltage_kv: 1.5 }),
    obj("i1", "inverter", { voltage_kv: 1.5, rating_kw: 100 }),
    obj("t1", "transformer", { lv_kv: 0.69, hv_kv: 33, rating_kva: 5000 }),
    obj("g1", "grid_connection_point", { voltage_kv: 33 }),
  ];
  const connections = [
    edge("c1", "s1", "out", "i1", "in", "dc_string"),
    edge("c2", "i1", "out", "t1", "lv"),
    edge("c3", "t1", "hv", "g1", "in"),
  ];
  return { objects, connections };
}

describe("connectivity — buildGraph", () => {
  it("merges busbar ports into a single node", () => {
    const objects = [obj("b1", "busbar"), obj("i1", "inverter"), obj("i2", "inverter")];
    const graph = buildGraph(objects, [
      edge("c1", "i1", "out", "b1", "p1"),
      edge("c2", "i2", "out", "b1", "p2"),
    ]);
    expect(graph.portUsage.get("b1::*")).toHaveLength(2);
    expect(graph.adjacency.get("b1")).toEqual(new Set(["i1", "i2"]));
  });

  it("ignores edges referencing missing objects", () => {
    const graph = buildGraph([obj("i1", "inverter")], [edge("c1", "i1", "out", "ghost", "in")]);
    expect(graph.edges).toHaveLength(0);
  });

  it("excludes earth/signal from adjacency but keeps them incident", () => {
    const graph = buildGraph(
      [obj("i1", "inverter"), obj("e1", "earthing")],
      [edge("c1", "i1", "out", "e1", "in", "earth")],
    );
    expect(graph.adjacency.get("i1")?.size).toBe(0);
    expect(graph.edgesByObject.get("i1")).toHaveLength(1);
  });
});

describe("connectivity — validators", () => {
  it("flags a lone inverter as disconnected_equipment", () => {
    const issues = runValidation([obj("i1", "inverter")], [], symbols);
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("disconnected_equipment");
    expect(issues.find((i) => i.code === "disconnected_equipment")?.severity).toBe("warning");
  });

  it("does not flag monitoring or earthing equipment as disconnected", () => {
    const issues = runValidation([obj("w1", "weather_station"), obj("e1", "earthing")], [], symbols);
    expect(issues.filter((i) => i.code === "disconnected_equipment")).toHaveLength(0);
  });

  it("reports zero open_circuit for a complete source→grid chain", () => {
    const { objects, connections } = healthyChain();
    const issues = runValidation(objects, connections, symbols);
    expect(issues.filter((i) => i.code === "open_circuit")).toHaveLength(0);
  });

  it("reports open_circuit when the chain never reaches the grid", () => {
    const { objects, connections } = healthyChain();
    const issues = runValidation(objects, connections.slice(0, 2), symbols);
    const open = issues.find((i) => i.code === "open_circuit");
    expect(open?.severity).toBe("error");
    expect(open?.objectIds).toEqual(["s1"]);
  });

  it("flags unterminated required ports", () => {
    const issues = runValidation(
      [obj("g1", "grid_connection_point"), obj("i1", "inverter")],
      [edge("c1", "i1", "out", "g1", "in")],
      symbols,
    );
    const unterminated = issues.filter((i) => i.code === "unterminated_port");
    expect(unterminated.some((i) => i.objectIds[0] === "i1")).toBe(true);
    expect(unterminated.some((i) => i.objectIds[0] === "g1")).toBe(false);
  });

  it("flags duplicate tags as errors", () => {
    const issues = runValidation(
      [obj("a", "inverter", {}, "INV-01-01"), obj("b", "inverter", {}, "INV-01-01")],
      [],
      symbols,
    );
    const dup = issues.find((i) => i.code === "duplicate_tag");
    expect(dup?.severity).toBe("error");
    expect(dup?.objectIds.sort()).toEqual(["a", "b"]);
  });

  it("flags 0.69 kV inverter wired straight to a 33 kV busbar", () => {
    const issues = runValidation(
      [obj("i1", "inverter", { voltage_kv: 0.69 }), obj("b1", "busbar", { voltage_kv: 33 })],
      [edge("c1", "i1", "out", "b1", "p1")],
      symbols,
    );
    const mismatch = issues.find((i) => i.code === "voltage_mismatch");
    expect(mismatch?.severity).toBe("error");
    expect(mismatch?.connectionIds).toEqual(["c1"]);
  });

  it("allows a voltage step across a transformer", () => {
    const { objects, connections } = healthyChain();
    const issues = runValidation(objects, connections, symbols);
    expect(issues.filter((i) => i.code === "voltage_mismatch")).toHaveLength(0);
  });

  it("warns on voltages absent from the project voltage list", () => {
    const issues = runValidation([obj("b1", "busbar", { voltage_kv: 11 })], [], symbols, {
      projectVoltagesKv: [0.69, 33, 132],
    });
    const unknown = issues.find((i) => i.code === "unknown_voltage_level");
    expect(unknown?.severity).toBe("warning");
    expect(
      runValidation([obj("b2", "busbar", { voltage_kv: 33 })], [], symbols, {
        projectVoltagesKv: [0.69, 33],
      }).filter((i) => i.code === "unknown_voltage_level"),
    ).toHaveLength(0);
  });

  it("flags a cable carrying current above its ampacity", () => {
    const issues = runValidation(
      [obj("i1", "inverter"), obj("b1", "busbar")],
      [edge("c1", "i1", "out", "b1", "p1", "cable", { current_a: 420, ampacity_a: 300 })],
      symbols,
    );
    expect(issues.some((i) => i.code === "rating_exceeded" && i.connectionIds?.[0] === "c1")).toBe(
      true,
    );
  });

  it("flags summed inverter kW exceeding transformer kVA", () => {
    const objects = [
      obj("t1", "transformer", { lv_kv: 0.69, hv_kv: 33, rating_kva: 1000 }),
      obj("b1", "busbar", { voltage_kv: 0.69 }),
      obj("i1", "inverter", { voltage_kv: 0.69, rating_kw: 800, power_factor: 1 }),
      obj("i2", "inverter", { voltage_kv: 0.69, rating_kw: 800, power_factor: 1 }),
    ];
    const connections = [
      edge("c1", "t1", "lv", "b1", "p0"),
      edge("c2", "i1", "out", "b1", "p1"),
      edge("c3", "i2", "out", "b1", "p2"),
    ];
    const exceeded = runValidation(objects, connections, symbols).find(
      (i) => i.code === "rating_exceeded",
    );
    expect(exceeded?.severity).toBe("error");
    expect(exceeded?.objectIds).toContain("t1");
  });

  it("does not flag a transformer with adequate rating", () => {
    const objects = [
      obj("t1", "transformer", { lv_kv: 0.69, hv_kv: 33, rating_kva: 5000 }),
      obj("i1", "inverter", { voltage_kv: 0.69, rating_kw: 800 }),
    ];
    const issues = runValidation(objects, [edge("c1", "t1", "lv", "i1", "in")], symbols);
    expect(issues.filter((i) => i.code === "rating_exceeded")).toHaveLength(0);
  });

  it("flags two supplies landing on one non-busbar input port", () => {
    const objects = [obj("i1", "inverter"), obj("s1", "pv_string"), obj("s2", "pv_string")];
    const connections = [
      edge("c1", "s1", "out", "i1", "in", "dc_string"),
      edge("c2", "s2", "out", "i1", "in", "dc_string"),
    ];
    const issue = runValidation(objects, connections, symbols).find(
      (i) => i.code === "multiple_sources_one_input",
    );
    expect(issue?.severity).toBe("error");
    expect(issue?.objectIds).toContain("i1");
  });

  it("never flags multiple supplies on a busbar", () => {
    const objects = [obj("b1", "busbar"), obj("i1", "inverter"), obj("i2", "inverter")];
    const issues = runValidation(
      objects,
      [edge("c1", "i1", "out", "b1", "p1"), edge("c2", "i2", "out", "b1", "p1")],
      symbols,
    );
    expect(issues.filter((i) => i.code === "multiple_sources_one_input")).toHaveLength(0);
  });

  it("is deterministic and summarises severities", () => {
    const { objects, connections } = healthyChain();
    const a = runValidation(objects, connections, symbols);
    const b = runValidation([...objects].reverse(), [...connections].reverse(), symbols);
    expect(a).toEqual(b);
    const summary = summarizeIssues(a);
    expect(summary.issue_count).toBe(summary.error_count + summary.warning_count);
  });
});
