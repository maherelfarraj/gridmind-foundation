// GC-17 browser fixtures — deterministic, tenant-isolated seed data.
//
// Service role is setup/teardown only; it never appears in an assertion. The
// seeded tenant is purged through the audited `fixture_purge_tenants` path.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const URL_ = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const ANON =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const ARTIFACT_DIR = path.resolve(process.cwd(), "test-results/browser-fixture");
export const FIXTURE_FILE = path.join(ARTIFACT_DIR, "fixture.json");

/** Every governed alert family, rendered one row each so all 16 are identifiable. */
export const FAMILIES = [
  "high_exposure",
  "probability_impact_increase",
  "new_top_contributor",
  "p80_budget_breach",
  "p90_schedule_breach",
  "contingency_inadequacy",
  "burn_rate_spike",
  "unlinked_drawdown",
  "overdue_mitigation",
  "stale_simulation",
  "input_quality",
  "fx_materiality",
  "double_count",
  "funding_mismatch",
  "reserve_expiry",
  "sod_exception",
] as const;

export type Family = (typeof FAMILIES)[number];

export interface Fixture {
  suffix: string;
  companyId: string;
  projectId: string;
  projectCode: string;
  writerId: string;
  readerId: string;
  /** family -> alert id */
  alerts: Record<string, string>;
  storage: { writer: string; writerAr: string; reader: string };
}

export function envReady(): boolean {
  return Boolean(URL_ && ANON && SERVICE);
}

export function service(): SupabaseClient {
  return createClient(URL_, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function readFixture(): Fixture {
  return JSON.parse(fs.readFileSync(FIXTURE_FILE, "utf8")) as Fixture;
}

const projectRef = /https:\/\/([^.]+)\./.exec(URL_)?.[1] ?? "";
const STORAGE_KEY = `sb-${projectRef}-auth-token`;

/** Signs the user in over the Supabase HTTP API and writes a Playwright storageState. */
async function storageStateFor(email: string, password: string, file: string): Promise<void> {
  const c = createClient(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw error ?? new Error(`sign-in failed for ${email}`);
  const origin = process.env.GC17_BASE_URL ?? "http://localhost:8080";
  fs.writeFileSync(
    file,
    JSON.stringify({
      cookies: [],
      origins: [
        {
          origin,
          localStorage: [{ name: STORAGE_KEY, value: JSON.stringify(data.session) }],
        },
      ],
    }),
    "utf8",
  );
}

export async function seedFixture(): Promise<Fixture> {
  const svc = service();
  const suffix = crypto.randomUUID().slice(0, 8);
  const password = `Pw!${crypto.randomUUID()}`;
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const { data: co, error: coErr } = await svc
    .from("companies")
    .insert({ name: `GC17 browser ${suffix}`, slug: `gc17-pw-${suffix}`, plan_tier: "enterprise" })
    .select("id")
    .single();
  if (coErr || !co) throw coErr ?? new Error("company insert failed");
  const companyId = (co as { id: string }).id;

  async function makeUser(prefix: string, roles: string[], locale: "en" | "ar") {
    const email = `gc17-pw-${prefix}-${suffix}@gm-e2e.local`;
    const { data: u, error } = await svc.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !u.user) throw error ?? new Error("createUser failed");
    await svc.from("profiles").upsert({
      id: u.user.id,
      company_id: companyId,
      email,
      full_name: `GC17 ${prefix}`,
      locale,
    });
    for (const role of roles) {
      const { error: rErr } = await svc
        .from("user_roles")
        .insert({ user_id: u.user.id, company_id: companyId, role });
      if (rErr) throw rErr;
    }
    return { id: u.user.id, email };
  }

  const writer = await makeUser("w", ["company_admin", "project_admin"], "en");
  const writerAr = await makeUser("ar", ["company_admin", "project_admin"], "ar");
  const reader = await makeUser("r", [], "en");

  const projectCode = `G17B-${suffix.slice(0, 4).toUpperCase()}`;
  const { data: proj, error: pErr } = await svc
    .from("projects")
    .insert({
      company_id: companyId,
      name: `GC17 browser project ${suffix}`,
      code: projectCode,
      status: "active",
      archetype: "utility_pv",
    })
    .select("id")
    .single();
  if (pErr || !proj) throw pErr ?? new Error("project insert failed");
  const projectId = (proj as { id: string }).id;

  // One alert per family. `sod_exception` starts at info so the escalation
  // ladder (info → warning → critical) is exercisable in the browser.
  const rows = FAMILIES.map((family, i) => ({
    company_id: companyId,
    project_id: projectId,
    family,
    severity: family === "sod_exception" ? "info" : "warning",
    status: "open",
    dedupe_key: `gc17-pw|${family}|${projectId}|${suffix}`,
    title: `GC17 ${family} ${suffix}`,
    detail: `Deterministic browser fixture row ${i + 1} of ${FAMILIES.length}.`,
  }));
  const { data: inserted, error: aErr } = await svc
    .from("risk_contingency_alerts")
    .insert(rows)
    .select("id, family");
  if (aErr || !inserted) throw aErr ?? new Error("alert insert failed");
  const alerts: Record<string, string> = {};
  for (const r of inserted as { id: string; family: string }[]) alerts[r.family] = r.id;

  const storage = {
    writer: path.join(ARTIFACT_DIR, "writer.json"),
    writerAr: path.join(ARTIFACT_DIR, "writer-ar.json"),
    reader: path.join(ARTIFACT_DIR, "reader.json"),
  };
  await storageStateFor(writer.email, password, storage.writer);
  await storageStateFor(writerAr.email, password, storage.writerAr);
  await storageStateFor(reader.email, password, storage.reader);

  const fixture: Fixture = {
    suffix,
    companyId,
    projectId,
    projectCode,
    writerId: writer.id,
    readerId: reader.id,
    alerts,
    storage,
  };
  fs.writeFileSync(FIXTURE_FILE, JSON.stringify(fixture, null, 2), "utf8");
  return fixture;
}

export async function purgeFixture(companyId: string): Promise<void> {
  const svc = service();
  const { error } = await svc.rpc("fixture_purge_tenants", { p_company_ids: [companyId] });
  if (error) throw error;
}
