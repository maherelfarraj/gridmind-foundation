// P-200 — Period close I/O helpers (kept out of *.functions.ts).
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { AGING_BUCKETS, type AgingBucketKey } from "@/lib/finance/aging-weights";
import { WIP_THRESHOLD_BASE } from "@/lib/finance/wip-thresholds";
import { assertPeriodOpen, periodMonth } from "@/lib/finance/periods";
import { balanceOf, bucketFor, daysPastDue, isAgingEligible } from "@/lib/ar-aging.rules";
import { safeRows } from "@/lib/finance-cockpit.server";
import { audit, hasAnyRole, httpError } from "@/lib/payments.server";
import {
  BILLED_INVOICE_STATUSES,
  EARNED_PAY_APP_STATUSES,
  WIP_CONTRACT_STATUSES,
} from "@/lib/wip.rules";
import {
  PERIOD_FULL_ROLES,
  PERIOD_READ_ROLES,
  PERIOD_REOPEN_ROLES,
  buildChecklist,
  emptyTotals,
  monthEnd,
  monthStart,
  recentMonths,
  type ChecklistItem,
  type PeriodAccess,
  type PeriodRow,
  type PeriodStatus,
  type PeriodTotals,
} from "@/lib/periods.rules";

export interface PeriodListRow extends PeriodRow {
  checklist: ChecklistItem[];
  can_close: boolean;
}

export async function resolvePeriodAccess(ctx: AuthContext): Promise<PeriodAccess> {
  if (await hasAnyRole(ctx, PERIOD_REOPEN_ROLES)) return "reopen";
  if (await hasAnyRole(ctx, PERIOD_FULL_ROLES)) return "full";
  if (await hasAnyRole(ctx, PERIOD_READ_ROLES)) return "read";
  return "none";
}

export function assertPeriodRead(access: PeriodAccess): void {
  if (access === "none") httpError(403, "forbidden", "You cannot view finance periods.");
}

export function assertPeriodWrite(access: PeriodAccess): void {
  if (access !== "full" && access !== "reopen") {
    httpError(403, "forbidden", "Only finance or company admins can manage finance periods.");
  }
}

export async function periodCompanyId(ctx: AuthContext): Promise<string> {
  const { data, error } = await ctx.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", ctx.user!.id)
    .maybeSingle();
  if (error) throw error;
  const companyId = (data as { company_id: string | null } | null)?.company_id ?? null;
  if (!companyId) httpError(400, "no_company", "No active company context.");
  return companyId;
}

// ---------------------------------------------------------------------------
// Period rows (auto-materialize current + prior)
// ---------------------------------------------------------------------------
export async function ensureCurrentPeriods(ctx: AuthContext, companyId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const months = [periodMonth(today), recentMonths(today, 2)[1]];
  await ctx.supabase.from("finance_periods").upsert(
    months.map((m) => ({ company_id: companyId, period_month: m, status: "open" })) as never,
    { onConflict: "company_id,period_month", ignoreDuplicates: true },
  );
}

interface RawPeriod {
  id: string;
  period_month: string;
  status: PeriodStatus;
  closed_by: string | null;
  closed_at: string | null;
  close_checklist: unknown;
}

export async function loadPeriods(ctx: AuthContext, companyId: string): Promise<PeriodRow[]> {
  const rows =
    (await safeRows<RawPeriod>(() =>
      ctx.supabase
        .from("finance_periods")
        .select("id, period_month, status, closed_by, closed_at, close_checklist")
        .eq("company_id", companyId)
        .order("period_month", { ascending: false })
        .limit(24),
    )) ?? [];

  const names = new Map<string, string>();
  const ids = [...new Set(rows.map((r) => r.closed_by).filter(Boolean) as string[])];
  if (ids.length > 0) {
    const profs =
      (await safeRows<{ id: string; full_name: string | null }>(() =>
        ctx.supabase.from("profiles").select("id, full_name").in("id", ids),
      )) ?? [];
    for (const p of profs) names.set(p.id, p.full_name ?? "—");
  }

  const known = new Set(rows.map((r) => r.period_month));
  const synthetic = recentMonths(new Date().toISOString().slice(0, 10), 6)
    .filter((m) => !known.has(m))
    .map<PeriodRow>((m) => ({
      id: null,
      period_month: m,
      status: "open",
      closed_by: null,
      closed_by_name: null,
      closed_at: null,
      close_checklist: {},
    }));

  return [
    ...rows.map<PeriodRow>((r) => ({
      id: r.id,
      period_month: r.period_month,
      status: r.status,
      closed_by: r.closed_by,
      closed_by_name: r.closed_by ? (names.get(r.closed_by) ?? "—") : null,
      closed_at: r.closed_at,
      close_checklist: (r.close_checklist as Record<string, unknown>) ?? {},
    })),
    ...synthetic,
  ].sort((a, b) => b.period_month.localeCompare(a.period_month));
}

// ---------------------------------------------------------------------------
// Live checklist facts
// ---------------------------------------------------------------------------
export async function checklistFor(
  ctx: AuthContext,
  companyId: string,
  period: PeriodRow,
): Promise<ChecklistItem[]> {
  const start = monthStart(period.period_month);
  const end = monthEnd(period.period_month);

  const [matches, payments, alerts, wip] = await Promise.all([
    safeRows<{ id: string }>(() =>
      ctx.supabase
        .from("three_way_matches")
        .select("id")
        .eq("company_id", companyId)
        .eq("payment_release_blocked", true)
        .gte("invoice_date", start)
        .lte("invoice_date", end),
    ),
    safeRows<{ id: string }>(() =>
      ctx.supabase
        .from("payments")
        .select("id")
        .eq("company_id", companyId)
        .eq("record_status", "recorded")
        .eq("reconciliation_status", "unmatched")
        .gte("payment_date", start)
        .lte("payment_date", end),
    ),
    safeRows<{ id: string }>(() =>
      ctx.supabase
        .from("finance_alerts")
        .select("id")
        .eq("company_id", companyId)
        .eq("status", "open"),
    ),
    unbilledContracts(ctx, companyId, end),
  ]);

  const checklist = (period.close_checklist ?? {}) as { unbilled_reviewed?: boolean };
  return buildChecklist({
    blocked_matches: matches?.length ?? 0,
    unmatched_payments: payments?.length ?? 0,
    open_alerts: alerts?.length ?? 0,
    unbilled_contracts: wip,
    unbilled_reviewed: Boolean(checklist.unbilled_reviewed),
  });
}

/** Count of contracts whose earned − billed exceeds the WIP review threshold. */
async function unbilledContracts(
  ctx: AuthContext,
  companyId: string,
  asOf: string,
): Promise<number> {
  const contracts =
    (await safeRows<{ id: string }>(() =>
      ctx.supabase
        .from("contracts")
        .select("id")
        .eq("company_id", companyId)
        .in("status", WIP_CONTRACT_STATUSES as unknown as string[]),
    )) ?? [];
  if (contracts.length === 0) return 0;
  const ids = contracts.map((c) => c.id);

  const [payApps, invoices] = await Promise.all([
    safeRows<{ contract_id: string; total_certified: number | null }>(() =>
      ctx.supabase
        .from("pay_applications")
        .select("contract_id, total_certified")
        .in("contract_id", ids)
        .in("status", EARNED_PAY_APP_STATUSES as unknown as string[])
        .lte("period_end", asOf),
    ),
    safeRows<{ contract_id: string | null; amount: number | null }>(() =>
      ctx.supabase
        .from("invoices")
        .select("contract_id, amount")
        .in("contract_id", ids)
        .eq("direction", "receivable")
        .in("status", BILLED_INVOICE_STATUSES as unknown as string[])
        .lte("issue_date", asOf),
    ),
  ]);

  const earned = new Map<string, number>();
  for (const p of payApps ?? [])
    earned.set(p.contract_id, (earned.get(p.contract_id) ?? 0) + Number(p.total_certified ?? 0));
  const billed = new Map<string, number>();
  for (const i of invoices ?? []) {
    if (!i.contract_id) continue;
    billed.set(i.contract_id, (billed.get(i.contract_id) ?? 0) + Number(i.amount ?? 0));
  }
  return ids.filter((id) => (earned.get(id) ?? 0) - (billed.get(id) ?? 0) >= WIP_THRESHOLD_BASE)
    .length;
}

// ---------------------------------------------------------------------------
// Close / reopen / checklist
// ---------------------------------------------------------------------------
export async function closePeriod(
  ctx: AuthContext,
  companyId: string,
  month: string,
): Promise<void> {
  const { error } = await ctx.supabase.rpc("close_finance_period", {
    p_company_id: companyId,
    p_period_month: monthStart(month),
  } as never);
  if (error) httpError(403, "forbidden", error.message);
  await audit(ctx, "period.close", "finance_periods", null, { period_month: monthStart(month) });
}

export async function reopenPeriod(
  ctx: AuthContext,
  companyId: string,
  month: string,
): Promise<void> {
  const { error } = await ctx.supabase.rpc("reopen_finance_period", {
    p_company_id: companyId,
    p_period_month: monthStart(month),
  } as never);
  if (error) httpError(403, "forbidden", error.message);
  await audit(ctx, "period.reopen", "finance_periods", null, { period_month: monthStart(month) });
}

export async function saveChecklist(
  ctx: AuthContext,
  companyId: string,
  month: string,
  unbilledReviewed: boolean,
  note?: string,
): Promise<void> {
  const payload = {
    company_id: companyId,
    period_month: monthStart(month),
    status: "open",
    close_checklist: {
      unbilled_reviewed: unbilledReviewed,
      note: note ?? null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: ctx.user!.id,
    },
  };
  const { data: existing } = await ctx.supabase
    .from("finance_periods")
    .select("id")
    .eq("company_id", companyId)
    .eq("period_month", monthStart(month))
    .maybeSingle();

  if (existing) {
    const { error } = await ctx.supabase
      .from("finance_periods")
      .update({ close_checklist: payload.close_checklist } as never)
      .eq("id", (existing as { id: string }).id);
    if (error) throw error;
  } else {
    const { error } = await ctx.supabase.from("finance_periods").insert(payload as never);
    if (error) throw error;
  }
  await audit(ctx, "period.checklist", "finance_periods", null, {
    period_month: monthStart(month),
    unbilled_reviewed: unbilledReviewed,
  });
}

// ---------------------------------------------------------------------------
// Comparison totals
// ---------------------------------------------------------------------------
export async function totalsFor(
  ctx: AuthContext,
  companyId: string,
  month: string,
): Promise<PeriodTotals> {
  const start = monthStart(month);
  const end = monthEnd(month);
  const totals = emptyTotals(start);

  const [invoices, payments, agingRows] = await Promise.all([
    safeRows<{ contract_id: string | null; amount: number | null }>(() =>
      ctx.supabase
        .from("invoices")
        .select("contract_id, amount")
        .eq("company_id", companyId)
        .eq("direction", "receivable")
        .in("status", BILLED_INVOICE_STATUSES as unknown as string[])
        .gte("issue_date", start)
        .lte("issue_date", end),
    ),
    safeRows<{ amount: number | null; amount_base: number | null }>(() =>
      ctx.supabase
        .from("payments")
        .select("amount, amount_base")
        .eq("company_id", companyId)
        .eq("record_status", "recorded")
        .gte("payment_date", start)
        .lte("payment_date", end),
    ),
    safeRows<{
      status: string;
      direction: string;
      due_date: string | null;
      amount: number | null;
      tax_amount: number | null;
      paid_amount: number | null;
    }>(() =>
      ctx.supabase
        .from("invoices")
        .select("status, direction, due_date, amount, tax_amount, paid_amount")
        .eq("company_id", companyId)
        .eq("direction", "receivable")
        .lte("issue_date", end),
    ),
  ]);

  totals.revenue = round2((invoices ?? []).reduce((s, i) => s + Number(i.amount ?? 0), 0));
  totals.collected = round2(
    (payments ?? []).reduce((s, p) => s + Number(p.amount_base ?? p.amount ?? 0), 0),
  );

  for (const inv of agingRows ?? []) {
    if (!isAgingEligible(inv as never)) continue;
    const bal = balanceOf(inv as never);
    if (bal <= 0) continue;
    const bucket: AgingBucketKey = bucketFor(daysPastDue(inv.due_date, end));
    totals.aging[bucket] = round2(totals.aging[bucket] + bal);
  }
  void AGING_BUCKETS;

  totals.wip = await companyWip(ctx, companyId, end);
  return totals;
}

async function companyWip(ctx: AuthContext, companyId: string, asOf: string): Promise<number> {
  const contracts =
    (await safeRows<{ id: string }>(() =>
      ctx.supabase
        .from("contracts")
        .select("id")
        .eq("company_id", companyId)
        .in("status", WIP_CONTRACT_STATUSES as unknown as string[]),
    )) ?? [];
  if (contracts.length === 0) return 0;
  const ids = contracts.map((c) => c.id);

  const [payApps, invoices] = await Promise.all([
    safeRows<{ total_certified: number | null }>(() =>
      ctx.supabase
        .from("pay_applications")
        .select("total_certified")
        .in("contract_id", ids)
        .in("status", EARNED_PAY_APP_STATUSES as unknown as string[])
        .lte("period_end", asOf),
    ),
    safeRows<{ amount: number | null }>(() =>
      ctx.supabase
        .from("invoices")
        .select("amount")
        .in("contract_id", ids)
        .eq("direction", "receivable")
        .in("status", BILLED_INVOICE_STATUSES as unknown as string[])
        .lte("issue_date", asOf),
    ),
  ]);

  const earned = (payApps ?? []).reduce((s, p) => s + Number(p.total_certified ?? 0), 0);
  const billed = (invoices ?? []).reduce((s, i) => s + Number(i.amount ?? 0), 0);
  return round2(earned - billed);
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

export { assertPeriodOpen };
