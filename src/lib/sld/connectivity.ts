// P-142 — Pure connectivity + validation engine for SLD drawings.
// No React / Supabase imports: this module must stay unit-testable in isolation.
import { findDuplicateTags } from "./tagging";

export type ConnObject = {
  id: string;
  symbol_type: string;
  tag: string | null;
  properties?: Record<string, unknown> | null;
};

export type ConnEdge = {
  id: string;
  from_object_id: string;
  from_port: string;
  to_object_id: string;
  to_port: string;
  connection_type: string;
  cable_number?: string | null;
  properties?: Record<string, unknown> | null;
};

export type ConnSymbolMeta = {
  type_key: string;
  category: string;
  display_name?: string;
  ports?: Array<{ key: string; required?: boolean }>;
};

export type IssueSeverity = "error" | "warning";

export type ValidationIssueCode =
  | "disconnected_equipment"
  | "open_circuit"
  | "unterminated_port"
  | "duplicate_tag"
  | "voltage_mismatch"
  | "unknown_voltage_level"
  | "rating_exceeded"
  | "multiple_sources_one_input";

export type ValidationIssue = {
  severity: IssueSeverity;
  code: ValidationIssueCode;
  objectIds: string[];
  connectionIds?: string[];
  message: string;
};

export type ValidationSnapshot = {
  ran_at: string;
  issue_count: number;
  error_count: number;
  warning_count: number;
  issues: ValidationIssue[];
};

/** Connection types that carry no power and are ignored by topology walks. */
export const NON_POWER_CONNECTIONS = new Set(["earth", "signal"]);

/** Categories excluded from the disconnected-equipment check. */
export const NON_TOPOLOGY_CATEGORIES = new Set(["monitoring", "earthing"]);

const SOURCE_TYPES = new Set([
  "pv_string",
  "pv_module",
  "generator",
  "bess_rack",
  "battery_container",
]);
const SINK_TYPES = new Set(["grid_connection_point"]);
const TRANSFORMER_TYPES = new Set(["transformer", "aux_transformer"]);
const INVERTER_TYPES = new Set(["inverter", "pcs"]);
const BUS_TYPES = new Set(["busbar", "mv_switchgear", "lv_switchgear", "ring_main_unit"]);

export const VOLTAGE_TOLERANCE = 0.05;

export type ConnGraph = {
  objects: Map<string, ConnObject>;
  edges: ConnEdge[];
  /** Object id → neighbouring object ids (power connections only). */
  adjacency: Map<string, Set<string>>;
  /** Object id → every incident edge, including earth/signal. */
  edgesByObject: Map<string, ConnEdge[]>;
  /** `${objectId}::${port}` → incident edges; busbar-like nodes merge into `::*`. */
  portUsage: Map<string, ConnEdge[]>;
};

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function prop(obj: ConnObject | undefined, key: string): number | null {
  return num((obj?.properties as Record<string, unknown> | undefined)?.[key]);
}

function edgeProp(edge: ConnEdge, key: string): number | null {
  return num((edge.properties as Record<string, unknown> | undefined)?.[key]);
}

function categoryOf(obj: ConnObject | undefined, symbols: Map<string, ConnSymbolMeta>): string {
  if (!obj) return "";
  return symbols.get(obj.symbol_type)?.category ?? "";
}

function labelOf(obj: ConnObject | undefined, symbols?: Map<string, ConnSymbolMeta>): string {
  if (!obj) return "object";
  return obj.tag ?? symbols?.get(obj.symbol_type)?.display_name ?? obj.symbol_type;
}

/** Busbar-like equipment merges all its ports into a single electrical node. */
export function mergesPorts(symbolType: string): boolean {
  return BUS_TYPES.has(symbolType);
}

export function portKey(objectId: string, port: string, symbolType: string): string {
  return `${objectId}::${mergesPorts(symbolType) ? "*" : port}`;
}

/** Adjacency + port usage index for a revision graph. */
export function buildGraph(objects: ConnObject[], connections: ConnEdge[]): ConnGraph {
  const objectMap = new Map(objects.map((o) => [o.id, o]));
  const adjacency = new Map<string, Set<string>>();
  const edgesByObject = new Map<string, ConnEdge[]>();
  const portUsage = new Map<string, ConnEdge[]>();

  for (const o of objects) {
    adjacency.set(o.id, new Set());
    edgesByObject.set(o.id, []);
  }

  const edges = connections.filter(
    (c) => objectMap.has(c.from_object_id) && objectMap.has(c.to_object_id),
  );

  for (const e of edges) {
    edgesByObject.get(e.from_object_id)!.push(e);
    edgesByObject.get(e.to_object_id)!.push(e);

    if (!NON_POWER_CONNECTIONS.has(e.connection_type)) {
      adjacency.get(e.from_object_id)!.add(e.to_object_id);
      adjacency.get(e.to_object_id)!.add(e.from_object_id);
    }

    for (const [id, port] of [
      [e.from_object_id, e.from_port],
      [e.to_object_id, e.to_port],
    ] as const) {
      const key = portKey(id, port, objectMap.get(id)!.symbol_type);
      const list = portUsage.get(key) ?? [];
      list.push(e);
      portUsage.set(key, list);
    }
  }

  return { objects: objectMap, edges, adjacency, edgesByObject, portUsage };
}

/** Object ids reachable from `startId` over power connections, stopping at `stopAt`. */
export function reachableFrom(
  graph: ConnGraph,
  startId: string,
  stopAt: (id: string) => boolean = () => false,
): Set<string> {
  const seen = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current !== startId && stopAt(current)) continue;
    for (const next of graph.adjacency.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/** Declared voltage of an object; transformers expose two sides. */
export function voltagesOf(obj: ConnObject | undefined): number[] {
  if (!obj) return [];
  const out: number[] = [];
  for (const key of ["voltage_kv", "hv_kv", "lv_kv", "rated_voltage_kv"]) {
    const v = prop(obj, key);
    if (v !== null && v > 0) out.push(v);
  }
  return [...new Set(out)];
}

function withinTolerance(a: number, b: number): boolean {
  const base = Math.max(Math.abs(a), Math.abs(b));
  if (base === 0) return true;
  return Math.abs(a - b) / base <= VOLTAGE_TOLERANCE;
}

function fmtKv(v: number): string {
  return `${Number(v.toFixed(3))} kV`;
}

export type ValidateOptions = {
  /** Voltage levels declared on project_sld_config (P-054), in kV. */
  projectVoltagesKv?: number[];
};

/**
 * Runs every connectivity validator over a graph.
 * Deterministic: issues are emitted in a stable code → object order.
 */
export function validateConnectivity(
  graph: ConnGraph,
  symbolTypes: ConnSymbolMeta[],
  options: ValidateOptions = {},
): ValidationIssue[] {
  const symbols = new Map(symbolTypes.map((s) => [s.type_key, s]));
  const objects = [...graph.objects.values()];
  const issues: ValidationIssue[] = [];

  // --- disconnected_equipment -------------------------------------------
  for (const o of objects) {
    if (NON_TOPOLOGY_CATEGORIES.has(categoryOf(o, symbols))) continue;
    const incident = (graph.edgesByObject.get(o.id) ?? []).filter(
      (e) => !NON_POWER_CONNECTIONS.has(e.connection_type),
    );
    if (incident.length === 0) {
      issues.push({
        severity: "warning",
        code: "disconnected_equipment",
        objectIds: [o.id],
        message: `${labelOf(o, symbols)} has no electrical connections.`,
      });
    }
  }

  // --- open_circuit ------------------------------------------------------
  const isSink = (id: string) => {
    const obj = graph.objects.get(id);
    return Boolean(
      obj && (SINK_TYPES.has(obj.symbol_type) || categoryOf(obj, symbols) === "grid"),
    );
  };
  for (const o of objects) {
    const isSource = SOURCE_TYPES.has(o.symbol_type) || categoryOf(o, symbols) === "generation";
    if (!isSource) continue;
    const reached = reachableFrom(graph, o.id);
    const terminates = [...reached].some((id) => id !== o.id && isSink(id));
    if (!terminates) {
      issues.push({
        severity: "error",
        code: "open_circuit",
        objectIds: [o.id],
        message: `${labelOf(o, symbols)} never reaches a grid connection point.`,
      });
    }
  }

  // --- unterminated_port -------------------------------------------------
  for (const o of objects) {
    const ports = symbols.get(o.symbol_type)?.ports ?? [];
    for (const p of ports) {
      if (!p.required) continue;
      const used = graph.portUsage.get(portKey(o.id, p.key, o.symbol_type)) ?? [];
      if (used.length === 0) {
        issues.push({
          severity: "warning",
          code: "unterminated_port",
          objectIds: [o.id],
          message: `${labelOf(o, symbols)} has an unterminated required port "${p.key}".`,
        });
      }
    }
  }

  // --- duplicate_tag (P-141 result) --------------------------------------
  for (const group of findDuplicateTags(
    objects.map((o) => ({ id: o.id, symbol_type: o.symbol_type, tag: o.tag, x: 0, y: 0 })),
  )) {
    issues.push({
      severity: "error",
      code: "duplicate_tag",
      objectIds: group.ids,
      message: `Tag ${group.tag} is used by ${group.ids.length} objects.`,
    });
  }

  // --- voltage_mismatch / unknown_voltage_level --------------------------
  const projectVoltages = (options.projectVoltagesKv ?? []).filter((v) => v > 0);
  if (projectVoltages.length > 0) {
    for (const o of objects) {
      for (const v of voltagesOf(o)) {
        if (!projectVoltages.some((pv) => withinTolerance(pv, v))) {
          issues.push({
            severity: "warning",
            code: "unknown_voltage_level",
            objectIds: [o.id],
            message: `${labelOf(o, symbols)} declares ${fmtKv(v)}, which is not a project voltage level.`,
          });
        }
      }
    }
  }

  for (const e of graph.edges) {
    if (NON_POWER_CONNECTIONS.has(e.connection_type)) continue;
    const a = graph.objects.get(e.from_object_id);
    const b = graph.objects.get(e.to_object_id);
    if (TRANSFORMER_TYPES.has(a?.symbol_type ?? "") || TRANSFORMER_TYPES.has(b?.symbol_type ?? "")) {
      continue; // a transformer legitimately sits between two voltage levels
    }
    const va = voltagesOf(a);
    const vb = voltagesOf(b);
    if (va.length === 0 || vb.length === 0) continue;
    const compatible = va.some((x) => vb.some((y) => withinTolerance(x, y)));
    if (!compatible) {
      issues.push({
        severity: "error",
        code: "voltage_mismatch",
        objectIds: [a!.id, b!.id],
        connectionIds: [e.id],
        message: `${labelOf(a, symbols)} (${fmtKv(va[0])}) is connected directly to ${labelOf(
          b,
          symbols,
        )} (${fmtKv(vb[0])}) with no transformer between them.`,
      });
    }
  }

  // --- rating_exceeded ---------------------------------------------------
  for (const e of graph.edges) {
    if (NON_POWER_CONNECTIONS.has(e.connection_type)) continue;
    const current = edgeProp(e, "current_a");
    const ampacity = edgeProp(e, "ampacity_a");
    if (current !== null && ampacity !== null && ampacity > 0 && current > ampacity) {
      issues.push({
        severity: "error",
        code: "rating_exceeded",
        objectIds: [e.from_object_id, e.to_object_id],
        connectionIds: [e.id],
        message: `Cable ${e.cable_number ?? e.id.slice(0, 8)} carries ${current} A above its ${ampacity} A ampacity.`,
      });
    }
  }

  for (const t of objects) {
    if (!TRANSFORMER_TYPES.has(t.symbol_type)) continue;
    const kva = prop(t, "rating_kva") ?? prop(t, "rating_mva") ?? null;
    const ratingKva = prop(t, "rating_kva") ?? (prop(t, "rating_mva") ?? 0) * 1000;
    if (!kva || ratingKva <= 0) continue;
    const downstream = reachableFrom(graph, t.id, (id) => {
      const obj = graph.objects.get(id);
      return Boolean(
        obj && (TRANSFORMER_TYPES.has(obj.symbol_type) || SINK_TYPES.has(obj.symbol_type)),
      );
    });
    let demandKva = 0;
    const contributors: string[] = [];
    for (const id of downstream) {
      const obj = graph.objects.get(id);
      if (!obj || !INVERTER_TYPES.has(obj.symbol_type)) continue;
      const kw = prop(obj, "rating_kw");
      if (kw === null || kw <= 0) continue;
      const pf = prop(obj, "power_factor") ?? 1;
      demandKva += kw / (pf > 0 ? pf : 1);
      contributors.push(id);
    }
    if (contributors.length > 0 && demandKva > ratingKva) {
      issues.push({
        severity: "error",
        code: "rating_exceeded",
        objectIds: [t.id, ...contributors],
        message: `${labelOf(t, symbols)} is rated ${ratingKva} kVA but carries ${Number(
          demandKva.toFixed(1),
        )} kVA of downstream conversion capacity.`,
      });
    }
  }

  // --- multiple_sources_one_input ----------------------------------------
  for (const [key, list] of graph.portUsage) {
    if (list.length < 2) continue;
    const [objectId, port] = key.split("::");
    const obj = graph.objects.get(objectId);
    if (!obj || mergesPorts(obj.symbol_type)) continue;
    const supplies = list.filter(
      (e) => !NON_POWER_CONNECTIONS.has(e.connection_type) && e.to_object_id === objectId,
    );
    if (supplies.length > 1) {
      issues.push({
        severity: "error",
        code: "multiple_sources_one_input",
        objectIds: [objectId, ...supplies.map((e) => e.from_object_id)],
        connectionIds: supplies.map((e) => e.id),
        message: `${labelOf(obj, symbols)} port "${port}" is fed by ${supplies.length} supplies.`,
      });
    }
  }

  return sortIssues(issues);
}

const SEVERITY_ORDER: Record<IssueSeverity, number> = { error: 0, warning: 1 };

export function sortIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return [...issues].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.code.localeCompare(b.code) ||
      (a.objectIds[0] ?? "").localeCompare(b.objectIds[0] ?? ""),
  );
}

export function summarizeIssues(
  issues: ValidationIssue[],
): Pick<ValidationSnapshot, "issue_count" | "error_count" | "warning_count"> {
  return {
    issue_count: issues.length,
    error_count: issues.filter((i) => i.severity === "error").length,
    warning_count: issues.filter((i) => i.severity === "warning").length,
  };
}

/** Ids carrying at least one issue of each severity — drives the canvas halos. */
export function issueSeverityByObject(
  issues: ValidationIssue[],
): Map<string, IssueSeverity> {
  const out = new Map<string, IssueSeverity>();
  for (const issue of issues) {
    for (const id of issue.objectIds) {
      if (issue.severity === "error" || !out.has(id)) out.set(id, issue.severity);
    }
  }
  return out;
}

/** Convenience wrapper used by both the server fn and the debounced client run. */
export function runValidation(
  objects: ConnObject[],
  connections: ConnEdge[],
  symbolTypes: ConnSymbolMeta[],
  options: ValidateOptions = {},
): ValidationIssue[] {
  return validateConnectivity(buildGraph(objects, connections), symbolTypes, options);
}
