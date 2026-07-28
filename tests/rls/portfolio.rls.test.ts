// P-256 — Portfolio RPC access-control suite.
//
// Doctrine (portfolio_guard, Blueprint addendum): every cross-project RPC is
// SECURITY DEFINER, denies anon and all four external-viewer roles, resolves
// the tenant from the caller's profile (never from an argument), and writes
// one ops.portfolio_view audit row per call.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { deleteFixtureUsers, purgeFixtureTenants } from "../helpers/fixture-teardown";
import {
  anonClient,
  attachProfile,
  createTenant,
  createUser,
  isSupabaseUp,
  serviceClient,
  setupPortfolioFixture,
  type PortfolioFixture,
} from "../portfolio/fixtures";

const up = await isSupabaseUp();
const d = up ? describe : describe.skip;

const EXTERNAL_ROLES = [
  "client_viewer",
  "investor_viewer",
  "lender_viewer",
  "vendor_viewer",
] as const;

type Rpc = { name: string; args?: Record<string, unknown> };

const RPCS: Rpc[] = [
  { name: "portfolio_kpis" },
  { name: "portfolio_gates" },
  { name: "portfolio_project_cards" },
  { name: "portfolio_hse_quality" },
  { name: "portfolio_hse_exposure" },
  { name: "portfolio_cash_curve", args: { p_months: 6 } },
  { name: "portfolio_cash_curve_projects", args: { p_back: 6, p_forward: 3 } },
  { name: "portfolio_cash_month", args: { p_month: new Date().toISOString().slice(0, 8) + "01" } },
];

const call = (client: SupabaseClient<Database>, rpc: Rpc) =>
  client.rpc(rpc.name as never, (rpc.args ?? {}) as never);

d("P-256 · portfolio RPC guard (external viewers, tenancy, audit)", () => {
  let fx: PortfolioFixture;
  const svc = serviceClient();
  const externals: Record<string, SupabaseClient<Database>> = {};
  const externalIds: string[] = [];
  let otherCompanyId = "";
  let otherUserId = "";
  let otherClient: SupabaseClient<Database>;

  beforeAll(async () => {
    fx = await setupPortfolioFixture();

    for (const role of EXTERNAL_ROLES) {
      const u = await createUser(svc, `p256-${role}`);
      await attachProfile(svc, u.userId, u.email, fx.companyId, role);
      externals[role] = u.client;
      externalIds.push(u.userId);
    }

    const other = await createTenant(svc, "other");
    otherCompanyId = other.companyId;
    const ou = await createUser(svc, "p256-other");
    await attachProfile(svc, ou.userId, ou.email, otherCompanyId, "company_admin");
    otherUserId = ou.userId;
    otherClient = ou.client;
  }, 180_000);

  afterAll(async () => {
    await purgeFixtureTenants(svc, [otherCompanyId]);
    await deleteFixtureUsers(svc, [...externalIds, otherUserId]);
    await fx?.cleanup();
  }, 180_000);

  for (const role of EXTERNAL_ROLES) {
    it(`denies ${role} on every portfolio RPC`, async () => {
      for (const rpc of RPCS) {
        const { error } = await call(externals[role], rpc);
        expect(error, `${role} → ${rpc.name} should be denied`).not.toBeNull();
        expect(error!.message).toContain("portfolio_access_denied");
      }
    });
  }

  it("denies anonymous callers on every portfolio RPC", async () => {
    const anon = anonClient();
    for (const rpc of RPCS) {
      const { error } = await call(anon, rpc);
      expect(error, `anon → ${rpc.name} should be denied`).not.toBeNull();
    }
  });

  it("scopes aggregation to the caller's own company", async () => {
    const mine = await fx.client.rpc("portfolio_kpis");
    expect(mine.error).toBeNull();
    expect(Number((mine.data as Record<string, never>).projects.total)).toBe(3);

    const theirs = await otherClient.rpc("portfolio_kpis");
    expect(theirs.error).toBeNull();
    expect(Number((theirs.data as Record<string, never>).projects.total)).toBe(0);

    const theirCards = await otherClient.rpc("portfolio_project_cards");
    expect(theirCards.error).toBeNull();
    expect(theirCards.data ?? []).toHaveLength(0);

    const myCards = await fx.client.rpc("portfolio_project_cards");
    const codes = ((myCards.data ?? []) as Array<{ project_code: string }>).map(
      (r) => r.project_code,
    );
    expect(codes).toEqual([fx.codes.A, fx.codes.B, fx.codes.C]);
  });

  it("writes an ops.portfolio_view audit row per call, scoped to the tenant", async () => {
    const before = await svc
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", fx.companyId)
      .eq("action", "ops.portfolio_view");

    const { error } = await fx.client.rpc("portfolio_hse_exposure");
    expect(error).toBeNull();

    const after = await svc
      .from("audit_logs")
      .select("actor_id, metadata", { count: "exact" })
      .eq("company_id", fx.companyId)
      .eq("action", "ops.portfolio_view")
      .order("created_at", { ascending: false })
      .limit(1);

    expect((after.count ?? 0) > (before.count ?? 0)).toBe(true);
    expect(after.data?.[0]?.actor_id).toBe(fx.userId);
    expect((after.data?.[0]?.metadata as { rpc?: string })?.rpc).toBe("portfolio_hse_exposure");
  });
});
