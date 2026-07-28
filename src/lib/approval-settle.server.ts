// P-248 — Class 4+6: the approval engine is the sole writer of approval-decided
// entity states. Every decision path funnels through these two helpers, which
// call the engine-marked SQL settler (`settle_approval_entity`). Guard triggers
// on estimates / esg_reports / proposals / pay_applications reject any other
// writer with 42501.
import type { SupabaseClient } from "@supabase/supabase-js";

type Client = Pick<SupabaseClient, "rpc">;

export interface SettleResult {
  settled: boolean;
  entity_type?: string;
  entity_id?: string;
  instance_status?: string;
  reason?: string;
}

/** Settle the entity bound to the instance behind a single approval row. */
export async function settleEntityForApproval(
  client: Client,
  approvalId: string,
): Promise<SettleResult> {
  try {
    const { data, error } = await client.rpc("settle_approval_entity_for", {
      p_approval_id: approvalId,
    });
    if (error) throw error;
    return (data ?? { settled: false }) as SettleResult;
  } catch {
    // never fail the approval decision on a downstream settlement error
    return { settled: false, reason: "settle_failed" };
  }
}

/** Settle the entity bound to an approval instance (polling / reconcile path). */
export async function settleEntityForInstance(
  client: Client,
  instanceId: string,
): Promise<SettleResult> {
  try {
    const { data, error } = await client.rpc("settle_approval_entity", {
      p_instance_id: instanceId,
    });
    if (error) throw error;
    return (data ?? { settled: false }) as SettleResult;
  } catch {
    return { settled: false, reason: "settle_failed" };
  }
}
