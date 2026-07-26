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

/** P-145 — revision clouds, notes and arrows live on a dedicated top layer. */
export const MARKUP_LAYER_ID = "__markup";

export const MARKUP_KINDS = ["cloud", "note", "arrow"] as const;
export type MarkupKind = (typeof MARKUP_KINDS)[number];

export type SldMarkup = {
  id: string;
  kind: MarkupKind;
  /** mm-space geometry: cloud/arrow use a polyline, notes use a single point. */
  points: { x: number; y: number }[];
  note: string;
  author_id: string | null;
  author_name: string | null;
  status: "open" | "resolved";
  linked_object_ids: string[];
  created_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
};

/** Persisted into sld_revisions.canvas jsonb. */
export type SldCanvasMeta = {
  layers: SldLayer[];
  gridMm: GridMm;
  snapEnabled: boolean;
  /** P-141 — tagging zones; objects inside a bounds inherit its 2-digit area code. */
  areas: TagArea[];
  /** P-145 — revision clouds and review notes (never exported to DXF model space). */
  markups: SldMarkup[];
};

export type CanvasTool = "select" | "pan" | "place" | "connect" | "measure";

export const DEFAULT_LAYERS: SldLayer[] = [
  { id: BORDER_LAYER_ID, name: "Sheet border", visible: true, locked: true, system: true },
  { id: "default", name: "Equipment", visible: true, locked: false },
  { id: MEASURE_LAYER_ID, name: "Dimensions", visible: true, locked: false, system: true },
  { id: MARKUP_LAYER_ID, name: "Markups", visible: true, locked: false, system: true },
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

export function normalizeMarkups(raw: unknown): SldMarkup[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .filter((m): m is Record<string, any> => Boolean(m) && typeof m === "object")
    .map((m, i) => ({
      id: String(m.id ?? `mk-${i + 1}`),
      kind: (MARKUP_KINDS as readonly string[]).includes(m.kind) ? (m.kind as MarkupKind) : "cloud",
      points: Array.isArray(m.points)
        ? m.points
            .filter((p: any) => p && typeof p === "object")
            .map((p: any) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }))
        : [],
      note: typeof m.note === "string" ? m.note : "",
      author_id: m.author_id ? String(m.author_id) : null,
      author_name: m.author_name ? String(m.author_name) : null,
      status: m.status === "resolved" ? "resolved" : "open",
      linked_object_ids: Array.isArray(m.linked_object_ids)
        ? m.linked_object_ids.map((id: unknown) => String(id))
        : [],
      created_at: typeof m.created_at === "string" ? m.created_at : new Date(0).toISOString(),
      resolved_by: m.resolved_by ? String(m.resolved_by) : null,
      resolved_at: m.resolved_at ? String(m.resolved_at) : null,
    }));
}

export function defaultCanvasMeta(): SldCanvasMeta {
  return {
    layers: DEFAULT_LAYERS.map((l) => ({ ...l })),
    gridMm: 5,
    snapEnabled: true,
    areas: [],
    markups: [],
  };
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
    : [
        ...withBorder,
        { id: MEASURE_LAYER_ID, name: "Dimensions", visible: true, locked: false, system: true },
      ];
  // The markup layer is always last so clouds and notes render on top.
  const withMarkup = withMeasure.some((l) => l.id === MARKUP_LAYER_ID)
    ? [
        ...withMeasure.filter((l) => l.id !== MARKUP_LAYER_ID),
        withMeasure.find((l) => l.id === MARKUP_LAYER_ID)!,
      ]
    : [
        ...withMeasure,
        { id: MARKUP_LAYER_ID, name: "Markups", visible: true, locked: false, system: true },
      ];
  const grid = GRID_STEPS.includes(obj.gridMm as GridMm) ? (obj.gridMm as GridMm) : base.gridMm;
  return {
    layers: withMarkup.length > 2 ? withMarkup : base.layers,
    gridMm: grid,
    snapEnabled: obj.snapEnabled !== false,
    areas: normalizeAreas(obj.areas),
    markups: normalizeMarkups(obj.markups),
  };
}
