// P-182 — Server-only helpers for the construction governance register. Kept
// out of *.functions.ts so the serverFn split transform can't drop siblings.
import type { Client } from "@/lib/cwp.server";
import { audit, httpError } from "@/lib/cwp.server";
import {
  evaluatePtwValidity,
  formatGovNumber,
  nextGovSequence,
  type PtwStatus,
} from "@/lib/governance.rules";

export const GOV_DOC_WRITER_ROLES = [
  "construction_admin",
  "engineering_admin",
  "company_admin",
] as const;
export const TBT_WRITER_ROLES = [
  "construction_admin",
  "foreman",
  "hse_admin",
  "company_admin",
] as const;
export const PTW_WRITER_ROLES = ["hse_admin", "construction_admin", "company_admin"] as const;

type GovTable =
  | "method_statements"
  | "toolbox_talks"
  | "permits_to_work"
  | "site_instructions"
  | "technical_queries";

type GovNumberColumn = "ms_number" | "tbt_number" | "ptw_number" | "si_number" | "tq_number";

const UNIQUE_VIOLATION = "23505";

async function mintGovNumber(
  client: Client,
  table: GovTable,
  column: GovNumberColumn,
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
  return formatGovNumber(prefix, nextGovSequence(prefix, existing));
}

/** Insert a governance row, retrying when a concurrent writer takes the number. */
export async function insertGovRow<T>(
  client: Client,
  table: GovTable,
  column: GovNumberColumn,
  prefix: string,
  companyId: string,
  buildRow: (num: string) => Record<string, unknown>,
  attempts = 5,
): Promise<T> {
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i += 1) {
    const num = await mintGovNumber(client, table, column, prefix, companyId);
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

export async function loadGovRow<T>(client: Client, table: GovTable, id: string): Promise<T> {
  const { data, error } = await client.from(table).select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "not_found");
  return data as T;
}

/**
 * P-111 approval start with inline fallback: returns the instance id, or null
 * when the company has no rule for the key (caller then signs off inline).
 */
export async function startGovApproval(
  client: Client,
  ruleKey: "method_statement" | "permit_to_work",
  entityType: "method_statement" | "permit_to_work",
  entityId: string,
  projectId: string,
): Promise<string | null> {
  const { data, error } = await client.rpc("start_approval_instance", {
    p_rule_key: ruleKey,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_metadata: { project_id: projectId } as never,
  });
  if (error) return null;
  return (data as string | null) ?? null;
}

export type PermitRow = {
  id: string;
  company_id: string;
  project_id: string;
  ptw_number: string;
  status: PtwStatus;
  valid_from: string;
  valid_to: string;
  isolations_confirmed: boolean;
};

/**
 * Lazy expiry sweep: evaluate validity on read/mutate and persist 'expired'
 * when the window has passed. Returns the permit's effective validity.
 */
export async function sweepPermitExpiry(client: Client, row: PermitRow, nowMs = Date.now()) {
  const validity = evaluatePtwValidity(
    {
      status: row.status,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      isolationsConfirmed: row.isolations_confirmed,
    },
    nowMs,
  );
  if (validity.needsExpirySweep) {
    await client.from("permits_to_work").update({ status: "expired" }).eq("id", row.id);
    await audit(client, "ptw.expired", "permits_to_work", row.id, {
      ptw_number: row.ptw_number,
      valid_to: row.valid_to,
    });
  }
  return validity;
}

/** Sweep a list of permits, returning rows with their effective status applied. */
export async function sweepPermitList<T extends PermitRow>(
  client: Client,
  rows: readonly T[],
  nowMs = Date.now(),
): Promise<T[]> {
  const out: T[] = [];
  for (const row of rows) {
    const validity = await sweepPermitExpiry(client, row, nowMs);
    out.push({ ...row, status: validity.effectiveStatus });
  }
  return out;
}
