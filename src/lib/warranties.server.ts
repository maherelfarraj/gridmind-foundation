// P-108 — Server-only warranty helpers.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

/**
 * Mint the next claim number for a company: `WC-YYYY-NNNN`.
 * Sequence derived from the max existing claim_number in the current year
 * for the company. Caller must retry on unique conflict.
 */
export async function generateClaimNumber(
  client: SupabaseClient<Database>,
  companyId: string,
): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `WC-${year}-`;
  const { data, error } = await client
    .from("warranty_claims")
    .select("claim_number")
    .eq("company_id", companyId)
    .like("claim_number", `${prefix}%`)
    .order("claim_number", { ascending: false })
    .limit(1);
  if (error) throw error;
  let next = 1;
  const last = (data ?? [])[0] as { claim_number: string } | undefined;
  if (last) {
    const tail = last.claim_number.slice(prefix.length);
    const parsed = Number.parseInt(tail, 10);
    if (Number.isFinite(parsed)) next = parsed + 1;
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
}
