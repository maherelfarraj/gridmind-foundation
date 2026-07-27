// P-201 — RLS stub for bond_instruments, bond_claims and bond_renewals.
//
// Company A must never see company B's bonds, the external portal viewer sees
// zero rows, DELETE is impossible (no grant) and bond_renewals is append-only.
//
// Runs only under vitest.config.all.ts. Self-skips when Supabase is unreachable.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isSupabaseUp, serviceClient, setupFixtures, type Fixtures } from "./helpers/rls";

const up = await isSupabaseUp();

const BOND_TABLES = ["bond_instruments", "bond_claims", "bond_renewals"] as const;

describe.skipIf(!up)("P-201 bonds & guarantees RLS isolation", () => {
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

    const instrumentId = await plant("bond_instruments", {
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      instrument_type: "performance_bond",
      beneficiary_name: "Employer B",
      beneficiary_type: "employer",
      issuer_name: "Bank B",
      issuer_type: "bank",
      amount: 100000,
      currency_code: "USD",
      issue_date: "2026-01-01",
      expiry_date: "2027-01-01",
      status: "active",
    });

    await plant("bond_claims", {
      company_id: f.B.companyId,
      instrument_id: instrumentId,
      amount: 5000,
      currency_code: "USD",
      reason: "Delay damages",
      status: "submitted",
    });

    await plant("bond_renewals", {
      company_id: f.B.companyId,
      instrument_id: instrumentId,
      previous_expiry: "2027-01-01",
      new_expiry: "2028-01-01",
      premium_amount: 1200,
    });
  });

  afterAll(async () => {
    await f?.cleanup?.();
  });

  for (const table of BOND_TABLES) {
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

  it("company B member sees its own instrument with BG- numbering", async () => {
    const { data, error } = await f.B.client
      .from("bond_instruments" as never)
      .select("id, instrument_number")
      .eq("id", planted.bond_instruments);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
    expect((data as { instrument_number: string }[])[0].instrument_number).toMatch(/^BG-\d{4}$/);
  });

  it("claims are numbered CL-####", async () => {
    const { data } = await f.B.client
      .from("bond_claims" as never)
      .select("claim_number")
      .eq("id", planted.bond_claims);
    expect((data as { claim_number: string }[])[0].claim_number).toMatch(/^CL-\d{4}$/);
  });

  it("bond_renewals is append-only: UPDATE affects no rows", async () => {
    const { data, error } = await f.B.client
      .from("bond_renewals" as never)
      .update({ notes: "tamper" } as never)
      .eq("id", planted.bond_renewals)
      .select("id");
    expect(error === null ? (data ?? []) : []).toHaveLength(0);
  });

  it("expiry_date >= issue_date CHECK rejects bad dates", async () => {
    const svc = serviceClient();
    const { error } = await svc.from("bond_instruments" as never).insert({
      company_id: f.B.companyId,
      instrument_type: "bid_bond",
      beneficiary_name: "X",
      issuer_name: "Y",
      amount: 10,
      currency_code: "USD",
      issue_date: "2026-06-01",
      expiry_date: "2026-05-01",
    } as never);
    expect(error).not.toBeNull();
  });

  it("unique(company_id, instrument_number) holds", async () => {
    const svc = serviceClient();
    const { data: existing } = await svc
      .from("bond_instruments" as never)
      .select("instrument_number")
      .eq("id", planted.bond_instruments)
      .single();
    const { error } = await svc.from("bond_instruments" as never).insert({
      company_id: f.B.companyId,
      instrument_number: (existing as { instrument_number: string }).instrument_number,
      instrument_type: "bid_bond",
      beneficiary_name: "X",
      issuer_name: "Y",
      amount: 10,
      currency_code: "USD",
    } as never);
    expect(error).not.toBeNull();
  });

  it("cross-tenant write is blocked: company A cannot update B's instrument", async () => {
    const { data } = await f.A.client
      .from("bond_instruments" as never)
      .update({ status: "released" } as never)
      .eq("id", planted.bond_instruments)
      .select("id");
    expect(data ?? []).toHaveLength(0);
  });
});
