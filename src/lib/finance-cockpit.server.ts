// P-196 — Finance cockpit I/O helpers. Kept out of *.functions.ts so the
// server-fn splitter never drops module-scope siblings.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { resolveBaseCurrency } from "@/lib/ar-aging.server";
import {
  FINANCE_ACTIVITY_ENTITIES,
  FINANCE_APPROVAL_ENTITIES,
  FINANCE_FULL_ROLES,
  FINANCE_READ_ROLES,
  aggregateCashTrend,
  lastMonthKeys,
  monthBounds,
  percent,
  sumPayments,
  todayIso,
  trendRange,
  type CashFlowRow,
  type CashTrendPoint,
  type FinanceAccessLevel,
} from "@/lib/finance-cockpit.rules";
import { summarizeExpiringBonds, type ExpiringBondsSummary } from "@/lib/finance/bond-expiry";
import { hasAnyRole } from "@/lib/payments.server";

/** Postgres/PostgREST codes meaning "this table isn't in the schema". */
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205", "PGRST200"]);

function isMissingTable(error: unknown): boolean {
  if (!error) return false;
  const e = error as { code?: string; message?: string };
  if (e.code && MISSING_TABLE_CODES.has(e.code)) return true;
  return /does not exist|could not find the table/i.test(e.message ?? "");
}

/**
 * Runs a Supabase query and degrades to `null` (rendered as "n/a") when the
 * dependency table is absent. Any other error still throws.
 */
export async function safeRows<T>(
  run: () => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[] | null> {
  try {
    const { data, error } = await run();
    if (error) {
      if (isMissingTable(error)) return null;
      throw error;
    }
    return (data ?? []) as T[];
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
}

export async function resolveFinanceAccess(ctx: AuthContext): Promise<FinanceAccessLevel> {
  if (await hasAnyRole(ctx, FINANCE_FULL_ROLES)) return "full";
  if (await hasAnyRole(ctx, FINANCE_READ_ROLES)) return "read";
  return "none";
}

export interface CockpitTile<T> {
  value: T | null;
  available: boolean;
}

function tile<T>(value: T | null): CockpitTile<T> {
  return { value, available: value !== null };
}

export interface ActivityRow {
  id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  created_at: string;
  actor_name: string | null;
}

export interface FinanceCockpitData {
  base_currency: string;
  today: string;
  month: { start: string; end: string };
  cash_position: CockpitTile<{ inflow: number; outflow: number; net: number }>;
  open_pay_apps: CockpitTile<{ total: number; count: number }>;
  budget_vs_actual: CockpitTile<{ budget: number; actual: number; consumed_pct: number | null }>;
  pending_approvals: CockpitTile<{ count: number }>;
  co_exposure: CockpitTile<{ co_amount: number; contract_value: number; pct: number | null }>;
  sla_credits: CockpitTile<{ total: number; count: number }>;
  bonds_expiring_30: CockpitTile<ExpiringBondsSummary>;
  cash_trend: CockpitTile<CashTrendPoint[]>;
  activity: CockpitTile<ActivityRow[]>;
}

export async function loadFinanceCockpit(ctx: AuthContext): Promise<FinanceCockpitData> {
  const today = todayIso();
  const month = monthBounds(today);
  const months = lastMonthKeys(today, 6);
  const trend = trendRange(today, 6);
  const base_currency = await resolveBaseCurrency(ctx);

  const [payments, payApps, budgets, approvals, changeOrders, contracts, slas, flows, bonds, logs] =
    await Promise.all([
      safeRows<{ direction: string; amount_base: number | null }>(() =>
        ctx.supabase
          .from("payments")
          .select("direction, amount_base")
          .eq("record_status", "recorded")
          .gte("payment_date", month.start)
          .lte("payment_date", month.end),
      ),
      safeRows<{ net_amount: number | null }>(() =>
        ctx.supabase
          .from("pay_applications")
          .select("net_amount")
          .in("status", ["submitted", "certified"]),
      ),
      safeRows<{ current_amount: number | null; actual_amount: number | null }>(() =>
        ctx.supabase.from("budgets").select("current_amount, actual_amount"),
      ),
      safeRows<{ entity: string | null; entity_type: string | null }>(() =>
        ctx.supabase
          .from("approval_instances")
          .select("entity, entity_type")
          .eq("status", "pending"),
      ),
      safeRows<{ amount: number | null }>(() =>
        ctx.supabase
          .from("change_orders")
          .select("amount")
          .in("status", ["approved", "incorporated"]),
      ),
      safeRows<{ value: number | null }>(() =>
        ctx.supabase.from("contracts").select("value").in("status", ["signed", "active"]),
      ),
      safeRows<{ credit_amount: number | null }>(() =>
        ctx.supabase
          .from("sla_records")
          .select("credit_amount")
          .is("resolved_at", null)
          .gte("created_at", `${month.start}T00:00:00Z`),
      ),
      safeRows<CashFlowRow>(() =>
        ctx.supabase
          .from("cash_flows")
          .select("period, direction, kind, amount_base, voided")
          .gte("period", trend.start)
          .lte("period", trend.end),
      ),
      safeRows<{ expiry_date: string | null; amount: number | null; currency_code: string }>(() =>
        ctx.supabase
          .from("bond_instruments")
          .select("expiry_date, amount, currency_code")
          .in("status", ["active", "expiring_soon"])
          .not("expiry_date", "is", null),
      ),
      safeRows<Record<string, unknown>>(() =>
        ctx.supabase
          .from("audit_logs")
          .select("id, action, entity, entity_id, created_at, profiles:actor_id(full_name, email)")
          .in("entity", [...FINANCE_ACTIVITY_ENTITIES])
          .order("created_at", { ascending: false })
          .limit(20),
      ),
    ]);

  const approvalCount =
    approvals === null
      ? null
      : approvals.filter((a) =>
          FINANCE_APPROVAL_ENTITIES.some(
            (e) => a.entity_type === e || a.entity === e || a.entity === `${e}s`,
          ),
        ).length;

  const coTotal = changeOrders?.reduce((a, r) => a + Number(r.amount ?? 0), 0) ?? null;
  const contractTotal = contracts?.reduce((a, r) => a + Number(r.value ?? 0), 0) ?? null;
  const budgetTotal = budgets?.reduce((a, r) => a + Number(r.current_amount ?? 0), 0) ?? null;
  const actualTotal = budgets?.reduce((a, r) => a + Number(r.actual_amount ?? 0), 0) ?? null;

  return {
    base_currency,
    today,
    month,
    cash_position: tile(
      payments === null
        ? null
        : {
            inflow: sumPayments(payments, "receivable"),
            outflow: sumPayments(payments, "payable"),
            net: sumPayments(payments, "receivable") - sumPayments(payments, "payable"),
          },
    ),
    open_pay_apps: tile(
      payApps === null
        ? null
        : {
            total: payApps.reduce((a, r) => a + Number(r.net_amount ?? 0), 0),
            count: payApps.length,
          },
    ),
    budget_vs_actual: tile(
      budgets === null
        ? null
        : {
            budget: budgetTotal ?? 0,
            actual: actualTotal ?? 0,
            consumed_pct: percent(actualTotal ?? 0, budgetTotal ?? 0),
          },
    ),
    pending_approvals: tile(approvalCount === null ? null : { count: approvalCount }),
    co_exposure: tile(
      coTotal === null || contractTotal === null
        ? null
        : {
            co_amount: coTotal,
            contract_value: contractTotal,
            pct: percent(coTotal, contractTotal),
          },
    ),
    sla_credits: tile(
      slas === null
        ? null
        : {
            total: slas.reduce((a, r) => a + Number(r.credit_amount ?? 0), 0),
            count: slas.length,
          },
    ),
    bonds_expiring_30: tile(bonds === null ? null : summarizeExpiringBonds(bonds, today, 30)),
    cash_trend: tile(flows === null ? null : aggregateCashTrend(flows, months)),
    activity: tile(logs === null ? null : logs.map(toActivityRow)),
  };
}

export function toActivityRow(r: Record<string, unknown>): ActivityRow {
  const profile = r.profiles as { full_name?: string; email?: string } | null;
  return {
    id: String(r.id),
    action: String(r.action ?? ""),
    entity: String(r.entity ?? ""),
    entity_id: (r.entity_id as string) ?? null,
    created_at: String(r.created_at ?? ""),
    actor_name: profile?.full_name ?? profile?.email ?? null,
  };
}
