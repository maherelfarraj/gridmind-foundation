// P-193 — RLS stub for payments, ar_reminders and finance_periods.
//
// Company A must never see company B's finance rows, the external portal
// viewer sees zero rows, and DELETE is impossible (no grant to authenticated).
//
// Runs only under vitest.config.all.ts. Self-skips when Supabase is unreachable.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isSupabaseUp, serviceClient, setupFixtures, type Fixtures } from "./helpers/rls";

const up = await isSupabaseUp();

const FINANCE_TABLES = ["payments", "ar_reminders", "finance_periods"] as const;

describe.skipIf(!up)("P-193 finance core RLS isolation", () => {
  let f: Fixtures;
  const planted: Record<string, string> = {};

  beforeAll(async () => {
    f = await setupFixtures();
    const svc = serviceClient();

    const plant = async (table: string, payload: Record<string, unknown>) => {
      const { data, error } = await svc
        .from(table as never)
        .insert(payload as never)
        .select("id")
        .single();
      if (error) throw new Error(`${table}: ${error.message}`);
      planted[table] = (data as { id: string }).id;
      return planted[table];
    };

    const invoiceId = await plant("invoices", {
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      invoice_number: `INV-P193-${crypto.randomUUID().slice(0, 6)}`,
      direction: "receivable",
      status: "draft",
      amount: 1000,
      tax_amount: 0,
      currency_code: "USD",
    });

    await plant("payments", {
      company_id: f.B.companyId,
      invoice_id: invoiceId,
      amount: 250,
      currency_code: "USD",
      payment_date: new Date().toISOString().slice(0, 10),
      method: "bank_transfer",
    });

    await plant("ar_reminders", {
      company_id: f.B.companyId,
      invoice_id: invoiceId,
      reminder_number: 1,
      channel: "email",
      status: "sent",
    });

    await plant("finance_periods", {
      company_id: f.B.companyId,
      period_month: `${new Date().toISOString().slice(0, 7)}-01`,
      status: "open",
    });
  });

  afterAll(async () => {
    await f?.cleanup?.();
  });

  for (const table of FINANCE_TABLES) {
    it(`company A reads zero company B rows from ${table}`, async () => {
      const { data, error } = await f.A.client
        .from(table as never)
        .select("id")
        .eq("id", planted[table]);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
    });

    it(`external viewer reads zero rows from ${table}`, async () => {
      const { data } = await f.viewer.client
        .from(table as never)
        .select("id")
        .limit(50);
      expect(data ?? []).toHaveLength(0);
    });

    it(`${table} rows cannot be deleted by an authenticated user`, async () => {
      const { error } = await f.B.client
        .from(table as never)
        .delete()
        .eq("id", planted[table]);
      expect(error).not.toBeNull();
    });
  }

  it("company B member still sees its own payment with PM- numbering", async () => {
    const { data, error } = await f.B.client
      .from("payments")
      .select("id, payment_number")
      .eq("id", planted.payments);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
    expect((data as { payment_number: string }[])[0].payment_number).toMatch(/^PM-\d{4}$/);
  });

  it("company A cannot void company B's payment", async () => {
    const { data } = await f.A.client
      .from("payments")
      .update({ record_status: "voided" } as never)
      .eq("id", planted.payments)
      .select("id");
    expect(data ?? []).toHaveLength(0);
  });

  it("unique(invoice_id, reminder_number) holds", async () => {
    const svc = serviceClient();
    const { data: existing } = await svc
      .from("ar_reminders")
      .select("invoice_id")
      .eq("id", planted.ar_reminders)
      .single();
    const { error } = await svc.from("ar_reminders").insert({
      company_id: f.B.companyId,
      invoice_id: (existing as { invoice_id: string }).invoice_id,
      reminder_number: 1,
      channel: "email",
      status: "sent",
    } as never);
    expect(error).not.toBeNull();
  });

  it("unique(company_id, period_month) holds", async () => {
    const svc = serviceClient();
    const { error } = await svc.from("finance_periods").insert({
      company_id: f.B.companyId,
      period_month: `${new Date().toISOString().slice(0, 7)}-01`,
      status: "open",
    } as never);
    expect(error).not.toBeNull();
  });
});
