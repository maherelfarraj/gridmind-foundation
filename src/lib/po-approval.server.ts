// Day 2 — settle purchase orders after a P-111 approval decision.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import {
  PO_APPROVAL_ENTITY,
  poStatusForInstance,
  type InstanceStatus,
} from "@/lib/po-approval.rules";

/**
 * Hook for the P-112 inbox decision path: after `decide_approval` returns,
 * mirror the instance outcome onto any purchase order bound to it. The
 * instance status is read back from the database — the caller's claim is
 * irrelevant.
 */
export async function settlePoAfterDecision(
  context: AuthContext,
  approvalId: string,
): Promise<void> {
  try {
    const { data: approval } = await context.supabase
      .from("approvals")
      .select("instance_id")
      .eq("id", approvalId)
      .maybeSingle();
    const instanceId = (approval as { instance_id: string } | null)?.instance_id;
    if (!instanceId) return;

    const { data: instance } = await context.supabase
      .from("approval_instances")
      .select("id, status, entity_type, entity_id")
      .eq("id", instanceId)
      .maybeSingle();
    const inst = instance as {
      id: string;
      status: InstanceStatus;
      entity_type: string;
      entity_id: string;
    } | null;
    if (!inst || inst.entity_type !== PO_APPROVAL_ENTITY) return;

    const next = poStatusForInstance(inst.status);
    if (!next || next === "pending_approval") return;

    const approved = next === "approved";
    const now = new Date().toISOString();
    await context.supabase
      .from("purchase_orders")
      .update({
        status: next,
        approved_by: approved ? (context.user?.id ?? null) : null,
        approved_at: approved ? now : null,
      } as never)
      .eq("id", inst.entity_id)
      .eq("approval_instance_id", inst.id);

    await context.supabase.rpc("write_audit_log", {
      p_action: approved ? "po.approve" : "po.reject",
      p_entity: "purchase_orders",
      p_entity_id: inst.entity_id,
      p_metadata: { via: "approval_engine", instance_id: inst.id } as never,
    });
  } catch {
    // never fail the approval decision on a downstream settlement error
  }
}
