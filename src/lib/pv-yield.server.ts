// P-156 — Server-only helpers for PV yield simulations (kept out of the
// serverfn-split module so runtime siblings survive the transform).
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { httpError } from "@/lib/pv-layout.server";
import { YIELD_DISCLAIMER } from "@/lib/pv/yield-v2";

export const SIMULATION_DISCLAIMER = YIELD_DISCLAIMER;

export interface SimulationRow {
  id: string;
  company_id: string;
  project_id: string;
  status: string;
  is_baseline: boolean;
  approval_instance_id: string | null;
  name: string;
}

export async function loadSimulation(
  context: AuthContext,
  simulationId: string,
): Promise<SimulationRow> {
  const { data, error } = await context.supabase
    .from("pv_simulations")
    .select("id, company_id, project_id, status, is_baseline, approval_instance_id, name")
    .eq("id", simulationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "not_found", "Simulation not found.");
  return data as unknown as SimulationRow;
}

/** Reads the latest approval instance status for a simulation. */
export async function latestApprovalStatus(
  context: AuthContext,
  simulationId: string,
): Promise<string | null> {
  const { data, error } = await context.supabase
    .from("approval_instances")
    .select("status, requested_at")
    .eq("entity_type", "pv_simulation")
    .eq("entity_id", simulationId)
    .order("requested_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = (data ?? [])[0] as { status?: string } | undefined;
  return row?.status ?? null;
}

export async function auditPvSimulation(
  context: AuthContext,
  action: string,
  simulationId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await context.supabase.rpc("write_audit_log", {
    p_action: action,
    p_entity: "pv_simulations",
    p_entity_id: simulationId,
    p_metadata: metadata as never,
  });
}
