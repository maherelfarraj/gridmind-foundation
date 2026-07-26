// P-112 — Server-only helpers for the approval inbox.
// Kept out of *.functions.ts so tss-serverfn-split cannot drop them.
import type { Json } from "@/integrations/supabase/types";
import type { AuthContext } from "@/integrations/supabase/auth-attacher";

export interface InboxRow {
  approval_id: string;
  instance_id: string;
  approver_id: string;
  approver_name: string | null;
  approval_status: "pending" | "approved" | "rejected" | "skipped";
  approval_comment: string | null;
  approval_decided_at: string | null;
  step_order: number;
  total_steps: number;
  step_role: string | null;
  step_due_at: string | null;
  entity_type: string;
  entity_id: string;
  rule_key: string | null;
  amount: number | null;
  currency: string | null;
  metadata: Json;
  requester_id: string | null;
  requester_name: string | null;
  instance_status: string;
  sla_due_at: string | null;
  requested_at: string;
  escalated_at: string | null;
  title: string;
}

export interface ApprovalStepGroup {
  step_order: number;
  approvals: Array<{
    id: string;
    approver_id: string;
    approver_name: string | null;
    status: "pending" | "approved" | "rejected" | "skipped";
    comment: string | null;
    decided_at: string | null;
    due_at: string | null;
  }>;
}

export interface InstanceDetail {
  id: string;
  entity_type: string;
  entity_id: string;
  rule_key: string | null;
  amount: number | null;
  currency: string | null;
  metadata: Json;
  status: string;
  requested_at: string;
  requester_id: string | null;
  requester_name: string | null;
  sla_due_at: string | null;
  completed_at: string | null;
  current_step: number;
  escalated_at: string | null;
  title: string;
  steps: ApprovalStepGroup[];
  audit: Array<{
    id: string;
    action: string;
    created_at: string;
    actor_id: string | null;
    actor_name: string | null;
    metadata: Json;
  }>;
}

export async function assertCompanyAdmin(context: AuthContext): Promise<boolean> {
  const { data, error } = await context.supabase.rpc("has_company_role", {
    p_role: "company_admin",
  });
  if (error) throw error;
  return data === true;
}

export function asObject(json: Json | null | undefined): { [k: string]: Json | undefined } {
  return json && typeof json === "object" && !Array.isArray(json)
    ? (json as { [k: string]: Json | undefined })
    : {};
}

export function pickString(json: Json | null | undefined, key: string): string | null {
  const v = asObject(json)[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function deriveTitle(
  metadata: Json | null | undefined,
  entityType: string,
  entityId: string,
): string {
  for (const k of ["title", "name", "reference", "po_number", "contract_number"]) {
    const v = pickString(metadata, k);
    if (v && v.trim().length > 0) return v;
  }
  return `${entityType} ${entityId.slice(0, 8)}`;
}

export async function nameMap(
  context: AuthContext,
  ids: string[],
): Promise<Map<string, string | null>> {
  const clean = Array.from(new Set(ids.filter(Boolean)));
  if (clean.length === 0) return new Map();
  const { data, error } = await context.supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", clean as string[]);
  if (error) throw error;
  const map = new Map<string, string | null>();
  for (const p of (data ?? []) as Array<{
    id: string;
    full_name: string | null;
    email: string | null;
  }>) {
    map.set(p.id, p.full_name ?? p.email ?? null);
  }
  return map;
}

export async function stepCountMap(
  context: AuthContext,
  instanceIds: string[],
): Promise<Map<string, number>> {
  const clean = Array.from(new Set(instanceIds));
  if (clean.length === 0) return new Map();
  const { data, error } = await context.supabase
    .from("approvals")
    .select("instance_id, step_order")
    .in("instance_id", clean as string[]);
  if (error) throw error;
  const totals = new Map<string, number>();
  for (const r of (data ?? []) as Array<{
    instance_id: string;
    step_order: number;
  }>) {
    const prev = totals.get(r.instance_id) ?? 0;
    if (r.step_order > prev) totals.set(r.instance_id, r.step_order);
  }
  return totals;
}
