// P-195 — AR aging I/O helpers. Kept out of *.functions.ts so the server-fn
// splitter never drops module-scope siblings.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import {
  isAgingEligible,
  toAgingRow,
  todayIso,
  type AgingInvoiceInput,
  type AgingInvoiceRow,
} from "@/lib/ar-aging.rules";

export const AR_WRITE_ROLES = ["finance_admin", "company_admin"] as const;

const DEFAULT_BASE_CURRENCY = "USD";

/** Mirrors public.finance_base_currency(): project override, else company default. */
export async function resolveBaseCurrency(ctx: AuthContext, projectId?: string): Promise<string> {
  if (!projectId) return DEFAULT_BASE_CURRENCY;
  const { data, error } = await ctx.supabase
    .from("project_financial_config")
    .select("currency_code")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) return DEFAULT_BASE_CURRENCY;
  return (data as { currency_code?: string } | null)?.currency_code ?? DEFAULT_BASE_CURRENCY;
}

/**
 * Latest FX rate on or before today for each currency → base.
 * Missing pairs are omitted (never silently 1.0) so the caller can flag them.
 */
export async function loadFxRates(
  ctx: AuthContext,
  currencies: string[],
  base: string,
  onDate: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>([[base, 1]]);
  const needed = currencies.filter((c) => c !== base);
  if (needed.length === 0) return map;
  const { data, error } = await ctx.supabase
    .from("fx_rates")
    .select("base_code, quote_code, rate, as_of")
    .in("base_code", needed)
    .eq("quote_code", base)
    .lte("as_of", onDate)
    .order("as_of", { ascending: false });
  if (error) return map;
  for (const r of (data ?? []) as { base_code: string; rate: number }[]) {
    if (!map.has(r.base_code)) map.set(r.base_code, Number(r.rate));
  }
  return map;
}

interface RawInvoice {
  id: string;
  invoice_number: string;
  status: string;
  direction: string;
  due_date: string | null;
  amount: number;
  tax_amount: number;
  paid_amount: number;
  currency_code: string;
  project_id: string | null;
  projects: { name: string } | null;
  contracts: { counterparty: string } | null;
}

export interface AgingDataset {
  rows: AgingInvoiceRow[];
  base_currency: string;
  today: string;
  fx_missing_currencies: string[];
}

/** Load open receivables, attach client/project/reminder counts, and age them. */
export async function loadAgingDataset(
  ctx: AuthContext,
  filters: { project_id?: string },
): Promise<AgingDataset> {
  const today = todayIso();
  const base = await resolveBaseCurrency(ctx, filters.project_id);

  let query = ctx.supabase
    .from("invoices")
    .select(
      "id, invoice_number, status, direction, due_date, amount, tax_amount, paid_amount, currency_code, project_id, projects(name), contracts(counterparty)" as string,
    )
    .eq("direction", "receivable")
    .in("status", ["approved", "sent", "partially_paid"])
    .limit(2000);
  if (filters.project_id) query = query.eq("project_id", filters.project_id);
  const { data, error } = await query.returns<RawInvoice[]>();
  if (error) throw error;

  const open = (data ?? []).filter((r) =>
    isAgingEligible({
      direction: r.direction,
      status: r.status,
      amount: Number(r.amount ?? 0),
      tax_amount: Number(r.tax_amount ?? 0),
      paid_amount: Number(r.paid_amount ?? 0),
    }),
  );
  if (open.length === 0) {
    return { rows: [], base_currency: base, today, fx_missing_currencies: [] };
  }

  const ids = open.map((r) => r.id);
  const [fx, reminders] = await Promise.all([
    loadFxRates(ctx, [...new Set(open.map((r) => r.currency_code))], base, today),
    ctx.supabase.from("ar_reminders").select("invoice_id").in("invoice_id", ids),
  ]);
  const counts = new Map<string, number>();
  for (const r of (reminders.data ?? []) as { invoice_id: string }[]) {
    counts.set(r.invoice_id, (counts.get(r.invoice_id) ?? 0) + 1);
  }

  const missing = new Set<string>();
  const rows = open.map((r) => {
    const rate = fx.has(r.currency_code) ? (fx.get(r.currency_code) as number) : null;
    if (rate === null) missing.add(r.currency_code);
    const input: AgingInvoiceInput = {
      id: r.id,
      invoice_number: r.invoice_number,
      status: r.status,
      direction: r.direction,
      due_date: r.due_date,
      amount: Number(r.amount ?? 0),
      tax_amount: Number(r.tax_amount ?? 0),
      paid_amount: Number(r.paid_amount ?? 0),
      currency_code: r.currency_code,
      fx_rate_to_base: rate,
      project_id: r.project_id,
      project_name: r.projects?.name ?? null,
      client_name: r.contracts?.counterparty ?? null,
      reminder_count: counts.get(r.id) ?? 0,
    };
    return toAgingRow(input, today);
  });

  return { rows, base_currency: base, today, fx_missing_currencies: [...missing] };
}

export interface ReminderRow {
  id: string;
  invoice_id: string;
  reminder_number: number;
  channel: string;
  template: string | null;
  notes: string | null;
  status: string;
  sent_at: string;
  sent_by: string | null;
  sent_by_name: string | null;
}

export function toReminderRow(r: Record<string, any>): ReminderRow {
  return {
    id: r.id,
    invoice_id: r.invoice_id,
    reminder_number: Number(r.reminder_number ?? 0),
    channel: r.channel,
    template: r.template ?? null,
    notes: r.response_notes ?? null,
    status: r.status,
    sent_at: r.sent_at,
    sent_by: r.sent_by ?? null,
    sent_by_name: r.profiles?.full_name ?? null,
  };
}

/** Next reminder_number for an invoice = max(existing) + 1 (starts at 1). */
export async function nextReminderNumber(ctx: AuthContext, invoiceId: string): Promise<number> {
  const { data, error } = await ctx.supabase
    .from("ar_reminders")
    .select("reminder_number")
    .eq("invoice_id", invoiceId)
    .order("reminder_number", { ascending: false })
    .limit(1);
  if (error) throw error;
  const rows = (data ?? []) as { reminder_number: number }[];
  return rows.length === 0 ? 1 : Number(rows[0].reminder_number) + 1;
}
