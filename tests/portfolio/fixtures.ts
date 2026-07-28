// P-256 — Portfolio aggregation fixture tenant.
//
// A single throw-away tenant holding THREE projects in different phases,
// different contract currencies and different HSE/quality states. Every
// number below is chosen so the expected aggregation can be computed by hand
// (see EXPECTED) and asserted to the cent.
//
// Teardown goes through `fixture_purge_tenants` (Batch 32 doctrine) — a plain
// companies.delete() silently no-ops while any child FK survives.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { deleteFixtureUsers, purgeFixtureTenants } from "../helpers/fixture-teardown";

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const ANON =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function isSupabaseUp(): Promise<boolean> {
  try {
    if (!URL || !ANON || !SERVICE) return false;
    const res = await fetch(`${URL}/auth/v1/health`, {
      headers: { apikey: ANON },
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function serviceClient(): SupabaseClient<Database> {
  return createClient<Database>(URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function anonClient(): SupabaseClient<Database> {
  return createClient<Database>(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function jwtClient(token: string): SupabaseClient<Database> {
  return createClient<Database>(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export async function createUser(
  svc: SupabaseClient<Database>,
  prefix: string,
): Promise<{ userId: string; email: string; jwt: string; client: SupabaseClient<Database> }> {
  const email = `${prefix}-${crypto.randomUUID().slice(0, 8)}@gm-p256-test.local`;
  const password = `Pw!${crypto.randomUUID()}`;
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  const auth = anonClient();
  const { data: signIn, error: signErr } = await auth.auth.signInWithPassword({ email, password });
  if (signErr || !signIn.session) throw signErr ?? new Error("sign-in failed");
  return {
    userId: data.user.id,
    email,
    jwt: signIn.session.access_token,
    client: jwtClient(signIn.session.access_token),
  };
}

export async function createTenant(
  svc: SupabaseClient<Database>,
  label: string,
): Promise<{ companyId: string }> {
  const { data, error } = await svc
    .from("companies")
    .insert({
      name: `P256 ${label}`,
      slug: `p256-${label}-${crypto.randomUUID().slice(0, 8)}`,
      plan_tier: "enterprise",
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("company insert failed");
  return { companyId: data.id };
}

export async function attachProfile(
  svc: SupabaseClient<Database>,
  userId: string,
  email: string,
  companyId: string,
  role: Database["public"]["Enums"]["app_role"],
): Promise<void> {
  const { error: pErr } = await svc.from("profiles").upsert({ id: userId, company_id: companyId, email });
  if (pErr) throw pErr;
  const { error: rErr } = await svc
    .from("user_roles")
    .insert({ user_id: userId, company_id: companyId, role });
  if (rErr) throw rErr;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
};
/** First day of the current month — cash rows land here on purpose. */
export const currentMonth = (): string => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
};

export interface PortfolioFixture {
  svc: SupabaseClient<Database>;
  companyId: string;
  userId: string;
  client: SupabaseClient<Database>;
  projects: { A: string; B: string; C: string };
  codes: { A: string; B: string; C: string };
  cleanup: () => Promise<void>;
}

/** Hand-computed expectations for the 3-project fixture. */
export const EXPECTED = {
  baseCurrency: "USD",
  projects: { total: 3, byPhase: { development: 1, ntp: 1, cod: 1 } },
  // 10,000,000 + 20,000,000 + 3,000,000 (the 5,000,000 cancelled one is out)
  contractValue: 33_000_000,
  evm: {
    pv: 3_600_000,
    ev: 3_500_000,
    ac: 3_430_000,
    bac: 14_000_000,
    // weighted, never an average of ratios: 3.5M / 3.6M and 3.5M / 3.43M
    spi: 0.972222,
    cpi: 1.020408,
    projectsCounted: 3,
  },
  arOpen: 1_160_000, // 1,000,000 + 160,000 tax − 0 paid
  apOpen: 400_000,
  cashMtd: { inflow: 50_000, outflow: 44_000 },
  curve: {
    // FX fixed at entry: 90,000 EUR @1.10 = 99,000 · 71,000 JOD @1.41 = 100,110
    forecastInflow: 200_110,
    forecastOutflow: 99_000,
    actualInflow: 50_000,
    actualOutflow: 44_000,
    forecastNet: 101_110,
    actualNet: 6_000,
  },
  perProjectCurve: {
    A: { forecastInflow: 100_000, actualInflow: 50_000, forecastOutflow: 0, actualOutflow: 0 },
    B: { forecastInflow: 0, actualInflow: 0, forecastOutflow: 99_000, actualOutflow: 44_000 },
    C: { forecastInflow: 100_110, actualInflow: 0, forecastOutflow: 0, actualOutflow: 0 },
  },
  hse: {
    incidentsOpen: 2,
    incidentsTotal: 3,
    recordable: 2,
    exposureHours: 24_000, // 12,000 + 8,000 + 4,000 (uneven manhours)
    trir: 16.6667, // 2 × 200,000 / 24,000
    punchOpen: { A: 2, B: 1, C: 1 },
    punchOpenTotal: 4,
    ncrOpen: 1,
    holdPointsOpen: 1,
  },
  cards: {
    A: { spi: 0.9, cpi: 0.947368, punchAOpen: 2, gatesTotal: 3, gatesApproved: 1 },
    B: { spi: 1.1, cpi: 1.047619, punchAOpen: 0, gatesTotal: 4, gatesApproved: 4 },
    C: { spi: 0.666667, cpi: 1.052632, punchAOpen: 0, gatesTotal: 3, gatesApproved: 2 },
  },
} as const;

export async function setupPortfolioFixture(): Promise<PortfolioFixture> {
  const svc = serviceClient();
  const { companyId } = await createTenant(svc, "agg");
  const user = await createUser(svc, "p256-admin");
  await attachProfile(svc, user.userId, user.email, companyId, "company_admin");

  const stamp = crypto.randomUUID().slice(0, 6).toUpperCase();
  const codes = { A: `P256-${stamp}-A`, B: `P256-${stamp}-B`, C: `P256-${stamp}-C` };

  const one = async <T,>(table: string, payload: Record<string, unknown>): Promise<T> => {
    const { data, error } = await svc
      .from(table as never)
      .insert(payload as never)
      .select("id")
      .single();
    if (error || !data) throw new Error(`${table}: ${error?.message}`);
    return data as T;
  };
  const many = async (table: string, rows: Record<string, unknown>[]) => {
    const { error } = await svc.from(table as never).insert(rows as never);
    if (error) throw new Error(`${table}: ${error.message}`);
  };

  const mkProject = async (code: string, name: string, phase: string) =>
    (
      await one<{ id: string }>("projects", {
        company_id: companyId,
        code,
        name,
        archetype: "utility_pv",
        phase,
        status: "active",
        created_by: user.userId,
      })
    ).id;

  const A = await mkProject(codes.A, "P256 Alpha (development)", "development");
  const B = await mkProject(codes.B, "P256 Bravo (ntp)", "ntp");
  const C = await mkProject(codes.C, "P256 Charlie (cod)", "cod");

  // Financial config — one base currency for the tenant; the currency mix
  // lives in contracts and cash flows, converted at entry FX.
  await many(
    "project_financial_config",
    [A, B, C].map((id) => ({ company_id: companyId, project_id: id, currency_code: "USD" })),
  );

  // ---------------------------------------------------------------- EVM ----
  const today = iso(new Date());
  await many("evm_snapshots", [
    // stale snapshot: must be ignored in favour of today's row
    {
      company_id: companyId,
      project_id: A,
      snapshot_date: iso(daysAgo(30)),
      planned_value: 10,
      earned_value: 10,
      actual_cost: 10,
      budget_at_completion: 10,
      currency_code: "USD",
    },
    {
      company_id: companyId,
      project_id: A,
      snapshot_date: today,
      planned_value: 1_000_000,
      earned_value: 900_000,
      actual_cost: 950_000,
      budget_at_completion: 4_000_000,
      currency_code: "USD",
    },
    {
      company_id: companyId,
      project_id: B,
      snapshot_date: today,
      planned_value: 2_000_000,
      earned_value: 2_200_000,
      actual_cost: 2_100_000,
      budget_at_completion: 8_000_000,
      currency_code: "USD",
    },
    {
      company_id: companyId,
      project_id: C,
      snapshot_date: today,
      planned_value: 600_000,
      earned_value: 400_000,
      actual_cost: 380_000,
      budget_at_completion: 2_000_000,
      currency_code: "USD",
    },
  ]);

  // ---------------------------------------------------------- Contracts ----
  await many("contracts", [
    {
      company_id: companyId,
      project_id: A,
      contract_number: `${codes.A}-C1`,
      title: "Alpha EPC",
      counterparty: "Client A",
      status: "active",
      value: 10_000_000,
      currency_code: "USD",
    },
    {
      company_id: companyId,
      project_id: B,
      contract_number: `${codes.B}-C1`,
      title: "Bravo EPC",
      counterparty: "Client B",
      status: "signed",
      value: 20_000_000,
      currency_code: "EUR",
    },
    {
      company_id: companyId,
      project_id: C,
      contract_number: `${codes.C}-C1`,
      title: "Charlie EPC",
      counterparty: "Client C",
      status: "active",
      value: 3_000_000,
      currency_code: "JOD",
    },
    {
      company_id: companyId,
      project_id: C,
      contract_number: `${codes.C}-C2`,
      title: "Charlie cancelled scope",
      counterparty: "Client C",
      status: "terminated",
      value: 5_000_000,
      currency_code: "JOD",
    },
  ]);

  // ----------------------------------------------------------- Invoices ----
  await many("invoices", [
    {
      company_id: companyId,
      project_id: A,
      invoice_number: `${codes.A}-AR1`,
      direction: "receivable",
      status: "submitted",
      amount: 1_000_000,
      tax_amount: 160_000,
      currency_code: "USD",
    },
    {
      company_id: companyId,
      project_id: B,
      invoice_number: `${codes.B}-AP1`,
      direction: "payable",
      status: "approved",
      amount: 400_000,
      tax_amount: 0,
      currency_code: "USD",
    },
  ]);

  // --------------------------------------------------------- Cash flows ----
  const period = currentMonth();
  await many("cash_flows", [
    {
      company_id: companyId,
      project_id: A,
      period,
      direction: "inflow",
      kind: "forecast",
      category: "milestone_billing",
      amount: 100_000,
      currency_code: "USD",
      amount_base: 100_000,
      base_currency_code: "USD",
      fx_rate_to_base: 1,
      voided: false,
    },
    {
      company_id: companyId,
      project_id: A,
      period,
      direction: "inflow",
      kind: "actual",
      category: "milestone_billing",
      amount: 50_000,
      currency_code: "USD",
      amount_base: 50_000,
      base_currency_code: "USD",
      fx_rate_to_base: 1,
      voided: false,
    },
    {
      company_id: companyId,
      project_id: B,
      period,
      direction: "outflow",
      kind: "forecast",
      category: "po_payment",
      amount: 90_000,
      currency_code: "EUR",
      amount_base: 99_000,
      base_currency_code: "USD",
      fx_rate_to_base: 1.1,
      voided: false,
    },
    {
      company_id: companyId,
      project_id: B,
      period,
      direction: "outflow",
      kind: "actual",
      category: "po_payment",
      amount: 40_000,
      currency_code: "EUR",
      amount_base: 44_000,
      base_currency_code: "USD",
      fx_rate_to_base: 1.1,
      voided: false,
    },
    {
      company_id: companyId,
      project_id: C,
      period,
      direction: "inflow",
      kind: "forecast",
      category: "milestone_billing",
      amount: 71_000,
      currency_code: "JOD",
      amount_base: 100_110,
      base_currency_code: "USD",
      fx_rate_to_base: 1.41,
      voided: false,
    },
    {
      // voided rows never reach the curve
      company_id: companyId,
      project_id: C,
      period,
      direction: "inflow",
      kind: "forecast",
      category: "milestone_billing",
      amount: 999_999,
      currency_code: "USD",
      amount_base: 999_999,
      base_currency_code: "USD",
      voided: true,
    },
  ]);

  // ---------------------------------------------------- Gates / rail -------
  const gate = (project: string, prefix: string, phase: string, i: number, status: string) => ({
    company_id: companyId,
    project_id: project,
    phase,
    name: `${prefix}-G${i}`,
    sort_order: i,
    status,
  });
  await many("project_phase_gates", [
    gate(A, "A", "development", 1, "approved"),
    gate(A, "A", "development", 2, "pending"),
    gate(A, "A", "ntp", 3, "locked"),
    gate(B, "B", "development", 1, "approved"),
    gate(B, "B", "ntp", 2, "approved"),
    gate(B, "B", "cod", 3, "approved"),
    gate(B, "B", "handover", 4, "approved"),
    gate(C, "C", "development", 1, "approved"),
    gate(C, "C", "ntp", 2, "approved"),
    gate(C, "C", "cod", 3, "pending"),
  ]);

  // --------------------------------------------------------- HSE / DPR ----
  const dpr = async (project: string, hours: number, headcount: number, back: number) => {
    const row = await one<{ id: string }>("construction_daily_reports", {
      company_id: companyId,
      project_id: project,
      report_date: iso(daysAgo(back)),
      shift: "day",
      status: "approved",
      total_manpower: headcount,
      total_hours: hours,
    });
    await many("manpower_logs", [
      { company_id: companyId, dpr_id: row.id, trade: "electrical", headcount, hours },
    ]);
  };
  await dpr(A, 12_000, 120, 10);
  await dpr(B, 8_000, 80, 12);
  await dpr(C, 4_000, 40, 14);

  await many("hse_incidents", [
    {
      company_id: companyId,
      project_id: A,
      incident_number: `${codes.A}-HSE-0001`,
      incident_type: "injury",
      severity: "major",
      occurred_at: daysAgo(9).toISOString(),
      description: "Recordable hand injury",
      osha_recordable: true,
      status: "open",
    },
    {
      company_id: companyId,
      project_id: B,
      incident_number: `${codes.B}-HSE-0001`,
      incident_type: "injury",
      severity: "moderate",
      occurred_at: daysAgo(20).toISOString(),
      description: "Recordable strain, closed out",
      osha_recordable: true,
      status: "closed",
    },
    {
      company_id: companyId,
      project_id: C,
      incident_number: `${codes.C}-HSE-0001`,
      incident_type: "near_miss",
      severity: "minor",
      occurred_at: daysAgo(4).toISOString(),
      description: "Near miss, not recordable",
      osha_recordable: false,
      status: "open",
    },
  ]);

  // -------------------------------------------------------------- Punch ----
  const punch = (project: string, n: number, category: string, status: string) => ({
    company_id: companyId,
    project_id: project,
    punch_number: `${project.slice(0, 4)}-P${n}-${crypto.randomUUID().slice(0, 4)}`,
    walk_date: iso(daysAgo(5)),
    area: "Block 1",
    discipline: "electrical",
    category,
    description: `Punch ${category}`,
    status,
  });
  await many("qaqc_punch_items", [
    punch(A, 1, "A", "open"),
    punch(A, 2, "A", "open"),
    punch(A, 3, "B", "ready_for_review"),
    punch(B, 4, "C", "open"),
    punch(C, 5, "A", "closed"),
  ]);

  // --------------------------------------------------------------- NCRs ----
  await many("ncrs", [
    {
      company_id: companyId,
      project_id: B,
      ncr_number: `${codes.B}-NCR-0001`,
      source: "inspection",
      description: "Torque values out of spec",
      status: "open",
    },
    {
      company_id: companyId,
      project_id: B,
      ncr_number: `${codes.B}-NCR-0002`,
      source: "inspection",
      description: "Closed finding",
      status: "closed",
    },
  ]);

  // ------------------------------------------------------- ITP hold pts ----
  const itpA = await one<{ id: string }>("inspection_test_plans", {
    company_id: companyId,
    project_id: A,
    itp_number: `${codes.A}-ITP-01`,
    title: "Alpha ITP",
    discipline: "electrical",
    status: "approved",
  });
  const itpC = await one<{ id: string }>("inspection_test_plans", {
    company_id: companyId,
    project_id: C,
    itp_number: `${codes.C}-ITP-01`,
    title: "Charlie ITP",
    discipline: "electrical",
    status: "approved",
  });
  await many("itp_steps", [
    {
      company_id: companyId,
      itp_id: itpA.id,
      seq: 1,
      description: "Hold: cable megger",
      point_type: "hold",
      status: "pending",
    },
    {
      company_id: companyId,
      itp_id: itpA.id,
      seq: 2,
      description: "Witness: torque check",
      point_type: "witness",
      status: "pending",
    },
    {
      company_id: companyId,
      itp_id: itpC.id,
      seq: 1,
      description: "Hold: signed off",
      point_type: "hold",
      status: "signed_off",
    },
  ]);

  return {
    svc,
    companyId,
    userId: user.userId,
    client: user.client,
    projects: { A, B, C },
    codes,
    cleanup: async () => {
      await purgeFixtureTenants(svc, [companyId]);
      await deleteFixtureUsers(svc, [user.userId]);
    },
  };
}
