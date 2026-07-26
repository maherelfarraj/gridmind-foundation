// P-179 — Server-only helpers for CWP & controls. Kept out of *.functions.ts so
// the createServerFn split transform can't drop sibling declarations.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { formatSequenceNumber, nextSequence } from "@/lib/cwp.rules";

export type Client = SupabaseClient<Database>;

export function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function currentCompanyId(client: Client, userId: string): Promise<string> {
  const { data, error } = await client
    .from("profiles")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  const companyId = (data as { company_id: string | null } | null)?.company_id;
  if (!companyId) httpError(400, "no_company");
  return companyId as string;
}

export async function hasAnyRole(client: Client, roles: readonly string[]): Promise<boolean> {
  const results = await Promise.all(
    roles.map((r) => client.rpc("has_company_role", { p_role: r as never })),
  );
  return results.some((r) => r.data === true);
}

export const CWP_WRITER_ROLES = ["construction_admin", "foreman", "company_admin"] as const;
export const CONTROLS_WRITER_ROLES = ["construction_admin", "company_admin"] as const;

export async function assertRoles(client: Client, roles: readonly string[]): Promise<void> {
  if (!(await hasAnyRole(client, roles))) httpError(403, "forbidden_role");
}

/** Next CWP-NNNN / RCP-NNNN for a company (caller retries on unique conflict). */
async function mintNumber(
  client: Client,
  table: "construction_work_packages" | "recovery_plans",
  column: "cwp_number" | "plan_number",
  prefix: string,
  companyId: string,
): Promise<string> {
  const { data, error } = await client
    .from(table)
    .select(column)
    .eq("company_id", companyId)
    .like(column, `${prefix}-%`)
    .order(column, { ascending: false })
    .limit(1);
  if (error) throw error;
  const existing = ((data ?? []) as unknown as Array<Record<string, string>>).map(
    (r) => r[column],
  );
  return formatSequenceNumber(prefix, nextSequence(prefix, existing));
}

const UNIQUE_VIOLATION = "23505";

/**
 * Insert a row whose number column must be unique per company, retrying with a
 * freshly minted number when a concurrent writer wins the race.
 */
export async function insertWithNumber<T>(
  client: Client,
  table: "construction_work_packages" | "recovery_plans",
  column: "cwp_number" | "plan_number",
  prefix: string,
  companyId: string,
  buildRow: (num: string) => Record<string, unknown>,
  attempts = 5,
): Promise<T> {
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i += 1) {
    const num = await mintNumber(client, table, column, prefix, companyId);
    const { data, error } = await client
      .from(table)
      .insert(buildRow(num) as never)
      .select("*")
      .single();
    if (!error) return data as T;
    if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error;
    lastError = error;
  }
  throw lastError ?? new Error("number_allocation_failed");
}

export async function audit(
  client: Client,
  action: string,
  entity: string,
  entityId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await client.rpc("write_audit_log", {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId,
      p_metadata: metadata as never,
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Recovery-plan activation via the P-111 engine. Returns the approval instance
 * id, or null when no rule is configured for the company (caller then falls
 * back to an inline construction_admin sign-off).
 */
export async function startRecoveryApproval(
  client: Client,
  planId: string,
  projectId: string,
): Promise<string | null> {
  const { data, error } = await client.rpc("start_approval_instance", {
    p_rule_key: "construction_recovery_plan",
    p_entity_type: "recovery_plan",
    p_entity_id: planId,
    p_metadata: { project_id: projectId } as never,
  });
  if (error) return null;
  return (data as string | null) ?? null;
}
