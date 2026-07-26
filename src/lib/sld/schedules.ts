// P-144 — Pure schedule builders for SLD drawings.
// No React / Supabase imports: unit-testable and reused by the server fn.
import {
  cableReferences,
  protectionReferences,
  type CableReferenceRow,
  type ProtectionReferenceRow,
} from "./coordination";
import type { ConnEdge, ConnObject } from "./connectivity";

export const SCHEDULE_TYPES = [
  "boq",
  "equipment",
  "cable",
  "protection",
  "legend",
  "title_block",
] as const;

export type ScheduleType = (typeof SCHEDULE_TYPES)[number];

export const SCHEDULE_LABELS: Record<ScheduleType, string> = {
  boq: "Bill of quantities",
  equipment: "Equipment schedule",
  cable: "Cable schedule",
  protection: "Protection schedule",
  legend: "Legend",
  title_block: "Title block",
};

export type ScheduleSymbolMeta = {
  type_key: string;
  display_name?: string | null;
  category?: string | null;
  svg_body?: string | null;
  tag_prefix?: string | null;
};

export type ScheduleArea = { id?: string; name?: string; bounds?: unknown };

export type TitleBlockInput = {
  drawing_number: string;
  title: string;
  revision_code: string | null;
  status: string;
  sheet_size?: string | null;
  project_name: string | null;
  project_code?: string | null;
  company_name?: string | null;
  drawn_by: string | null;
  checked_by?: string | null;
  created_at?: string | null;
  revision_date?: string | null;
};

export type BoqRow = {
  item: string;
  symbol_type: string;
  description: string;
  rating: string | null;
  unit: "no" | "m";
  quantity: number;
};

export type EquipmentRow = {
  tag: string | null;
  symbol_type: string;
  description: string;
  rating: string | null;
  area: string;
  layer: string;
  object_id: string;
};

export type CableRow = {
  cable_number: string | null;
  from_tag: string | null;
  to_tag: string | null;
  size_mm2: number | null;
  cores: number | null;
  length_m: number | null;
  voltage_kv: number | null;
  connection_type: string;
  connection_id: string;
};

export type ProtectionRow = {
  tag: string | null;
  device_type: string;
  rated_current_a: number | null;
  breaking_ka: number | null;
  ansi_functions: string | null;
  protects_tag: string;
};

export type LegendRow = {
  symbol_type: string;
  description: string;
  category: string;
  svg_body: string | null;
  count: number;
};

export type TitleBlockRow = TitleBlockInput & { generated_at?: string };

export type ScheduleRow =
  | BoqRow
  | EquipmentRow
  | CableRow
  | ProtectionRow
  | LegendRow
  | TitleBlockRow;

export type ScheduleSet = {
  [K in ScheduleType]: ScheduleRow[];
};

const CABLE_TYPES = new Set(["cable", "dc_string"]);

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function symbolMap(symbols: ScheduleSymbolMeta[]): Map<string, ScheduleSymbolMeta> {
  const m = new Map<string, ScheduleSymbolMeta>();
  for (const s of symbols) m.set(s.type_key, s);
  return m;
}

function humanize(key: string): string {
  return key
    .split("_")
    .map((p) => (p.length <= 3 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
    .join(" ");
}

export function describeSymbol(
  symbolType: string,
  symbols: Map<string, ScheduleSymbolMeta>,
): string {
  return str(symbols.get(symbolType)?.display_name) ?? humanize(symbolType);
}

/** Human rating string used to group BOQ lines and label equipment rows. */
export function ratingLabel(obj: ConnObject): string | null {
  const p = obj.properties ?? {};
  const kw = num(p.rated_power_kw);
  if (kw !== null) return `${kw} kW`;
  const kva = num(p.rated_kva);
  if (kva !== null) return `${kva} kVA`;
  const kwh = num(p.energy_kwh);
  if (kwh !== null) return `${kwh} kWh`;
  const amps = num(p.rated_current_a);
  if (amps !== null) return `${amps} A`;
  const kv = num(p.voltage_kv);
  if (kv !== null) return `${kv} kV`;
  const wp = num(p.module_wp);
  if (wp !== null) return `${wp} Wp`;
  return null;
}

/** Area label for an object: explicit property, else the tag's middle segment, else "01". */
export function areaOf(obj: ConnObject, areas: ScheduleArea[] = []): string {
  const explicit = str((obj.properties ?? {}).area);
  if (explicit) return explicit;
  const fromTag = obj.tag?.split("-")[1];
  if (fromTag && /^\d{2}$/.test(fromTag)) {
    const named = areas.find((a) => a.id === fromTag || a.name === fromTag);
    return named?.name ? String(named.name) : fromTag;
  }
  return "01";
}

export function buildBoq(
  objects: ConnObject[],
  connections: ConnEdge[],
  symbols: Map<string, ScheduleSymbolMeta>,
): BoqRow[] {
  const counts = new Map<string, BoqRow>();

  for (const obj of objects) {
    const rating = ratingLabel(obj);
    const key = `${obj.symbol_type}|${rating ?? ""}`;
    const existing = counts.get(key);
    if (existing) {
      existing.quantity += 1;
      continue;
    }
    counts.set(key, {
      item: "",
      symbol_type: obj.symbol_type,
      description: describeSymbol(obj.symbol_type, symbols),
      rating,
      unit: "no",
      quantity: 1,
    });
  }

  // Cable metres summed by size + voltage.
  const cables = new Map<string, BoqRow>();
  for (const conn of connections) {
    if (!CABLE_TYPES.has(conn.connection_type)) continue;
    const p = conn.properties ?? {};
    const size = num(p.size_mm2);
    const kv = num(p.voltage_kv) ?? (num(p.voltage_v) !== null ? num(p.voltage_v)! / 1000 : null);
    const length = num(p.length_m) ?? 0;
    if (length <= 0) continue;
    const rating = [size ? `${size} mm²` : null, kv !== null ? `${kv} kV` : null]
      .filter(Boolean)
      .join(" · ");
    const key = `cable|${rating}`;
    const existing = cables.get(key);
    if (existing) {
      existing.quantity = Number((existing.quantity + length).toFixed(2));
      continue;
    }
    cables.set(key, {
      item: "",
      symbol_type: "cable",
      description: "Power cable",
      rating: rating || null,
      unit: "m",
      quantity: Number(length.toFixed(2)),
    });
  }

  const rows = [
    ...[...counts.values()].sort(
      (a, b) =>
        a.symbol_type.localeCompare(b.symbol_type) || (a.rating ?? "").localeCompare(b.rating ?? ""),
    ),
    ...[...cables.values()].sort((a, b) => (a.rating ?? "").localeCompare(b.rating ?? "")),
  ];
  return rows.map((r, i) => ({ ...r, item: String(i + 1).padStart(3, "0") }));
}

export function buildEquipment(
  objects: ConnObject[],
  symbols: Map<string, ScheduleSymbolMeta>,
  areas: ScheduleArea[] = [],
): EquipmentRow[] {
  return objects
    .filter((o) => Boolean(o.tag))
    .map((o) => ({
      tag: o.tag ?? null,
      symbol_type: o.symbol_type,
      description: describeSymbol(o.symbol_type, symbols),
      rating: ratingLabel(o),
      area: areaOf(o, areas),
      layer: str((o.properties ?? {}).layer) ?? "equipment",
      object_id: o.id,
    }))
    .sort((a, b) => (a.tag ?? "").localeCompare(b.tag ?? ""));
}

export function buildCableSchedule(objects: ConnObject[], connections: ConnEdge[]): CableRow[] {
  const tagById = new Map(objects.map((o) => [o.id, o.tag ?? null]));
  return connections
    .filter((c) => CABLE_TYPES.has(c.connection_type))
    .map((c) => {
      const p = c.properties ?? {};
      const volts = num(p.voltage_v);
      return {
        cable_number: c.cable_number ?? null,
        from_tag: tagById.get(c.from_object_id) ?? null,
        to_tag: tagById.get(c.to_object_id) ?? null,
        size_mm2: num(p.size_mm2),
        cores: num(p.cores),
        length_m: num(p.length_m),
        voltage_kv: num(p.voltage_kv) ?? (volts !== null ? volts / 1000 : null),
        connection_type: c.connection_type,
        connection_id: c.id,
      };
    })
    .sort((a, b) => (a.cable_number ?? "~").localeCompare(b.cable_number ?? "~"));
}

export function buildProtection(objects: ConnObject[], connections: ConnEdge[]): ProtectionRow[] {
  const { rows } = protectionReferences(objects, connections);
  return rows
    .map((r: ProtectionReferenceRow) => ({
      tag: r.tag,
      device_type: r.deviceType,
      rated_current_a: r.ratedCurrentA,
      breaking_ka: r.breakingKa,
      ansi_functions: r.ansiFunctions,
      protects_tag: r.protectedTags.join(", "),
    }))
    .sort((a, b) => (a.tag ?? "~").localeCompare(b.tag ?? "~"));
}

export function buildLegend(
  objects: ConnObject[],
  symbols: Map<string, ScheduleSymbolMeta>,
): LegendRow[] {
  const counts = new Map<string, number>();
  for (const o of objects) counts.set(o.symbol_type, (counts.get(o.symbol_type) ?? 0) + 1);
  return [...counts.entries()]
    .map(([type, count]) => ({
      symbol_type: type,
      description: describeSymbol(type, symbols),
      category: str(symbols.get(type)?.category) ?? "other",
      svg_body: symbols.get(type)?.svg_body ?? null,
      count,
    }))
    .sort((a, b) => a.symbol_type.localeCompare(b.symbol_type));
}

export function buildTitleBlock(input: TitleBlockInput): TitleBlockRow[] {
  return [{ ...input }];
}

/** Reference rows carried for downstream cable verification (P-143 reuse). */
export function cableVerificationRows(
  objects: ConnObject[],
  connections: ConnEdge[],
): CableReferenceRow[] {
  return cableReferences(objects, connections).rows;
}

export function buildSchedules(args: {
  objects: ConnObject[];
  connections: ConnEdge[];
  symbols: ScheduleSymbolMeta[];
  areas?: ScheduleArea[];
  titleBlock: TitleBlockInput;
}): ScheduleSet {
  const map = symbolMap(args.symbols);
  return {
    boq: buildBoq(args.objects, args.connections, map),
    equipment: buildEquipment(args.objects, map, args.areas ?? []),
    cable: buildCableSchedule(args.objects, args.connections),
    protection: buildProtection(args.objects, args.connections),
    legend: buildLegend(args.objects, map),
    title_block: buildTitleBlock(args.titleBlock),
  };
}

export const SCHEDULE_COLUMNS: Record<ScheduleType, { key: string; label: string }[]> = {
  boq: [
    { key: "item", label: "Item" },
    { key: "description", label: "Description" },
    { key: "rating", label: "Rating" },
    { key: "unit", label: "Unit" },
    { key: "quantity", label: "Qty" },
  ],
  equipment: [
    { key: "tag", label: "Tag" },
    { key: "description", label: "Equipment" },
    { key: "rating", label: "Rating" },
    { key: "area", label: "Area" },
    { key: "layer", label: "Layer" },
  ],
  cable: [
    { key: "cable_number", label: "Cable no." },
    { key: "from_tag", label: "From" },
    { key: "to_tag", label: "To" },
    { key: "size_mm2", label: "Size (mm²)" },
    { key: "cores", label: "Cores" },
    { key: "length_m", label: "Length (m)" },
    { key: "voltage_kv", label: "Voltage (kV)" },
  ],
  protection: [
    { key: "tag", label: "Tag" },
    { key: "device_type", label: "Device" },
    { key: "rated_current_a", label: "Rated (A)" },
    { key: "breaking_ka", label: "Breaking (kA)" },
    { key: "protects_tag", label: "Protects" },
  ],
  legend: [
    { key: "symbol_type", label: "Symbol" },
    { key: "description", label: "Description" },
    { key: "category", label: "Category" },
    { key: "count", label: "Count" },
  ],
  title_block: [
    { key: "drawing_number", label: "Drawing no." },
    { key: "title", label: "Title" },
    { key: "revision_code", label: "Rev" },
    { key: "status", label: "Status" },
    { key: "project_name", label: "Project" },
    { key: "drawn_by", label: "Drawn by" },
    { key: "created_at", label: "Created" },
  ],
};

/** Rows → matrix using the schedule's column order (shared by CSV and PDF). */
export function scheduleMatrix(
  type: ScheduleType,
  rows: Record<string, unknown>[],
): { headers: string[]; body: (string | number)[][] } {
  const cols = SCHEDULE_COLUMNS[type];
  return {
    headers: cols.map((c) => c.label),
    body: rows.map((r) =>
      cols.map((c) => {
        const v = r[c.key];
        if (v === null || v === undefined) return "";
        return typeof v === "number" ? v : String(v);
      }),
    ),
  };
}
