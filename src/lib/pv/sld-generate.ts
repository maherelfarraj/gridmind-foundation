// P-155 — Pure, deterministic conversion of an approved PV layout + P-154
// stringing into a Batch 16 SLD object graph. No Supabase/React imports.
import {
  generateCableNumbers,
  generateTags,
  type SymbolPrefixSource,
  type TaggableConnection,
  type TaggableObject,
} from "@/lib/sld/tagging";

/** Site metres → canvas mm (×10), deterministic and reversible. */
export const METRES_TO_CANVAS = 10;

export type SldSymbolType =
  | "pv_string"
  | "string_combiner"
  | "inverter"
  | "transformer"
  | "mv_switchgear"
  | "grid_connection_point";

export interface GenStringRow {
  id: string;
  string_label: string;
  block_id: string | null;
  combiner_label: string | null;
  inverter_station_label: string | null;
  mppt_index: number | null;
  modules_in_series: number;
  dc_power_kwp: number | null;
  voc_at_min_temp_v: number | null;
  vmp_at_max_temp_v: number | null;
}

export interface GenAssignmentRow {
  inverter_station_label: string;
  inverter_id: string | null;
  mppt_index: number;
  loading_pct: number | null;
  dc_ac_ratio: number | null;
  inverter_ac_kw: number | null;
  inverter_dc_kwp: number | null;
  mv_feeder: {
    label?: string | null;
    voltage_kv?: number | null;
    cable_id?: string | null;
    length_m?: number | null;
  } | null;
  transformer: {
    transformer_id?: string | null;
    station_label?: string | null;
    loading_pct?: number | null;
  } | null;
}

export interface GenBlock {
  id: string;
  label: string | null;
  centroid: { x: number; y: number };
}

export interface GenGridLimits {
  voltageKv: number | null;
  exportCapacityMw: number | null;
  importCapacityMw: number | null;
  utility: string | null;
}

export interface GenInput {
  layoutId: string;
  layoutNumber: string;
  strings: GenStringRow[];
  assignments: GenAssignmentRow[];
  blocks: GenBlock[];
  grid: GenGridLimits;
  symbolTypes: SymbolPrefixSource[];
}

export interface GenObject {
  key: string;
  symbol_type: SldSymbolType;
  tag: string;
  label: string;
  x: number;
  y: number;
  rotation: number;
  properties: Record<string, unknown>;
}

export interface GenConnection {
  key: string;
  from: string;
  to: string;
  from_port: string;
  to_port: string;
  connection_type: "dc_string" | "cable" | "busbar";
  cable_number: string | null;
  properties: Record<string, unknown>;
}

export interface GenWarning {
  code: string;
  message: string;
  refs: string[];
}

export interface GenGraph {
  objects: GenObject[];
  connections: GenConnection[];
  warnings: GenWarning[];
  counts: { objects: number; connections: number; byType: Record<string, number> };
}

const ROW_Y = {
  string: 0,
  combiner: 1200,
  inverter: 2400,
  transformer: 3600,
  switchgear: 4800,
  grid: 6000,
} as const;

function toCanvas(v: number): number {
  return Math.round(v * METRES_TO_CANVAS * 100) / 100;
}

/** Deterministic column spread for nodes without a real site coordinate. */
function spread(index: number, total: number, span = 6000): number {
  if (total <= 1) return 0;
  return Math.round(((index / (total - 1)) * span - span / 2) * 100) / 100;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, "en"));
}

/**
 * Applies the P-141 tag engine, then gives any residual duplicate a
 * deterministic `-2`, `-3` suffix and records a warning.
 */
function applyTags(
  objects: GenObject[],
  symbolTypes: SymbolPrefixSource[],
  warnings: GenWarning[],
): void {
  const taggable: TaggableObject[] = objects.map((o) => ({
    id: o.key,
    symbol_type: o.symbol_type,
    tag: null,
    x: o.x,
    y: o.y,
  }));
  const assignments = generateTags(taggable, symbolTypes, [], { force: true });
  const byKey = new Map(assignments.map((a) => [a.id, a.tag]));

  const seen = new Map<string, number>();
  for (const obj of objects) {
    const base = byKey.get(obj.key) ?? obj.tag;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    if (count === 1) {
      obj.tag = base;
      continue;
    }
    obj.tag = `${base}-${count}`;
    warnings.push({
      code: "duplicate_tag",
      message: `Tag ${base} was already used in this revision — assigned ${obj.tag} instead.`,
      refs: [obj.key],
    });
  }
}

function applyCableNumbers(objects: GenObject[], connections: GenConnection[]): void {
  const taggableObjects: TaggableObject[] = objects.map((o) => ({
    id: o.key,
    symbol_type: o.symbol_type,
    tag: o.tag,
    x: o.x,
    y: o.y,
  }));
  const taggableConnections: TaggableConnection[] = connections.map((c) => ({
    id: c.key,
    connection_type: c.connection_type,
    cable_number: null,
    from_object_id: c.from,
    to_object_id: c.to,
  }));
  const assigned = generateCableNumbers(taggableConnections, taggableObjects, [], { force: true });
  const byKey = new Map(assigned.map((a) => [a.id, a.cable_number]));
  for (const conn of connections) conn.cable_number = byKey.get(conn.key) ?? null;
}

/**
 * Builds the full string → combiner → inverter → transformer → MV switchgear →
 * grid graph. Every string reaches the grid connection point; nodes that would
 * be orphaned raise a warning rather than being silently dropped.
 */
export function buildSldGraph(input: GenInput): GenGraph {
  const warnings: GenWarning[] = [];
  const objects: GenObject[] = [];
  const connections: GenConnection[] = [];

  const blockById = new Map(input.blocks.map((b) => [b.id, b]));
  const strings = [...input.strings].sort((a, b) =>
    a.string_label.localeCompare(b.string_label, "en", { numeric: true }),
  );

  // --- Inverter stations -----------------------------------------------
  const stationLabels = sortedUnique([
    ...input.assignments.map((a) => a.inverter_station_label),
    ...strings.map((s) => s.inverter_station_label ?? "").filter(Boolean),
  ]);
  const stationByLabel = new Map<string, GenObject>();
  stationLabels.forEach((label, i) => {
    const rows = input.assignments.filter((a) => a.inverter_station_label === label);
    const obj: GenObject = {
      key: `inv:${label}`,
      symbol_type: "inverter",
      tag: "",
      label,
      x: spread(i, stationLabels.length),
      y: ROW_Y.inverter,
      rotation: 0,
      properties: {
        source_layout_id: input.layoutId,
        station_label: label,
        inverter_library_id: rows[0]?.inverter_id ?? null,
        ac_kw: rows[0]?.inverter_ac_kw ?? null,
        dc_kwp: rows[0]?.inverter_dc_kwp ?? null,
        loading_pct: rows[0]?.loading_pct ?? null,
        dc_ac_ratio: rows[0]?.dc_ac_ratio ?? null,
        mppt_index: rows.map((r) => r.mppt_index).sort((a, b) => a - b),
      },
    };
    objects.push(obj);
    stationByLabel.set(label, obj);
  });

  // --- Strings ----------------------------------------------------------
  strings.forEach((s, i) => {
    const block = s.block_id ? blockById.get(s.block_id) : undefined;
    objects.push({
      key: `str:${s.id}`,
      symbol_type: "pv_string",
      tag: "",
      label: s.string_label,
      x: block ? toCanvas(block.centroid.x) : spread(i, strings.length, 12000),
      y: block ? toCanvas(block.centroid.y) + ROW_Y.string : ROW_Y.string,
      rotation: 0,
      properties: {
        source_layout_id: input.layoutId,
        source_string_id: s.id,
        modules_in_series: s.modules_in_series,
        dc_power_kwp: s.dc_power_kwp,
        voc_at_min_temp_v: s.voc_at_min_temp_v,
        vmp_at_max_temp_v: s.vmp_at_max_temp_v,
        mppt_index: s.mppt_index,
      },
    });
  });

  // --- Combiners --------------------------------------------------------
  const combinerLabels = sortedUnique(
    strings.map((s) => s.combiner_label ?? "").filter((l) => l.length > 0),
  );
  const combinerByLabel = new Map<string, GenObject>();
  combinerLabels.forEach((label, i) => {
    const members = strings.filter((s) => s.combiner_label === label);
    const station = members.find((m) => m.inverter_station_label)?.inverter_station_label ?? null;
    const obj: GenObject = {
      key: `scb:${label}`,
      symbol_type: "string_combiner",
      tag: "",
      label,
      x: spread(i, combinerLabels.length, 10000),
      y: ROW_Y.combiner,
      rotation: 0,
      properties: {
        source_layout_id: input.layoutId,
        input_count: members.length,
        inverter_station_label: station,
      },
    };
    objects.push(obj);
    combinerByLabel.set(label, obj);
  });

  // --- Transformers + MV feeders ---------------------------------------
  const feederGroups = new Map<string, { stations: string[]; voltageKv: number | null }>();
  const transformerByStation = new Map<string, GenObject>();
  const txLabels = sortedUnique(
    input.assignments
      .map((a) => a.transformer?.station_label ?? "")
      .filter((l) => (l as string).length > 0),
  );
  txLabels.forEach((label, i) => {
    const rows = input.assignments.filter((a) => a.transformer?.station_label === label);
    const obj: GenObject = {
      key: `tx:${label}`,
      symbol_type: "transformer",
      tag: "",
      label,
      x: spread(i, txLabels.length, 5000),
      y: ROW_Y.transformer,
      rotation: 0,
      properties: {
        source_layout_id: input.layoutId,
        transformer_library_id: rows[0]?.transformer?.transformer_id ?? null,
        loading_pct: rows[0]?.transformer?.loading_pct ?? null,
        station_label: label,
      },
    };
    objects.push(obj);
    for (const r of rows) transformerByStation.set(r.inverter_station_label, obj);
  });

  for (const a of input.assignments) {
    const feederLabel = a.mv_feeder?.label;
    if (!feederLabel) continue;
    const group = feederGroups.get(feederLabel) ?? {
      stations: [],
      voltageKv: a.mv_feeder?.voltage_kv ?? null,
    };
    if (!group.stations.includes(a.inverter_station_label)) {
      group.stations.push(a.inverter_station_label);
    }
    feederGroups.set(feederLabel, group);
  }

  const feederLabels = sortedUnique([...feederGroups.keys()]);
  const switchgearByFeeder = new Map<string, GenObject>();
  feederLabels.forEach((label, i) => {
    const group = feederGroups.get(label)!;
    const obj: GenObject = {
      key: `mvsg:${label}`,
      symbol_type: "mv_switchgear",
      tag: "",
      label,
      x: spread(i, feederLabels.length, 4000),
      y: ROW_Y.switchgear,
      rotation: 0,
      properties: {
        source_layout_id: input.layoutId,
        feeder_label: label,
        voltage_kv: group.voltageKv ?? input.grid.voltageKv,
        station_labels: [...group.stations].sort((x, y) => x.localeCompare(y, "en")),
      },
    };
    objects.push(obj);
    switchgearByFeeder.set(label, obj);
  });

  // --- Grid connection point -------------------------------------------
  const poi: GenObject = {
    key: "poi:grid",
    symbol_type: "grid_connection_point",
    tag: "",
    label: "Point of interconnection",
    x: 0,
    y: ROW_Y.grid,
    rotation: 0,
    properties: {
      source_layout_id: input.layoutId,
      voltage_kv: input.grid.voltageKv,
      export_capacity_mw: input.grid.exportCapacityMw,
      import_capacity_mw: input.grid.importCapacityMw,
      utility: input.grid.utility,
    },
  };
  objects.push(poi);

  applyTags(objects, input.symbolTypes, warnings);

  // --- Connections ------------------------------------------------------
  const push = (
    from: GenObject,
    to: GenObject,
    fromPort: string,
    toPort: string,
    type: GenConnection["connection_type"],
    properties: Record<string, unknown> = {},
  ) => {
    connections.push({
      key: `${from.key}->${to.key}`,
      from: from.key,
      to: to.key,
      from_port: fromPort,
      to_port: toPort,
      connection_type: type,
      cable_number: null,
      properties: { source_layout_id: input.layoutId, ...properties },
    });
  };

  const combinerInputIndex = new Map<string, number>();
  for (const s of strings) {
    const strObj = objects.find((o) => o.key === `str:${s.id}`)!;
    const combiner = s.combiner_label ? combinerByLabel.get(s.combiner_label) : undefined;
    const station = s.inverter_station_label
      ? stationByLabel.get(s.inverter_station_label)
      : undefined;
    const target = combiner ?? station;
    if (!target) {
      warnings.push({
        code: "orphan_string",
        message: `String ${s.string_label} has no combiner or inverter station and could not be connected.`,
        refs: [s.string_label],
      });
      continue;
    }
    const idx = (combinerInputIndex.get(target.key) ?? 0) + 1;
    combinerInputIndex.set(target.key, idx);
    push(strObj, target, "dc_out", `dc_in_${idx}`, "dc_string", { string_label: s.string_label });
  }

  for (const label of combinerLabels) {
    const combiner = combinerByLabel.get(label)!;
    const stationLabel = combiner.properties.inverter_station_label as string | null;
    const station = stationLabel ? stationByLabel.get(stationLabel) : undefined;
    if (!station) {
      warnings.push({
        code: "orphan_combiner",
        message: `Combiner ${label} is not assigned to an inverter station.`,
        refs: [label],
      });
      continue;
    }
    push(combiner, station, "dc_out", "dc_in", "cable", { voltage_level: "dc" });
  }

  for (const label of stationLabels) {
    const station = stationByLabel.get(label)!;
    const tx = transformerByStation.get(label);
    if (!tx) {
      warnings.push({
        code: "no_transformer_for_station",
        message: `Inverter station ${label} has no transformer — the AC path stops here.`,
        refs: [label],
      });
      continue;
    }
    push(station, tx, "ac_out", "lv", "cable", { voltage_level: "ac_lv" });
  }

  for (const label of feederLabels) {
    const sg = switchgearByFeeder.get(label)!;
    const stations = sg.properties.station_labels as string[];
    const joined = new Set<string>();
    for (const st of stations) {
      const tx = transformerByStation.get(st);
      if (!tx || joined.has(tx.key)) continue;
      joined.add(tx.key);
      push(tx, sg, "mv", "in", "busbar", { feeder_label: label });
    }
    push(sg, poi, "out", "plant", "cable", {
      voltage_level: "ac_mv",
      voltage_kv: sg.properties.voltage_kv,
    });
  }

  if (feederLabels.length === 0) {
    for (const label of txLabels) {
      const tx = objects.find((o) => o.key === `tx:${label}`)!;
      push(tx, poi, "mv", "plant", "cable", { voltage_level: "ac_mv" });
    }
    if (txLabels.length === 0) {
      warnings.push({
        code: "no_mv_path",
        message: "No transformer or MV feeder data — the grid connection point is unconnected.",
        refs: ["poi:grid"],
      });
    }
  }

  connections.sort((a, b) => a.key.localeCompare(b.key, "en"));
  applyCableNumbers(objects, connections);

  const byType: Record<string, number> = {};
  for (const o of objects) byType[o.symbol_type] = (byType[o.symbol_type] ?? 0) + 1;

  return {
    objects,
    connections,
    warnings,
    counts: { objects: objects.length, connections: connections.length, byType },
  };
}

/** Objects added/removed between two generations, keyed by tag. */
export function diffTagSets(
  previous: string[],
  next: string[],
): { added: string[]; removed: string[]; unchanged: number } {
  const prev = new Set(previous);
  const nxt = new Set(next);
  return {
    added: [...nxt].filter((t) => !prev.has(t)).sort(),
    removed: [...prev].filter((t) => !nxt.has(t)).sort(),
    unchanged: [...nxt].filter((t) => prev.has(t)).length,
  };
}
