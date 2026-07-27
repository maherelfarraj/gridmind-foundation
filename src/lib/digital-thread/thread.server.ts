// P-188 — Digital-thread read model: graph + labels + impact assessments.
// Server-only helpers; the thin server functions live in thread.functions.ts.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export interface GraphNode {
  entity_type: string;
  entity_id: string;
  depth: number;
  label?: string;
  href?: string | null;
}

export interface GraphEdge {
  id: string;
  source_type: string;
  source_id: string;
  link_type: string;
  target_type: string;
  target_id: string;
  metadata: Record<string, JsonValue> | null;
}

export interface EntityGraph {
  root: { entity_type: string; entity_id: string };
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ImpactRow {
  id: string;
  event_type: string;
  source_type: string;
  source_id: string;
  title: string;
  summary: string | null;
  severity: string;
  status: string;
  impacts: Array<Record<string, JsonValue>>;
  project_id: string | null;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
}

/** entity_type → table + display column, used for node labels and deep links. */
const LABELS: Record<string, { table: string; col: string; route?: (id: string) => string }> = {
  project: { table: "projects", col: "name", route: (id) => `/projects/${id}` },
  layout: { table: "pv_layouts", col: "name" },
  simulation: { table: "pv_simulations", col: "name" },
  sld: { table: "sld_drawings", col: "drawing_number", route: (id) => `/engineering/sld/${id}` },
  bom: { table: "bom_snapshots", col: "id" },
  rfq: { table: "rfqs", col: "rfq_number" },
  po: { table: "purchase_orders", col: "po_number" },
  vendor: { table: "vendors", col: "name" },
  drawing: { table: "drawing_register", col: "drawing_number" },
  equipment: { table: "equipment_registry", col: "tag" },
  work_order: { table: "work_orders", col: "wo_number" },
  warranty_claim: { table: "warranty_claims", col: "claim_number" },
  spare_part: { table: "spare_parts", col: "part_number" },
  scada_alarm: { table: "scada_alarms", col: "message" },
  cwp: { table: "construction_work_packages", col: "package_number" },
  document: { table: "documents", col: "title" },
  contract: { table: "contracts", col: "contract_number" },
  change_request: { table: "change_orders", col: "co_number" },
  impact_assessment: { table: "impact_assessments", col: "title" },
};

async function safe<T>(fn: () => Promise<T | null>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

/** Attach human labels to graph nodes. Unknown or deleted rows keep a short id. */
export async function labelNodes(context: AuthContext, nodes: GraphNode[]): Promise<GraphNode[]> {
  const byType = new Map<string, string[]>();
  for (const n of nodes) {
    if (!LABELS[n.entity_type]) continue;
    const list = byType.get(n.entity_type) ?? [];
    list.push(n.entity_id);
    byType.set(n.entity_type, list);
  }

  const labels = new Map<string, string>();
  await Promise.all(
    Array.from(byType.entries()).map(async ([type, ids]) => {
      const cfg = LABELS[type];
      await safe(async () => {
        const { data } = await (context.supabase as any)
          .from(cfg.table)
          .select(`id, ${cfg.col}`)
          .in("id", ids);
        for (const row of (data ?? []) as Array<Record<string, unknown>>) {
          const value = row[cfg.col];
          if (typeof value === "string" && value.length > 0) {
            labels.set(`${type}:${row.id as string}`, value);
          }
        }
        return true;
      });
    }),
  );

  return nodes.map((n) => ({
    ...n,
    label: labels.get(`${n.entity_type}:${n.entity_id}`) ?? `${n.entity_id.slice(0, 8)}…`,
    href: LABELS[n.entity_type]?.route?.(n.entity_id) ?? null,
  }));
}

export async function loadEntityGraph(
  context: AuthContext,
  entityType: string,
  entityId: string,
  depth: number,
): Promise<EntityGraph> {
  const { data, error } = await context.supabase.rpc("get_entity_graph", {
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_depth: depth,
  });
  if (error) throw error;
  const raw = (data ?? {}) as unknown as EntityGraph;
  const nodes = await labelNodes(context, raw.nodes ?? []);
  return {
    root: raw.root ?? { entity_type: entityType, entity_id: entityId },
    nodes,
    edges: raw.edges ?? [],
  };
}

export async function loadImpactsForEntity(
  context: AuthContext,
  entityType: string,
  entityId: string,
): Promise<ImpactRow[]> {
  const direct = await context.supabase
    .from("impact_assessments")
    .select("*")
    .eq("source_type", entityType)
    .eq("source_id", entityId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (direct.error) throw direct.error;

  // Assessments that name this entity as an affected target.
  const linked = await safe(async () => {
    const { data } = await context.supabase
      .from("entity_links")
      .select("source_id")
      .eq("source_type", "impact_assessment")
      .eq("target_type", entityType)
      .eq("target_id", entityId)
      .limit(100);
    return ((data ?? []) as Array<{ source_id: string }>).map((r) => r.source_id);
  });

  const rows = (direct.data ?? []) as unknown as ImpactRow[];
  const ids = (linked ?? []).filter((id) => !rows.some((r) => r.id === id));
  if (ids.length > 0) {
    const extra = await context.supabase
      .from("impact_assessments")
      .select("*")
      .in("id", ids)
      .order("created_at", { ascending: false });
    if (!extra.error) rows.push(...((extra.data ?? []) as unknown as ImpactRow[]));
  }
  return rows;
}

export async function loadImpactById(context: AuthContext, id: string): Promise<ImpactRow | null> {
  const { data, error } = await context.supabase
    .from("impact_assessments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as ImpactRow) ?? null;
}

/** Acknowledge / resolve / dismiss. The 0077 trigger writes the audit row. */
export async function setImpactStatus(
  context: AuthContext,
  id: string,
  status: "acknowledged" | "resolved" | "dismissed",
): Promise<{ id: string; status: string }> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status };
  if (status === "acknowledged") {
    patch.acknowledged_by = context.user!.id;
    patch.acknowledged_at = now;
  } else {
    patch.resolved_by = context.user!.id;
    patch.resolved_at = now;
  }
  const { data, error } = await context.supabase
    .from("impact_assessments")
    .update(patch as never)
    .eq("id", id)
    .select("id, status")
    .single();
  if (error) throw error;
  return data as { id: string; status: string };
}

export async function loadOrphanLinks(context: AuthContext) {
  const { data, error } = await context.supabase.rpc("entity_link_orphans");
  if (error) throw error;
  return (data ?? []) as Array<{
    link_id: string;
    company_id: string;
    endpoint: string;
    entity_type: string;
    entity_id: string;
  }>;
}
