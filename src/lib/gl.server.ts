// P-208 — GL export I/O helpers. Kept out of *.functions.ts so the server-fn
// splitter never drops module-scope siblings.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { safeRows } from "@/lib/finance-cockpit.server";
import { hasAnyRole, httpError } from "@/lib/payments.server";
import { loadFxRates } from "@/lib/ar-aging.server";
import {
  CHANGE_ORDER_STATUSES,
  DEBIT_NOTE_STATUSES,
  GL_WRITE_ROLES,
  PAYABLE_INVOICE_STATUSES,
  PAY_APP_STATUSES,
  RECEIVABLE_INVOICE_STATUSES,
  round2,
  type GlLine,
  type GlMapping,
  type GlSourceEvent,
} from "@/lib/gl.rules";

export const GL_BUCKET = "documents";
const DEFAULT_BASE_CURRENCY = "USD";

export async function glCompanyId(ctx: AuthContext): Promise<string> {
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

export async function canWriteGl(ctx: AuthContext): Promise<boolean> {
  return hasAnyRole(ctx, GL_WRITE_ROLES);
}

export async function assertGlWrite(ctx: AuthContext): Promise<void> {
  if (!(await canWriteGl(ctx))) {
    httpError(403, "forbidden", "Only finance admins or company admins can generate GL exports.");
  }
}

/** Company base currency: the single project config currency, else USD. */
export async function resolveCompanyBaseCurrency(ctx: AuthContext): Promise<string> {
  const rows =
    (await safeRows<{ currency_code: string | null }>(() =>
      ctx.supabase.from("project_financial_config").select("currency_code"),
    )) ?? [];
  const distinct = [...new Set(rows.map((r) => r.currency_code).filter(Boolean))] as string[];
  return distinct.length === 1 ? distinct[0] : DEFAULT_BASE_CURRENCY;
}

export async function loadMappings(ctx: AuthContext): Promise<GlMapping[]> {
  const rows =
    (await safeRows<GlMapping & { id: string }>(() =>
      ctx.supabase
        .from("gl_account_mappings")
        .select(
          "id, event_type, debit_account_code, debit_account_name, credit_account_code, credit_account_name, enabled",
        )
        .order("event_type"),
    )) ?? [];
  return rows;
}

// ------------------------------------------------------------- sources

interface RawInvoice {
  id: string;
  invoice_number: string;
  direction: string;
  status: string;
  issue_date: string | null;
  amount: number | string;
  tax_amount: number | string;
  currency_code: string;
  project_id: string | null;
  milestone_label: string | null;
  contracts: { counterparty: string | null } | null;
  vendors: { name: string | null } | null;
}

interface RawPayment {
  id: string;
  payment_number: string | null;
  direction: string | null;
  record_status: string;
  payment_date: string;
  amount: number | string;
  amount_base: number | string | null;
  currency_code: string;
  base_currency_code: string | null;
  project_id: string | null;
  invoices: { invoice_number: string | null; direction: string | null } | null;
}

interface RawPayApp {
  id: string;
  application_number: number;
  status: string;
  period_end: string;
  retention_amount: number | string;
  project_id: string | null;
  contracts: { counterparty: string | null } | null;
}

interface RawChangeOrder {
  id: string;
  co_number: string;
  title: string | null;
  status: string;
  approved_at: string | null;
  created_at: string;
  amount: number | string;
  currency_code: string | null;
  project_id: string | null;
  contracts: { counterparty: string | null } | null;
}

interface RawDebitNote {
  id: string;
  note_number: string;
  status: string;
  issued_at: string | null;
  reason: string | null;
  amount: number | string;
  currency_code: string;
  project_id: string | null;
  contracts: { counterparty: string | null } | null;
}

function inRange(date: string | null, from: string, to: string): boolean {
  return Boolean(date) && date! >= from && date! <= to;
}

/**
 * Gather every ledger-eligible event in range and convert to base currency.
 * FX discipline (P-077/P-193): payments carry a frozen amount_base; other
 * documents use the rate on their own posting date, never today's rate.
 */
export async function gatherSourceEvents(
  ctx: AuthContext,
  periodFrom: string,
  periodTo: string,
  baseCurrency: string,
): Promise<{ events: GlSourceEvent[]; fx_missing: string[] }> {
  const [invoices, payments, payApps, changeOrders, debitNotes] = await Promise.all([
    safeRows<RawInvoice>(() =>
      ctx.supabase
        .from("invoices")
        .select(
          "id, invoice_number, direction, status, issue_date, amount, tax_amount, currency_code, project_id, milestone_label, contracts(counterparty), vendors(name)" as string,
        )
        .gte("issue_date", periodFrom)
        .lte("issue_date", periodTo),
    ),
    safeRows<RawPayment>(() =>
      ctx.supabase
        .from("payments")
        .select(
          "id, payment_number, direction, record_status, payment_date, amount, amount_base, currency_code, base_currency_code, project_id, invoices(invoice_number, direction)" as string,
        )
        .gte("payment_date", periodFrom)
        .lte("payment_date", periodTo),
    ),
    safeRows<RawPayApp>(() =>
      ctx.supabase
        .from("pay_applications")
        .select(
          "id, application_number, status, period_end, retention_amount, project_id, contracts(counterparty)" as string,
        )
        .gte("period_end", periodFrom)
        .lte("period_end", periodTo),
    ),
    safeRows<RawChangeOrder>(() =>
      ctx.supabase
        .from("change_orders")
        .select(
          "id, co_number, title, status, approved_at, created_at, amount, currency_code, project_id, contracts(counterparty)" as string,
        ),
    ),
    safeRows<RawDebitNote>(() =>
      ctx.supabase
        .from("debit_notes")
        .select(
          "id, note_number, status, issued_at, reason, amount, currency_code, project_id, contracts(counterparty)" as string,
        )
        .gte("issued_at", periodFrom)
        .lte("issued_at", periodTo),
    ),
  ]);

  const currencies = new Set<string>([baseCurrency]);
  for (const i of invoices ?? []) currencies.add(i.currency_code);
  for (const c of changeOrders ?? []) if (c.currency_code) currencies.add(c.currency_code);
  for (const d of debitNotes ?? []) currencies.add(d.currency_code);
  const fx = await loadFxRates(ctx, [...currencies], baseCurrency, periodTo);
  const fxMissing = new Set<string>();

  const toBase = (amount: number, currency: string): number | null => {
    if (currency === baseCurrency) return round2(amount);
    const rate = fx.get(currency);
    if (!rate) {
      fxMissing.add(currency);
      return null;
    }
    return round2(amount * rate);
  };

  const events: GlSourceEvent[] = [];

  for (const inv of invoices ?? []) {
    const gross = Number(inv.amount ?? 0) + Number(inv.tax_amount ?? 0);
    const isReceivable = inv.direction === "receivable";
    const eligible = isReceivable
      ? (RECEIVABLE_INVOICE_STATUSES as readonly string[]).includes(inv.status)
      : (PAYABLE_INVOICE_STATUSES as readonly string[]).includes(inv.status);
    if (!eligible) continue;
    const base = toBase(gross, inv.currency_code);
    if (base === null) continue;
    events.push({
      event_type: isReceivable ? "invoice_receivable_issued" : "invoice_payable_received",
      source_type: "invoice",
      source_id: inv.id,
      source_number: inv.invoice_number,
      counterparty: inv.contracts?.counterparty ?? inv.vendors?.name ?? null,
      detail: inv.milestone_label,
      entry_date: inv.issue_date!,
      amount_base: base,
      currency_code: inv.currency_code,
      project_id: inv.project_id,
    });
  }

  for (const pay of payments ?? []) {
    if (pay.record_status !== "recorded") continue;
    const direction = pay.direction ?? pay.invoices?.direction ?? "receivable";
    // Frozen base amount wins; fall back to the period rate only when absent.
    const frozen = pay.amount_base === null ? null : Number(pay.amount_base);
    const base =
      frozen !== null && Number.isFinite(frozen) && frozen > 0
        ? round2(frozen)
        : toBase(Number(pay.amount ?? 0), pay.currency_code);
    if (base === null) continue;
    events.push({
      event_type: direction === "receivable" ? "payment_received" : "payment_made",
      source_type: "payment",
      source_id: pay.id,
      source_number: pay.payment_number ?? `PAY-${pay.id.slice(0, 8)}`,
      counterparty: pay.invoices?.invoice_number ?? null,
      detail: direction === "receivable" ? "collection" : "disbursement",
      entry_date: pay.payment_date,
      amount_base: base,
      currency_code: pay.base_currency_code ?? pay.currency_code,
      project_id: pay.project_id,
    });
  }

  for (const app of payApps ?? []) {
    if (!(PAY_APP_STATUSES as readonly string[]).includes(app.status)) continue;
    const retention = Number(app.retention_amount ?? 0);
    if (retention <= 0) continue;
    events.push({
      event_type: "retention_withheld",
      source_type: "pay_application",
      source_id: app.id,
      source_number: `PA-${String(app.application_number).padStart(3, "0")}`,
      counterparty: app.contracts?.counterparty ?? null,
      detail: "retention withheld",
      entry_date: app.period_end,
      amount_base: round2(retention),
      currency_code: baseCurrency,
      project_id: app.project_id,
    });
  }

  for (const co of changeOrders ?? []) {
    if (!(CHANGE_ORDER_STATUSES as readonly string[]).includes(co.status)) continue;
    const date = (co.approved_at ?? co.created_at).slice(0, 10);
    if (!inRange(date, periodFrom, periodTo)) continue;
    const base = toBase(Number(co.amount ?? 0), co.currency_code ?? baseCurrency);
    if (base === null || base <= 0) continue;
    events.push({
      event_type: "change_order_approved",
      source_type: "change_order",
      source_id: co.id,
      source_number: co.co_number,
      counterparty: co.contracts?.counterparty ?? null,
      detail: co.title,
      entry_date: date,
      amount_base: base,
      currency_code: co.currency_code ?? baseCurrency,
      project_id: co.project_id,
    });
  }

  for (const note of debitNotes ?? []) {
    if (!(DEBIT_NOTE_STATUSES as readonly string[]).includes(note.status)) continue;
    const base = toBase(Number(note.amount ?? 0), note.currency_code);
    if (base === null || base <= 0) continue;
    events.push({
      event_type: "debit_note_issued",
      source_type: "debit_note",
      source_id: note.id,
      source_number: note.note_number,
      counterparty: note.contracts?.counterparty ?? null,
      detail: note.reason,
      entry_date: note.issued_at!,
      amount_base: base,
      currency_code: note.currency_code,
      project_id: note.project_id,
    });
  }

  events.sort((a, b) =>
    a.entry_date === b.entry_date
      ? a.source_number.localeCompare(b.source_number)
      : a.entry_date.localeCompare(b.entry_date),
  );
  return { events, fx_missing: [...fxMissing] };
}

// ---------------------------------------------------------------- runs

export interface GlRunRow {
  id: string;
  run_number: string;
  period_from: string;
  period_to: string;
  status: "generated" | "downloaded" | "superseded";
  base_currency_code: string;
  row_count: number;
  total_debit: number;
  total_credit: number;
  file_path: string | null;
  superseded_by: string | null;
  created_at: string;
}

export async function loadRuns(ctx: AuthContext): Promise<GlRunRow[]> {
  const rows =
    (await safeRows<GlRunRow>(() =>
      ctx.supabase
        .from("gl_export_runs")
        .select(
          "id, run_number, period_from, period_to, status, base_currency_code, row_count, total_debit, total_credit, file_path, superseded_by, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(50),
    )) ?? [];
  return rows.map((r) => ({
    ...r,
    row_count: Number(r.row_count ?? 0),
    total_debit: Number(r.total_debit ?? 0),
    total_credit: Number(r.total_credit ?? 0),
  }));
}

export async function loadRunLines(ctx: AuthContext, runId: string): Promise<GlLine[]> {
  const rows =
    (await safeRows<GlLine>(() =>
      ctx.supabase
        .from("gl_journal_entries")
        .select(
          "line_no, entry_date, event_type, account_code, account_name, debit, credit, currency_code, memo, source_type, source_id, source_number, project_id",
        )
        .eq("run_id", runId)
        .order("line_no"),
    )) ?? [];
  return rows.map((l) => ({ ...l, debit: Number(l.debit ?? 0), credit: Number(l.credit ?? 0) }));
}

export async function insertRun(
  ctx: AuthContext,
  values: Record<string, unknown>,
): Promise<{ id: string; run_number: string }> {
  const { data, error } = await ctx.supabase
    .from("gl_export_runs")
    .insert(values as never)
    .select("id, run_number")
    .single();
  if (error) throw error;
  return data as { id: string; run_number: string };
}

export async function insertLines(
  ctx: AuthContext,
  companyId: string,
  runId: string,
  lines: readonly GlLine[],
): Promise<void> {
  if (lines.length === 0) return;
  const payload = lines.map((l) => ({ ...l, company_id: companyId, run_id: runId }));
  const { error } = await ctx.supabase.from("gl_journal_entries").insert(payload as never);
  if (error) {
    // Roll the header back so a failed run never lingers half-written.
    await ctx.supabase.from("gl_export_runs").delete().eq("id", runId);
    throw error;
  }
}

/** Mark every prior run for the same range superseded — never deleted. */
export async function supersedePriorRuns(
  ctx: AuthContext,
  periodFrom: string,
  periodTo: string,
  newRunId: string,
): Promise<string[]> {
  const { data, error } = await ctx.supabase
    .from("gl_export_runs")
    .update({
      status: "superseded",
      superseded_by: newRunId,
      superseded_at: new Date().toISOString(),
    } as never)
    .eq("period_from", periodFrom)
    .eq("period_to", periodTo)
    .neq("id", newRunId)
    .neq("status", "superseded")
    .select("run_number");
  if (error) throw error;
  return ((data ?? []) as { run_number: string }[]).map((r) => r.run_number);
}

export async function uploadCsv(ctx: AuthContext, path: string, csv: string): Promise<void> {
  const bytes = new TextEncoder().encode(csv);
  const { error } = await ctx.supabase.storage.from(GL_BUCKET).upload(path, bytes, {
    contentType: "text/csv; charset=utf-8",
    upsert: true,
  });
  if (error) throw error;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
