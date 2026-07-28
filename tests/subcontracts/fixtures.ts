// P-262 — Batch 34 finale: subcontract lifecycle fixture.
//
// ONE throw-away tenant holding a $100,000 subcontract with three SOV lines
// whose amounts do NOT divide evenly (60,000.00 / 33,333.33 / 6,666.67). The
// awkward cents are the point: every expectation in `EXPECTED` is computed by
// hand against the SQL rounding rules
//
//   line.previous_amount     = round(amount * previous_pct / 100, 2)
//   line.this_period_amount  = round(amount * cumulative_pct / 100, 2) - previous_amount
//   claim.retention_amount   = round(this_period_amount * retention_pct / 100, 2)
//   claim.net_payable        = this_period_amount - retention_amount
//
// so a drift of a single cent anywhere in the chain fails the suite.
//
// Teardown goes through `fixture_purge_tenants` (Batch 32 doctrine).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { deleteFixtureUsers, purgeFixtureTenants } from "../helpers/fixture-teardown";
import { anonClient, createUser, isSupabaseUp, serviceClient } from "../portfolio/fixtures";

export { anonClient, createUser, isSupabaseUp, serviceClient };

type Svc = SupabaseClient<Database>;
type Rpc = (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: null | { message: string; code?: string } }>;

export const rpc = (client: SupabaseClient<Database>): Rpc =>
  (client.rpc as unknown as Rpc).bind(client) as Rpc;

const iso = (d: Date) => d.toISOString().slice(0, 10);
export const today = (): string => iso(new Date());
export const daysFromToday = (n: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

// ---------------------------------------------------------------------------
// Hand-computed expectations
// ---------------------------------------------------------------------------
export const SOV = [
  { line_no: 1, description: "Civil works", amount: 60_000.0 },
  { line_no: 2, description: "MV cabling", amount: 33_333.33 },
  { line_no: 3, description: "Commissioning support", amount: 6_666.67 },
] as const;

export const EXPECTED = {
  contractValue: 100_000.0,
  retentionPct: 10,
  paymentTermsDays: 30,
  claims: [
    {
      pct: 40,
      lines: [24_000.0, 13_333.33, 2_666.67],
      thisPeriod: 40_000.0,
      previousCertified: 0,
      grossToDate: 40_000.0,
      retention: 4_000.0,
      netPayable: 36_000.0,
      retentionHeldAfter: 4_000.0,
      certifiedToDateAfter: 40_000.0,
    },
    {
      pct: 35,
      lines: [21_000.0, 11_666.67, 2_333.33],
      thisPeriod: 35_000.0,
      previousCertified: 40_000.0,
      grossToDate: 75_000.0,
      retention: 3_500.0,
      netPayable: 31_500.0,
      retentionHeldAfter: 7_500.0,
      certifiedToDateAfter: 75_000.0,
    },
    {
      pct: 25,
      lines: [15_000.0, 8_333.33, 1_666.67],
      thisPeriod: 25_000.0,
      previousCertified: 75_000.0,
      grossToDate: 100_000.0,
      retention: 2_500.0,
      netPayable: 22_500.0,
      retentionHeldAfter: 10_000.0,
      certifiedToDateAfter: 100_000.0,
    },
  ],
  retention: { retained: 10_000.0, release: 10_000.0, heldAfterRelease: 0 },
  /** Certified sub value that flows into project actual cost (gross, pre-retention). */
  evmActuals: 100_000.0,
} as const;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------
async function one<T extends { id: string }>(
  svc: Svc,
  table: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await svc
    .from(table as never)
    .insert(payload as never)
    .select("id")
    .single();
  if (error || !data) throw new Error(`${table}: ${error?.message}`);
  return data as T;
}

export async function createTenant(svc: Svc, label: string): Promise<string> {
  const { id } = await one<{ id: string }>(svc, "companies", {
    name: `P262 ${label}`,
    slug: `p262-${label}-${crypto.randomUUID().slice(0, 8)}`,
    plan_tier: "enterprise",
  });
  return id;
}

export async function attachMember(
  svc: Svc,
  userId: string,
  email: string,
  companyId: string,
  roles: ReadonlyArray<Database["public"]["Enums"]["app_role"]>,
): Promise<void> {
  const { error: pErr } = await svc
    .from("profiles")
    .upsert({ id: userId, company_id: companyId, email });
  if (pErr) throw pErr;
  if (roles.length === 0) return;
  const { error: rErr } = await svc
    .from("user_roles")
    .insert(roles.map((role) => ({ user_id: userId, company_id: companyId, role })));
  if (rErr) throw rErr;
}

export async function seatPortalUser(
  svc: Svc,
  args: { companyId: string; vendorId: string; userId: string; email: string },
): Promise<void> {
  const { error } = await svc.from("vendor_portal_memberships").insert({
    company_id: args.companyId,
    vendor_id: args.vendorId,
    user_id: args.userId,
    email: args.email,
    status: "active",
    accepted_at: new Date().toISOString(),
  } as never);
  if (error) throw error;
}

/** Insert a submitted claim with one line per SOV line at `pct` this period. */
export async function submitClaim(
  svc: Svc,
  args: {
    companyId: string;
    subcontractId: string;
    lineIds: readonly string[];
    pct: number;
    periodStart: string;
    periodEnd: string;
    userId: string;
  },
): Promise<string> {
  const claim = await one<{ id: string }>(svc, "subcontract_claims", {
    company_id: args.companyId,
    subcontract_id: args.subcontractId,
    period_start: args.periodStart,
    period_end: args.periodEnd,
    status: "submitted",
    submitted_by: args.userId,
    submitted_at: new Date().toISOString(),
    created_by: args.userId,
  });
  const { error } = await svc.from("subcontract_claim_lines").insert(
    args.lineIds.map((id) => ({
      company_id: args.companyId,
      claim_id: claim.id,
      subcontract_line_id: id,
      this_period_pct: args.pct,
    })) as never,
  );
  if (error) throw error;
  return claim.id;
}

/**
 * Certify through the ENGINE, never by hand: an approved approval instance is
 * settled by `settle_derived_entity`, which is the only writer allowed past
 * the `subcontract_claim_engine_only` freeze — and which raises the AP invoice.
 */
export async function certifyClaim(
  svc: Svc,
  args: { companyId: string; claimId: string; deciderId: string },
): Promise<string> {
  const now = new Date().toISOString();
  const inst = await one<{ id: string }>(svc, "approval_instances", {
    company_id: args.companyId,
    entity: "subcontract_claims",
    entity_type: "subcontract_claim",
    entity_id: args.claimId,
    rule_key: "subcontract_claim_certify",
    status: "approved",
    requested_by: args.deciderId,
    decided_by: args.deciderId,
    decided_at: now,
    completed_at: now,
  });
  const { data, error } = await rpc(svc)("settle_derived_entity", { p_instance_id: inst.id });
  if (error) throw new Error(`settle_derived_entity: ${error.message}`);
  const settled = (data ?? {}) as { settled?: boolean; reason?: string };
  if (!settled.settled) throw new Error(`claim not settled: ${settled.reason ?? "unknown"}`);
  return inst.id;
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------
export interface SubcontractFixture {
  svc: Svc;
  companyId: string;
  projectId: string;
  admin: { userId: string; email: string; client: Svc };
  /** Internal member with no subcontract write role. */
  engineer: { userId: string; email: string; client: Svc };
  vendorA: string;
  vendorB: string;
  subA: { id: string; lineIds: string[] };
  subB: { id: string; lineIds: string[]; claimId: string };
  /** Portal seats — external viewers, one per vendor. */
  subUserA: { userId: string; client: Svc };
  subUserB: { userId: string; client: Svc };
  cleanup: () => Promise<void>;
}

export async function setupSubcontractFixture(): Promise<SubcontractFixture> {
  const svc = serviceClient();
  const tenants: string[] = [];
  const users: string[] = [];
  try {
    return await build(svc, tenants, users);
  } catch (err) {
    await purgeFixtureTenants(svc, tenants);
    await deleteFixtureUsers(svc, users);
    throw err;
  }
}

async function build(svc: Svc, tenants: string[], users: string[]): Promise<SubcontractFixture> {
  const companyId = await createTenant(svc, "sub");
  tenants.push(companyId);

  const admin = await createUser(svc, "p262-admin");
  users.push(admin.userId);
  await attachMember(svc, admin.userId, admin.email, companyId, ["company_admin"]);

  const engineer = await createUser(svc, "p262-eng");
  users.push(engineer.userId);
  await attachMember(svc, engineer.userId, engineer.email, companyId, ["engineer"]);

  const stamp = crypto.randomUUID().slice(0, 6).toUpperCase();
  const project = await one<{ id: string }>(svc, "projects", {
    company_id: companyId,
    code: `P262-${stamp}`,
    name: "P262 subcontract lifecycle",
    archetype: "utility_pv",
    phase: "ntp",
    status: "active",
    created_by: admin.userId,
  });

  const mkVendor = async (name: string) =>
    (
      await one<{ id: string }>(svc, "vendors", {
        company_id: companyId,
        name,
        categories: ["subcontractor"],
        status: "active",
        currency_code: "USD",
        created_by: admin.userId,
      })
    ).id;
  const vendorA = await mkVendor(`P262 Sub A ${stamp}`);
  const vendorB = await mkVendor(`P262 Sub B ${stamp}`);

  const mkSubcontract = async (vendorId: string, title: string, value: number) =>
    (
      await one<{ id: string }>(svc, "subcontracts", {
        company_id: companyId,
        project_id: project.id,
        vendor_id: vendorId,
        title,
        contract_value: value,
        currency_code: "USD",
        retention_pct: EXPECTED.retentionPct,
        payment_terms_days: EXPECTED.paymentTermsDays,
        status: "active",
        start_date: daysFromToday(-90),
        end_date: daysFromToday(30),
        // DLP already ended so the retention release is not an early call.
        defects_liability_end: daysFromToday(-1),
        created_by: admin.userId,
      })
    ).id;

  const subAId = await mkSubcontract(vendorA, "P262 balance of plant", EXPECTED.contractValue);
  const lineIds: string[] = [];
  for (const line of SOV) {
    const row = await one<{ id: string }>(svc, "subcontract_lines", {
      company_id: companyId,
      subcontract_id: subAId,
      line_no: line.line_no,
      description: line.description,
      qty: 1,
      unit_price: line.amount,
    });
    lineIds.push(row.id);
  }

  // Sub B — the isolation counterparty: its own subcontract and open claim.
  const subBId = await mkSubcontract(vendorB, "P262 fencing package", 10_000);
  const bLine = await one<{ id: string }>(svc, "subcontract_lines", {
    company_id: companyId,
    subcontract_id: subBId,
    line_no: 1,
    description: "Perimeter fence",
    qty: 1,
    unit_price: 10_000,
  });
  const bClaim = await submitClaim(svc, {
    companyId,
    subcontractId: subBId,
    lineIds: [bLine.id],
    pct: 50,
    periodStart: daysFromToday(-30),
    periodEnd: daysFromToday(-1),
    userId: admin.userId,
  });

  const mkSeat = async (vendorId: string, prefix: string) => {
    const u = await createUser(svc, prefix);
    users.push(u.userId);
    await attachMember(svc, u.userId, u.email, companyId, ["vendor_viewer"]);
    await seatPortalUser(svc, { companyId, vendorId, userId: u.userId, email: u.email });
    return { userId: u.userId, client: u.client };
  };
  const subUserA = await mkSeat(vendorA, "p262-suba");
  const subUserB = await mkSeat(vendorB, "p262-subb");

  return {
    svc,
    companyId,
    projectId: project.id,
    admin: { userId: admin.userId, email: admin.email, client: admin.client },
    engineer: { userId: engineer.userId, email: engineer.email, client: engineer.client },
    vendorA,
    vendorB,
    subA: { id: subAId, lineIds },
    subB: { id: subBId, lineIds: [bLine.id], claimId: bClaim },
    subUserA,
    subUserB,
    cleanup: async () => {
      await purgeFixtureTenants(svc, tenants);
      await deleteFixtureUsers(svc, users);
    },
  };
}

/** Protected tenants the purge path must never touch. */
export async function tenantSurvivors(svc: Svc): Promise<string[]> {
  const { data } = await svc.from("companies").select("slug").in("slug", ["gsi", "sandbox"]);
  return ((data ?? []) as { slug: string }[]).map((r) => r.slug).sort();
}

export async function tenantExists(svc: Svc, companyId: string): Promise<boolean> {
  const { data } = await svc.from("companies").select("id").eq("id", companyId).maybeSingle();
  return Boolean(data);
}
