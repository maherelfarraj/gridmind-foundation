// P-139 — symbol registry helpers.
import { describe, expect, it } from "vitest";

import {
  filterSymbols,
  footprintFor,
  groupByCategory,
  initialProperties,
  mergeSymbolTypes,
  missingRequiredProperties,
  nextTag,
  parseSymbolRecord,
  sanitizeSvgBody,
  viewBoxToMm,
  type SymbolTypeRecord,
} from "@/lib/sld/symbol-registry";

const rec = (over: Partial<SymbolTypeRecord> = {}): SymbolTypeRecord => ({
  id: over.id ?? "id-1",
  company_id: null,
  type_key: "inverter",
  display_name: "Inverter",
  category: "conversion",
  svg_body: '<rect x="8" y="8" width="24" height="24" />',
  ports: [
    { key: "dc", x: 20, y: 0 },
    { key: "ac", x: 20, y: 40 },
  ],
  property_schema: [
    { key: "rating_kw", label: "Rating", type: "number", unit: "kW", required: true },
  ],
  default_properties: { rating_kw: 100 },
  tag_prefix: "INV",
  sort_order: 10,
  ...over,
});

describe("sanitizeSvgBody", () => {
  it("strips scripts, event handlers and external references", () => {
    const dirty =
      '<rect onclick="alert(1)" x="1"/><script>alert(2)</script><a href="http://x">t</a>';
    const clean = sanitizeSvgBody(dirty);
    expect(clean).not.toContain("script");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("http://x");
    expect(clean).toContain("<rect");
  });
});

describe("mergeSymbolTypes", () => {
  it("lets a company override shadow the global symbol of the same key", () => {
    const merged = mergeSymbolTypes([
      rec(),
      rec({ id: "id-2", company_id: "co", display_name: "GSI Inverter" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].display_name).toBe("GSI Inverter");
  });

  it("sorts by sort_order then name", () => {
    const merged = mergeSymbolTypes([
      rec({ id: "b", type_key: "busbar", display_name: "Busbar", sort_order: 40 }),
      rec(),
    ]);
    expect(merged.map((m) => m.type_key)).toEqual(["inverter", "busbar"]);
  });
});

describe("parseSymbolRecord", () => {
  it("converts viewBox ports to millimetre offsets from the centre", () => {
    const parsed = parseSymbolRecord(rec());
    expect(parsed.w).toBe(16);
    expect(parsed.ports).toEqual([
      { id: "dc", x: 0, y: -8 },
      { id: "ac", x: 0, y: 8 },
    ]);
  });

  it("uses wide footprints for bus and cable symbols", () => {
    expect(footprintFor("busbar")).toEqual({ w: 32, h: 8 });
    expect(viewBoxToMm(20, 16)).toBe(0);
  });
});

describe("palette filtering and grouping", () => {
  it("matches name, key, tag prefix and category", () => {
    const list = [rec(), rec({ id: "2", type_key: "busbar", display_name: "Busbar", category: "cable_bus", tag_prefix: "BB" })];
    expect(filterSymbols(list, "inv").map((r) => r.type_key)).toEqual(["inverter"]);
    expect(filterSymbols(list, "BB").map((r) => r.type_key)).toEqual(["busbar"]);
    expect(filterSymbols(list, "").length).toBe(2);
  });

  it("groups in canonical category order", () => {
    const groups = groupByCategory([
      rec({ id: "2", type_key: "busbar", category: "cable_bus" }),
      rec(),
    ]);
    expect(groups.map((g) => g.category)).toEqual(["conversion", "cable_bus"]);
  });
});

describe("placement helpers", () => {
  it("issues the next free tag for a prefix", () => {
    expect(nextTag("INV", ["INV-001", "INV-003", null, "TX-009"])).toBe("INV-004");
    expect(nextTag("INV", [])).toBe("INV-001");
  });

  it("seeds default properties and reports missing required fields", () => {
    expect(initialProperties(rec())).toEqual({ rating_kw: 100 });
    expect(missingRequiredProperties(rec(), {})).toEqual(["Rating"]);
    expect(missingRequiredProperties(rec(), { rating_kw: 250 })).toEqual([]);
  });
});
