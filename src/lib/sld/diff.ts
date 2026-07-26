// P-145 — Pure revision diff + graph hashing for SLD drawings.
// No React, no Supabase: unit-testable and shared by client and server.

export type DiffObject = {
  id: string;
  symbol_type: string;
  tag: string | null;
  x: number;
  y: number;
  rotation: number;
  mirrored: boolean;
  layer_id: string;
  properties: Record<string, any>;
};

export type DiffConnection = {
  id: string;
  from_object_id: string;
  from_port: string;
  to_object_id: string;
  to_port: string;
  connection_type: string;
  cable_number: string | null;
  properties?: Record<string, any>;
};

/**
 * Lineage stamp written when a revision is deep-copied. It lets a diff match
 * "the same" object across revisions even though every row has a fresh uuid.
 */
export const LINEAGE_KEY = "__lineage_id";

/** Internal props that must never surface as a user-visible change. */
const IGNORED_PROPS = new Set([LINEAGE_KEY, "__removed", "__group_id"]);

export type Point = { x: number; y: number };

export type MovedEntry = { id: string; key: string; tag: string | null; from: Point; to: Point };
export type PropertyChange = {
  id: string;
  key: string;
  tag: string | null;
  property: string;
  from: any;
  to: any;
};
export type TagChange = { id: string; key: string; from: string | null; to: string | null };
export type ConnectionChange = {
  id: string;
  kind: "added" | "removed" | "rerouted" | "retyped" | "renumbered";
  cable_number: string | null;
  from_tag: string | null;
  to_tag: string | null;
  detail?: string;
};

export type GraphDiff = {
  added: DiffObject[];
  removed: DiffObject[];
  moved: MovedEntry[];
  propertyChanged: PropertyChange[];
  tagChanged: TagChange[];
  connectionChanged: ConnectionChange[];
};

/** Stable identity across revisions: lineage stamp → row id → tag. */
export function identityKey(obj: DiffObject): string {
  const lineage = obj.properties?.[LINEAGE_KEY];
  if (typeof lineage === "string" && lineage.length > 0) return `I:${lineage}`;
  if (obj.id) return `I:${obj.id}`;
  return `T:${obj.tag ?? ""}`;
}

/**
 * Hash identity: deliberately free of row ids and lineage stamps so a no-op
 * deep copy hashes identically to its source.
 */
function contentKey(obj: DiffObject): string {
  return obj.tag ? `T:${obj.tag}` : `C:${obj.symbol_type}@${roundMm(obj.x)},${roundMm(obj.y)}`;
}

export function roundMm(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function samePoint(a: DiffObject, b: DiffObject): boolean {
  return roundMm(a.x) === roundMm(b.x) && roundMm(a.y) === roundMm(b.y);
}

function comparableProps(props: Record<string, unknown> | null | undefined) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props ?? {})) {
    if (IGNORED_PROPS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

function tagOf(objects: Map<string, DiffObject>, id: string): string | null {
  return objects.get(id)?.tag ?? null;
}

/** Endpoint-based identity so connections match across revisions too. */
function connKey(c: DiffConnection, byId: Map<string, DiffObject>): string {
  const from = byId.get(c.from_object_id);
  const to = byId.get(c.to_object_id);
  const a = from ? identityKey(from) : c.from_object_id;
  const b = to ? identityKey(to) : c.to_object_id;
  return `${a}|${c.from_port}>${b}|${c.to_port}`;
}

/**
 * Diff two revision graphs. `A` is the older/base revision, `B` the newer one.
 * Everything is keyed by stable object identity, not row id.
 */
export function diffGraphs(
  objectsA: DiffObject[],
  connsA: DiffConnection[],
  objectsB: DiffObject[],
  connsB: DiffConnection[],
): GraphDiff {
  const mapA = new Map<string, DiffObject>();
  const mapB = new Map<string, DiffObject>();
  for (const o of objectsA) mapA.set(identityKey(o), o);
  for (const o of objectsB) mapB.set(identityKey(o), o);

  const diff: GraphDiff = {
    added: [],
    removed: [],
    moved: [],
    propertyChanged: [],
    tagChanged: [],
    connectionChanged: [],
  };

  for (const [key, b] of mapB) {
    const a = mapA.get(key);
    if (!a) {
      diff.added.push(b);
      continue;
    }
    if (!samePoint(a, b)) {
      diff.moved.push({
        id: b.id,
        key,
        tag: b.tag ?? a.tag,
        from: { x: roundMm(a.x), y: roundMm(a.y) },
        to: { x: roundMm(b.x), y: roundMm(b.y) },
      });
    }
    if ((a.tag ?? null) !== (b.tag ?? null)) {
      diff.tagChanged.push({ id: b.id, key, from: a.tag ?? null, to: b.tag ?? null });
    }
    if (a.rotation !== b.rotation) {
      diff.propertyChanged.push({
        id: b.id,
        key,
        tag: b.tag,
        property: "rotation",
        from: a.rotation,
        to: b.rotation,
      });
    }
    if (Boolean(a.mirrored) !== Boolean(b.mirrored)) {
      diff.propertyChanged.push({
        id: b.id,
        key,
        tag: b.tag,
        property: "mirrored",
        from: Boolean(a.mirrored),
        to: Boolean(b.mirrored),
      });
    }
    if (a.symbol_type !== b.symbol_type) {
      diff.propertyChanged.push({
        id: b.id,
        key,
        tag: b.tag,
        property: "symbol_type",
        from: a.symbol_type,
        to: b.symbol_type,
      });
    }
    if (a.layer_id !== b.layer_id) {
      diff.propertyChanged.push({
        id: b.id,
        key,
        tag: b.tag,
        property: "layer",
        from: a.layer_id,
        to: b.layer_id,
      });
    }
    const pa = comparableProps(a.properties);
    const pb = comparableProps(b.properties);
    const keys = Array.from(new Set([...Object.keys(pa), ...Object.keys(pb)])).sort();
    for (const p of keys) {
      const from = pa[p] ?? null;
      const to = pb[p] ?? null;
      if (JSON.stringify(from) !== JSON.stringify(to)) {
        diff.propertyChanged.push({ id: b.id, key, tag: b.tag, property: p, from, to });
      }
    }
  }

  for (const [key, a] of mapA) {
    if (!mapB.has(key)) diff.removed.push(a);
  }

  // --- connections ---------------------------------------------------------
  const byIdA = new Map(objectsA.map((o) => [o.id, o]));
  const byIdB = new Map(objectsB.map((o) => [o.id, o]));
  const connMapA = new Map<string, DiffConnection>();
  const connMapB = new Map<string, DiffConnection>();
  for (const c of connsA) connMapA.set(connKey(c, byIdA), c);
  for (const c of connsB) connMapB.set(connKey(c, byIdB), c);

  for (const [key, b] of connMapB) {
    const a = connMapA.get(key);
    const endpoints = {
      from_tag: tagOf(byIdB, b.from_object_id),
      to_tag: tagOf(byIdB, b.to_object_id),
    };
    if (!a) {
      diff.connectionChanged.push({
        id: b.id,
        kind: "added",
        cable_number: b.cable_number ?? null,
        ...endpoints,
      });
      continue;
    }
    if (a.connection_type !== b.connection_type) {
      diff.connectionChanged.push({
        id: b.id,
        kind: "retyped",
        cable_number: b.cable_number ?? null,
        ...endpoints,
        detail: `${a.connection_type} → ${b.connection_type}`,
      });
    }
    if ((a.cable_number ?? null) !== (b.cable_number ?? null)) {
      diff.connectionChanged.push({
        id: b.id,
        kind: "renumbered",
        cable_number: b.cable_number ?? null,
        ...endpoints,
        detail: `${a.cable_number ?? "—"} → ${b.cable_number ?? "—"}`,
      });
    }
    const pa = JSON.stringify(comparableProps(a.properties));
    const pb = JSON.stringify(comparableProps(b.properties));
    if (pa !== pb) {
      diff.connectionChanged.push({
        id: b.id,
        kind: "rerouted",
        cable_number: b.cable_number ?? null,
        ...endpoints,
        detail: "route or cable data changed",
      });
    }
  }
  for (const [key, a] of connMapA) {
    if (connMapB.has(key)) continue;
    diff.connectionChanged.push({
      id: a.id,
      kind: "removed",
      cable_number: a.cable_number ?? null,
      from_tag: tagOf(byIdA, a.from_object_id),
      to_tag: tagOf(byIdA, a.to_object_id),
    });
  }

  return diff;
}

export function diffTotals(diff: GraphDiff) {
  return {
    added: diff.added.length,
    removed: diff.removed.length,
    moved: diff.moved.length,
    property_changed: diff.propertyChanged.length,
    tag_changed: diff.tagChanged.length,
    connection_changed: diff.connectionChanged.length,
  };
}

export function isEmptyDiff(diff: GraphDiff): boolean {
  return Object.values(diffTotals(diff)).every((n) => n === 0);
}

// --- hashing ---------------------------------------------------------------

function sortedProps(props: Record<string, unknown> | null | undefined): [string, unknown][] {
  return Object.entries(comparableProps(props)).sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Canonical, row-id-free representation of a graph: sorted keys, rounded
 * coordinates, deterministic ordering. Two structurally identical graphs
 * normalize to byte-identical JSON.
 */
export function normalizeGraph(objects: DiffObject[], connections: DiffConnection[]): string {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const objectRows = objects
    .map((o) => ({
      k: contentKey(o),
      t: o.symbol_type,
      g: o.tag ?? null,
      x: roundMm(o.x),
      y: roundMm(o.y),
      r: Number(o.rotation) || 0,
      m: Boolean(o.mirrored),
      l: o.layer_id,
      p: sortedProps(o.properties),
    }))
    .sort((a, b) => a.k.localeCompare(b.k));

  const connectionRows = connections
    .map((c) => ({
      k: connKey(c, byId),
      t: c.connection_type,
      n: c.cable_number ?? null,
      p: sortedProps(c.properties),
    }))
    .sort((a, b) => a.k.localeCompare(b.k));

  return JSON.stringify({ objects: objectRows, connections: connectionRows });
}

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fnv1a-${h.toString(16).padStart(8, "0")}`;
}

/** sha-256 of the normalized graph; deterministic across client and server. */
export async function graphHash(
  objects: DiffObject[],
  connections: DiffConnection[],
): Promise<string> {
  const canonical = normalizeGraph(objects, connections);
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!subtle) return fnv1a(canonical);
  const bytes = new TextEncoder().encode(canonical);
  const digest = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
