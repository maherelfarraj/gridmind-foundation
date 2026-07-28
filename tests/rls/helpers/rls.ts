// P-132 — Shared RLS fixture helpers.
//
// These helpers talk directly to Lovable Cloud Supabase using service-role
// keys for setup/teardown and per-user JWT-scoped clients for assertions.
// RLS is evaluated as the authenticated user; the service-role client is
// NEVER used for assertions.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { deleteFixtureUsers, purgeFixtureTenants } from "../../helpers/fixture-teardown";

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

function jwtClient(token: string): SupabaseClient<Database> {
  return createClient<Database>(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export type TenantUser = {
  userId: string;
  email: string;
  password: string;
  jwt: string;
  client: SupabaseClient<Database>;
};

export type TenantDeps = {
  companyId: string;
  slug: string;
  projectId: string;
  opportunityId: string;
  costCodeId: string;
  vendorId: string;
  scadaAssetId: string | null;
  equipmentId: string | null;
};

export type Fixtures = {
  svc: SupabaseClient<Database>;
  A: TenantUser & TenantDeps;
  B: TenantUser & TenantDeps;
  // External portal viewer with NO company profile — only a portal membership
  // in company B. Used to prove that a viewer sees curated portal data but
  // zero internal rows via direct table SELECTs.
  viewer: TenantUser & { companyBId: string; projectBId: string; membershipId: string };
  cleanup: () => Promise<void>;
};

async function createUser(
  svc: SupabaseClient<Database>,
  emailPrefix: string,
): Promise<{ userId: string; email: string; password: string; jwt: string }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `${emailPrefix}-${suffix}@gm-rls-test.local`;
  const password = `Pw!${crypto.randomUUID()}`;
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");

  const auth = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error: signInErr } = await auth.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr || !signIn.session) throw signInErr ?? new Error("sign-in failed");
  return { userId: data.user.id, email, password, jwt: signIn.session.access_token };
}

async function seedTenant(
  svc: SupabaseClient<Database>,
  label: string,
  userId: string,
  email: string,
): Promise<TenantDeps> {
  const slug = `p132-${label}-${crypto.randomUUID().slice(0, 8)}`;
  const { data: co, error: coErr } = await svc
    .from("companies")
    .insert({ name: `P132 ${label}`, slug, plan_tier: "enterprise" })
    .select("id")
    .single();
  if (coErr || !co) throw coErr ?? new Error("company insert failed");

  await svc.from("profiles").upsert({ id: userId, company_id: co.id, email });
  await svc
    .from("user_roles")
    .insert({ user_id: userId, company_id: co.id, role: "company_admin" });

  const { data: proj, error: projErr } = await svc
    .from("projects")
    .insert({
      company_id: co.id,
      name: `P132 project ${label}`,
      code: `P132-${label.toUpperCase()}`,
      archetype: "utility_pv",
      phase: "development",
      status: "active",
      created_by: userId,
    })
    .select("id")
    .single();
  if (projErr || !proj) throw projErr ?? new Error("project insert failed");

  const { data: opp } = await svc
    .from("opportunities")
    .insert({ company_id: co.id, name: `Opp ${label}`, created_by: userId })
    .select("id")
    .single();

  const { data: cc } = await svc
    .from("cost_codes")
    .insert({
      company_id: co.id,
      project_id: proj.id,
      code: `CC-${label}`,
      name: `Cost ${label}`,
    })
    .select("id")
    .single();

  const { data: vendor } = await svc
    .from("vendors")
    .insert({ company_id: co.id, name: `Vendor ${label}` })
    .select("id")
    .single();

  const { data: asset, error: assetErr } = await svc
    .from("scada_assets")
    .insert({
      company_id: co.id,
      project_id: proj.id,
      asset_key: `AST-${label}-${crypto.randomUUID().slice(0, 6)}`,
      name: `Asset ${label}`,
      asset_type: "inverter",
    })
    .select("id")
    .single();
  if (assetErr || !asset) throw assetErr ?? new Error("scada_asset insert failed");

  const { data: equip } = await svc
    .from("equipment_registry")
    .insert({
      company_id: co.id,
      project_id: proj.id,
      tag: `EQ-${label}`,
      equipment_type: "inverter",
    })
    .select("id")
    .single();

  return {
    companyId: co.id,
    slug,
    projectId: proj.id,
    opportunityId: opp?.id ?? "",
    costCodeId: cc?.id ?? "",
    vendorId: vendor?.id ?? "",
    scadaAssetId: asset?.id ?? null,
    equipmentId: equip?.id ?? null,
  };
}

export async function setupFixtures(): Promise<Fixtures> {
  const svc = serviceClient();

  const [rawA, rawB, rawViewer] = await Promise.all([
    createUser(svc, "ua"),
    createUser(svc, "ub"),
    createUser(svc, "viewer"),
  ]);

  const [depsA, depsB] = await Promise.all([
    seedTenant(svc, "a", rawA.userId, rawA.email),
    seedTenant(svc, "b", rawB.userId, rawB.email),
  ]);

  // Viewer must exist in public.profiles because portal_memberships.user_id
  // FKs profiles(id). Attach the viewer profile to an ORPHAN company (no
  // user_roles, no shared data with A/B) so is_company_member(A|B) still
  // returns false — the invariant tests rely on. Poll auth until the row
  // is visible before writing the profile.
  for (let i = 0; i < 10; i++) {
    const { data: got } = await svc.auth.admin.getUserById(rawViewer.userId);
    if (got?.user) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const orphanSlug = `p132-viewer-${crypto.randomUUID().slice(0, 8)}`;
  const { data: orphanCo, error: orphanErr } = await svc
    .from("companies")
    .insert({ name: `P132 viewer-orphan`, slug: orphanSlug, plan_tier: "starter" })
    .select("id")
    .single();
  if (orphanErr || !orphanCo) throw orphanErr ?? new Error("viewer-orphan company insert failed");
  const { error: profErr } = await svc
    .from("profiles")
    .upsert({ id: rawViewer.userId, company_id: orphanCo.id, email: rawViewer.email });
  if (profErr) throw profErr;

  const { data: membership, error: memErr } = await svc
    .from("portal_memberships")
    .insert({
      company_id: depsB.companyId,
      project_id: depsB.projectId,
      user_id: rawViewer.userId,
      email: rawViewer.email,
      role: "client_viewer",
      status: "active",
      exposure: { milestones: true, kpis: true, photos: true },
      invited_by: rawB.userId,
    })
    .select("id")
    .single();
  if (memErr || !membership) throw memErr ?? new Error("portal_membership insert failed");

  const A: Fixtures["A"] = {
    ...depsA,
    userId: rawA.userId,
    email: rawA.email,
    password: rawA.password,
    jwt: rawA.jwt,
    client: jwtClient(rawA.jwt),
  };
  const B: Fixtures["B"] = {
    ...depsB,
    userId: rawB.userId,
    email: rawB.email,
    password: rawB.password,
    jwt: rawB.jwt,
    client: jwtClient(rawB.jwt),
  };
  const viewer: Fixtures["viewer"] = {
    userId: rawViewer.userId,
    email: rawViewer.email,
    password: rawViewer.password,
    jwt: rawViewer.jwt,
    client: jwtClient(rawViewer.jwt),
    companyBId: depsB.companyId,
    projectBId: depsB.projectId,
    membershipId: membership.id,
  };

  const cleanup = async () => {
    // P-250: audited purge path — a plain companies.delete() silently no-ops
    // whenever any child FK survives, which is how fixture tenants regrew.
    await purgeFixtureTenants(svc, [depsA.companyId, depsB.companyId, orphanCo.id]);
    await deleteFixtureUsers(svc, [rawA.userId, rawB.userId, rawViewer.userId]);
  };

  return { svc, A, B, viewer, cleanup };
}

// ---------------------------------------------------------------------------
// Matrix: table specs.
//
// A spec provides:
//   - `seedForB(ctx)`: service-role insert used to plant a row under company B
//   - `insertAsA(ctx)`: shape user A tries to insert with company_id = B
//
// Both must respect NOT NULL and enum constraints. RLS is what should reject
// the second call; the first should succeed unconditionally.
// ---------------------------------------------------------------------------

export type TableSpec = {
  group: string;
  table: string;
  seedForB: (f: Fixtures) => Record<string, unknown>;
  insertAsA: (f: Fixtures) => Record<string, unknown>;
  // Optional: skip the INSERT-denial half (e.g. profiles/user_roles/invites
  // where the row shape is inherently tied to auth.users identity and RLS is
  // proven by the SELECT half alone).
  skipInsertDenial?: boolean;
};

export const MATRIX: TableSpec[] = [
  // --- Tenancy -----------------------------------------------------------
  {
    group: "Tenancy",
    table: "profiles",
    seedForB: () => ({}), // profile already seeded by setup
    insertAsA: (f) => ({ id: crypto.randomUUID(), company_id: f.B.companyId, email: "x@x" }),
    skipInsertDenial: true, // profiles.id FK to auth.users; SELECT check suffices
  },
  {
    group: "Tenancy",
    table: "user_roles",
    seedForB: () => ({}),
    insertAsA: (f) => ({ user_id: f.A.userId, company_id: f.B.companyId, role: "engineer" }),
  },
  {
    group: "Tenancy",
    table: "invites",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      email: `seed-${crypto.randomUUID().slice(0, 6)}@x.local`,
      role: "engineer",
      token_hash: crypto.randomUUID().replace(/-/g, ""),
      invited_by: f.B.userId,
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      email: `evil-${crypto.randomUUID().slice(0, 6)}@x.local`,
      role: "engineer",
      token_hash: crypto.randomUUID().replace(/-/g, ""),
      invited_by: f.A.userId,
    }),
  },
  // --- Projects ----------------------------------------------------------
  {
    group: "Projects",
    table: "projects",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      name: "B extra",
      code: `B-EXTRA-${crypto.randomUUID().slice(0, 6)}`,
      archetype: "utility_pv",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      name: "A hijack",
      code: `A-HIJACK-${crypto.randomUUID().slice(0, 6)}`,
      archetype: "utility_pv",
    }),
  },
  {
    group: "Projects",
    table: "project_members",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      user_id: f.B.userId,
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      user_id: f.A.userId,
    }),
  },
  {
    group: "Projects",
    table: "project_phase_gates",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      phase: "development",
      name: "Gate B",
      sort_order: 1,
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      phase: "development",
      name: "Gate A hijack",
      sort_order: 99,
    }),
  },
  // --- CRM ---------------------------------------------------------------
  {
    group: "CRM",
    table: "leads",
    seedForB: (f) => ({ company_id: f.B.companyId, name: "Lead B" }),
    insertAsA: (f) => ({ company_id: f.B.companyId, name: "Lead A hijack" }),
  },
  {
    group: "CRM",
    table: "opportunities",
    seedForB: (f) => ({ company_id: f.B.companyId, name: "Opp B" }),
    insertAsA: (f) => ({ company_id: f.B.companyId, name: "Opp A hijack" }),
  },
  {
    group: "CRM",
    table: "proposals",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      opportunity_id: f.B.opportunityId,
      title: "Proposal B",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      opportunity_id: f.B.opportunityId,
      title: "Proposal A hijack",
    }),
  },
  // --- Procurement -------------------------------------------------------
  {
    group: "Procurement",
    table: "vendors",
    seedForB: (f) => ({ company_id: f.B.companyId, name: "Vendor extra B" }),
    insertAsA: (f) => ({ company_id: f.B.companyId, name: "Vendor A hijack" }),
  },
  {
    group: "Procurement",
    table: "rfqs",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      rfq_number: `RFQ-B-${crypto.randomUUID().slice(0, 6)}`,
      title: "RFQ B",
      currency_code: "USD",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      rfq_number: `RFQ-A-${crypto.randomUUID().slice(0, 6)}`,
      title: "RFQ A hijack",
      currency_code: "USD",
    }),
  },
  {
    group: "Procurement",
    table: "purchase_orders",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      vendor_id: f.B.vendorId,
      po_number: `PO-B-${crypto.randomUUID().slice(0, 6)}`,
      currency_code: "USD",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      vendor_id: f.B.vendorId,
      po_number: `PO-A-${crypto.randomUUID().slice(0, 6)}`,
      currency_code: "USD",
    }),
  },
  // --- Finance -----------------------------------------------------------
  {
    group: "Finance",
    table: "budgets",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      cost_code_id: f.B.costCodeId,
      currency_code: "USD",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      cost_code_id: f.B.costCodeId,
      currency_code: "USD",
    }),
  },
  {
    group: "Finance",
    table: "invoices",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      invoice_number: `INV-B-${crypto.randomUUID().slice(0, 6)}`,
      direction: "payable",
      currency_code: "USD",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      invoice_number: `INV-A-${crypto.randomUUID().slice(0, 6)}`,
      direction: "payable",
      currency_code: "USD",
    }),
  },
  {
    group: "Finance",
    table: "change_orders",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      co_number: `CO-B-${crypto.randomUUID().slice(0, 6)}`,
      title: "CO B",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      co_number: `CO-A-${crypto.randomUUID().slice(0, 6)}`,
      title: "CO A hijack",
    }),
  },
  // --- Field -------------------------------------------------------------
  {
    group: "Field",
    table: "construction_daily_reports",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      report_date: "2026-01-01",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      report_date: "2026-01-02",
    }),
  },
  {
    group: "Field",
    table: "hse_incidents",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      incident_number: `INC-B-${crypto.randomUUID().slice(0, 6)}`,
      incident_type: "near_miss",
      occurred_at: new Date().toISOString(),
      description: "seed",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      incident_number: `INC-A-${crypto.randomUUID().slice(0, 6)}`,
      incident_type: "near_miss",
      occurred_at: new Date().toISOString(),
      description: "hijack",
    }),
  },
  {
    group: "Field",
    table: "qaqc_inspections",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      inspection_number: `QA-B-${crypto.randomUUID().slice(0, 6)}`,
      discipline: "electrical",
      area: "A1",
      inspection_date: "2026-01-01",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      inspection_number: `QA-A-${crypto.randomUUID().slice(0, 6)}`,
      discipline: "electrical",
      area: "A1",
      inspection_date: "2026-01-02",
    }),
  },
  // --- Commissioning -----------------------------------------------------
  {
    group: "Commissioning",
    table: "commissioning_tests",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      area: "Block-1",
      test_type: "functional",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      area: "Block-1",
      test_type: "functional",
    }),
  },
  {
    group: "Commissioning",
    table: "performance_tests",
    seedForB: (f) => ({ company_id: f.B.companyId, project_id: f.B.projectId }),
    insertAsA: (f) => ({ company_id: f.B.companyId, project_id: f.B.projectId }),
  },
  // --- O&M ---------------------------------------------------------------
  {
    group: "O&M",
    table: "equipment_registry",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      tag: `EQ-B-${crypto.randomUUID().slice(0, 6)}`,
      equipment_type: "inverter",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      tag: `EQ-A-${crypto.randomUUID().slice(0, 6)}`,
      equipment_type: "inverter",
    }),
  },
  {
    group: "O&M",
    table: "work_orders",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      wo_number: `WO-B-${crypto.randomUUID().slice(0, 6)}`,
      title: "WO B",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      wo_number: `WO-A-${crypto.randomUUID().slice(0, 6)}`,
      title: "WO A hijack",
    }),
  },
  {
    group: "O&M",
    table: "scada_telemetry",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      scada_asset_id: f.B.scadaAssetId,
      ts: new Date().toISOString(),
      metric: "ac_power_kw",
      value: 100,
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      scada_asset_id: f.B.scadaAssetId,
      ts: new Date().toISOString(),
      metric: "ac_power_kw",
      value: 999,
    }),
  },
  // --- Portals -----------------------------------------------------------
  {
    group: "Portals",
    table: "portal_memberships",
    seedForB: () => ({}), // seeded by setup
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      user_id: f.A.userId,
      email: "evil@x.local",
      role: "client_viewer",
    }),
  },
  {
    group: "Portals",
    table: "investor_share_links",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      label: "Seed B share",
      token_hash: "a".repeat(64),
      role: "investor_viewer",
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      scope: { project_ids: [f.B.projectId], sections: ["milestones"] },
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      label: "Hijack share",
      token_hash: "b".repeat(64),
      role: "investor_viewer",
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      scope: { project_ids: [f.B.projectId], sections: ["milestones"] },
    }),
  },
  {
    group: "Portals",
    table: "portal_tickets",
    seedForB: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      subject: "Seed B ticket",
    }),
    insertAsA: (f) => ({
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      subject: "Hijack ticket",
    }),
  },
];
