// P-SIDEBAR — helpers for sidebar badge rollups. Kept out of the *.functions
// module so serverfn splitting can't drop them.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";

export async function sidebarCompanyId(context: AuthContext): Promise<string | null> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", context.user!.id)
    .maybeSingle();
  if (error) return null;
  return (data as { company_id: string | null } | null)?.company_id ?? null;
}

export async function criticalAlarmCount(
  context: AuthContext,
  companyId: string,
): Promise<number> {
  const { count, error } = await context.supabase
    .from("scada_alarms")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("severity", "critical")
    .in("status", ["active", "acknowledged"]);
  if (error) return 0;
  return count ?? 0;
}

export async function openCategoryAPunchCount(
  context: AuthContext,
  companyId: string,
): Promise<number> {
  const { count, error } = await context.supabase
    .from("qaqc_punch_items")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("category", "A")
    .eq("status", "open");
  if (error) return 0;
  return count ?? 0;
}
