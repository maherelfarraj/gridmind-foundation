// P-139 — Browser-safe helpers for the data-driven SLD symbol registry.
// Symbol geometry, ports and property forms come from public.sld_symbol_types,
// never from hardcoded components.

export const SYMBOL_CATEGORIES = [
  "generation",
  "conversion",
  "switchgear",
  "protection",
  "measurement",
  "distribution",
  "cable_bus",
  "earthing",
  "monitoring",
  "storage",
  "auxiliary",
  "grid",
] as const;

export type SymbolCategory = (typeof SYMBOL_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<SymbolCategory, string> = {
  generation: "Generation",
  conversion: "Conversion",
  switchgear: "Switchgear",
  protection: "Protection",
  measurement: "Measurement",
  distribution: "Distribution",
  cable_bus: "Cable & bus",
  earthing: "Earthing",
  monitoring: "Monitoring",
  storage: "Storage",
  auxiliary: "Auxiliary",
  grid: "Grid",
};

export type SymbolPropertyField = {
  key: string;
  label: string;
  type: "number" | "text" | "select" | "bool";
  unit?: string;
  options?: string[];
  min?: number;
  max?: number;
  required?: boolean;
};

export type SymbolPortSpec = {
  key: string;
  /** Position inside the 40×40 symbol viewBox. */
  x: number;
  y: number;
  side?: "left" | "right" | "top" | "bottom";
};

export type SymbolPropertyValue = Record<string, string | number | boolean | null>;

export type SymbolTypeRecord = {
  id: string;
  company_id: string | null;
  type_key: string;
  display_name: string;
  category: SymbolCategory;
  svg_body: string;
  ports: SymbolPortSpec[];
  property_schema: SymbolPropertyField[];
  default_properties: SymbolPropertyValue;
  tag_prefix: string;
  sort_order: number;
};

/** The symbol viewBox is 40×40; footprints are expressed in sheet millimetres. */
export const SYMBOL_VIEWBOX = 40;
const DEFAULT_FOOTPRINT_MM = 16;
const WIDE_FOOTPRINTS: Record<string, { w: number; h: number }> = {
  busbar: { w: 32, h: 8 },
  cable: { w: 28, h: 8 },
  battery_container: { w: 26, h: 14 },
  mv_switchgear: { w: 24, h: 16 },
  lv_switchgear: { w: 24, h: 16 },
  ring_main_unit: { w: 24, h: 14 },
};

export function footprintFor(typeKey: string): { w: number; h: number } {
  return WIDE_FOOTPRINTS[typeKey] ?? { w: DEFAULT_FOOTPRINT_MM, h: DEFAULT_FOOTPRINT_MM };
}

/**
 * Registry markup is authored by engineering admins, not end users, but it is
 * still stored data — strip anything scriptable before it reaches the DOM.
 */
export function sanitizeSvgBody(body: string): string {
  return String(body ?? "")
    .replace(/<\s*(script|foreignObject|iframe|use)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|foreignObject|iframe|use)\b[^>]*\/?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|xlink:href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

export type ParsedSymbol = {
  record: SymbolTypeRecord;
  /** Footprint in mm, origin at the symbol centre. */
  w: number;
  h: number;
  svg: string;
  ports: Array<{ id: string; x: number; y: number }>;
};

/** Convert a viewBox coordinate (0..40) to a millimetre offset from the centre. */
export function viewBoxToMm(value: number, sizeMm: number): number {
  return (value / SYMBOL_VIEWBOX - 0.5) * sizeMm;
}

export function parseSymbolRecord(record: SymbolTypeRecord): ParsedSymbol {
  const { w, h } = footprintFor(record.type_key);
  return {
    record,
    w,
    h,
    svg: sanitizeSvgBody(record.svg_body),
    ports: (record.ports ?? []).map((p) => ({
      id: p.key,
      x: viewBoxToMm(p.x, w),
      y: viewBoxToMm(p.y, h),
    })),
  };
}

/** Company rows shadow global rows with the same type_key. */
export function mergeSymbolTypes(records: SymbolTypeRecord[]): SymbolTypeRecord[] {
  const byKey = new Map<string, SymbolTypeRecord>();
  for (const r of records) {
    const current = byKey.get(r.type_key);
    if (!current || (current.company_id === null && r.company_id !== null))
      byKey.set(r.type_key, r);
  }
  return [...byKey.values()].sort(
    (a, b) => a.sort_order - b.sort_order || a.display_name.localeCompare(b.display_name),
  );
}

export function filterSymbols(records: SymbolTypeRecord[], query: string): SymbolTypeRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return records;
  return records.filter((r) =>
    [r.display_name, r.type_key, r.tag_prefix, CATEGORY_LABELS[r.category] ?? r.category]
      .join(" ")
      .toLowerCase()
      .includes(q),
  );
}

export function groupByCategory(
  records: SymbolTypeRecord[],
): Array<{ category: SymbolCategory; label: string; items: SymbolTypeRecord[] }> {
  const groups = new Map<SymbolCategory, SymbolTypeRecord[]>();
  for (const r of records) {
    const list = groups.get(r.category) ?? [];
    list.push(r);
    groups.set(r.category, list);
  }
  return SYMBOL_CATEGORIES.filter((c) => groups.has(c)).map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    items: groups.get(category)!,
  }));
}

/** Next free tag for a symbol type, e.g. INV-004. */
export function nextTag(prefix: string, existingTags: Array<string | null>): string {
  const re = new RegExp(`^${prefix}-(\\d+)$`, "i");
  let max = 0;
  for (const tag of existingTags) {
    const m = tag ? re.exec(tag) : null;
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

/** Values a newly placed object starts with, from the registry defaults. */
export function initialProperties(record: SymbolTypeRecord): SymbolPropertyValue {
  return { ...(record.default_properties ?? {}) };
}

export function coercePropertyValue(
  field: SymbolPropertyField,
  raw: unknown,
): string | number | boolean | null {
  if (field.type === "number") {
    if (raw === "" || raw === null || raw === undefined) return null;
    const n = Number(raw);
    if (Number.isNaN(n)) return null;
    if (field.min !== undefined && n < field.min) return field.min;
    if (field.max !== undefined && n > field.max) return field.max;
    return n;
  }
  if (field.type === "bool") return Boolean(raw);
  if (raw === "" || raw === null || raw === undefined) return null;
  return String(raw);
}

export function missingRequiredProperties(
  record: SymbolTypeRecord,
  properties: Record<string, unknown>,
): string[] {
  return (record.property_schema ?? [])
    .filter((f) => f.required)
    .filter((f) => {
      const v = properties?.[f.key];
      return v === undefined || v === null || v === "";
    })
    .map((f) => f.label);
}
