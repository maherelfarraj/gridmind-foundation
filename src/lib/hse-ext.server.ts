// P-185 — Server-only helpers for the HSE expansion. Kept out of *.functions.ts
// so the createServerFn split transform cannot drop sibling declarations.
import type { Json } from "@/integrations/supabase/types";
import type { Client } from "@/lib/cwp.server";
import { httpError } from "@/lib/cwp.server";
import { formatHseNumber, nextHseSequence } from "@/lib/hse-ext.rules";

export const HSE_WRITER_ROLES = ["hse_admin", "construction_admin", "company_admin"] as const;
export const HSE_OBSERVER_ROLES = [
  "hse_admin",
  "construction_admin",
  "foreman",
  "field_technician",
  "company_admin",
] as const;

export type HseNumberedTable = "risk_assessments" | "job_safety_analyses" | "safety_observations";
export type HseNumberColumn = "ra_number" | "jsa_number" | "obs_number";

export type HseRow = Record<string, Json>;

const UNIQUE_VIOLATION = "23505";

async function mintHseNumber(
  client: Client,
  table: HseNumberedTable,
  column: HseNumberColumn,
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
  const existing = ((data ?? []) as unknown as Array<Record<string, string>>).map((r) => r[column]);
  return formatHseNumber(prefix, nextHseSequence(prefix, existing));
}

/** Insert a numbered HSE row, retrying when a concurrent writer takes the number. */
export async function insertHseNumbered<T extends HseRow = HseRow>(
  client: Client,
  table: HseNumberedTable,
  column: HseNumberColumn,
  prefix: string,
  companyId: string,
  buildRow: (num: string) => Record<string, unknown>,
  attempts = 5,
): Promise<T> {
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i += 1) {
    const num = await mintHseNumber(client, table, column, prefix, companyId);
    const { data, error } = await client
      .from(table)
      .insert(buildRow(num) as never)
      .select("*")
      .single();
    if (!error) return data as unknown as T;
    if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error;
    lastError = error;
  }
  throw lastError ?? new Error("number_allocation_failed");
}

export type HseTable =
  | HseNumberedTable
  | "competency_records"
  | "emergency_response"
  | "environmental_monitoring"
  | "waste_tracking"
  | "site_audit_checklists";

/** Company-scoped list (RLS enforces tenancy) with an optional project filter. */
export async function listHseRows<T extends HseRow = HseRow>(
  client: Client,
  table: HseTable,
  projectId: string | null | undefined,
  orderColumn: string,
  ascending = false,
): Promise<T[]> {
  let q = client.from(table).select("*").order(orderColumn, { ascending }).limit(500);
  if (projectId) q = q.eq("project_id", projectId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as T[];
}

export async function insertHseRow<T extends HseRow = HseRow>(
  client: Client,
  table: HseTable,
  row: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client
    .from(table)
    .insert(row as never)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as T;
}

export async function updateHseRow<T extends HseRow = HseRow>(
  client: Client,
  table: HseTable,
  id: string,
  patch: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client
    .from(table)
    .update(patch as never)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "not_found");
  return data as unknown as T;
}

/**
 * RA/JSA activation via the P-111 engine. Returns the approval instance id, or
 * null when no rule is configured — the caller then falls back to an inline
 * hse_admin sign-off.
 */
export async function startHseApproval(
  client: Client,
  ruleKey: "risk_assessment" | "jsa",
  entityId: string,
  projectId: string,
  metadata: Record<string, unknown>,
): Promise<string | null> {
  const { data, error } = await client.rpc("start_approval_instance", {
    p_rule_key: ruleKey,
    p_entity_type: ruleKey,
    p_entity_id: entityId,
    p_metadata: { project_id: projectId, ...metadata } as never,
  });
  if (error) return null;
  return (data as string | null) ?? null;
}
