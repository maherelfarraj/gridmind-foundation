// P-109 — Server-only helpers for service tickets.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

/**
 * Mint the next ticket number for a company: `ST-YYYY-NNNN`.
 * Caller must retry on unique conflict (23505).
 */
export async function generateTicketNumber(
  client: SupabaseClient<Database>,
  companyId: string,
): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `ST-${year}-`;
  const { data, error } = await client
    .from("service_tickets")
    .select("ticket_number")
    .eq("company_id", companyId)
    .like("ticket_number", `${prefix}%`)
    .order("ticket_number", { ascending: false })
    .limit(1);
  if (error) throw error;
  let next = 1;
  const last = (data ?? [])[0] as { ticket_number: string } | undefined;
  if (last) {
    const tail = last.ticket_number.slice(prefix.length);
    const parsed = Number.parseInt(tail, 10);
    if (Number.isFinite(parsed)) next = parsed + 1;
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
}
