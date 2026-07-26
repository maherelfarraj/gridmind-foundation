// P-138 — Shared, browser-safe types for the SLD CAD canvas workspace.
import type { TagArea } from "./tagging";

export type { TagArea };

export const SHEET_SIZES = {
  A0: { w: 1189, h: 841 },
  A1: { w: 841, h: 594 },
  A2: { w: 594, h: 420 },
  A3: { w: 420, h: 297 },
} as const;

export type SheetSize = keyof typeof SHEET_SIZES;

export const GRID_STEPS = [1, 5, 10] as const;
export type GridMm = (typeof GRID_STEPS)[number];

export const BORDER_LAYER_ID = "__border";

export type SldLayer = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  /** System layers (border/title block) cannot be renamed or deleted. */
  system?: boolean;
};

export type SldCanvasObject = {
  id: string;
  symbol_type: string;
  tag: string | null;
  label: string | null;
  x: number;
  y: number;
  rotation: 0 | 90 | 180 | 270;
  mirrored: boolean;
  layer_id: string;
  properties: Record<string, unknown>;
};

export const CONNECTION_TYPES = ["cable", "busbar", "dc_string", "earth", "signal"] as const;
export type ConnectionType = (typeof CONNECTION_TYPES)[number];

export const CONNECTION_LABELS: Record<ConnectionType, string> = {
  cable: "Cable",
  busbar: "Busbar",
  dc_string: "DC string",
  earth: "Earth",
  signal: "Signal",
};

export type SldConnection = {
  id: string;
  from_object_id: string;
  from_port: string;
  to_object_id: string;
  to_port: string;
  connection_type: ConnectionType;
  cable_number: string | null;
  properties?: Record<string, unknown>;
};

/** P-140 — dimension annotations live as objects on the measurement layer. */
export const MEASURE_SYMBOL = "__dimension";
export const MEASURE_LAYER_ID = "__measure";

/** Persisted into sld_revisions.canvas jsonb. */
export type SldCanvasMeta = {
  layers: SldLayer[];
  gridMm: GridMm;
  snapEnabled: boolean;
  /** P-141 — tagging zones; objects inside a bounds inherit its 2-digit area code. */
  areas: TagArea[];
};

export type CanvasTool = "select" | "pan" | "place" | "connect" | "measure";

export const DEFAULT_LAYERS: SldLayer[] = [
  { id: BORDER_LAYER_ID, name: "Sheet border", visible: true, locked: true, system: true },
  { id: "default", name: "Equipment", visible: true, locked: false },
  { id: MEASURE_LAYER_ID, name: "Dimensions", visible: true, locked: false, system: true },
];

export function normalizeAreas(raw: unknown): TagArea[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .filter(
      (a): a is Record<string, any> =>
        Boolean(a) && typeof a === "object" && Boolean((a as Record<string, unknown>).bounds),
    )
    .map((a, i) => ({
      id: String(a.id ?? i + 1),
      name: String(a.name ?? `Area ${i + 1}`),
      code: a.code ? String(a.code) : undefined,
      bounds: {
        x: Number(a.bounds.x) || 0,
        y: Number(a.bounds.y) || 0,
        w: Number(a.bounds.w) || 0,
        h: Number(a.bounds.h) || 0,
      },
    }));
}

export function defaultCanvasMeta(): SldCanvasMeta {
  return { layers: DEFAULT_LAYERS.map((l) => ({ ...l })), gridMm: 5, snapEnabled: true, areas: [] };
}

export function normalizeCanvasMeta(raw: unknown): SldCanvasMeta {
  const base = defaultCanvasMeta();
  if (!raw || typeof raw !== "object") return base;
  const obj = raw as Record<string, unknown>;
  const layers = Array.isArray(obj.layers)
    ? (obj.layers as unknown[])
        .filter((l): l is Record<string, unknown> => Boolean(l) && typeof l === "object")
        .map((l) => ({
          id: String(l.id ?? "default"),
          name: String(l.name ?? "Layer"),
          visible: l.visible !== false,
          locked: Boolean(l.locked),
          system: Boolean(l.system),
        }))
    : [];
  const withBorder = layers.some((l) => l.id === BORDER_LAYER_ID)
    ? layers
    : [base.layers[0], ...layers];
  const withMeasure = withBorder.some((l) => l.id === MEASURE_LAYER_ID)
    ? withBorder
    : [...withBorder, { ...base.layers[base.layers.length - 1] }];
  const grid = GRID_STEPS.includes(obj.gridMm as GridMm) ? (obj.gridMm as GridMm) : base.gridMm;
  return {
    layers: withMeasure.length > 1 ? withMeasure : base.layers,
    gridMm: grid,
    snapEnabled: obj.snapEnabled !== false,
    areas: normalizeAreas(obj.areas),
  };
}
