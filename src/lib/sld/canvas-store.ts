// P-138/P-140 — Typed zustand store for the SLD CAD canvas: viewport, grid/snap,
// layers, selection, connectors, measurement, and a capped undo/redo stack.
import { create } from "zustand";

import {
  defaultCanvasMeta,
  MEASURE_LAYER_ID,
  MEASURE_SYMBOL,
  type CanvasTool,
  type ConnectionType,
  type GridMm,
  type SldCanvasMeta,
  type SldCanvasObject,
  type SldConnection,
  type SldLayer,
  type SldMarkup,
} from "./canvas-types";
import {
  alignGeometry,
  boundsOf,
  distributeGeometry,
  expandSelectionToGroups,
  GROUP_KEY,
  groupIdOf,
  marqueeHits,
  measure as measureGeometry,
  mirrorSelectionGeometry,
  rectFromPoints,
  rotateSelectionGeometry,
  type AlignMode,
  type DistributeAxis,
  type Measurement,
  type Rect,
} from "./geometry";
import { portPosition, symbolDef } from "./symbols";
import type { TagArea } from "./tagging";

export const MAX_HISTORY = 100;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 16;
/** Paste/duplicate offset in mm (P-140). */
export const PASTE_OFFSET_MM = 10;

export type CommandLabel =
  | "place"
  | "move"
  | "delete"
  | "property"
  | "layers"
  | "paste"
  | "connect"
  | "group"
  | "align"
  | "measure";

export type Snapshot = {
  objects: SldCanvasObject[];
  layers: SldLayer[];
  connections: SldConnection[];
};
export type Command = { label: CommandLabel; before: Snapshot; after: Snapshot };

export type Point = { x: number; y: number };

export type PendingConnection = {
  objectId: string;
  port: string;
  from: Point;
  to: Point;
  targetObjectId?: string;
  targetPort?: string;
};

export type CanvasState = {
  zoom: number;
  pan: Point;
  gridMm: GridMm;
  snapEnabled: boolean;
  layers: SldLayer[];
  areas: TagArea[];
  markups: SldMarkup[];
  objects: SldCanvasObject[];
  connections: SldConnection[];
  selection: string[];
  tool: CanvasTool;
  placingType: string | null;
  connectionType: ConnectionType;
  pendingConnection: PendingConnection | null;
  measurement: Measurement | null;
  measureStart: Point | null;
  marquee: Rect | null;
  cursorMm: Point | null;
  clipboard: SldCanvasObject[];
  undoStack: Command[];
  redoStack: Command[];
  dirty: boolean;
  removedIds: string[];
  removedConnectionIds: string[];
  snapIndicator: Point | null;
};

export type CanvasActions = {
  hydrate: (objects: SldCanvasObject[], meta: SldCanvasMeta, connections?: SldConnection[]) => void;
  setZoom: (zoom: number) => void;
  zoomAt: (factor: number, cursor: Point) => void;
  setPan: (pan: Point) => void;
  panBy: (dx: number, dy: number) => void;
  fitToContent: (viewport: { width: number; height: number }, sheet: Point) => void;
  setGridMm: (mm: GridMm) => void;
  toggleSnap: () => void;
  setTool: (tool: CanvasTool) => void;
  setPlacingType: (type: string | null) => void;
  setConnectionType: (type: ConnectionType) => void;
  setSnapIndicator: (p: Point | null) => void;
  setCursorMm: (p: Point | null) => void;
  setMarquee: (rect: Rect | null) => void;
  commitMarquee: (rect: Rect, additive?: boolean) => void;
  select: (ids: string[], additive?: boolean) => void;
  clearSelection: () => void;
  addLayer: (name: string) => void;
  renameLayer: (id: string, name: string) => void;
  toggleLayerVisible: (id: string) => void;
  toggleLayerLocked: (id: string) => void;
  placeObject: (obj: SldCanvasObject) => void;
  moveSelection: (dx: number, dy: number) => void;
  setObjectProps: (id: string, patch: Partial<SldCanvasObject>) => void;
  /** P-141 — applies a tagging plan locally (undoable) before the next save. */
  applyTagPlan: (
    tags: Array<{ id: string; tag: string }>,
    cables?: Array<{ id: string; cable_number: string }>,
  ) => void;
  rotateSelection: () => void;
  mirrorSelection: () => void;
  alignSelection: (mode: AlignMode) => void;
  distributeSelection: (axis: DistributeAxis) => void;
  groupSelection: () => void;
  ungroupSelection: () => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  copySelection: () => void;
  paste: () => void;
  startConnection: (objectId: string, port: string, from: Point) => void;
  updateConnection: (to: Point, target?: { objectId: string; port: string }) => void;
  cancelConnection: () => void;
  finishConnection: (objectId: string, port: string) => void;
  removeConnection: (id: string) => void;
  startMeasure: (p: Point) => void;
  updateMeasure: (p: Point, axisLock?: boolean) => void;
  commitMeasure: (layerId?: string) => void;
  cancelMeasure: () => void;
  undo: () => void;
  redo: () => void;
  markSaved: () => void;
  /** P-145 — markup layer (clouds, notes, arrows). */
  addMarkup: (markup: SldMarkup) => void;
  updateMarkup: (id: string, patch: Partial<SldMarkup>) => void;
  removeMarkup: (id: string) => void;
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

const footprint = (o: { symbol_type?: string }) => {
  const def = symbolDef((o as SldCanvasObject).symbol_type ?? "");
  return { w: def.w, h: def.h };
};

export function contentBounds(objects: SldCanvasObject[]) {
  const b = boundsOf(objects as any, footprint as any);
  return b;
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

export type PortHit = { objectId: string; port: string; point: Point; distance: number };

/** Nearest port anchor within `tolerance` mm of a point, with its owner. */
export function nearestPortHit(
  objects: SldCanvasObject[],
  point: Point,
  tolerance: number,
): PortHit | null {
  let best: PortHit | null = null;
  for (const o of objects) {
    for (const port of symbolDef(o.symbol_type).ports) {
      const p = portPosition(o, port);
      const d = Math.hypot(p.x - point.x, p.y - point.y);
      if (d <= tolerance && (!best || d < best.distance)) {
        best = { objectId: o.id, port: port.id, point: p, distance: d };
      }
    }
  }
  return best;
}

export function nearestPort(
  objects: SldCanvasObject[],
  point: Point,
  tolerance: number,
): Point | null {
  return nearestPortHit(objects, point, tolerance)?.point ?? null;
}

/** Resolve a connection endpoint to sheet coordinates (follows object moves). */
export function connectionEndpoints(
  connection: SldConnection,
  objects: SldCanvasObject[],
): { from: Point; to: Point } | null {
  const from = objects.find((o) => o.id === connection.from_object_id);
  const to = objects.find((o) => o.id === connection.to_object_id);
  if (!from || !to) return null;
  const anchor = (obj: SldCanvasObject, portId: string): Point => {
    const def = symbolDef(obj.symbol_type);
    const port = def.ports.find((p) => p.id === portId);
    // Busbars behave as multi-port nodes: fall back to the object centre.
    return port ? portPosition(obj, port) : { x: obj.x, y: obj.y };
  };
  return { from: anchor(from, connection.from_port), to: anchor(to, connection.to_port) };
}

function snapshot(state: Pick<CanvasState, "objects" | "layers" | "connections">): Snapshot {
  return {
    objects: state.objects.map((o) => ({ ...o, properties: { ...o.properties } })),
    layers: state.layers.map((l) => ({ ...l })),
    connections: state.connections.map((c) => ({ ...c })),
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

function tempId() {
  return `tmp-${Math.random().toString(36).slice(2)}`;
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
  areas: meta.areas,
  markups: [],
  objects: [],
  connections: [],
  selection: [],
  tool: "select",
  placingType: null,
  connectionType: "cable",
  pendingConnection: null,
  measurement: null,
  measureStart: null,
  marquee: null,
  cursorMm: null,
  clipboard: [],
  undoStack: [],
  redoStack: [],
  dirty: false,
  removedIds: [],
  removedConnectionIds: [],
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
        connections: patch.connections ?? state.connections,
      });
      set({
        ...patch,
        undoStack: pushCommand(state.undoStack, { label, before, after }),
        redoStack: [],
        dirty: true,
      });
    };

    /** Selected + unlocked objects, expanded across groups. */
    const activeSelection = (s: CanvasState) => {
      const ids = expandSelectionToGroups(s.selection, s.objects);
      return s.objects.filter((o) => ids.includes(o.id) && !isLayerLocked(s.layers, o.layer_id));
    };

    const applyPositions = (
      s: CanvasState,
      patches: Array<{ id: string; x?: number; y?: number; rotation?: any; mirrored?: boolean }>,
    ) => {
      const map = new Map(patches.map((p) => [p.id, p]));
      return s.objects.map((o) => (map.has(o.id) ? { ...o, ...map.get(o.id)! } : o));
    };

    return {
      ...initialCanvasState,

      hydrate: (objects, m, connections = []) =>
        set({
          objects,
          connections,
          layers: m.layers,
          areas: m.areas ?? [],
          markups: m.markups ?? [],
          gridMm: m.gridMm,
          snapEnabled: m.snapEnabled,
          selection: [],
          undoStack: [],
          redoStack: [],
          removedIds: [],
          removedConnectionIds: [],
          pendingConnection: null,
          measurement: null,
          measureStart: null,
          marquee: null,
          dirty: false,
        }),

      setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
      zoomAt: (factor, cursor) => set(zoomAroundCursor(get(), factor, cursor)),
      setPan: (pan) => set({ pan }),
      panBy: (dx, dy) => set({ pan: { x: get().pan.x + dx, y: get().pan.y + dy } }),
      fitToContent: (viewport, sheet) => set(fitTransform(get().objects, viewport, sheet)),

      setGridMm: (gridMm) => set({ gridMm, dirty: true }),
      toggleSnap: () => set({ snapEnabled: !get().snapEnabled, dirty: true }),
      setTool: (tool) =>
        set({
          tool,
          placingType: tool === "place" ? get().placingType : null,
          pendingConnection: null,
          measureStart: null,
        }),
      setPlacingType: (placingType) => set({ placingType, tool: placingType ? "place" : "select" }),
      setConnectionType: (connectionType) => set({ connectionType }),
      setSnapIndicator: (snapIndicator) => set({ snapIndicator }),
      setCursorMm: (cursorMm) => set({ cursorMm }),
      setMarquee: (marquee) => set({ marquee }),

      commitMarquee: (rect, additive) => {
        const s = get();
        const hits = marqueeHits(selectableObjects(s) as any, rect, footprint as any);
        get().select(hits, additive);
        set({ marquee: null });
      },

      select: (ids, additive) => {
        const { layers, objects } = get();
        const expanded = expandSelectionToGroups(ids, objects);
        const allowed = expanded.filter((id) => {
          const o = objects.find((x) => x.id === id);
          return o ? !isLayerLocked(layers, o.layer_id) : false;
        });
        set({
          selection: additive ? Array.from(new Set([...get().selection, ...allowed])) : allowed,
        });
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
          layers: s.layers.map((l) => (l.id === id && !l.system ? { ...l, locked: !l.locked } : l)),
        })),

      placeObject: (obj) => {
        if (isLayerLocked(get().layers, obj.layer_id)) return;
        commit("place", (s) => ({ objects: [...s.objects, obj], selection: [obj.id] }));
      },

      moveSelection: (dx, dy) => {
        const ids = activeSelection(get()).map((o) => o.id);
        if (ids.length === 0) return;
        commit("move", (s) => ({
          objects: s.objects.map((o) =>
            ids.includes(o.id) ? { ...o, x: o.x + dx, y: o.y + dy } : o,
          ),
        }));
      },

      setObjectProps: (id, patch) =>
        commit("property", (s) => ({
          objects: s.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)),
        })),

      applyTagPlan: (tags, cables = []) => {
        if (tags.length === 0 && cables.length === 0) return;
        const tagMap = new Map(tags.map((t) => [t.id, t.tag]));
        const cableMap = new Map(cables.map((c) => [c.id, c.cable_number]));
        commit("property", (s) => ({
          objects: s.objects.map((o) => (tagMap.has(o.id) ? { ...o, tag: tagMap.get(o.id)! } : o)),
          connections: s.connections.map((c) =>
            cableMap.has(c.id) ? { ...c, cable_number: cableMap.get(c.id)! } : c,
          ),
        }));
      },

      rotateSelection: () => {
        const s0 = get();
        const sel = activeSelection(s0);
        if (sel.length === 0) return;
        const patches = rotateSelectionGeometry(sel as any, 90, footprint as any);
        commit("property", (s) => ({ objects: applyPositions(s, patches) }));
      },

      mirrorSelection: () => {
        const sel = activeSelection(get());
        if (sel.length === 0) return;
        const patches = mirrorSelectionGeometry(sel as any, footprint as any);
        commit("property", (s) => ({ objects: applyPositions(s, patches) }));
      },

      alignSelection: (mode) => {
        const sel = activeSelection(get());
        if (sel.length < 2) return;
        const patches = alignGeometry(sel as any, mode, footprint as any);
        commit("align", (s) => ({ objects: applyPositions(s, patches) }));
      },

      distributeSelection: (axis) => {
        const sel = activeSelection(get());
        if (sel.length < 3) return;
        const patches = distributeGeometry(sel as any, axis);
        commit("align", (s) => ({ objects: applyPositions(s, patches) }));
      },

      groupSelection: () => {
        const sel = activeSelection(get());
        if (sel.length < 2) return;
        const groupId = newId();
        const ids = sel.map((o) => o.id);
        commit("group", (s) => ({
          objects: s.objects.map((o) =>
            ids.includes(o.id)
              ? { ...o, properties: { ...o.properties, [GROUP_KEY]: groupId } }
              : o,
          ),
          selection: ids,
        }));
      },

      ungroupSelection: () => {
        const sel = activeSelection(get());
        const ids = sel.filter((o) => groupIdOf(o.properties)).map((o) => o.id);
        if (ids.length === 0) return;
        commit("group", (s) => ({
          objects: s.objects.map((o) => {
            if (!ids.includes(o.id)) return o;
            const props = { ...o.properties };
            delete props[GROUP_KEY];
            return { ...o, properties: props };
          }),
        }));
      },

      deleteSelection: () => {
        const state = get();
        const removable = activeSelection(state);
        if (removable.length === 0) return;
        const ids = removable.map((o) => o.id);
        const droppedConnections = state.connections.filter(
          (c) => ids.includes(c.from_object_id) || ids.includes(c.to_object_id),
        );
        commit("delete", (s) => ({
          objects: s.objects.filter((o) => !ids.includes(o.id)),
          connections: s.connections.filter(
            (c) => !ids.includes(c.from_object_id) && !ids.includes(c.to_object_id),
          ),
          selection: [],
        }));
        set({
          removedIds: Array.from(
            new Set([...state.removedIds, ...ids.filter((id) => !id.startsWith("tmp-"))]),
          ),
          removedConnectionIds: Array.from(
            new Set([
              ...state.removedConnectionIds,
              ...droppedConnections.map((c) => c.id).filter((id) => !id.startsWith("tmp-")),
            ]),
          ),
        });
      },

      copySelection: () => {
        const s = get();
        const ids = expandSelectionToGroups(s.selection, s.objects);
        set({ clipboard: s.objects.filter((o) => ids.includes(o.id)).map((o) => ({ ...o })) });
      },

      paste: () => {
        const s = get();
        if (s.clipboard.length === 0) return;
        const clones = s.clipboard.map((o) => ({
          ...o,
          id: tempId(),
          tag: null,
          x: o.x + PASTE_OFFSET_MM,
          y: o.y + PASTE_OFFSET_MM,
        }));
        commit("paste", (st) => ({
          objects: [...st.objects, ...clones],
          selection: clones.map((c) => c.id),
        }));
      },

      duplicateSelection: () => {
        const s = get();
        const clones = activeSelection(s).map((o) => ({
          ...o,
          id: tempId(),
          tag: null,
          x: o.x + PASTE_OFFSET_MM,
          y: o.y + PASTE_OFFSET_MM,
        }));
        if (clones.length === 0) return;
        commit("paste", (st) => ({
          objects: [...st.objects, ...clones],
          selection: clones.map((c) => c.id),
        }));
      },

      // --- connectors --------------------------------------------------------

      startConnection: (objectId, port, from) =>
        set({ pendingConnection: { objectId, port, from, to: from } }),

      updateConnection: (to, target) =>
        set((s) =>
          s.pendingConnection
            ? {
                pendingConnection: {
                  ...s.pendingConnection,
                  to,
                  targetObjectId: target?.objectId,
                  targetPort: target?.port,
                },
              }
            : {},
        ),

      cancelConnection: () => set({ pendingConnection: null }),

      finishConnection: (objectId, port) => {
        const s = get();
        const pending = s.pendingConnection;
        if (!pending || pending.objectId === objectId) {
          set({ pendingConnection: null });
          return;
        }
        const exists = s.connections.some(
          (c) =>
            c.from_object_id === pending.objectId &&
            c.from_port === pending.port &&
            c.to_object_id === objectId &&
            c.to_port === port,
        );
        if (exists) {
          set({ pendingConnection: null });
          return;
        }
        const connection: SldConnection = {
          id: tempId(),
          from_object_id: pending.objectId,
          from_port: pending.port,
          to_object_id: objectId,
          to_port: port,
          connection_type: s.connectionType,
          cable_number: null,
        };
        commit("connect", (st) => ({ connections: [...st.connections, connection] }));
        set({ pendingConnection: null });
      },

      removeConnection: (id) => {
        const s = get();
        if (!s.connections.some((c) => c.id === id)) return;
        commit("connect", (st) => ({ connections: st.connections.filter((c) => c.id !== id) }));
        if (!id.startsWith("tmp-")) {
          set({
            removedConnectionIds: Array.from(new Set([...s.removedConnectionIds, id])),
          });
        }
      },

      // --- measurement -------------------------------------------------------

      startMeasure: (p) => set({ measureStart: p, measurement: null }),

      updateMeasure: (p, axisLock) => {
        const start = get().measureStart;
        if (!start) return;
        set({ measurement: measureGeometry(start, p, axisLock) });
      },

      commitMeasure: (layerId = MEASURE_LAYER_ID) => {
        const s = get();
        const m = s.measurement;
        if (!m) return;
        if (isLayerLocked(s.layers, layerId)) {
          set({ measureStart: null });
          return;
        }
        const dimension: SldCanvasObject = {
          id: tempId(),
          symbol_type: MEASURE_SYMBOL,
          tag: null,
          label: `${Math.round(m.distance * 10) / 10} mm`,
          x: (m.start.x + m.end.x) / 2,
          y: (m.start.y + m.end.y) / 2,
          rotation: 0,
          mirrored: false,
          layer_id: layerId,
          properties: {
            x1: m.start.x,
            y1: m.start.y,
            x2: m.end.x,
            y2: m.end.y,
            distance_mm: m.distance,
          },
        };
        commit("measure", (st) => ({ objects: [...st.objects, dimension] }));
        set({ measureStart: null, measurement: null });
      },

      cancelMeasure: () => set({ measureStart: null, measurement: null }),

      undo: () => {
        const s = get();
        const cmd = s.undoStack[s.undoStack.length - 1];
        if (!cmd) return;
        set({
          objects: cmd.before.objects.map((o) => ({ ...o })),
          layers: cmd.before.layers.map((l) => ({ ...l })),
          connections: cmd.before.connections.map((c) => ({ ...c })),
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
          connections: cmd.after.connections.map((c) => ({ ...c })),
          redoStack: s.redoStack.slice(0, -1),
          undoStack: pushCommand(s.undoStack, cmd),
          selection: [],
          dirty: true,
        });
      },

      markSaved: () => set({ dirty: false, removedIds: [], removedConnectionIds: [] }),

      addMarkup: (markup) => set((s) => ({ markups: [...s.markups, markup], dirty: true })),
      updateMarkup: (id, patch) =>
        set((s) => ({
          markups: s.markups.map((m) => (m.id === id ? { ...m, ...patch } : m)),
          dirty: true,
        })),
      removeMarkup: (id) =>
        set((s) => ({ markups: s.markups.filter((m) => m.id !== id), dirty: true })),
    };
  });

export const useCanvasStore = createCanvasStore();

export { rectFromPoints };
