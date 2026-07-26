// P-147 — SVG / JSON round-trip / DXF / CSV exporter tests.
import { describe, expect, it } from "vitest";

import {
  fromJson,
  isValidDxf,
  MAX_IMPORT_OBJECTS,
  SldImportError,
  toCsv,
  toDxf,
  toJson,
  toSvg,
  type ExportGraph,
  type ExportSheet,
  type ExportSymbol,
} from "@/lib/sld/exporters";

const symbols: ExportSymbol[] = [
  {
    type_key: "inverter",
    display_name: "Inverter",
    svg_body: '<rect x="0" y="0" width="40" height="40" /><line x1="0" y1="0" x2="40" y2="40" />',
    ports: [
      { key: "in", x: 0, y: 20 },
      { key: "out", x: 40, y: 20 },
    ],
  },
  {
    type_key: "transformer",
    display_name: "Transformer",
    svg_body: '<circle cx="20" cy="20" r="14" /><foreignObject width="10" height="10" />',
    ports: [
      { key: "hv", x: 20, y: 0 },
      { key: "lv", x: 20, y: 40 },
    ],
  },
];

const graph: ExportGraph = {
  objects: [
    {
      id: "o1",
      symbol_type: "inverter",
      tag: "INV-001",
      label: "Inverter 1",
      x: 100,
      y: 120,
      rotation: 0,
      mirrored: false,
      layer_id: "default",
      properties: { rating_kw: 3300 },
    },
    {
      id: "o2",
      symbol_type: "transformer",
      tag: "TRF-001",
      label: null,
      x: 300,
      y: 120,
      rotation: 90,
      mirrored: false,
      layer_id: "default",
      properties: {},
    },
  ],
  connections: [
    {
      id: "c1",
      from_object_id: "o1",
      from_port: "out",
      to_object_id: "o2",
      to_port: "hv",
      connection_type: "ac_mv",
      cable_number: "CBL-001",
      properties: {},
    },
  ],
};

const sheet: ExportSheet = {
  size: "A1",
  titleBlock: {
    drawing_number: "SLD-001",
    title: "Main single line diagram",
    revision_code: "A",
    status: "draft",
    sheet_size: "A1",
    project_name: "East Amman",
    drawn_by: "GridMind",
  } as any,
  legend: [{ symbol_type: "inverter", display_name: "Inverter", count: 1 } as any],
  layers: [{ id: "default", name: "Default" }],
};

describe("toSvg", () => {
  const svg = toSvg(graph, symbols, sheet);

  it("emits a standalone document with border, title block and legend", () => {
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("</svg>");
    expect(svg).toContain("viewBox");
    expect(svg).toContain("SLD-001");
    expect(svg).toContain("Main single line diagram");
    expect(svg).toContain("Legend");
  });

  it("renders every object tag and cable number", () => {
    expect(svg).toContain("INV-001");
    expect(svg).toContain("TRF-001");
    expect(svg).toContain("CBL-001");
  });

  it("skips unsupported primitives instead of crashing", () => {
    expect(svg).not.toContain("foreignObject");
    expect(svg).toContain("circle");
  });
});

describe("json round trip", () => {
  it("reproduces the graph exactly", () => {
    const doc = toJson(graph);
    const back = fromJson(JSON.parse(JSON.stringify(doc)));
    expect(back).toEqual(toJson(graph) && fromJson(doc));
    expect(JSON.stringify(toJson(back))).toEqual(JSON.stringify(doc));
  });

  it("accepts a raw JSON string", () => {
    expect(fromJson(JSON.stringify(toJson(graph))).objects).toHaveLength(2);
  });

  it("rejects a future version", () => {
    const doc = { ...toJson(graph), version: 2 };
    expect(() => fromJson(doc)).toThrow(SldImportError);
  });

  it("rejects an oversized document", () => {
    const big = {
      ...toJson(graph),
      objects: Array.from({ length: MAX_IMPORT_OBJECTS + 1 }, (_, i) => ({
        ...toJson(graph).objects[0],
        id: `o${i}`,
      })),
    };
    expect(() => fromJson(big)).toThrow(SldImportError);
  });

  it("rejects a foreign document shape", () => {
    expect(() => fromJson({ hello: "world" })).toThrow(SldImportError);
  });
});

describe("toDxf", () => {
  const { dxf } = toDxf(graph, symbols, sheet);

  it("produces a structurally valid R12 file", () => {
    expect(dxf.startsWith("0\nSECTION")).toBe(true);
    expect(dxf.trimEnd().endsWith("EOF")).toBe(true);
    expect(isValidDxf(dxf)).toBe(true);
  });

  it("contains HEADER, TABLES, BLOCKS and ENTITIES sections", () => {
    for (const section of ["HEADER", "TABLES", "BLOCKS", "ENTITIES"]) {
      expect(dxf).toContain(section);
    }
  });

  it("writes INSERT for symbols, POLYLINE for connections and TEXT for tags", () => {
    expect(dxf).toContain("INSERT");
    expect(dxf).toContain("POLYLINE");
    expect(dxf).toContain("TEXT");
    expect(dxf).toContain("INV-001");
  });

  it("rejects nothing but reports warnings for unknown symbols", () => {
    const { warnings } = toDxf(
      { ...graph, objects: [{ ...graph.objects[0], symbol_type: "mystery" }] },
      symbols,
      sheet,
    );
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe("toCsv", () => {
  it("quotes separators and escapes quotes", () => {
    const csv = toCsv([{ tag: 'INV,"1"', kw: 3300 }]);
    expect(csv.split("\n")[0]).toBe("tag,kw");
    expect(csv).toContain('"INV,""1"""');
  });

  it("returns an empty string with no rows", () => {
    expect(toCsv([])).toBe("");
  });
});
