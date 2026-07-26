// P-143 — Coordination checks over fixture graphs, reusing the P-055 module/inverter fixtures.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildGraph, type ConnEdge, type ConnObject } from "@/lib/sld/connectivity";
import {
  cableReferences,
  checkBess,
  checkDcAcRatio,
  checkInverterTransformer,
  checkStringInverter,
  checkTransformerLoading,
  protectionReferences,
  runCoordination,
  COORDINATION_DISCLAIMER,
} from "@/lib/sld/coordination";

// Same fixture values as tests/unit/calculators.test.ts (P-055).
const MODULE = { voc_v: 41.0, vmp_v: 34.0, temp_coeff_voc_pct_per_c: -0.28 };
const SITE = { min_temp_c: -20, max_temp_c: 70 };
const INV_1500 = { max_dc_voltage_v: 1500, mppt_min_v: 550, mppt_max_v: 1500 };

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
  to: string,
  connection_type = "cable",
  properties: Record<string, unknown> = {},
): ConnEdge {
  return {
    id,
    from_object_id: from,
    from_port: "out",
    to_object_id: to,
    to_port: "in",
    connection_type,
    properties,
  };
}

function string(id: string, modules: number) {
  return obj(id, "pv_string", {
    ...MODULE,
    ...SITE,
    modules_in_series: modules,
    module_wp: 610,
    string_count: 1,
  });
}

describe("checkStringInverter", () => {
  it("errors when cold Voc exceeds the inverter maximum, showing the computed value", () => {
    const objects = [string("s1", 33), obj("i1", "inverter", { ...INV_1500, rated_power_kw: 100 })];
    const issues = checkStringInverter(objects, [edge("c1", "s1", "i1", "dc_string")]);
    const err = issues.find((i) => i.code === "voc_exceeds_inverter_max");
    expect(err?.severity).toBe("error");
    expect(Number(err?.values?.["String Voc at min temp"]?.replace(" V", ""))).toBeGreaterThan(1500);
    expect(err?.note).toBe(COORDINATION_DISCLAIMER);
  });

  it("passes a 28-module string on the same inverter", () => {
    const objects = [string("s1", 28), obj("i1", "inverter", { ...INV_1500, rated_power_kw: 100 })];
    const issues = checkStringInverter(objects, [edge("c1", "s1", "i1", "dc_string")]);
    expect(issues.some((i) => i.severity === "error")).toBe(false);
    expect(issues.some((i) => i.code === "string_ok")).toBe(true);
  });

  it("warns when strings outnumber MPPT inputs", () => {
    const objects = [
      string("s1", 28),
      string("s2", 28),
      obj("i1", "inverter", { ...INV_1500, mppt_count: 1, rated_power_kw: 100 }),
    ];
    const issues = checkStringInverter(objects, [
      edge("c1", "s1", "i1", "dc_string"),
      edge("c2", "s2", "i1", "dc_string"),
    ]);
    expect(issues.find((i) => i.code === "strings_exceed_mppt")?.severity).toBe("warning");
  });
});

describe("checkDcAcRatio", () => {
  const inverter = obj("i1", "inverter", { rated_power_kw: 100, ...INV_1500 });

  it("warns with the ratio to two decimals when above the upper bound", () => {
    const pv = obj("s1", "pv_string", { module_wp: 610, modules_in_series: 28, string_count: 12 });
    const issues = checkDcAcRatio([pv, inverter], [edge("c1", "s1", "i1", "dc_string")]);
    const warn = issues.find((i) => i.code === "dc_ac_out_of_range");
    expect(warn?.severity).toBe("warning");
    expect(warn?.values?.["DC/AC ratio"]).toMatch(/^\d+\.\d{2}$/);
    expect(Number(warn?.values?.["DC/AC ratio"])).toBeGreaterThan(1.6);
  });

  it("reports info inside the 1.0–1.6 band and honours configurable bounds", () => {
    const pv = obj("s1", "pv_string", { kwp: 130 });
    const inRange = checkDcAcRatio([pv, inverter], [edge("c1", "s1", "i1", "dc_string")]);
    expect(inRange.find((i) => i.code === "dc_ac_in_range")?.severity).toBe("info");

    const tightened = checkDcAcRatio([pv, inverter], [edge("c1", "s1", "i1", "dc_string")], {
      dcAcMax: 1.2,
    });
    expect(tightened.some((i) => i.code === "dc_ac_out_of_range")).toBe(true);
  });

  it("emits a plant-wide ratio row", () => {
    const pv = obj("s1", "pv_string", { kwp: 130 });
    const issues = checkDcAcRatio([pv, inverter], [edge("c1", "s1", "i1", "dc_string")]);
    expect(issues.some((i) => i.code.startsWith("plant_dc_ac"))).toBe(true);
  });
});

describe("checkInverterTransformer / checkTransformerLoading", () => {
  function plant(rated_kva: number, inverterKw: number, count: number) {
    const objects: ConnObject[] = [
      obj("t1", "transformer", { rated_kva, hv_kv: 33, lv_kv: 0.69, power_factor: 1 }, "TR-01-01"),
      obj("b1", "busbar", { voltage_kv: 0.69 }),
    ];
    const connections: ConnEdge[] = [edge("c0", "t1", "b1")];
    for (let i = 0; i < count; i += 1) {
      objects.push(obj(`i${i}`, "inverter", { rated_power_kw: inverterKw, ac_voltage_kv: 0.69 }));
      connections.push(edge(`c${i + 1}`, `i${i}`, "b1"));
    }
    return { objects, connections };
  }

  it("errors above 100% loading", () => {
    const { objects, connections } = plant(1000, 600, 2);
    const err = checkInverterTransformer(objects, connections).find(
      (i) => i.code === "transformer_overloaded",
    );
    expect(err?.severity).toBe("error");
    expect(err?.values?.Loading).toBe("120.0 %");
  });

  it("warns between 90% and 100% loading", () => {
    const { objects, connections } = plant(1000, 475, 2);
    const warn = checkInverterTransformer(objects, connections).find(
      (i) => i.code === "transformer_high_loading",
    );
    expect(warn?.severity).toBe("warning");
  });

  it("reports info below 90% loading", () => {
    const { objects, connections } = plant(2000, 500, 2);
    const issues = checkInverterTransformer(objects, connections);
    expect(issues.find((i) => i.code === "transformer_loading_ok")?.severity).toBe("info");
    expect(issues.some((i) => i.severity === "error")).toBe(false);
  });

  it("suggests a nameplate from selectTransformer when the rating is missing", () => {
    const objects = [
      obj("t1", "transformer", { hv_kv: 33, lv_kv: 0.69 }),
      obj("i1", "inverter", { rated_power_kw: 500, ac_voltage_kv: 0.69 }),
    ];
    const missing = checkInverterTransformer(objects, [edge("c1", "t1", "i1")]).find(
      (i) => i.code === "transformer_rating_missing",
    );
    expect(missing?.values?.["Suggested nameplate"]).toBe("630 kVA");
  });

  it("flags an LV winding mismatch against the inverter AC voltage", () => {
    const objects = [
      obj("t1", "transformer", { rated_kva: 2000, hv_kv: 33, lv_kv: 0.4 }),
      obj("i1", "inverter", { rated_power_kw: 500, ac_voltage_kv: 0.69 }),
    ];
    const issues = checkInverterTransformer(objects, [edge("c1", "t1", "i1")]);
    expect(issues.find((i) => i.code === "lv_voltage_mismatch")?.severity).toBe("error");
  });

  it("applies the growth factor to downstream loading", () => {
    const { objects, connections } = plant(1000, 400, 2);
    const graph = buildGraph(objects, connections);
    const base = checkTransformerLoading(graph)[0];
    const grown = checkTransformerLoading(graph, { growthFactor: 1.3 })[0];
    expect(base.values?.["Loading with growth"]).toBe("80.0 %");
    expect(grown.values?.["Loading with growth"]).toBe("104.0 %");
    expect(grown.severity).toBe("error");
  });
});

describe("checkBess", () => {
  it("warns when a battery container has no PCS", () => {
    const issues = checkBess([obj("b1", "battery_container", { energy_kwh: 2000, power_kw: 1000 })], []);
    expect(issues.find((i) => i.code === "bess_no_pcs")?.severity).toBe("warning");
  });

  it("flags implausible durations and accepts sane ones", () => {
    const short = checkBess([obj("b1", "bess_rack", { energy_kwh: 100, power_kw: 1000 })], []);
    expect(short.find((i) => i.code === "bess_duration_implausible")?.values?.Duration).toBe("0.10 h");

    const ok = checkBess([obj("b2", "bess_rack", { energy_kwh: 2000, power_kw: 1000 })], []);
    expect(ok.find((i) => i.code === "bess_duration_ok")?.severity).toBe("info");
  });

  it("warns when PCS power is below rack power", () => {
    const objects = [
      obj("b1", "battery_container", { energy_kwh: 4000, power_kw: 2000 }),
      obj("p1", "pcs", { rated_power_kw: 1000 }),
    ];
    const issues = checkBess(objects, [edge("c1", "b1", "p1")]);
    expect(issues.find((i) => i.code === "pcs_under_rack_power")?.severity).toBe("warning");
  });
});

describe("reference tables for P-144", () => {
  it("pairs protective devices with the equipment they protect", () => {
    const objects = [
      obj("cb1", "circuit_breaker", { rated_current_a: 630, breaking_ka: 25 }, "CB-01-01"),
      obj("t1", "transformer", { rated_kva: 2000, hv_kv: 33, lv_kv: 0.69 }, "TR-01-01"),
      obj("b1", "busbar", {}, "BUS-01-01"),
      obj("cb2", "circuit_breaker", { rated_current_a: 100 }, "CB-01-02"),
    ];
    const { rows, issues } = protectionReferences(objects, [
      edge("c1", "b1", "cb1"),
      edge("c2", "cb1", "t1"),
    ]);
    const paired = rows.find((r) => r.tag === "CB-01-01");
    expect(paired?.ratedCurrentA).toBe(630);
    expect(paired?.protectedTags.sort()).toEqual(["BUS-01-01", "TR-01-01"]);
    expect(issues.find((i) => i.objectIds[0] === "cb2")?.code).toBe("protection_device_unpaired");
  });

  it("derives cable reference rows and warns when the declared size is undersized", () => {
    const objects = [obj("i1", "inverter", {}, "INV-01-01"), obj("b1", "busbar", {}, "BUS-01-01")];
    const connections = [
      edge("c1", "i1", "b1", "cable", {
        current_a: 400,
        length_m: 120,
        voltage_v: 690,
        size_mm2: 95,
      }),
      edge("c2", "i1", "b1", "earth", { current_a: 400 }),
    ];
    const { rows, issues } = cableReferences(objects, connections);
    expect(rows).toHaveLength(1);
    expect(rows[0].standardMm2).toBeGreaterThan(95);
    expect(rows[0].verify).toBe(true);
    expect(issues[0].message).toContain("verify cable size — reference only".toLowerCase().slice(0, 5));
  });
});

describe("runCoordination", () => {
  it("aggregates counts, reference rows and the disclaimer", () => {
    const objects = [
      string("s1", 33),
      obj("i1", "inverter", { ...INV_1500, rated_power_kw: 100, ac_voltage_kv: 0.69 }),
    ];
    const result = runCoordination(objects, [edge("c1", "s1", "i1", "dc_string")]);
    expect(result.note).toBe(COORDINATION_DISCLAIMER);
    expect(result.issue_count).toBe(
      result.error_count + result.warning_count + result.info_count,
    );
    expect(result.issues.every((i) => i.note === COORDINATION_DISCLAIMER)).toBe(true);
  });

  it("is deterministic across input ordering", () => {
    const objects = [string("s1", 28), obj("i1", "inverter", { ...INV_1500, rated_power_kw: 100 })];
    const conns = [edge("c1", "s1", "i1", "dc_string")];
    expect(runCoordination(objects, conns)).toEqual(runCoordination([...objects].reverse(), conns));
  });
});

describe("coordination module purity", () => {
  it("does not reimplement sizing math and imports the P-055 calculators", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/sld/coordination.ts"), "utf8");
    expect(src).toContain('from "@/lib/calculators/solar-string"');
    expect(src).toContain('from "@/lib/calculators/transformer"');
    expect(src).toContain('from "@/lib/calculators/cable"');
    expect(src).not.toMatch(/from\s+['"]react['"]/);
    expect(src).not.toMatch(/@supabase\/supabase-js/);
    // No duplicated ampacity/standard-size tables.
    expect(src).not.toContain("IEC_60228_SIZES_MM2 =");
    expect(src).not.toContain("STANDARD_KVA =");
  });
});
