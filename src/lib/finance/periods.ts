// P-200 — Period-close enforcement helper.
//
// Every financial mutation calls assertPeriodOpen(...) as its FIRST step after
// auth, passing its own business date (payment_date, issue_date, period,
// period_end). A closed month raises a typed 409 that the UI surfaces verbatim
// in a destructive toast.
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  currentActorId,
  periodBlockedAuditRow,
  writeBlockedAudit,
} from "@/lib/blocked-audit";

export const PERIOD_CLOSED_PREFIX = "finance_period_closed";

/** Month key (YYYY-MM) of an ISO date. */
export function periodKey(date: string): string {
  return date.slice(0, 7);
}

/** First day of the month of an ISO date, as YYYY-MM-DD. */
export function periodMonth(date: string): string {
  return `${periodKey(date)}-01`;
}

export function periodClosedMessage(date: string): string {
  return `Period ${periodKey(date)} is closed. Reopen it in /finance/periods to post into it.`;
}

export interface PeriodClosedError extends Error {
  statusCode: 409;
  code: "finance_period_closed";
  period: string;
}

export function periodClosedError(date: string): PeriodClosedError {
  return Object.assign(new Error(periodClosedMessage(date)), {
    statusCode: 409 as const,
    code: "finance_period_closed" as const,
    period: periodKey(date),
    body: JSON.stringify({
      error: "finance_period_closed",
      message: periodClosedMessage(date),
      period: periodKey(date),
    }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function isPeriodClosedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if ((err as { code?: unknown }).code === PERIOD_CLOSED_PREFIX) return true;
  const m = (err as { message?: unknown }).message;
  return typeof m === "string" && m.includes(PERIOD_CLOSED_PREFIX);
}

/** Missing RPC / table (not yet migrated) must never block a mutation. */
function isMissingObject(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "42P01" || code === "42883" || code === "PGRST202";
}

/**
 * Throws a typed 409 when `date` falls inside a closed finance period.
 * Silently no-ops when the enforcement RPC is not deployed.
 */
export async function assertPeriodOpen(
  supabase: SupabaseClient,
  companyId: string | null | undefined,
  date: string | null | undefined,
  audit?: { entity?: string; entityId?: string | null },
): Promise<void> {
  if (!companyId || !date) return;
  const { error } = await supabase.rpc("assert_finance_period_open", {
    p_company_id: companyId,
    p_date: date,
  } as never);
  if (!error) return;
  if (isPeriodClosedError(error)) {
    // Day 7 — blocked-attempt audit. Exactly one row, then the same typed 409.
    await writeBlockedAudit(
      supabase,
      periodBlockedAuditRow({
        companyId,
        actorId: await currentActorId(supabase),
        attemptedDate: date,
        entity: audit?.entity ?? "finance_periods",
        entityId: audit?.entityId ?? null,
      }),
    );
    throw periodClosedError(date);
  }
  if (isMissingObject(error)) return;
  throw error;
}
