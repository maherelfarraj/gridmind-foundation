// P-192 — Pure graph layout + orphan mapping for the digital thread.
// Extracted from ThreadGraph so the traversal is unit-testable without React.
import type { EntityGraph, GraphEdge, GraphNode } from "@/lib/digital-thread/thread.server";

export const COL_W = 240;
export const ROW_H = 56;
export const NODE_W = 196;
export const NODE_H = 40;
export const PAD = 24;

export interface PositionedNode extends GraphNode {
  x: number;
  y: number;
}

export interface GraphLayout {
  /** Distinct depth columns, ascending (upstream negative → downstream positive). */
  layers: Array<{ depth: number; nodes: GraphNode[] }>;
  placed: PositionedNode[];
  index: Map<string, PositionedNode>;
  width: number;
  height: number;
}

export function graphKey(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}

/**
 * Cycle-safe depth walk. Edges point source → target: following an edge
 * forward is downstream (+1), following it backward is upstream (-1).
 * Every node is visited at most once, so cycles terminate.
 */
export function computeDepths(
  nodes: GraphNode[],
  edges: GraphEdge[],
  root: { entity_type: string; entity_id: string } | null,
): Map<string, number> {
  const depths = new Map<string, number>();
  const known = new Set(nodes.map((n) => graphKey(n.entity_type, n.entity_id)));
  if (!root) {
    for (const n of nodes) depths.set(graphKey(n.entity_type, n.entity_id), n.depth ?? 0);
    return depths;
  }

  const forward = new Map<string, string[]>();
  const backward = new Map<string, string[]>();
  for (const e of edges) {
    const s = graphKey(e.source_type, e.source_id);
    const t = graphKey(e.target_type, e.target_id);
    if (!known.has(s) || !known.has(t)) continue;
    forward.set(s, [...(forward.get(s) ?? []), t]);
    backward.set(t, [...(backward.get(t) ?? []), s]);
  }

  const rootKey = graphKey(root.entity_type, root.entity_id);
  const queue: Array<{ key: string; depth: number }> = [{ key: rootKey, depth: 0 }];
  depths.set(rootKey, 0);
  while (queue.length > 0) {
    const { key, depth } = queue.shift()!;
    for (const next of forward.get(key) ?? []) {
      if (depths.has(next)) continue; // cycle / already placed
      depths.set(next, depth + 1);
      queue.push({ key: next, depth: depth + 1 });
    }
    for (const prev of backward.get(key) ?? []) {
      if (depths.has(prev)) continue;
      depths.set(prev, depth - 1);
      queue.push({ key: prev, depth: depth - 1 });
    }
  }

  // Nodes unreachable from the root keep whatever depth the RPC reported.
  for (const n of nodes) {
    const key = graphKey(n.entity_type, n.entity_id);
    if (!depths.has(key)) depths.set(key, n.depth ?? 0);
  }
  return depths;
}

/** Deduped, cycle-safe layer layout for the SVG viewer. */
export function buildGraphLayers(
  nodes: GraphNode[],
  edges: GraphEdge[],
  root: { entity_type: string; entity_id: string } | null = null,
): GraphLayout {
  const unique = new Map<string, GraphNode>();
  for (const n of nodes) {
    const key = graphKey(n.entity_type, n.entity_id);
    if (!unique.has(key)) unique.set(key, n);
  }
  const list = Array.from(unique.values());
  const depths = computeDepths(list, edges, root);

  const byDepth = new Map<number, GraphNode[]>();
  for (const n of list) {
    const depth = depths.get(graphKey(n.entity_type, n.entity_id)) ?? 0;
    byDepth.set(depth, [...(byDepth.get(depth) ?? []), { ...n, depth }]);
  }
  const depthKeys = Array.from(byDepth.keys()).sort((a, b) => a - b);
  const layers = depthKeys.map((depth) => ({
    depth,
    nodes: byDepth
      .get(depth)!
      .slice()
      .sort((a, b) => a.entity_type.localeCompare(b.entity_type)),
  }));

  const tallest = Math.max(1, ...layers.map((l) => l.nodes.length));
  const placed: PositionedNode[] = [];
  layers.forEach((layer, col) => {
    const offset = (tallest - layer.nodes.length) / 2;
    layer.nodes.forEach((n, row) => {
      placed.push({ ...n, x: PAD + col * COL_W, y: PAD + (row + offset) * ROW_H });
    });
  });

  return {
    layers,
    placed,
    index: new Map(placed.map((p) => [graphKey(p.entity_type, p.entity_id), p])),
    width: PAD * 2 + Math.max(1, layers.length) * COL_W,
    height: PAD * 2 + tallest * ROW_H,
  };
}

export function layoutForGraph(graph: EntityGraph): GraphLayout {
  return buildGraphLayers(graph.nodes ?? [], graph.edges ?? [], graph.root ?? null);
}

/* -------------------------------------------------------------------------- */
/* Orphan mapping                                                              */
/* -------------------------------------------------------------------------- */

export interface OrphanRow {
  link_id: string;
  company_id: string;
  endpoint: string;
  entity_type: string;
  entity_id: string;
}

export interface MappedOrphan extends OrphanRow {
  reason: "missing_target";
  label: string;
}

/**
 * Turn `entity_link_orphans` rows into UI-ready findings. Rows whose entity
 * type is outside the known vocabulary are skipped, never reported as orphans.
 */
export function mapOrphanRows(
  rows: OrphanRow[],
  knownTypes: readonly string[],
): { orphans: MappedOrphan[]; skipped: OrphanRow[] } {
  const known = new Set(knownTypes);
  const orphans: MappedOrphan[] = [];
  const skipped: OrphanRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!known.has(row.entity_type)) {
      skipped.push(row);
      continue;
    }
    const key = `${row.link_id}:${row.endpoint}`;
    if (seen.has(key)) continue;
    seen.add(key);
    orphans.push({
      ...row,
      reason: "missing_target",
      label: `${row.endpoint} ${row.entity_type.replaceAll("_", " ")} no longer exists`,
    });
  }
  return { orphans, skipped };
}
