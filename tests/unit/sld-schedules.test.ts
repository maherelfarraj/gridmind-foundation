// P-144 — Pure schedule builders over a fixture drawing graph.
import { describe, expect, it } from "vitest";

import type { ConnEdge, ConnObject } from "@/lib/sld/connectivity";
import {
  buildBoq,
  buildCableSchedule,
  buildEquipment,
  buildLegend,
  buildProtection,
  buildSchedules,
  scheduleMatrix,
  SCHEDULE_TYPES,
  type ScheduleSymbolMeta,
} from "@/lib/sld/schedules";

const SYMBOLS: ScheduleSymbolMeta[] = [
  { type_key: "inverter", display_name: "Inverter", category: "conversion", svg_body: "<rect/>" },
  {
    type_key: "transformer",
    display_name: "Transformer",
    category: "conversion",
    svg_body: "<g/>",
  },
  {
    type_key: "circuit_breaker",
    display_name: "Circuit breaker",
    category: "protection",
    svg_body: "<path/>",
  },
  { type_key: "pv_string", display_name: "PV string", category: "generation", svg_body: "<line/>" },
];

const symbolMap = new Map(SYMBOLS.map((s) => [s.type_key, s]));

function obj(
  id: string,
  symbol_type: string,
  tag: string | null,
  properties: Record<string, unknown> = {},
): ConnObject {
  return { id, symbol_type, tag, properties };
}

function edge(
  id: string,
  from: string,
  to: string,
  connection_type = "cable",
  properties: Record<string, unknown> = {},
  cable_number: string | null = null,
): ConnEdge {
  return {
    id,
    from_object_id: from,
    from_port: "out",
    to_object_id: to,
    to_port: "in",
    connection_type,
    cable_number,
    properties,
  };
}

// Fixture: 12 × 250 kW inverters, 1 transformer, 1 breaker, 2 PV strings.
const OBJECTS: ConnObject[] = [
  ...Array.from({ length: 12 }, (_, i) =>
    obj(`i${i}`, "inverter", `INV-01-${String(i + 1).padStart(2, "0")}`, {
      rated_power_kw: 250,
      layer: "equipment",
    }),
  ),
  obj("t1", "transformer", "TR-01-01", { rated_kva: 3150, hv_kv: 33, lv_kv: 0.69 }),
  obj("cb1", "circuit_breaker", "CB-01-01", { rated_current_a: 630, breaking_ka: 25 }),
  obj("s1", "pv_string", "STR-02-01", { module_wp: 610, modules_in_series: 28, area: "02" }),
  obj("s2", "pv_string", "STR-02-02", { module_wp: 610, modules_in_series: 28, area: "02" }),
];

const CONNECTIONS: ConnEdge[] = [
  edge(
    "c1",
    "i0",
    "t1",
    "cable",
    { size_mm2: 240, voltage_kv: 0.69, length_m: 120, cores: 3 },
    "CBL-01-01",
  ),
  edge(
    "c2",
    "t1",
    "cb1",
    "cable",
    { size_mm2: 95, voltage_kv: 33, length_m: 80, cores: 3 },
    "CBL-01-02",
  ),
  edge("c3", "s1", "i0", "dc_string", { size_mm2: 6, voltage_kv: 1.5, length_m: 45 }, "CBL-02-01"),
  edge("c4", "cb1", "t1", "earth", { length_m: 10 }),
];

describe("buildBoq", () => {
  it("counts placed objects exactly, grouped by type and rating", () => {
    const rows = buildBoq(OBJECTS, CONNECTIONS, symbolMap);
    const inverters = rows.find((r) => r.symbol_type === "inverter" && r.unit === "no");
    expect(inverters?.quantity).toBe(12);
    expect(inverters?.rating).toBe("250 kW");
    expect(inverters?.description).toBe("Inverter");

    const totalUnits = rows.filter((r) => r.unit === "no").reduce((n, r) => n + r.quantity, 0);
    expect(totalUnits).toBe(OBJECTS.length);
    expect(rows.map((r) => r.item)).toEqual(rows.map((_, i) => String(i + 1).padStart(3, "0")));
  });

  it("sums cable metres by size and voltage, skipping earth runs", () => {
    const rows = buildBoq(OBJECTS, CONNECTIONS, symbolMap).filter((r) => r.unit === "m");
    expect(rows.map((r) => r.rating).sort()).toEqual([
      "240 mm² · 0.69 kV",
      "6 mm² · 1.5 kV",
      "95 mm² · 33 kV",
    ]);
    expect(rows.reduce((n, r) => n + r.quantity, 0)).toBe(245);
  });
});

describe("buildCableSchedule", () => {
  it("lists every cable/dc_string connection with endpoint tags", () => {
    const rows = buildCableSchedule(OBJECTS, CONNECTIONS);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.cable_number)).toEqual(["CBL-01-01", "CBL-01-02", "CBL-02-01"]);
    const first = rows[0];
    expect(first.from_tag).toBe("INV-01-01");
    expect(first.to_tag).toBe("TR-01-01");
    expect(first.size_mm2).toBe(240);
    expect(first.cores).toBe(3);
    expect(first.length_m).toBe(120);
    expect(first.voltage_kv).toBe(0.69);
  });

  it("derives kV from a volts property when kV is absent", () => {
    const rows = buildCableSchedule(
      [obj("a", "busbar", "BUS-01-01"), obj("b", "busbar", "BUS-01-02")],
      [edge("cx", "a", "b", "cable", { voltage_v: 690 })],
    );
    expect(rows[0].voltage_kv).toBe(0.69);
  });
});

describe("buildEquipment", () => {
  it("emits one row per tagged object with area and layer", () => {
    const rows = buildEquipment(OBJECTS, symbolMap);
    expect(rows).toHaveLength(OBJECTS.length);
    const string = rows.find((r) => r.tag === "STR-02-01");
    expect(string?.area).toBe("02");
    const inverter = rows.find((r) => r.tag === "INV-01-01");
    expect(inverter?.area).toBe("01");
    expect(inverter?.layer).toBe("equipment");
    expect(inverter?.rating).toBe("250 kW");
  });

  it("skips untagged objects", () => {
    expect(buildEquipment([obj("x", "inverter", null)], symbolMap)).toHaveLength(0);
  });
});

describe("buildProtection", () => {
  it("pairs each protective device with the equipment it protects", () => {
    const rows = buildProtection(OBJECTS, CONNECTIONS);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tag: "CB-01-01",
      device_type: "circuit_breaker",
      rated_current_a: 630,
      breaking_ka: 25,
      protects_tag: "TR-01-01",
    });
  });
});

describe("buildLegend", () => {
  it("contains exactly the symbol types on the sheet, with svg refs and counts", () => {
    const rows = buildLegend(OBJECTS, symbolMap);
    expect(rows.map((r) => r.symbol_type)).toEqual([
      "circuit_breaker",
      "inverter",
      "pv_string",
      "transformer",
    ]);
    expect(rows.find((r) => r.symbol_type === "inverter")?.count).toBe(12);
    expect(rows.every((r) => typeof r.svg_body === "string")).toBe(true);
    // A registry symbol not placed on the sheet must not appear.
    expect(rows.some((r) => r.symbol_type === "busbar")).toBe(false);
  });
});

describe("buildSchedules", () => {
  const set = buildSchedules({
    objects: OBJECTS,
    connections: CONNECTIONS,
    symbols: SYMBOLS,
    titleBlock: {
      drawing_number: "SLD-0001",
      title: "East Amman — key single line",
      revision_code: "A",
      status: "draft",
      project_name: "East Amman 50 MW PV",
      company_name: "GSI",
      drawn_by: "maher@next.jo",
      created_at: "2026-07-26T00:00:00.000Z",
    },
  });

  it("produces every schedule type", () => {
    expect(Object.keys(set).sort()).toEqual([...SCHEDULE_TYPES].sort());
  });

  it("renders a single title-block row carrying drawing metadata", () => {
    expect(set.title_block).toHaveLength(1);
    expect(set.title_block[0]).toMatchObject({
      drawing_number: "SLD-0001",
      revision_code: "A",
      project_name: "East Amman 50 MW PV",
      drawn_by: "maher@next.jo",
    });
  });

  it("is deterministic — regenerating the same graph yields identical rows", () => {
    const again = buildSchedules({
      objects: [...OBJECTS].reverse(),
      connections: [...CONNECTIONS].reverse(),
      symbols: SYMBOLS,
      titleBlock: {
        drawing_number: "SLD-0001",
        title: "East Amman — key single line",
        revision_code: "A",
        status: "draft",
        project_name: "East Amman 50 MW PV",
        company_name: "GSI",
        drawn_by: "maher@next.jo",
        created_at: "2026-07-26T00:00:00.000Z",
      },
    });
    expect(again.equipment).toEqual(set.equipment);
    expect(again.cable).toEqual(set.cable);
    expect(again.legend).toEqual(set.legend);
    expect(again.boq.map((r) => [r.symbol_type, r.rating, r.quantity])).toEqual(
      set.boq.map((r) => [r.symbol_type, r.rating, r.quantity]),
    );
  });
});

describe("scheduleMatrix", () => {
  it("maps rows onto the declared column order for CSV/PDF", () => {
    const rows = buildCableSchedule(OBJECTS, CONNECTIONS) as unknown as Record<string, unknown>[];
    const { headers, body } = scheduleMatrix("cable", rows);
    expect(headers[0]).toBe("Cable no.");
    expect(body).toHaveLength(3);
    expect(body[0][1]).toBe("INV-01-01");
    // Null cells become empty strings, never "null".
    expect(body.every((r) => r.every((c) => c !== null && c !== "null"))).toBe(true);
  });
});
