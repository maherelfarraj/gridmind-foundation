// Day 7 — Blocked-attempt auditing.
//
// Guard functions (`assert_finance_period_open`, `assert_export_unlocked`) raise
// inside the caller's transaction, so an audit row written *inside* the database
// function would be rolled back with the failed mutation — Postgres has no
// autonomous transactions. The audit write therefore happens at the application
// boundary, in its own request, immediately before the typed error is rethrown.
//
// Contract: exactly ONE audit row per blocked attempt, and the block still
// surfaces as the same typed 4xx it always did. Audit failures never mask the
// original error.

import type { SupabaseClient } from "@supabase/supabase-js";

export const PERIOD_BLOCKED_ACTION = "period.post_blocked";
export const EXPORT_BLOCKED_ACTION = "export.blocked";

export interface BlockedAuditRow {
  company_id: string;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
}

/** Pure builder — period-close block. */
export function periodBlockedAuditRow(input: {
  companyId: string;
  actorId?: string | null;
  attemptedDate: string;
  entity: string;
  entityId?: string | null;
}): BlockedAuditRow {
  return {
    company_id: input.companyId,
    actor_id: input.actorId ?? null,
    action: PERIOD_BLOCKED_ACTION,
    entity: input.entity,
    entity_id: input.entityId ?? null,
    metadata: {
      reason: "finance_period_closed",
      attempted_posting_date: input.attemptedDate,
      period: input.attemptedDate.slice(0, 7),
      status_code: 409,
    },
  };
}

/** Pure builder — export-lock block. */
export function exportBlockedAuditRow(input: {
  companyId: string;
  actorId?: string | null;
  projectId: string;
  exportType: string;
}): BlockedAuditRow {
  return {
    company_id: input.companyId,
    actor_id: input.actorId ?? null,
    action: EXPORT_BLOCKED_ACTION,
    entity: "project_export_locks",
    entity_id: input.projectId,
    metadata: {
      reason: "export_locked",
      export_type: input.exportType,
      project_id: input.projectId,
      status_code: 423,
    },
  };
}

/**
 * Best-effort single-row audit write. Never throws: the caller is already on a
 * failure path and must surface the original typed error.
 */
export async function writeBlockedAudit(
  supabase: SupabaseClient,
  row: BlockedAuditRow | null,
): Promise<void> {
  if (!row) return;
  try {
    await supabase.from("audit_logs").insert(row as never);
  } catch {
    /* audit is advisory — swallow */
  }
}

/** Resolves the acting profile id, or null when unavailable. */
export async function currentActorId(supabase: SupabaseClient): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}
