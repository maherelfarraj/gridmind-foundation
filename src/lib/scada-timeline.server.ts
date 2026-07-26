// P-174 — SCADA event timeline: cursor-paginated reads.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";

export interface TimelineEvent {
  id: string;
  project_id: string;
  project_name: string | null;
  asset_node_id: string | null;
  node_name: string | null;
  node_tag: string | null;
  event_type: string;
  severity: string;
  code: string | null;
  message: string;
  source: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_avatar: string | null;
  occurred_at: string;
}

export interface TimelinePage {
  events: TimelineEvent[];
  /** occurred_at of the last row — pass back as `cursor` for the next page. */
  nextCursor: string | null;
  nodes: { id: string; name: string; tag: string | null }[];
}

async function companyId(context: AuthContext): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", context.user!.id)
    .maybeSingle();
  if (error) throw error;
  const cid = (data as { company_id: string | null } | null)?.company_id;
  if (!cid) {
    throw Object.assign(new Error("no_company"), { statusCode: 400 });
  }
  return cid;
}

export async function loadEventTimeline(
  context: AuthContext,
  filters: {
    eventType?: string;
    severity?: string;
    nodeId?: string;
    projectId?: string;
    cursor?: string;
    limit: number;
  },
): Promise<TimelinePage> {
  const cid = await companyId(context);

  let q = context.supabase
    .from("scada_events")
    .select(
      "id, project_id, asset_node_id, event_type, severity, code, message, source, actor_id, occurred_at, project:projects(name), node:asset_nodes(name, tag), actor:profiles(full_name, email, avatar_url)",
    )
    .eq("company_id", cid)
    .order("occurred_at", { ascending: false })
    .limit(filters.limit);
  if (filters.cursor) q = q.lt("occurred_at", filters.cursor);
  if (filters.eventType) q = q.eq("event_type", filters.eventType as never);
  if (filters.severity) q = q.eq("severity", filters.severity as never);
  if (filters.nodeId) q = q.eq("asset_node_id", filters.nodeId);
  if (filters.projectId) q = q.eq("project_id", filters.projectId);

  const { data, error } = await q;
  if (error) throw error;

  const events: TimelineEvent[] = ((data ?? []) as unknown[]).map((raw) => {
    const r = raw as Record<string, unknown> & {
      project?: { name: string } | null;
      node?: { name: string; tag: string | null } | null;
      actor?: { full_name: string | null; email: string | null; avatar_url: string | null } | null;
    };
    return {
      id: r.id as string,
      project_id: r.project_id as string,
      project_name: r.project?.name ?? null,
      asset_node_id: (r.asset_node_id as string | null) ?? null,
      node_name: r.node?.name ?? null,
      node_tag: r.node?.tag ?? null,
      event_type: r.event_type as string,
      severity: r.severity as string,
      code: (r.code as string | null) ?? null,
      message: r.message as string,
      source: (r.source as string | null) ?? null,
      actor_id: (r.actor_id as string | null) ?? null,
      actor_name: r.actor?.full_name ?? r.actor?.email ?? null,
      actor_avatar: r.actor?.avatar_url ?? null,
      occurred_at: r.occurred_at as string,
    };
  });

  const { data: nodeRows } = await context.supabase
    .from("asset_nodes")
    .select("id, name, tag")
    .eq("company_id", cid)
    .order("name", { ascending: true })
    .limit(500);

  return {
    events,
    nextCursor:
      events.length === filters.limit ? (events[events.length - 1]?.occurred_at ?? null) : null,
    nodes: (nodeRows ?? []) as { id: string; name: string; tag: string | null }[],
  };
}
