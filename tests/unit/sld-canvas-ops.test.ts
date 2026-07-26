// P-140 — Store-level tests: grouping, connectors, measurement, lock guards.
import { describe, expect, it } from "vitest";

import {
  connectionEndpoints,
  createCanvasStore,
  nearestPortHit,
  PASTE_OFFSET_MM,
} from "@/lib/sld/canvas-store";
import { defaultCanvasMeta, MEASURE_SYMBOL, type SldCanvasObject } from "@/lib/sld/canvas-types";
import { GROUP_KEY } from "@/lib/sld/geometry";

const object = (id: string, x: number, y: number, layer = "default"): SldCanvasObject => ({
  id,
  symbol_type: "inverter",
  tag: id.toUpperCase(),
  label: null,
  x,
  y,
  rotation: 0,
  mirrored: false,
  layer_id: layer,
  properties: {},
});

function store(objects: SldCanvasObject[]) {
  const s = createCanvasStore();
  s.getState().hydrate(objects, defaultCanvasMeta(), []);
  return s;
}

describe("grouping", () => {
  it("moves grouped objects together and ungroup restores independence", () => {
    const s = store([object("a", 10, 10), object("b", 30, 10)]);
    s.getState().select(["a", "b"]);
    s.getState().groupSelection();
    const gid = s.getState().objects[0].properties[GROUP_KEY];
    expect(gid).toBeTruthy();

    s.getState().select(["a"]);
    expect(s.getState().selection.sort()).toEqual(["a", "b"]);
    s.getState().moveSelection(5, 0);
    expect(s.getState().objects.map((o) => o.x)).toEqual([15, 35]);

    s.getState().ungroupSelection();
    s.getState().select(["a"]);
    expect(s.getState().selection).toEqual(["a"]);
    s.getState().moveSelection(5, 0);
    expect(s.getState().objects.map((o) => o.x)).toEqual([20, 35]);
  });
});

describe("paste offset", () => {
  it("offsets clones by 10 mm", () => {
    const s = store([object("a", 10, 10)]);
    s.getState().select(["a"]);
    s.getState().copySelection();
    s.getState().paste();
    const clone = s.getState().objects[1];
    expect(clone.x).toBe(10 + PASTE_OFFSET_MM);
    expect(clone.y).toBe(10 + PASTE_OFFSET_MM);
  });
});

describe("connectors", () => {
  it("creates a connection between ports and follows object moves", () => {
    const s = store([object("a", 0, 0), object("b", 40, 0)]);
    const hit = nearestPortHit(s.getState().objects, { x: 0, y: 0 }, 20);
    expect(hit?.objectId).toBe("a");

    s.getState().startConnection("a", "out", { x: 0, y: 8 });
    s.getState().finishConnection("b", "in");
    expect(s.getState().connections).toHaveLength(1);

    const before = connectionEndpoints(s.getState().connections[0], s.getState().objects)!;
    s.getState().select(["b"]);
    s.getState().moveSelection(0, 20);
    const after = connectionEndpoints(s.getState().connections[0], s.getState().objects)!;
    expect(after.to.y).toBe(before.to.y + 20);
  });

  it("undo removes the connection", () => {
    const s = store([object("a", 0, 0), object("b", 40, 0)]);
    s.getState().startConnection("a", "out", { x: 0, y: 8 });
    s.getState().finishConnection("b", "in");
    s.getState().undo();
    expect(s.getState().connections).toHaveLength(0);
  });
});

describe("measurement", () => {
  it("commits a dimension object carrying the mm value", () => {
    const s = store([]);
    s.getState().startMeasure({ x: 0, y: 0 });
    s.getState().updateMeasure({ x: 30, y: 40 });
    s.getState().commitMeasure();
    const dim = s.getState().objects[0];
    expect(dim.symbol_type).toBe(MEASURE_SYMBOL);
    expect(dim.properties.distance_mm).toBe(50);
  });
});

describe("locked layers", () => {
  it("rejects placement, moves and deletes on locked layers", () => {
    const s = store([object("a", 10, 10, "locked-layer")]);
    s.setState({
      layers: [
        ...s.getState().layers,
        { id: "locked-layer", name: "Locked", visible: true, locked: true },
      ],
    });
    s.getState().select(["a"]);
    expect(s.getState().selection).toEqual([]);
    s.setState({ selection: ["a"] });
    s.getState().moveSelection(10, 0);
    expect(s.getState().objects[0].x).toBe(10);
    s.getState().deleteSelection();
    expect(s.getState().objects).toHaveLength(1);
  });
});
