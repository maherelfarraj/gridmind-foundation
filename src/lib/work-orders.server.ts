// P-106 — Server-only helpers for work orders (kept out of .functions.ts so
// createServerFn transform doesn't lose sibling declarations).
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import {
  canTransition,
  type WorkOrderStatus,
} from "@/lib/work-orders.rules";

/**
 * Mint the next WO number for a company: `WO-YYYY-NNNN`.
 * Sequence is derived from the max existing number in the current year for
 * the company. Caller must retry on unique conflict.
 */
export async function generateWoNumber(
  client: SupabaseClient<Database>,
  companyId: string,
): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `WO-${year}-`;
  const { data, error } = await client
    .from("work_orders")
    .select("wo_number")
    .eq("company_id", companyId)
    .like("wo_number", `${prefix}%`)
    .order("wo_number", { ascending: false })
    .limit(1);
  if (error) throw error;
  let next = 1;
  const last = (data ?? [])[0] as { wo_number: string } | undefined;
  if (last) {
    const tail = last.wo_number.slice(prefix.length);
    const parsed = Number.parseInt(tail, 10);
    if (Number.isFinite(parsed)) next = parsed + 1;
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
}

export function assertCanTransition(
  from: WorkOrderStatus,
  to: WorkOrderStatus,
): void {
  if (!canTransition(from, to)) {
    throw Object.assign(new Error(`invalid_transition:${from}->${to}`), {
      statusCode: 400,
      body: JSON.stringify({
        error: "invalid_transition",
        from,
        to,
      }),
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
