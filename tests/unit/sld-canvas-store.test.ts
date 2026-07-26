// P-138 — Canvas store: zoom focal point, snapping, undo/redo, layer locking.
import { describe, expect, it } from "vitest";

import {
  clampZoom,
  createCanvasStore,
  fitTransform,
  isLayerLocked,
  MAX_HISTORY,
  nearestPort,
  pushCommand,
  snapValue,
  zoomAroundCursor,
} from "@/lib/sld/canvas-store";
import { defaultCanvasMeta, type SldCanvasObject } from "@/lib/sld/canvas-types";

const obj = (over: Partial<SldCanvasObject> = {}): SldCanvasObject => ({
  id: "o1",
  symbol_type: "inverter",
  tag: null,
  label: null,
  x: 100,
  y: 100,
  rotation: 0,
  mirrored: false,
  layer_id: "default",
  properties: {},
  ...over,
});

describe("zoom", () => {
  it("clamps to 0.1x–16x", () => {
    expect(clampZoom(0.001)).toBe(0.1);
    expect(clampZoom(1000)).toBe(16);
  });

  it("keeps the cursor as focal point", () => {
    const state = { zoom: 1, pan: { x: 0, y: 0 } };
    const cursor = { x: 300, y: 200 };
    const before = { x: (cursor.x - state.pan.x) / state.zoom, y: (cursor.y - state.pan.y) / state.zoom };
    const next = zoomAroundCursor(state, 2, cursor);
    const after = { x: (cursor.x - next.pan.x) / next.zoom, y: (cursor.y - next.pan.y) / next.zoom };
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});

describe("snapping", () => {
  it("snaps to the grid when enabled only", () => {
    expect(snapValue(12.4, 5, true)).toBe(10);
    expect(snapValue(12.4, 5, false)).toBe(12.4);
  });

  it("finds the nearest object port", () => {
    const port = nearestPort([obj()], { x: 100, y: 108 }, 5);
    expect(port).toEqual({ x: 100, y: 109 });
    expect(nearestPort([obj()], { x: 0, y: 0 }, 5)).toBeNull();
  });
});

describe("fit to content", () => {
  it("frames all objects inside the viewport", () => {
    const objects = [obj({ id: "a", x: 0, y: 0 }), obj({ id: "b", x: 400, y: 300 })];
    const { zoom, pan } = fitTransform(objects, { width: 800, height: 600 }, { x: 841, y: 594 });
    for (const o of objects) {
      const sx = o.x * zoom + pan.x;
      const sy = o.y * zoom + pan.y;
      expect(sx).toBeGreaterThanOrEqual(0);
      expect(sx).toBeLessThanOrEqual(800);
      expect(sy).toBeGreaterThanOrEqual(0);
      expect(sy).toBeLessThanOrEqual(600);
    }
  });
});

describe("history", () => {
  it("caps the command stack at 100 entries", () => {
    let stack: any[] = [];
    for (let i = 0; i < 130; i += 1) {
      stack = pushCommand(stack as any, { label: "move", before: {} as any, after: {} as any });
    }
    expect(stack.length).toBe(MAX_HISTORY);
  });

  it("undo then redo restores identical positions", () => {
    const store = createCanvasStore();
    store.getState().hydrate([obj()], defaultCanvasMeta());
    store.getState().select(["o1"]);
    store.getState().moveSelection(25, -10);
    const moved = store.getState().objects[0];
    expect([moved.x, moved.y]).toEqual([125, 90]);

    store.getState().undo();
    expect([store.getState().objects[0].x, store.getState().objects[0].y]).toEqual([100, 100]);

    store.getState().redo();
    expect([store.getState().objects[0].x, store.getState().objects[0].y]).toEqual([125, 90]);
  });
});

describe("layer locking", () => {
  it("blocks selection and movement on locked layers", () => {
    const store = createCanvasStore();
    const meta = defaultCanvasMeta();
    meta.layers = meta.layers.map((l) => (l.id === "default" ? { ...l, locked: true } : l));
    store.getState().hydrate([obj()], meta);

    expect(isLayerLocked(meta.layers, "default")).toBe(true);
    store.getState().select(["o1"]);
    expect(store.getState().selection).toEqual([]);

    store.getState().moveSelection(10, 10);
    expect(store.getState().objects[0].x).toBe(100);
  });
});
