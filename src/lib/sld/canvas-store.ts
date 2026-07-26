// P-138 — Typed zustand store for the SLD CAD canvas: viewport, grid/snap,
// layers, selection, tool and a capped undo/redo command stack.
import { create } from "zustand";

import {
  BORDER_LAYER_ID,
  defaultCanvasMeta,
  type CanvasTool,
  type GridMm,
  type SldCanvasMeta,
  type SldCanvasObject,
  type SldLayer,
} from "./canvas-types";
import { portPosition, symbolDef } from "./symbols";

export const MAX_HISTORY = 100;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 16;

export type CommandLabel = "place" | "move" | "delete" | "property" | "layers" | "paste";

export type Snapshot = { objects: SldCanvasObject[]; layers: SldLayer[] };
export type Command = { label: CommandLabel; before: Snapshot; after: Snapshot };

export type Point = { x: number; y: number };

export type CanvasState = {
  zoom: number;
  pan: Point;
  gridMm: GridMm;
  snapEnabled: boolean;
  layers: SldLayer[];
  objects: SldCanvasObject[];
  selection: string[];
  tool: CanvasTool;
  placingType: string | null;
  clipboard: SldCanvasObject[];
  undoStack: Command[];
  redoStack: Command[];
  dirty: boolean;
  removedIds: string[];
  snapIndicator: Point | null;
};

export type CanvasActions = {
  hydrate: (objects: SldCanvasObject[], meta: SldCanvasMeta) => void;
  setZoom: (zoom: number) => void;
  zoomAt: (factor: number, cursor: Point) => void;
  setPan: (pan: Point) => void;
  panBy: (dx: number, dy: number) => void;
  fitToContent: (viewport: { width: number; height: number }, sheet: Point) => void;
  setGridMm: (mm: GridMm) => void;
  toggleSnap: () => void;
  setTool: (tool: CanvasTool) => void;
  setPlacingType: (type: string | null) => void;
  setSnapIndicator: (p: Point | null) => void;
  select: (ids: string[], additive?: boolean) => void;
  clearSelection: () => void;
  addLayer: (name: string) => void;
  renameLayer: (id: string, name: string) => void;
  toggleLayerVisible: (id: string) => void;
  toggleLayerLocked: (id: string) => void;
  placeObject: (obj: SldCanvasObject) => void;
  moveSelection: (dx: number, dy: number) => void;
  setObjectProps: (id: string, patch: Partial<SldCanvasObject>) => void;
  rotateSelection: () => void;
  mirrorSelection: () => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  copySelection: () => void;
  paste: () => void;
  undo: () => void;
  redo: () => void;
  markSaved: () => void;
};

export type CanvasStore = CanvasState & CanvasActions;

// --- pure helpers (exported for tests) -------------------------------------

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Zoom around a screen-space focal point so the cursor stays anchored. */
export function zoomAroundCursor(
  state: { zoom: number; pan: Point },
  factor: number,
  cursor: Point,
): { zoom: number; pan: Point } {
  const zoom = clampZoom(state.zoom * factor);
  const ratio = zoom / state.zoom;
  return {
    zoom,
    pan: {
      x: cursor.x - (cursor.x - state.pan.x) * ratio,
      y: cursor.y - (cursor.y - state.pan.y) * ratio,
    },
  };
}

export function snapValue(value: number, gridMm: number, enabled: boolean): number {
  if (!enabled || gridMm <= 0) return value;
  return Math.round(value / gridMm) * gridMm;
}

export function contentBounds(objects: SldCanvasObject[]) {
  if (objects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const o of objects) {
    const def = symbolDef(o.symbol_type);
    const half = Math.max(def.w, def.h) / 2;
    minX = Math.min(minX, o.x - half);
    minY = Math.min(minY, o.y - half);
    maxX = Math.max(maxX, o.x + half);
    maxY = Math.max(maxY, o.y + half);
  }
  return { minX, minY, maxX, maxY };
}

export function fitTransform(
  objects: SldCanvasObject[],
  viewport: { width: number; height: number },
  sheet: Point,
): { zoom: number; pan: Point } {
  const b = contentBounds(objects) ?? { minX: 0, minY: 0, maxX: sheet.x, maxY: sheet.y };
  const pad = 20;
  const w = Math.max(1, b.maxX - b.minX) + pad * 2;
  const h = Math.max(1, b.maxY - b.minY) + pad * 2;
  const zoom = clampZoom(Math.min(viewport.width / w, viewport.height / h));
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return {
    zoom,
    pan: { x: viewport.width / 2 - cx * zoom, y: viewport.height / 2 - cy * zoom },
  };
}

/** Nearest port anchor within `tolerance` mm of a point. */
export function nearestPort(
  objects: SldCanvasObject[],
  point: Point,
  tolerance: number,
): Point | null {
  let best: Point | null = null;
  let bestD = tolerance;
  for (const o of objects) {
    for (const port of symbolDef(o.symbol_type).ports) {
      const p = portPosition(o, port);
      const d = Math.hypot(p.x - point.x, p.y - point.y);
      if (d <= bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return best;
}

function snapshot(state: Pick<CanvasState, "objects" | "layers">): Snapshot {
  return {
    objects: state.objects.map((o) => ({ ...o, properties: { ...o.properties } })),
    layers: state.layers.map((l) => ({ ...l })),
  };
}

export function pushCommand(stack: Command[], cmd: Command): Command[] {
  const next = [...stack, cmd];
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tmp-${Math.random().toString(36).slice(2)}`;
}

export function isLayerLocked(layers: SldLayer[], layerId: string): boolean {
  const layer = layers.find((l) => l.id === layerId);
  return !layer || layer.locked || !layer.visible;
}

export function selectableObjects(state: Pick<CanvasState, "objects" | "layers">) {
  return state.objects.filter((o) => !isLayerLocked(state.layers, o.layer_id));
}

// --- store -----------------------------------------------------------------

const meta = defaultCanvasMeta();

export const initialCanvasState: CanvasState = {
  zoom: 1,
  pan: { x: 40, y: 40 },
  gridMm: meta.gridMm,
  snapEnabled: meta.snapEnabled,
  layers: meta.layers,
  objects: [],
  selection: [],
  tool: "select",
  placingType: null,
  clipboard: [],
  undoStack: [],
  redoStack: [],
  dirty: false,
  removedIds: [],
  snapIndicator: null,
};

export const createCanvasStore = () =>
  create<CanvasStore>((set, get) => {
    /** Apply a mutation and record it on the undo stack. */
    const commit = (label: CommandLabel, mutate: (s: CanvasStore) => Partial<CanvasState>) => {
      const state = get();
      const before = snapshot(state);
      const patch = mutate(state);
      const after = snapshot({
        objects: patch.objects ?? state.objects,
        layers: patch.layers ?? state.layers,
      });
      set({
        ...patch,
        undoStack: pushCommand(state.undoStack, { label, before, after }),
        redoStack: [],
        dirty: true,
      });
    };

    return {
      ...initialCanvasState,

      hydrate: (objects, m) =>
        set({
          objects,
          layers: m.layers,
          gridMm: m.gridMm,
          snapEnabled: m.snapEnabled,
          selection: [],
          undoStack: [],
          redoStack: [],
          removedIds: [],
          dirty: false,
        }),

      setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
      zoomAt: (factor, cursor) => set(zoomAroundCursor(get(), factor, cursor)),
      setPan: (pan) => set({ pan }),
      panBy: (dx, dy) => set({ pan: { x: get().pan.x + dx, y: get().pan.y + dy } }),
      fitToContent: (viewport, sheet) => set(fitTransform(get().objects, viewport, sheet)),

      setGridMm: (gridMm) => set({ gridMm, dirty: true }),
      toggleSnap: () => set({ snapEnabled: !get().snapEnabled, dirty: true }),
      setTool: (tool) => set({ tool, placingType: tool === "place" ? get().placingType : null }),
      setPlacingType: (placingType) =>
        set({ placingType, tool: placingType ? "place" : "select" }),
      setSnapIndicator: (snapIndicator) => set({ snapIndicator }),

      select: (ids, additive) => {
        const { layers, objects } = get();
        const allowed = ids.filter((id) => {
          const o = objects.find((x) => x.id === id);
          return o ? !isLayerLocked(layers, o.layer_id) : false;
        });
        set({ selection: additive ? Array.from(new Set([...get().selection, ...allowed])) : allowed });
      },
      clearSelection: () => set({ selection: [] }),

      addLayer: (name) =>
        commit("layers", (s) => ({
          layers: [...s.layers, { id: newId(), name, visible: true, locked: false }],
        })),
      renameLayer: (id, name) =>
        commit("layers", (s) => ({
          layers: s.layers.map((l) => (l.id === id && !l.system ? { ...l, name } : l)),
        })),
      toggleLayerVisible: (id) =>
        commit("layers", (s) => ({
          layers: s.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
        })),
      toggleLayerLocked: (id) =>
        commit("layers", (s) => ({
          layers: s.layers.map((l) =>
            l.id === id && !l.system ? { ...l, locked: !l.locked } : l,
          ),
        })),

      placeObject: (obj) => {
        if (isLayerLocked(get().layers, obj.layer_id)) return;
        commit("place", (s) => ({ objects: [...s.objects, obj], selection: [obj.id] }));
      },

      moveSelection: (dx, dy) =>
        commit("move", (s) => ({
          objects: s.objects.map((o) =>
            s.selection.includes(o.id) && !isLayerLocked(s.layers, o.layer_id)
              ? { ...o, x: o.x + dx, y: o.y + dy }
              : o,
          ),
        })),

      setObjectProps: (id, patch) =>
        commit("property", (s) => ({
          objects: s.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)),
        })),

      rotateSelection: () =>
        commit("property", (s) => ({
          objects: s.objects.map((o) =>
            s.selection.includes(o.id) && !isLayerLocked(s.layers, o.layer_id)
              ? { ...o, rotation: (((o.rotation + 90) % 360) as 0 | 90 | 180 | 270) }
              : o,
          ),
        })),

      mirrorSelection: () =>
        commit("property", (s) => ({
          objects: s.objects.map((o) =>
            s.selection.includes(o.id) && !isLayerLocked(s.layers, o.layer_id)
              ? { ...o, mirrored: !o.mirrored }
              : o,
          ),
        })),

      deleteSelection: () => {
        const state = get();
        const removable = state.objects.filter(
          (o) => state.selection.includes(o.id) && !isLayerLocked(state.layers, o.layer_id),
        );
        if (removable.length === 0) return;
        const ids = removable.map((o) => o.id);
        commit("delete", (s) => ({
          objects: s.objects.filter((o) => !ids.includes(o.id)),
          selection: [],
        }));
        set({
          removedIds: Array.from(
            new Set([...state.removedIds, ...ids.filter((id) => !id.startsWith("tmp-"))]),
          ),
        });
      },

      copySelection: () => {
        const s = get();
        set({ clipboard: s.objects.filter((o) => s.selection.includes(o.id)).map((o) => ({ ...o })) });
      },

      paste: () => {
        const s = get();
        if (s.clipboard.length === 0) return;
        const clones = s.clipboard.map((o) => ({
          ...o,
          id: newId(),
          tag: null,
          x: o.x + s.gridMm * 2,
          y: o.y + s.gridMm * 2,
        }));
        commit("paste", (st) => ({
          objects: [...st.objects, ...clones],
          selection: clones.map((c) => c.id),
        }));
      },

      duplicateSelection: () => {
        const s = get();
        const clones = s.objects
          .filter((o) => s.selection.includes(o.id) && !isLayerLocked(s.layers, o.layer_id))
          .map((o) => ({ ...o, id: newId(), tag: null, x: o.x + s.gridMm * 2, y: o.y + s.gridMm * 2 }));
        if (clones.length === 0) return;
        commit("paste", (st) => ({
          objects: [...st.objects, ...clones],
          selection: clones.map((c) => c.id),
        }));
      },

      undo: () => {
        const s = get();
        const cmd = s.undoStack[s.undoStack.length - 1];
        if (!cmd) return;
        set({
          objects: cmd.before.objects.map((o) => ({ ...o })),
          layers: cmd.before.layers.map((l) => ({ ...l })),
          undoStack: s.undoStack.slice(0, -1),
          redoStack: pushCommand(s.redoStack, cmd),
          selection: [],
          dirty: true,
        });
      },

      redo: () => {
        const s = get();
        const cmd = s.redoStack[s.redoStack.length - 1];
        if (!cmd) return;
        set({
          objects: cmd.after.objects.map((o) => ({ ...o })),
          layers: cmd.after.layers.map((l) => ({ ...l })),
          redoStack: s.redoStack.slice(0, -1),
          undoStack: pushCommand(s.undoStack, cmd),
          selection: [],
          dirty: true,
        });
      },

      markSaved: () => set({ dirty: false, removedIds: [] }),
    };
  });

export const useCanvasStore = createCanvasStore();
