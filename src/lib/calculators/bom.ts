// P-057 — Pure BOM calculator. Browser-safe, deterministic, no I/O.

export const BOM_CATEGORIES = [
  "modules",
  "inverters",
  "bos",
  "cables",
  "structures",
  "transformers",
  "other",
] as const;
export type BomCategory = (typeof BOM_CATEGORIES)[number];

export const BOM_CATEGORY_LABEL: Record<BomCategory, string> = {
  modules: "Modules",
  inverters: "Inverters",
  cables: "Cables",
  structures: "Structures & mounting",
  transformers: "Transformers",
  bos: "Balance of system",
  other: "Other",
};

/** Default buffer % per category as required by the spec. */
export const DEFAULT_BUFFERS: Record<BomCategory, number> = {
  modules: 0.5,
  inverters: 0,
  cables: 10,
  structures: 2,
  bos: 5,
  transformers: 0,
  other: 0,
};

/** Categories where the buffered quantity must be a whole number. */
const INTEGER_UNIT_CATEGORIES = new Set<BomCategory>([
  "modules",
  "inverters",
  "structures",
  "transformers",
]);

export interface BomLineInput {
  category: BomCategory;
  item: string;
  spec?: string | null;
  unit: string;
  qty: number;
  buffer_pct: number;
  unit_cost?: number | null;
  notes?: string | null;
}

export interface BomLine extends BomLineInput {
  qty_buffered: number;
}

/**
 * Apply a percentage buffer to a quantity.
 *  - Integer-unit categories (modules, inverters, structures, transformers)
 *    ceil to the next whole unit — you cannot ship a fraction of a module.
 *  - Continuous categories (cables, BOS, other) round to 4 decimals.
 */
export function applyBuffer(
  qty: number,
  bufferPct: number,
  category: BomCategory,
): number {
  const safeQty = Number.isFinite(qty) ? qty : 0;
  const safePct = Number.isFinite(bufferPct) ? bufferPct : 0;
  const raw = safeQty * (1 + safePct / 100);
  if (INTEGER_UNIT_CATEGORIES.has(category)) {
    return Math.max(0, Math.ceil(raw));
  }
  return Math.max(0, Math.round(raw * 10000) / 10000);
}

export interface BomParams {
  capacity_mwp_dc: number;
  module_wp?: number;
  dc_ac_ratio?: number;
  inverter_count?: number;
  tracker_type?: "fixed" | "single_axis" | "dual_axis" | string;
  modules_per_string?: number;
  modules_per_row?: number;
  avg_dc_run_m?: number;
  mv_cable_m_per_mw?: number;
}

const DEFAULTS = {
  module_wp: 550,
  dc_ac_ratio: 1.3,
  modules_per_string: 28,
  modules_per_row: 90,
  avg_dc_run_m: 90,
  mv_cable_m_per_mw: 800,
};

/**
 * Deterministic BOM composition. All heuristics live here so unit tests
 * can pin them.
 */
export function computeBom(params: BomParams): BomLine[] {
  const capacityMwp = Math.max(0, params.capacity_mwp_dc);
  const capacityWp = capacityMwp * 1_000_000;

  const moduleWp = params.module_wp ?? DEFAULTS.module_wp;
  const dcAcRatio = params.dc_ac_ratio ?? DEFAULTS.dc_ac_ratio;
  const modulesPerString =
    params.modules_per_string ?? DEFAULTS.modules_per_string;
  const modulesPerRow = params.modules_per_row ?? DEFAULTS.modules_per_row;
  const avgDcRunM = params.avg_dc_run_m ?? DEFAULTS.avg_dc_run_m;
  const mvCableMPerMw = params.mv_cable_m_per_mw ?? DEFAULTS.mv_cable_m_per_mw;

  const moduleCount =
    moduleWp > 0 ? Math.ceil(capacityWp / moduleWp) : 0;

  const stringCount =
    modulesPerString > 0 ? Math.ceil(moduleCount / modulesPerString) : 0;
  const rowCount =
    modulesPerRow > 0 ? Math.ceil(moduleCount / modulesPerRow) : 0;

  const capacityMwAc = dcAcRatio > 0 ? capacityMwp / dcAcRatio : capacityMwp;
  // Assume a 5 MVA reference inverter block when count not provided.
  const inverterCount =
    params.inverter_count && params.inverter_count > 0
      ? params.inverter_count
      : Math.max(1, Math.ceil(capacityMwAc / 5));

  // Cable heuristics.
  const dcCableM = stringCount * avgDcRunM * 2; // out-and-return
  const mvCableM = capacityMwp * mvCableMPerMw;

  // Transformers: 1 per ~40 MVA of AC capacity, minimum 1.
  const transformerCount = Math.max(1, Math.ceil(capacityMwAc / 40));

  // BOS lump-sum lines expressed per MWp DC.
  const combinerBoxCount = Math.max(1, Math.ceil(stringCount / 24));

  const rows: BomLineInput[] = [
    {
      category: "modules",
      item: "PV module",
      spec: `${moduleWp} Wp`,
      unit: "ea",
      qty: moduleCount,
      buffer_pct: DEFAULT_BUFFERS.modules,
    },
    {
      category: "inverters",
      item: "Central / string inverter",
      spec: `~${(capacityMwAc / Math.max(1, inverterCount)).toFixed(2)} MVA each`,
      unit: "ea",
      qty: inverterCount,
      buffer_pct: DEFAULT_BUFFERS.inverters,
    },
    {
      category: "structures",
      item:
        params.tracker_type && params.tracker_type !== "fixed"
          ? "Tracker row"
          : "Fixed-tilt table",
      spec: `${modulesPerRow} modules per row`,
      unit: "ea",
      qty: rowCount,
      buffer_pct: DEFAULT_BUFFERS.structures,
    },
    {
      category: "cables",
      item: "DC string cable",
      spec: `${avgDcRunM} m avg run × 2 conductors`,
      unit: "m",
      qty: dcCableM,
      buffer_pct: DEFAULT_BUFFERS.cables,
    },
    {
      category: "cables",
      item: "MV collection cable",
      spec: `${mvCableMPerMw} m/MW baseline`,
      unit: "m",
      qty: mvCableM,
      buffer_pct: DEFAULT_BUFFERS.cables,
    },
    {
      category: "transformers",
      item: "MV/HV power transformer",
      spec: "≥ 40 MVA nominal",
      unit: "ea",
      qty: transformerCount,
      buffer_pct: DEFAULT_BUFFERS.transformers,
    },
    {
      category: "bos",
      item: "DC combiner box",
      spec: "24 strings per box",
      unit: "ea",
      qty: combinerBoxCount,
      buffer_pct: DEFAULT_BUFFERS.bos,
    },
    {
      category: "bos",
      item: "Grounding & lightning protection",
      spec: "Site-wide allowance",
      unit: "lot",
      qty: 1,
      buffer_pct: DEFAULT_BUFFERS.bos,
    },
  ];

  return rows.map((r) => ({
    ...r,
    qty_buffered: applyBuffer(r.qty, r.buffer_pct, r.category),
  }));
}

/** Sum unit_cost × qty_buffered across lines. */
export function sumBomCost(lines: Pick<BomLine, "qty_buffered" | "unit_cost">[]): number {
  let total = 0;
  for (const l of lines) {
    if (l.unit_cost != null && Number.isFinite(l.unit_cost)) {
      total += l.unit_cost * l.qty_buffered;
    }
  }
  return Math.round(total * 100) / 100;
}
