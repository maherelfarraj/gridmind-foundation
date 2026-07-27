// P-195 — AR aging & collections server functions.
// Thin wrapper module: imports + createServerFn declarations only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  GetArAgingSchema,
  SendReminderSchema,
  bucketBars,
  expectedCash,
  forecastByMonth,
  groupByClient,
  groupByProject,
  overdueOf,
  sumBuckets,
  totalOf,
  type AgingGroup,
  type AgingInvoiceRow,
  type BucketBar,
  type BucketSums,
  type ForecastMonth,
} from "@/lib/ar-aging.rules";
import {
  AR_WRITE_ROLES,
  loadAgingDataset,
  nextReminderNumber,
  toReminderRow,
  type ReminderRow,
} from "@/lib/ar-aging.server";
import { toCsv } from "@/lib/csv";
import { assertExportAllowed } from "@/lib/export-guard";
import { AGING_BUCKETS, AGING_BUCKET_LABELS } from "@/lib/finance/aging-weights";
import { audit, hasAnyRole, httpError } from "@/lib/payments.server";

export type { AgingGroup, AgingInvoiceRow, ReminderRow };

export interface ArAgingResult {
  base_currency: string;
  today: string;
  by_client: AgingGroup[];
  by_project: AgingGroup[];
  invoices: AgingInvoiceRow[];
  totals: BucketSums;
  total_ar: number;
  overdue_ar: number;
  expected_cash: number;
  bars: BucketBar[];
  forecast: ForecastMonth[];
  fx_missing_currencies: string[];
}

// ---------------------------------------------------------------------------
// Aging report
// ---------------------------------------------------------------------------
export const getArAging = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => GetArAgingSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<ArAgingResult> => {
    requireSupabaseAuth(context);
    const ds = await loadAgingDataset(context, { project_id: data.project_id });
    const by_client = groupByClient(ds.rows);
    const by_project = groupByProject(ds.rows);
    const totals = sumBuckets(by_client);
    return {
      base_currency: ds.base_currency,
      today: ds.today,
      by_client,
      by_project,
      invoices: ds.rows,
      totals,
      total_ar: totalOf(totals),
      overdue_ar: overdueOf(totals),
      expected_cash: expectedCash(totals),
      bars: bucketBars(totals),
      forecast: forecastByMonth(ds.rows, ds.today),
      fx_missing_currencies: ds.fx_missing_currencies,
    };
  });

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------
export const getArAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ canRemind: boolean }> => {
    requireSupabaseAuth(context);
    return { canRemind: await hasAnyRole(context, AR_WRITE_ROLES) };
  });

// ---------------------------------------------------------------------------
// Dunning
// ---------------------------------------------------------------------------
export const sendArReminder = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => SendReminderSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ reminder: ReminderRow }> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, AR_WRITE_ROLES))) httpError(403, "forbidden");

    const { data: inv, error: invErr } = await context.supabase
      .from("invoices")
      .select("id, company_id, invoice_number, direction")
      .eq("id", data.invoice_id)
      .maybeSingle();
    if (invErr) throw invErr;
    if (!inv) httpError(404, "invoice_not_found", "Invoice not found.");
    const invoice = inv as {
      id: string;
      company_id: string;
      invoice_number: string;
      direction: string;
    };
    if (invoice.direction !== "receivable") {
      httpError(422, "not_receivable", "Reminders apply to receivable invoices only.");
    }

    const reminder_number = await nextReminderNumber(context, invoice.id);
    const { data: ins, error } = await context.supabase
      .from("ar_reminders")
      .insert({
        company_id: invoice.company_id,
        invoice_id: invoice.id,
        reminder_number,
        channel: data.channel,
        template: data.template,
        response_notes: data.notes ?? null,
        sent_by: context.user!.id,
      } as never)
      .select("*")
      .maybeSingle();
    if (error) throw error;

    const reminder = toReminderRow(ins as Record<string, unknown>);
    await audit(context, "reminder.send", "ar_reminders", reminder.id, {
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      reminder_number,
      channel: data.channel,
    });
    return { reminder };
  });

export const listInvoiceReminders = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ invoice_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ rows: ReminderRow[] }> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("ar_reminders")
      .select("*, profiles:sent_by(full_name)")
      .eq("invoice_id", data.invoice_id)
      .order("reminder_number", { ascending: false });
    if (error) throw error;
    return { rows: ((rows ?? []) as Record<string, unknown>[]).map(toReminderRow) };
  });

// ---------------------------------------------------------------------------
// CSV export (P-113 gated)
// ---------------------------------------------------------------------------
export const exportArAgingCsv = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => GetArAgingSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<{ filename: string; csv: string }> => {
    requireSupabaseAuth(context);
    await assertExportAllowed(context.supabase, data.project_id ?? null, "csv");
    const ds = await loadAgingDataset(context, { project_id: data.project_id });
    const csv = toCsv(
      [
        "Invoice",
        "Client",
        "Project",
        "Due date",
        "Days past due",
        "Bucket",
        "Currency",
        "Balance",
        `Balance (${ds.base_currency})`,
        "Reminders",
      ],
      ds.rows.map((r) => [
        r.invoice_number,
        r.client_name ?? "Unlinked",
        r.project_name ?? "Unlinked",
        r.due_date ?? "",
        r.days_past_due,
        AGING_BUCKET_LABELS[r.bucket],
        r.currency_code,
        r.balance.toFixed(2),
        r.fx_missing ? "" : r.base_balance.toFixed(2),
        r.reminder_count,
      ]),
    );
    void AGING_BUCKETS;
    return { filename: `ar-aging-${ds.today}.csv`, csv };
  });
