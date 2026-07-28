// POL-2 — Dashboard data loaders. RLS-scoped: every query runs on the caller's client.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { toActivityItem, type ActivityItem, type RawActivityRow } from "@/lib/dashboard.rules";

export interface DashboardData {
  activeProjects: number;
  openPunch: { total: number; a: number; b: number; c: number };
  inTransit: number;
  openTickets: number;
  activity: ActivityItem[];
}

export async function dashboardCompanyId(context: AuthContext): Promise<string | null> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", context.user!.id)
    .maybeSingle();
  if (error) return null;
  return (data as { company_id: string | null } | null)?.company_id ?? null;
}

async function countActiveProjects(context: AuthContext, companyId: string): Promise<number> {
  const { count, error } = await context.supabase
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "active");
  return error ? 0 : (count ?? 0);
}

async function countOpenPunch(
  context: AuthContext,
  companyId: string,
): Promise<DashboardData["openPunch"]> {
  const { data, error } = await context.supabase
    .from("qaqc_punch_items")
    .select("category")
    .eq("company_id", companyId)
    .in("status", ["open", "ready_for_review"]);
  if (error || !data) return { total: 0, a: 0, b: 0, c: 0 };
  const rows = data as { category: string }[];
  return {
    total: rows.length,
    a: rows.filter((r) => r.category === "A").length,
    b: rows.filter((r) => r.category === "B").length,
    c: rows.filter((r) => r.category === "C").length,
  };
}

async function countInTransit(context: AuthContext, companyId: string): Promise<number> {
  const { count, error } = await context.supabase
    .from("purchase_orders")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .in("status", ["issued", "partially_received"]);
  return error ? 0 : (count ?? 0);
}

async function countOpenTickets(context: AuthContext, companyId: string): Promise<number> {
  const { count, error } = await context.supabase
    .from("service_tickets")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .in("status", ["open", "in_progress", "waiting_client"]);
  return error ? 0 : (count ?? 0);
}

async function recentActivity(context: AuthContext, companyId: string): Promise<ActivityItem[]> {
  const { data, error } = await context.supabase
    .from("audit_logs")
    .select("id, action, entity, entity_id, created_at, actor_id")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error || !data) return [];
  const rows = data as {
    id: string;
    action: string;
    entity: string;
    entity_id: string | null;
    created_at: string;
    actor_id: string | null;
  }[];

  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter((v): v is string => !!v))];
  const names = new Map<string, string>();
  if (actorIds.length) {
    const { data: profiles } = await context.supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", actorIds);
    const list = (profiles ?? []) as {
      id: string;
      full_name: string | null;
      email: string | null;
    }[];
    for (const p of list) names.set(p.id, p.full_name || p.email || "");
  }

  const now = new Date();
  return rows.map((r) =>
    toActivityItem(
      {
        id: r.id,
        action: r.action,
        entity: r.entity,
        entity_id: r.entity_id,
        created_at: r.created_at,
        actor_name: r.actor_id ? (names.get(r.actor_id) ?? null) : null,
      } satisfies RawActivityRow,
      now,
    ),
  );
}

export async function loadDashboard(context: AuthContext): Promise<DashboardData> {
  const companyId = await dashboardCompanyId(context);
  if (!companyId) {
    return {
      activeProjects: 0,
      openPunch: { total: 0, a: 0, b: 0, c: 0 },
      inTransit: 0,
      openTickets: 0,
      activity: [],
    };
  }
  const [activeProjects, openPunch, inTransit, openTickets, activity] = await Promise.all([
    countActiveProjects(context, companyId),
    countOpenPunch(context, companyId),
    countInTransit(context, companyId),
    countOpenTickets(context, companyId),
    recentActivity(context, companyId),
  ]);
  return { activeProjects, openPunch, inTransit, openTickets, activity };
}
