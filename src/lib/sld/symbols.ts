// P-138 — Minimal placeholder symbol geometry. The full 35-symbol electrical
// library lands in P-139; this module only provides footprints + port anchors
// so the canvas can place, snap and connect objects today.

import {
  mergeSymbolTypes,
  parseSymbolRecord,
  type ParsedSymbol,
  type SymbolTypeRecord,
} from "./symbol-registry";

export type SymbolPort = { id: string; x: number; y: number };

export type SymbolDef = {
  type: string;
  label: string;
  /** Sanitized 40×40 viewBox markup from the registry, when available. */
  svg?: string;
  /** Footprint in mm, origin at the symbol centre. */
  w: number;
  h: number;
  ports: SymbolPort[];
};

const generic = (type: string, label: string, w = 16, h = 16): SymbolDef => ({
  type,
  label,
  w,
  h,
  ports: [
    { id: "in", x: 0, y: -h / 2 },
    { id: "out", x: 0, y: h / 2 },
    { id: "left", x: -w / 2, y: 0 },
    { id: "right", x: w / 2, y: 0 },
  ],
});

export const SYMBOL_DEFS: Record<string, SymbolDef> = {
  pv_array: generic("pv_array", "PV array", 20, 14),
  inverter: generic("inverter", "Inverter", 18, 18),
  transformer: generic("transformer", "Transformer", 16, 22),
  breaker: generic("breaker", "Circuit breaker", 12, 14),
  busbar: { ...generic("busbar", "Busbar", 40, 4), ports: [] },
  bess: generic("bess", "BESS container", 22, 16),
  meter: generic("meter", "Meter", 12, 12),
  grid: generic("grid", "Utility grid", 18, 14),
};

export function symbolDef(type: string): SymbolDef {
  const parsed = PARSED[type];
  if (parsed) {
    return {
      type,
      label: parsed.record.display_name,
      svg: parsed.svg,
      w: parsed.w,
      h: parsed.h,
      ports: parsed.ports,
    };
  }
  return SYMBOL_DEFS[type] ?? generic(type, type);
}

/** Port position in sheet coordinates, honouring rotation + mirroring. */
export function portPosition(
  obj: { x: number; y: number; rotation: number; mirrored: boolean },
  port: SymbolPort,
): { x: number; y: number } {
  const px = obj.mirrored ? -port.x : port.x;
  const py = port.y;
  const rad = ((obj.rotation % 360) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: obj.x + px * cos - py * sin, y: obj.y + px * sin + py * cos };
}

// ---------------------------------------------------------------------------
// P-139 — data-driven registry. Symbol geometry now comes from
// public.sld_symbol_types; the definitions above remain only as a fallback for
// legacy objects whose type is missing from the registry.

let REGISTRY: Record<string, SymbolTypeRecord> = {};
let PARSED: Record<string, ParsedSymbol> = {};

/** Install the merged (global + company) registry for the current session. */
export function setSymbolRegistry(records: SymbolTypeRecord[]): void {
  REGISTRY = {};
  PARSED = {};
  for (const record of mergeSymbolTypes(records)) {
    REGISTRY[record.type_key] = record;
    PARSED[record.type_key] = parseSymbolRecord(record);
  }
}

export function symbolRecord(type: string): SymbolTypeRecord | undefined {
  return REGISTRY[type];
}

export function parsedSymbol(type: string): ParsedSymbol | undefined {
  return PARSED[type];
}

export function registrySize(): number {
  return Object.keys(REGISTRY).length;
}
